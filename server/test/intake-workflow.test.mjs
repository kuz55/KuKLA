import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../dist/config.js';
import { buildApp } from '../dist/app.js';
import { IntakeService } from '../dist/intake/service.js';

// Real PostgreSQL engine in WASM, with pg's pool/client surface adapted for
// this isolated test. Full PostgreSQL migration-runner tests run separately.
test('experimental intake: explicit access, safe handoff, audit and rollback', async () => {
  const db = new PGlite();
  const oldQuery = pool.query;
  const oldConnect = pool.connect;
  const previous = process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE;
  let app;
  try {
    await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY, name text, email text, phone text, role text, active boolean);
      CREATE TABLE sessions(token_hash text, user_id uuid REFERENCES users(id), expires_at timestamptz);
      CREATE TABLE searches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, status text NOT NULL DEFAULT 'PLANNED', created_by uuid REFERENCES users(id));
      CREATE TABLE search_members(search_id uuid REFERENCES searches(id), user_id uuid REFERENCES users(id), PRIMARY KEY(search_id,user_id));
      CREATE TABLE search_organizations(search_id uuid, organization_id uuid);
      CREATE TABLE organization_members(organization_id uuid, user_id uuid, active boolean);
      CREATE TABLE events(search_id uuid REFERENCES searches(id), user_id uuid REFERENCES users(id), type text, payload jsonb);`);
    await db.exec(await readFile(new URL('../sql/010_initial_reports.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../sql/011_intake_workflow_foundation.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../sql/012_intake_resolution.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../sql/013_intake_idempotency.sql', import.meta.url), 'utf8'));
    const operator = randomUUID(), other = randomUUID(), registrar = randomUUID(), outsider = randomUUID();
    for (const id of [operator, other, registrar, outsider]) {
      await db.query("INSERT INTO users(id,name,role,active) VALUES ($1,'test','VIEWER',true)", [id]);
    }
    await db.query("INSERT INTO intake_permissions VALUES ($1,'RECORD'),($2,'RECORD'),($3,'REGISTER')", [operator, other, registrar]);
    const client = { query: (sql, params) => db.query(sql, params), release: () => {} };
    pool.query = (sql, params) => db.query(sql, params);
    pool.connect = async () => client;
    process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE = 'true';
    app = await buildApp();
    const tokenFor = async (id) => {
      const token = app.jwt.sign({ id, role: 'VIEWER', name: 'test' });
      const hash = createHash('sha256').update(token).digest('hex');
      await db.query("INSERT INTO sessions VALUES ($1,$2,now() + interval '1 hour')", [hash, id]);
      return token;
    };
    const tokens = {};
    for (const id of [operator, other, registrar, outsider]) tokens[id] = await tokenFor(id);
    const request = (method, url, id, payload, key = randomUUID()) => app.inject({ method, url, headers: { ...(id ? { authorization: `Bearer ${tokens[id]}` } : {}), 'idempotency-key': key }, payload });
    const input = { applicantName: 'Анна', applicantContact: '555-0100', missingPersonName: null, lastSeenTime: null, lastSeenPlace: null, situation: null };
    const endpoint = '/api/v1/intake/reports';
    assert.equal((await request('POST', endpoint, undefined, input)).statusCode, 401);
    assert.equal((await request('POST', endpoint, outsider, input)).statusCode, 403);
    assert.equal((await request('POST', endpoint, registrar, input)).statusCode, 403);
    assert.equal((await request('POST', endpoint, operator, { ...input, situation: '  ' })).statusCode, 400);
    const initialKey = randomUUID();
    const created = await request('POST', endpoint, operator, input, initialKey);
    assert.equal(created.statusCode, 201);
    assert.equal(created.headers['cache-control'], 'no-store');
    const id = created.json().id;
    const replay = await request('POST', endpoint, operator, input, initialKey);
    assert.deepEqual(replay.json(), created.json());
    assert.equal((await request('POST', endpoint, operator, { ...input, situation: 'Changed' }, initialKey)).statusCode, 409);
    assert.equal((await request('POST', endpoint, operator, input, 'not-a-uuid')).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: endpoint, headers: { authorization: `Bearer ${tokens[operator]}` }, payload: input })).statusCode, 400);

    assert.equal((await request('GET', `${endpoint}/${id}`, registrar)).statusCode, 404, 'draft must not reach registrar');
    assert.equal((await request('POST', `${endpoint}/${id}/handoff`, other)).statusCode, 404);
    assert.equal((await request('POST', `${endpoint}/${id}/handoff`, operator)).statusCode, 200);
    assert.equal((await request('POST', `${endpoint}/${id}/handoff`, operator)).statusCode, 200);
    assert.equal((await request('GET', '/api/v1/intake/queue', operator)).statusCode, 403);
    assert.equal((await request('GET', `${endpoint}/${id}`, outsider)).statusCode, 403);
    const queue = await request('GET', '/api/v1/intake/queue', registrar);
    assert.equal(queue.statusCode, 200);
    assert.equal(queue.json().items.length, 1);
    assert.equal(queue.json().nextCursor, null);
    assert.equal(queue.body.includes('Анна'), false, 'queue must not expose names');
    const detail = await request('GET', `${endpoint}/${id}`, registrar);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().applicant_contact, '555-0100');
    const second = await request('POST', endpoint, operator, input);
    const secondId = second.json().id;
    await request('POST', `${endpoint}/${secondId}/handoff`, operator);
    const firstPage = (await request('GET', '/api/v1/intake/queue?limit=1', registrar)).json();
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.nextCursor);
    const secondPage = (await request('GET', `/api/v1/intake/queue?limit=1&after=${firstPage.nextCursor}`, registrar)).json();
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
    assert.equal(secondPage.nextCursor, null);
    assert.equal((await request('GET', '/api/v1/intake/queue?limit=101', registrar)).statusCode, 400);
    const audit = await db.query('SELECT action FROM initial_report_audit WHERE report_id=$1 ORDER BY id', [id]);
    assert.deepEqual(audit.rows.map((r) => r.action), ['CREATED', 'HANDED_OFF']);
    // Existing searches must already be visible to the registrar; linking
    // cannot create access to a foreign search.
    const searchId = randomUUID();
    await db.query("INSERT INTO searches(id,title,created_by) VALUES($1,'Existing',$2)", [searchId, other]);
    assert.equal((await request('POST', `${endpoint}/${id}/link-search`, registrar, { searchId })).statusCode, 404);
    await db.query('INSERT INTO search_members(search_id,user_id) VALUES ($1,$2)', [searchId, registrar]);
    assert.equal((await request('POST', `${endpoint}/${id}/link-search`, outsider, { searchId })).statusCode, 403);
    assert.equal((await request('POST', `${endpoint}/${id}/link-search`, registrar, { searchId })).statusCode, 200);
    assert.equal((await request('POST', `${endpoint}/${id}/close`, registrar, { reason: 'duplicate' })).statusCode, 409);
    assert.equal((await request('GET', `${endpoint}/${id}`, registrar)).json().search_id, searchId);
    assert.equal((await request('GET', '/api/v1/intake/queue', registrar)).json().items.some(r => r.id === id), false);
    // A cursor stays usable after the item it references was resolved.
    assert.equal(firstPage.items[0].id, id);
    const afterResolved = (await request('GET', `/api/v1/intake/queue?limit=1&after=${id}`, registrar)).json();
    assert.equal(afterResolved.items[0].id, secondId);
    const linkedAudit = await db.query('SELECT action,search_id FROM initial_report_audit WHERE report_id=$1 ORDER BY id DESC LIMIT 1', [id]);
    assert.deepEqual(linkedAudit.rows[0], { action: 'SEARCH_LINKED', search_id: searchId });

    // Closing without a search requires a reason and is visible in the audit.
    assert.equal((await request('POST', `${endpoint}/${secondId}/close`, registrar, { reason: '  ' })).statusCode, 400);
    assert.equal((await request('POST', `${endpoint}/${secondId}/close`, registrar, { reason: ' Вопрос не о поиске ' })).statusCode, 200);
    const closed = (await request('GET', `${endpoint}/${secondId}`, registrar)).json();
    assert.equal(closed.resolution_reason, 'Вопрос не о поиске');
    const closeAudit = await db.query('SELECT action,reason,actor_id FROM initial_report_audit WHERE report_id=$1 ORDER BY id DESC LIMIT 1', [secondId]);
    assert.deepEqual(closeAudit.rows[0], { action: 'CLOSED_WITHOUT_SEARCH', reason: 'Вопрос не о поиске', actor_id: registrar });
    assert.equal((await request('POST', `${endpoint}/${secondId}/create-search`, registrar, { title: 'Search' })).statusCode, 409);

    // Creating a search links it atomically and gives the registrar membership.
    const third = (await request('POST', endpoint, operator, input)).json().id;
    assert.equal((await request('POST', `${endpoint}/${third}/create-search`, registrar, { title: 'Test search' })).statusCode, 404);
    await request('POST', `${endpoint}/${third}/handoff`, operator);
    assert.equal((await request('POST', `${endpoint}/${third}/create-search`, registrar, { title: ' ' })).statusCode, 400);
    const made = await request('POST', `${endpoint}/${third}/create-search`, registrar, { title: ' Test search ' });
    assert.equal(made.statusCode, 201);
    const createdSearchId = made.json().searchId;
    const search = await db.query('SELECT title,status,created_by FROM searches WHERE id=$1', [createdSearchId]);
    assert.deepEqual(search.rows[0], { title: 'Test search', status: 'PLANNED', created_by: registrar });
    assert.equal((await db.query('SELECT * FROM search_members WHERE search_id=$1 AND user_id=$2', [createdSearchId, registrar])).rowCount, 1);
    assert.equal((await db.query("SELECT * FROM events WHERE search_id=$1 AND type='SEARCH_CREATED'", [createdSearchId])).rowCount, 1);
    assert.equal((await request('GET', `${endpoint}/${third}`, registrar)).json().search_id, createdSearchId);
    const countBefore = (await db.query('SELECT count(*)::int AS n FROM initial_reports')).rows[0].n;
    const failingClient = { ...client, query: (sql, params) => {
      if (sql.startsWith('INSERT INTO initial_report_audit')) throw new Error('simulated audit failure');
      return db.query(sql, params);
    } };
    const service = new IntakeService({ connect: async () => failingClient });
    const retryKey = randomUUID();
    await assert.rejects(service.create(operator, input, retryKey), /simulated audit failure/);
    const countAfter = (await db.query('SELECT count(*)::int AS n FROM initial_reports')).rows[0].n;
    assert.equal(countBefore, countAfter, 'failed audit must roll back report');
    assert.ok((await new IntakeService(pool).create(operator, input, retryKey)).id, 'rolled-back key can be retried');
    await assert.rejects(db.query('INSERT INTO initial_reports(recorded_by,request_key) VALUES($1,$2)', [operator, randomUUID()]));
    const draft = await request('POST', endpoint, operator, input);
    const draftId = draft.json().id;
    await assert.rejects(service.handOff(operator, draftId), /simulated audit failure/);
    const draftRow = await db.query('SELECT handed_off_at FROM initial_reports WHERE id=$1', [draftId]);
    assert.equal(draftRow.rows[0].handed_off_at, null, 'failed audit must roll back handoff');
    await request('POST', `${endpoint}/${draftId}/handoff`, operator);
    const countSearches = (await db.query('SELECT count(*)::int AS n FROM searches')).rows[0].n;
    await assert.rejects(service.createSearch(registrar, draftId, 'Rollback search'), /simulated audit failure/);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM searches')).rows[0].n, countSearches);
    assert.equal((await db.query('SELECT resolved_at FROM initial_reports WHERE id=$1', [draftId])).rows[0].resolved_at, null);
    await assert.rejects(service.closeWithoutSearch(registrar, draftId, 'No search'), /simulated audit failure/);
    assert.equal((await db.query('SELECT resolved_at FROM initial_reports WHERE id=$1', [draftId])).rows[0].resolved_at, null);
    await assert.rejects(db.query('UPDATE initial_reports SET resolved_at=now(),resolved_by=$1 WHERE id=$2', [registrar, draftId]));
    await assert.rejects(db.query('UPDATE initial_reports SET resolved_at=now(),resolved_by=$1,resolution_reason=$2,search_id=$3 WHERE id=$4', [registrar, 'reason', searchId, draftId]));
    await db.query("DELETE FROM intake_permissions WHERE user_id=$1 AND permission='REGISTER'", [registrar]);
    assert.equal((await request('GET', `${endpoint}/${id}`, registrar)).statusCode, 403, 'revocation takes effect');
    await db.query('UPDATE users SET active=false WHERE id=$1', [operator]);
    assert.equal((await request('POST', endpoint, operator, input)).statusCode, 401, 'inactive users cannot record reports');
  } finally {
    if (app) await app.close();
    pool.query = oldQuery;
    pool.connect = oldConnect;
    if (previous === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE;
    else process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE = previous;
    await db.close();
  }
});

test('intake routes are not registered by default', async () => {
  const previous = process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE;
  delete process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE;
  const app = await buildApp();
  try {
    const r = await app.inject({ method: 'GET', url: '/api/v1/intake/queue' });
    assert.equal(r.statusCode, 404);
  } finally {
    await app.close();
    if (previous !== undefined) process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE = previous;
  }
});

test('experimental intake cannot be enabled in production', async () => {
  const oldEnv = process.env.NODE_ENV;
  const oldFlag = process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE;
  process.env.NODE_ENV = 'production';
  process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE = 'true';
  const app = await buildApp();
  try {
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/intake/queue' })).statusCode, 404);
  } finally {
    await app.close();
    if (oldEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnv;
    if (oldFlag === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE; else process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE = oldFlag;
  }
});
