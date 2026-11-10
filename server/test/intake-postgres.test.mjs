import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { IntakeService } from '../dist/intake/service.js';

// Exercises row locking with two actual PostgreSQL connections; PGlite's
// single connection cannot validate this concurrency property.
test('PostgreSQL serializes conflicting registrar resolutions', async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla' });
  const operator = randomUUID(), first = randomUUID(), second = randomUUID(), report = randomUUID();
  try {
    for (const id of [operator, first, second]) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Intake test',$2,'test-hash','VIEWER',true)", [id, `${id}@example.invalid`]);
    }
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'REGISTER'),($2,'REGISTER')", [first, second]);
    await pool.query('INSERT INTO initial_reports(id,recorded_by,handed_off_at) VALUES($1,$2,now())', [report, operator]);
    const intake = new IntakeService(pool);
    const outcomes = await Promise.allSettled([
      intake.closeWithoutSearch(first, report, 'First reason'),
      intake.closeWithoutSearch(second, report, 'Second reason'),
    ]);
    assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
    const rejected = outcomes.find((x) => x.status === 'rejected');
    assert.equal(rejected.reason.statusCode, 409);
    const row = (await pool.query('SELECT resolved_by,resolution_reason FROM initial_reports WHERE id=$1', [report])).rows[0];
    assert.ok([first, second].includes(row.resolved_by));
    const audit = (await pool.query('SELECT actor_id,reason FROM initial_report_audit WHERE report_id=$1', [report])).rows;
    assert.deepEqual(audit, [{ actor_id: row.resolved_by, reason: row.resolution_reason }]);
  } finally {
    await pool.query('DELETE FROM initial_report_audit WHERE report_id=$1', [report]);
    await pool.query('DELETE FROM initial_reports WHERE id=$1', [report]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[operator, first, second]]);
    await pool.end();
  }
});

test('PostgreSQL deduplicates concurrent creation and handoff retries', async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla' });
  const operator = randomUUID(), other = randomUUID(), key = randomUUID();
  const input = { applicantName: ' Test ', applicantContact: null, missingPersonName: null, lastSeenTime: null, lastSeenPlace: null, situation: null };
  try {
    for (const id of [operator, other]) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Intake test',$2,'test-hash','VIEWER',true)", [id, `${id}@example.invalid`]);
      await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'RECORD')", [id]);
    }
    const intake = new IntakeService(pool);
    const results = await Promise.all(Array.from({ length: 8 }, () => intake.create(operator, input, key)));
    assert.ok(results.every((r) => r.id === results[0].id && +r.receivedAt === +results[0].receivedAt));
    const id = results[0].id;
    assert.equal((await intake.create(operator, { ...input, applicantName: 'Test' }, key)).id, id);
    await assert.rejects(intake.create(operator, { ...input, applicantName: 'Different' }, key), { statusCode: 409 });
    const otherReport = await intake.create(other, input, key);
    assert.notEqual(otherReport.id, id);
    const handoffs = await Promise.all(Array.from({ length: 8 }, () => intake.handOff(operator, id)));
    assert.ok(handoffs.every((r) => +r.handedOffAt === +handoffs[0].handedOffAt));
    const audit = (await pool.query('SELECT action FROM initial_report_audit WHERE report_id=$1 ORDER BY id', [id])).rows.map((r) => r.action);
    assert.deepEqual(audit, ['CREATED', 'HANDED_OFF']);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM initial_reports WHERE recorded_by=$1', [operator])).rows[0].n, 1);
    await pool.query("DELETE FROM intake_permissions WHERE user_id=$1 AND permission='RECORD'", [operator]);
    await assert.rejects(intake.create(operator, input, key), { statusCode: 403 });
    await assert.rejects(intake.handOff(operator, id), { statusCode: 403 });
  } finally {
    await pool.query('DELETE FROM initial_report_audit WHERE report_id IN (SELECT id FROM initial_reports WHERE recorded_by=ANY($1::uuid[]))', [[operator, other]]);
    await pool.query('DELETE FROM initial_reports WHERE recorded_by=ANY($1::uuid[])', [[operator, other]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[operator, other]]);
    await pool.end();
  }
});

