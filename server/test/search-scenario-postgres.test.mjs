import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

// A deliberately partial integration test: real password login through intake
// and coordinator claim through group task review and experimental closure. SMS and UI are not covered.
test('password login to intake, search creation and coordinator claim', async () => {
  const flags = ['KUKLA_ENABLE_EXPERIMENTAL_INTAKE', 'KUKLA_ENABLE_EXPERIMENTAL_COORDINATION', 'KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD', 'KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE', 'KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS', 'KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY', 'KUKLA_ENABLE_EXPERIMENTAL_GROUPS', 'KUKLA_ENABLE_EXPERIMENTAL_TASKS'];
  const previous = flags.map((key) => process.env[key]);
  flags.forEach((key) => { process.env[key] = 'true'; });
  // This scenario logs in seven distinct synthetic actors from one test IP.
  // Rate limiting itself is covered separately with the production threshold.
  const previousRate = process.env.RATE_LIMIT_LOGIN_MAX;
  process.env.RATE_LIMIT_LOGIN_MAX = '100';
  const { buildApp } = await import('../dist/app.js');
  const { pool } = await import('../dist/config.js');
  const app = await buildApp();
  const ids = Array.from({ length: 7 }, randomUUID);
  const [operator, registrar, coordinator, outsider, lead, administrator, leader] = ids;
  const password = 'test-only-password-2026';
  let reportId, secondReportId, searchId;
  try {
    const hash = await bcrypt.hash(password, 4);
    for (const id of ids) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Scenario test',$2,$3,'VIEWER',true)", [id, `${id}@example.invalid`, hash]);
    }
    await pool.query("UPDATE users SET role='ADMIN' WHERE id=$1", [administrator]);
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'RECORD'),($2,'REGISTER')", [operator, registrar]);
    await pool.query('INSERT INTO leadership_eligibility(user_id) VALUES($1)', [leader]);
    const tokens = new Map();
    for (const id of ids) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { login: `${id}@example.invalid`, password } });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().user.id, id);
      tokens.set(id, res.json().token);
    }
    const call = (actor, method, url, payload, extra = {}) => app.inject({ method, url, payload, headers: { authorization: `Bearer ${tokens.get(actor)}`, ...extra } });
    assert.equal((await call(leader, 'POST', `/api/v1/eligibility/users/${coordinator}/grant`, {kind:'COORDINATOR'})).statusCode,200);
    assert.equal((await call(leader, 'POST', `/api/v1/eligibility/users/${lead}/grant`, {kind:'FIELD_LEAD'})).statusCode,200);
    const fields = { applicantName: 'Synthetic', applicantContact: '555-TEST', missingPersonName: null, lastSeenTime: null, lastSeenPlace: null, situation: null };
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
    const proposals = `/api/v1/field-lead/searches/${searchId}/proposals`;
    response = await call(registrar, 'POST', proposals, {candidateId: lead});
    assert.equal(response.statusCode, 200);
    const proposalId = response.json().proposalId;
    assert.equal((await call(lead, 'POST', `${proposals}/accept`, {proposalId})).statusCode, 200);
    const closure = `/api/v1/search-closure/searches/${searchId}`;
    assert.equal((await call(coordinator, 'POST', `${closure}/close`, {})).statusCode, 409);
    const access = `/api/v1/contact-access/searches/${searchId}/reports/${reportId}`;
    const otherContact = `/api/v1/contact-access/searches/${searchId}/reports/${secondReportId}/contact`;
    await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2)', [searchId,lead]);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,404);
    assert.equal((await call(outsider, 'POST', `${access}/grants`, {userId:lead,reason:'need contact'})).statusCode,403);
    assert.equal((await call(coordinator, 'POST', `${access}/grants`, {userId:lead,reason:'  '})).statusCode,400);
    assert.equal((await call(coordinator, 'POST', `${access}/grants`, {userId:lead,reason:'coordinate with applicant'})).statusCode,200);
    assert.equal((await call(coordinator, 'POST', `${access}/grants`, {userId:lead,reason:'retry'})).statusCode,409);
    response = await call(lead, 'GET', `${access}/contact`);
    assert.equal(response.statusCode,200);
    assert.equal(response.headers['cache-control'],'no-store');
    assert.deepEqual(response.json(),{reportId,applicantContact:'555-TEST'});
    assert.equal((await call(lead, 'GET', otherContact)).statusCode,404, 'a different report is not implicitly granted');
    assert.equal((await call(outsider, 'GET', `${access}/contact`)).statusCode,404);
    assert.equal((await call(coordinator, 'POST', `${access}/revoke`, {userId:lead})).statusCode,200);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,404);
    assert.equal((await call(coordinator, 'POST', `${access}/grants`, {userId:lead,reason:'contact again'})).statusCode,200);
    await pool.query('DELETE FROM search_members WHERE search_id=$1 AND user_id=$2', [searchId,lead]);
    await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2)', [searchId,lead]);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,404, 'rejoining does not reinstate grant');
    assert.equal((await call(coordinator, 'POST', `${access}/grants`, {userId:lead,reason:'after rejoin'})).statusCode,200);
    assert.equal((await call(administrator,'PATCH',`/api/v1/users/${lead}`,{active:false})).statusCode,200);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,401);
    assert.equal((await call(administrator,'PATCH',`/api/v1/users/${lead}`,{active:true})).statusCode,200);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,404, 'reactivation does not reinstate grant');
    assert.equal((await call(coordinator, 'POST', `${access}/grants`, {userId:lead,reason:'after reactivation'})).statusCode,200);
    const { ContactAccessService } = await import('../dist/contact-access/service.js');
    const failingPool = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, values) => {
        if (sql.startsWith('INSERT INTO events')) throw new Error('injected audit failure');
        return client.query(sql, values);
      }};
    }};
    await assert.rejects(new ContactAccessService(failingPool).revoke(coordinator,searchId,reportId,lead), /injected audit failure/);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,200, 'failed audit rolls back revocation');
    const contactAudit = `/api/v1/contact-access/searches/${searchId}/audit`;
    assert.equal((await call(lead,'GET',contactAudit)).statusCode,403);
    const accessLog = await call(coordinator,'GET',`${contactAudit}?limit=2`);
    assert.equal(accessLog.statusCode,200);
    assert.equal(accessLog.headers['cache-control'],'no-store');
    assert.equal(accessLog.json().items[0].payload.reason,'after reactivation');
    assert.ok(accessLog.json().nextCursor);
    assert.equal(accessLog.body.includes('555-TEST'),false);
    await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2)', [searchId,outsider]);
    const groupBase = `/api/v1/field-groups/searches/${searchId}`;
    response = await call(lead,'POST',`${groupBase}/groups`,{requestId:randomUUID(),title:'Synthetic group',candidateId:outsider});
    assert.equal(response.statusCode,200);
    const group = response.json(), groupPath = `${groupBase}/groups/${group.groupId}`;
    assert.equal((await call(outsider,'POST',`${groupPath}/lead-response`,{proposalId:group.proposalId,accept:true})).statusCode,200);
    response = await call(outsider,'POST',`${groupPath}/member-proposals`,{userId:lead,action:'ADD'});
    assert.equal(response.statusCode,200);
    assert.equal((await call(lead,'POST',`${groupPath}/member-decision`,{proposalId:response.json().proposalId,approve:true})).statusCode,200);
    assert.equal((await call(lead,'GET',groupPath)).json().members.length,2);
    const taskBase=`/api/v1/field-tasks/searches/${searchId}`;
    response=await call(lead,'POST',`${taskBase}/groups/${group.groupId}/tasks`,{requestId:randomUUID(),description:'Synthetic task',priority:'HIGH',dueAt:'2020-01-01T00:00:00Z'});
    assert.equal(response.statusCode,200);
    const taskId=response.json().taskId, taskPath=`${taskBase}/tasks/${taskId}`;
    assert.equal((await call(outsider,'POST',`${taskPath}/accept`,{requestId:randomUUID()})).statusCode,200);
    const { TaskOverdueInbox }=await import('../dist/tasks/overdue.js');
    await new TaskOverdueInbox(pool).process();
    const notifications='/api/v1/field-tasks/notifications';
    assert.ok((await call(lead,'GET',notifications)).json().items.some(x=>x.task_id===taskId));
    assert.ok((await call(outsider,'GET',notifications)).json().items.some(x=>x.task_id===taskId));
    response=await call(outsider,'POST',`${taskPath}/results`,{requestId:randomUUID(),result:'Synthetic result'});
    assert.equal(response.statusCode,200);
    assert.equal((await call(lead,'POST',`${taskPath}/decision`,{resultId:response.json().resultId,approve:true})).statusCode,200);
    assert.equal((await call(outsider,'GET',`${taskBase}/groups/${group.groupId}/tasks`)).json().items[0].status,'ACCEPTED');
    assert.ok(!(await call(lead,'GET',notifications)).json().items.some(x=>x.task_id===taskId));
    assert.equal((await call(lead, 'POST', `${closure}/confirm`, {})).statusCode, 200);
    const { SearchClosureService } = await import('../dist/search-closure/service.js');
    await assert.rejects(new SearchClosureService(failingPool).close(coordinator,searchId), /injected audit failure/);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,200, 'failed closure must not revoke grant');
    assert.equal((await call(coordinator, 'POST', `${closure}/close`, {})).statusCode, 200);
    assert.equal((await pool.query('SELECT status FROM searches WHERE id=$1', [searchId])).rows[0].status, 'COMPLETED');
    assert.equal((await pool.query('SELECT count(*)::int n FROM search_contact_grants WHERE search_id=$1',[searchId])).rows[0].n,0);
    assert.equal((await call(coordinator, 'POST', `${closure}/reopen`, {reason: 'New information'})).statusCode, 200);
    assert.equal((await call(lead, 'GET', `${access}/contact`)).statusCode,404);
    assert.equal((await pool.query('SELECT status FROM searches WHERE id=$1', [searchId])).rows[0].status, 'PLANNED');
    assert.equal((await call(coordinator, 'POST', `${closure}/close`, {})).statusCode, 409);
    // Legacy member-readable event streams must not accidentally expose the
    // new workflows' audit reasons, including through the snapshot endpoint.
    await pool.query("INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,'FUTURE_PRIVATE_EVENT',$3)", [searchId, coordinator, {reason:'synthetic-private-reason'}]);
    for (const suffix of ['events', 'snapshot']) {
      const legacy = await call(registrar, 'GET', `/api/v1/searches/${searchId}/${suffix}`);
      assert.equal(legacy.statusCode, 200);
      const events = suffix === 'events' ? legacy.json() : legacy.json().events;
      assert.ok(events.some((entry) => entry.type === 'SEARCH_CREATED'));
      assert.ok(!events.some((entry) => ['SEARCH_CLOSED','SEARCH_REOPENED','SEARCH_CLOSURE_CONFIRMED','FIELD_LEAD_ACCEPTED','CONTACT_ACCESS_GRANTED','CONTACT_ACCESS_REVOKED','FUTURE_PRIVATE_EVENT'].includes(entry.type)));
      assert.ok(!legacy.body.includes('synthetic-private-reason'));
    }
    assert.equal((await pool.query("SELECT count(*)::int n FROM events WHERE search_id=$1 AND type IN ('SEARCH_CLOSED','SEARCH_REOPENED','FUTURE_PRIVATE_EVENT')", [searchId])).rows[0].n,3);
    const audit = `${closure}/audit`;
    assert.equal((await call(lead, 'GET', audit)).statusCode, 403);
    assert.equal((await call(outsider, 'GET', audit)).statusCode, 403);
    await pool.query('INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by) VALUES($1,$2,false,$3)', [searchId,outsider,coordinator]);
    assert.equal((await call(outsider, 'GET', audit)).statusCode, 200, 'additional coordinator has equal closure access');
    await pool.query('DELETE FROM search_coordinators WHERE search_id=$1 AND user_id=$2', [searchId,outsider]);
    assert.equal((await call(outsider, 'GET', audit)).statusCode, 403);
    assert.equal((await call(coordinator, 'GET', `${audit}?before=not-a-number`)).statusCode, 400);
    assert.equal((await call(coordinator, 'GET', `${audit}?before=9223372036854775808`)).statusCode, 400);
    response = await call(coordinator, 'GET', `${audit}?limit=2`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    const auditPage = response.json();
    assert.deepEqual(auditPage.items.map(x => x.type), ['SEARCH_REOPENED','SEARCH_CLOSED']);
    assert.equal(auditPage.items[0].payload.reason, 'New information');
    const nextAuditPage = (await call(coordinator, 'GET', `${audit}?limit=2&before=${auditPage.nextCursor}`)).json();
    assert.deepEqual(nextAuditPage.items.map(x => x.type), ['SEARCH_CLOSURE_CONFIRMED']);
    assert.equal(nextAuditPage.nextCursor, null);
    await pool.query('DELETE FROM coordinator_eligibility WHERE user_id=$1', [coordinator]);
    assert.equal((await call(coordinator, 'GET', audit)).statusCode, 403);
    assert.equal((await call(coordinator, 'GET', reportList)).statusCode, 403);
    await pool.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1)', [coordinator]);
    const outcomes = await Promise.allSettled([
      new ContactAccessService(pool).grant(coordinator,searchId,reportId,lead,'concurrent test'),
      new SearchClosureService(pool).close(coordinator,searchId,'concurrent exception'),
    ]);
    assert.equal(outcomes[1].status,'fulfilled');
    if (outcomes[0].status === 'rejected') assert.equal(outcomes[0].reason.statusCode,409);
    assert.equal((await pool.query('SELECT count(*)::int n FROM search_contact_grants WHERE search_id=$1',[searchId])).rows[0].n,0);
  } finally {
    await app.close();
    for (const id of [reportId, secondReportId]) if (id) {
      await pool.query('DELETE FROM initial_report_audit WHERE report_id=$1', [id]);
      await pool.query('DELETE FROM initial_reports WHERE id=$1', [id]);
    }
    if (searchId) await pool.query('DELETE FROM searches WHERE id=$1', [searchId]);
    await pool.query('DELETE FROM events WHERE search_id IS NULL AND user_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [ids]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await pool.end();
    flags.forEach((key, i) => { if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i]; });
    if (previousRate === undefined) delete process.env.RATE_LIMIT_LOGIN_MAX; else process.env.RATE_LIMIT_LOGIN_MAX = previousRate;
  }
});
