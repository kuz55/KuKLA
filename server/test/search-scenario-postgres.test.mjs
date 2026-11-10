import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

// A deliberately partial integration test: real password login through intake
// and coordinator claim. It does not assert unsupported operational workflow.
test('password login to intake, search creation and coordinator claim', async () => {
  const flags = ['KUKLA_ENABLE_EXPERIMENTAL_INTAKE', 'KUKLA_ENABLE_EXPERIMENTAL_COORDINATION'];
  const previous = flags.map((key) => process.env[key]);
  flags.forEach((key) => { process.env[key] = 'true'; });
  const { buildApp } = await import('../dist/app.js');
  const { pool } = await import('../dist/config.js');
  const app = await buildApp();
  const ids = Array.from({ length: 4 }, randomUUID);
  const [operator, registrar, coordinator, outsider] = ids;
  const password = 'test-only-password-2026';
  let reportId, secondReportId, searchId;
  try {
    const hash = await bcrypt.hash(password, 4);
    for (const id of ids) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Scenario test',$2,$3,'VIEWER',true)", [id, `${id}@example.invalid`, hash]);
    }
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'RECORD'),($2,'REGISTER')", [operator, registrar]);
    await pool.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1)', [coordinator]);
    const tokens = new Map();
    for (const id of ids) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: `${id}@example.invalid`, password } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().user.id, id);
      tokens.set(id, res.json().token);
    }
    const call = (actor, method, url, payload, extra = {}) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tokens.get(actor)}`, ...extra } });
    const fields = { applicantName: 'Synthetic', applicantContact: null, missingPersonName: null, lastSeenTime: null, lastSeenPlace: null, situation: null };
    const key = randomUUID();
    let response = await call(operator, 'POST', '/api/v1/intake/reports', fields, { 'idempotency-key': key });
    assert.equal(response.statusCode, 201);
    reportId = response.json().id;
    response = await call(operator, 'POST', '/api/v1/intake/reports', fields, { 'idempotency-key': key });
    assert.equal(response.json().id, reportId);
    assert.equal((await call(operator, 'GET', `/api/v1/intake/my-reports/${reportId}`)).json().applicant_name, 'Synthetic');
    assert.equal((await call(registrar, 'GET', `/api/v1/intake/my-reports/${reportId}`)).statusCode, 403);
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'RECORD')", [outsider]);
    assert.equal((await call(outsider, 'GET', `/api/v1/intake/my-reports/${reportId}`)).statusCode, 404);
    assert.equal((await call(registrar, 'GET', `/api/v1/intake/reports/${reportId}`)).statusCode, 404);
    assert.equal((await call(operator, 'POST', `/api/v1/intake/reports/${reportId}/handoff`)).statusCode, 200);
    assert.equal((await call(outsider, 'GET', `/api/v1/intake/reports/${reportId}`)).statusCode, 403);
    response = await call(registrar, 'POST', `/api/v1/intake/reports/${reportId}/create-search`, { title: 'Synthetic search' });
    assert.equal(response.statusCode, 201);
    searchId = response.json().searchId;
    const claim = `/api/v1/coordination/searches/${searchId}/claim`;
    assert.equal((await call(outsider, 'POST', claim)).statusCode, 403);
    response = await call(coordinator, 'POST', claim);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().primaryId, coordinator);
    assert.equal((await call(coordinator, 'GET', `/api/v1/coordination/searches/${searchId}`)).json().find((x) => x.is_primary).user_id, coordinator);
    response = await call(operator, 'POST', '/api/v1/intake/reports', fields, { 'idempotency-key': randomUUID() });
    assert.equal(response.statusCode, 201);
    secondReportId = response.json().id;
    assert.equal((await call(operator, 'POST', `/api/v1/intake/reports/${secondReportId}/handoff`)).statusCode, 200);
    assert.equal((await call(registrar, 'POST', `/api/v1/intake/reports/${secondReportId}/link-search`, { searchId })).statusCode, 200);
    const reportList = `/api/v1/intake/searches/${searchId}/reports`;
    response = await call(coordinator, 'GET', reportList);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.json().items[0].id, reportId);
    assert.equal(response.json().items[0].applicant_name, 'Synthetic');
    assert.deepEqual(new Set(response.json().items.map((x) => x.id)), new Set([reportId, secondReportId]));
    const page = (await call(coordinator, 'GET', `${reportList}?limit=1`)).json();
    assert.equal(page.items.length, 1);
    assert.equal(page.nextCursor, page.items[0].id);
    const nextPage = (await call(coordinator, 'GET', `${reportList}?limit=1&after=${page.nextCursor}`)).json();
    assert.equal(nextPage.items.length, 1);
    assert.notEqual(nextPage.items[0].id, page.items[0].id);
    assert.equal(nextPage.nextCursor, null);
    assert.equal((await call(outsider, 'GET', reportList)).statusCode, 403);
    await pool.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1)', [outsider]);
    assert.equal((await call(outsider, 'GET', reportList)).statusCode, 404);
    assert.equal((await call(coordinator, 'GET', `/api/v1/intake/searches/${randomUUID()}/reports`)).statusCode, 404);
    assert.equal((await call(coordinator, 'GET', `${reportList}?limit=0`)).statusCode, 400);
    await pool.query('DELETE FROM coordinator_eligibility WHERE user_id=$1', [coordinator]);
    assert.equal((await call(coordinator, 'GET', reportList)).statusCode, 403);
  } finally {
    await app.close();
    for (const id of [reportId, secondReportId]) if (id) {
      await pool.query('DELETE FROM initial_report_audit WHERE report_id=$1', [id]);
      await pool.query('DELETE FROM initial_reports WHERE id=$1', [id]);
    }
    if (searchId) await pool.query('DELETE FROM searches WHERE id=$1', [searchId]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await pool.end();
    flags.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
  }
});