test('PostgreSQL-backed HTTP intake enforces authorization through resolution', async () => {
  const { buildApp } = await import('../dist/app.js');
  const { pool } = await import('../dist/config.js');
  const { createHash } = await import('node:crypto');
  const previous = process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE;
  process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE = 'true';
  const app = await buildApp();
  const operator = randomUUID(), registrar = randomUUID(), outsider = randomUUID();
  let reportId;
  let searchId;
  try {
    for (const id of [operator, registrar, outsider]) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Intake test',$2,'test-hash','VIEWER',true)", [id, `${id}@example.invalid`]);
    }
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'RECORD'),($2,'REGISTER')", [operator, registrar]);
    const tokens = new Map();
    for (const id of [operator, registrar, outsider]) {
      const token = app.jwt.sign({ id, name: 'Intake test', role: 'VIEWER' });
      const hash = createHash('sha256').update(token).digest('hex');
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [id, hash]);
      tokens.set(id, token);
    }
    const request = (method, url, actor, payload) => app.inject({
      method, url, headers: { ...(actor ? { authorization: `Bearer ${tokens.get(actor)}` } : {}), 'idempotency-key': randomUUID() }, payload,
    });
    const base = '/api/v1/intake/reports';
    const fields = { applicantName: 'Тест', applicantContact: null, missingPersonName: null, lastSeenTime: null, lastSeenPlace: null, situation: null };
    assert.equal((await request('POST', base, outsider, fields)).statusCode, 403);
    const created = await request('POST', base, operator, fields);
    assert.equal(created.statusCode, 201);
    reportId = created.json().id;
    assert.equal((await request('GET', `${base}/${reportId}`, registrar)).statusCode, 404);
    assert.equal((await request('POST', `${base}/${reportId}/handoff`, operator)).statusCode, 200);
    assert.equal((await request('GET', `${base}/${reportId}`, outsider)).statusCode, 403);
    assert.equal((await request('GET', `${base}/${reportId}`, registrar)).json().applicant_name, 'Тест');
    const response = await request('POST', `${base}/${reportId}/create-search`, registrar, { title: 'Test search' });
    assert.equal(response.statusCode, 201);
    searchId = response.json().searchId;
    assert.equal((await request('POST', `${base}/${reportId}/close`, registrar, { reason: 'Already resolved' })).statusCode, 409);
    const row = (await pool.query('SELECT search_id,resolved_by FROM initial_reports WHERE id=$1', [reportId])).rows[0];
    assert.deepEqual(row, { search_id: searchId, resolved_by: registrar });
    const actions = (await pool.query('SELECT action FROM initial_report_audit WHERE report_id=$1 ORDER BY id', [reportId])).rows.map((r) => r.action);
    assert.deepEqual(actions, ['CREATED', 'HANDED_OFF', 'SEARCH_LINKED']);
    await pool.query('DELETE FROM intake_permissions WHERE user_id=$1', [registrar]);
    assert.equal((await request('GET', `${base}/${reportId}`, registrar)).statusCode, 403);
    await pool.query('DELETE FROM sessions WHERE user_id=$1', [operator]);
    assert.equal((await request('POST', base, operator, fields)).statusCode, 401);
  } finally {
    await app.close();
    if (reportId) {
      await pool.query('DELETE FROM initial_report_audit WHERE report_id=$1', [reportId]);
      await pool.query('DELETE FROM initial_reports WHERE id=$1', [reportId]);
    }
    if (searchId) await pool.query('DELETE FROM searches WHERE id=$1', [searchId]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [[operator, registrar, outsider]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[operator, registrar, outsider]]);
    await pool.end();
    if (previous === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE;
    else process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE = previous;
  }
});
