import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { CoordinationService } from '../dist/coordination/service.js';

const connectionString = process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla';

test('coordinator claim, additional roles and consent-based transfer on PostgreSQL', async () => {
  const pool = new pg.Pool({ connectionString });
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [a, b, c, outsider] = ids;
  let searchId;
  let rollbackSearchId;
  try {
    for (const id of ids) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Test',$2,'hash','VIEWER',true)", [id, `${id}@example.invalid`]);
    }
    for (const id of [a, b, c]) await pool.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1)', [id]);
    searchId = (await pool.query("INSERT INTO searches(title,created_by) VALUES('Test',$1) RETURNING id", [a])).rows[0].id;
    const service = new CoordinationService(pool);
    await assert.rejects(service.claim(outsider, searchId), { statusCode: 403 });
    for (const status of ['COMPLETED','CANCELLED']) {
      await pool.query('UPDATE searches SET status=$2 WHERE id=$1',[searchId,status]);
      await assert.rejects(service.claim(a, searchId), { statusCode: 409 });
      assert.equal((await pool.query('SELECT count(*)::int n FROM search_coordinators WHERE search_id=$1',[searchId])).rows[0].n,0);
    }
    await pool.query("UPDATE searches SET status='PLANNED' WHERE id=$1",[searchId]);
    const claims = await Promise.all([service.claim(a, searchId), service.claim(b, searchId)]);
    assert.equal(claims.filter((x) => x.claimed).length, 1);
    const primary = claims.find((x) => x.claimed).primaryId;
    assert.equal(claims.find((x) => !x.claimed).primaryId, primary);
    const additional = primary === a ? b : a;
    assert.deepEqual(await service.claim(primary, searchId), { primaryId: primary, claimed: true });
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events WHERE search_id=$1 AND type='COORDINATOR_CLAIMED'", [searchId])).rows[0].n, 1);
    await assert.rejects(service.addAdditional(additional, searchId, c), { statusCode: 404 });
    await assert.rejects(service.addAdditional(primary, searchId, outsider), { statusCode: 403 });
    await service.addAdditional(primary, searchId, additional);
    await service.addAdditional(primary, searchId, additional);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events WHERE search_id=$1 AND type='COORDINATOR_ADDED'", [searchId])).rows[0].n, 1);
    assert.equal((await service.state(additional, searchId)).length, 2);

    // Additional coordinators have the same right to initiate transfers.
    const proposal = await service.proposeTransfer(additional, searchId, c, true, 'Смена дежурства');
    const inbox = await service.notifications(c);
    assert.equal(inbox.items.length, 1);
    assert.equal(inbox.items[0].kind, 'TRANSFER_REQUESTED');
    assert.equal(inbox.items[0].transfer_id, proposal.transferId);
    assert.equal((await service.pendingForUser(c, searchId)).id, proposal.transferId);
    assert.equal(JSON.stringify(inbox).includes('Смена дежурства'), false);
    const notificationId = inbox.items[0].id;
    await assert.rejects(service.acknowledgeNotification(primary, notificationId), { statusCode: 404 });
    await assert.rejects(service.notifications(outsider), { statusCode: 403 });
    const ack = await service.acknowledgeNotification(c, notificationId);
    assert.deepEqual(await service.acknowledgeNotification(c, notificationId), ack);
    assert.equal((await service.notifications(c)).items.length, 0);
    assert.equal((await service.pendingForUser(c, searchId)).reason, 'Смена дежурства');
    await assert.rejects(service.acceptTransfer(additional, searchId), { statusCode: 404 });
    assert.equal((await service.state(primary, searchId)).find((r) => r.is_primary).user_id, primary);
    await service.declineTransfer(c, searchId);
    await assert.rejects(service.pendingForUser(c, searchId), { statusCode: 404 });
    const secondProposal = await service.proposeTransfer(additional, searchId, c, true, 'Повторное назначение');
    assert.notEqual(secondProposal.transferId, proposal.transferId);
    assert.ok((await service.notifications(c)).items.some((n) => n.transfer_id === secondProposal.transferId));
    await assert.rejects(service.proposeTransfer(primary, searchId, additional, false, 'Другая передача'), { statusCode: 409 });
    await service.acceptTransfer(c, searchId);
    assert.ok((await service.notifications(primary)).items.some((n) => n.kind === 'TRANSFER_ACCEPTED'));
    assert.ok((await service.notifications(additional)).items.some((n) => n.kind === 'TRANSFER_ACCEPTED'));
    let state = await service.state(c, searchId);
    assert.equal(state.find((r) => r.is_primary).user_id, c);
    assert.equal(state.length, 3, 'previous primary was retained at the initiator’s request');
    const event = (await pool.query("SELECT payload FROM events WHERE search_id=$1 AND type='COORDINATOR_TRANSFER_ACCEPTED'", [searchId])).rows[0];
    assert.equal(event.payload.reason, 'Повторное назначение');
    await service.proposeTransfer(additional, searchId, primary, false, 'Передача обратно');
    await service.acceptTransfer(primary, searchId);
    state = await service.state(primary, searchId);
    assert.equal(state.find((r) => r.is_primary).user_id, primary);
    assert.equal(state.some((r) => r.user_id === c), false);
    await assert.rejects(service.state(c, searchId), { statusCode: 404 });
    await service.proposeTransfer(additional, searchId, c, false, 'Проверка отзыва');
    await pool.query('DELETE FROM coordinator_eligibility WHERE user_id=$1', [additional]);
    await assert.rejects(service.acceptTransfer(c, searchId), { statusCode: 403 });
    assert.equal((await service.state(primary, searchId)).find((r) => r.is_primary).user_id, primary);
    await assert.rejects(service.cancelTransfer(c, searchId, 'Чужой'), { statusCode: 404 });
    await service.cancelTransfer(primary, searchId, 'Инициатор больше не допущен');
    assert.ok((await service.notifications(c)).items.some((n) => n.kind === 'TRANSFER_CANCELLED'));
    const page = await service.notifications(c, undefined, 1);
    assert.ok(page.nextCursor);
    await service.acknowledgeNotification(c, page.items[0].id);
    const nextPage = await service.notifications(c, page.nextCursor, 1);
    assert.equal(nextPage.items.length, 1, 'cursor remains valid after acknowledgement');
    assert.notEqual(nextPage.items[0].id, page.items[0].id);
    assert.equal((await pool.query("SELECT payload FROM events WHERE search_id=$1 AND type='COORDINATOR_TRANSFER_CANCELLED'", [searchId])).rows[0].payload.reason, 'Инициатор больше не допущен');
    // A failing audit insert rolls back the coordinator assignment.
    rollbackSearchId = (await pool.query("INSERT INTO searches(title,created_by) VALUES('Rollback',$1) RETURNING id", [a])).rows[0].id;
    const failingPool = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, params) => {
        if (sql.startsWith('INSERT INTO events')) throw new Error('audit unavailable');
        return client.query(sql, params);
      } };
    } };
    await assert.rejects(new CoordinationService(failingPool).claim(primary, rollbackSearchId), /audit unavailable/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM search_coordinators WHERE search_id=$1', [rollbackSearchId])).rows[0].n, 0);
    await service.claim(primary, rollbackSearchId);
    const failingNotificationsPool = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, params) => {
        if (sql.startsWith('INSERT INTO coordination_notifications')) throw new Error('notification unavailable');
        return client.query(sql, params);
      } };
    } };
    await assert.rejects(new CoordinationService(failingNotificationsPool).proposeTransfer(primary, rollbackSearchId, c, true, 'Test'), /notification unavailable/);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM coordinator_transfers WHERE search_id=$1', [rollbackSearchId])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM events WHERE search_id=$1 AND type='COORDINATOR_TRANSFER_REQUESTED'", [rollbackSearchId])).rows[0].n, 0);
    await assert.rejects(service.state(additional, searchId), { statusCode: 403 });
  } finally {
    if (searchId) await pool.query('DELETE FROM searches WHERE id=$1', [searchId]);
    if (rollbackSearchId) await pool.query('DELETE FROM searches WHERE id=$1', [rollbackSearchId]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await pool.end();
  }
});

test('coordination HTTP routes enforce authentication and validated transfer', async () => {
  const { createHash } = await import('node:crypto');
  const { buildApp } = await import('../dist/app.js');
  const { pool } = await import('../dist/config.js');
  const oldFlag = process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION;
  process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION = 'true';
  const app = await buildApp();
  const primary = randomUUID(), target = randomUUID(), outsider = randomUUID();
  let searchId;
  try {
    const tokens = new Map();
    for (const id of [primary, target, outsider]) {
      await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Test',$2,'hash','VIEWER',true)", [id, `${id}@example.invalid`]);
      const token = app.jwt.sign({ id, name: 'Test', role: 'VIEWER' });
      tokens.set(id, token);
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [id, createHash('sha256').update(token).digest('hex')]);
    }
    await pool.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1),($2)', [primary, target]);
    searchId = (await pool.query("INSERT INTO searches(title,created_by) VALUES('Test',$1) RETURNING id", [primary])).rows[0].id;
    const base = `/api/v1/coordination/searches/${searchId}`;
    const call = (method, path, id, payload) => app.inject({ method, url: `${base}${path}`, headers: id ? { authorization: `Bearer ${tokens.get(id)}` } : {}, payload });
    assert.equal((await call('POST', '/claim', undefined)).statusCode, 401);
    assert.equal((await call('POST', '/claim', outsider)).statusCode, 403);
    const claimed = await call('POST', '/claim', primary);
    assert.equal(claimed.statusCode, 200);
    assert.equal(claimed.headers['cache-control'], 'no-store');
    const occupied = await call('POST', '/claim', target);
    assert.equal(occupied.statusCode, 409);
    assert.equal(occupied.json().primaryId, primary);
    assert.equal((await call('POST', '/transfer', primary, { userId: target, retainPrevious: true })).statusCode, 400);
    assert.equal((await call('POST', '/transfer', primary, { userId: target, retainPrevious: true, reason: 'Смена' })).statusCode, 200);
    const getInbox = (id) => app.inject({ method: 'GET', url: '/api/v1/coordination/notifications', headers: { authorization: `Bearer ${tokens.get(id)}` } });
    const targetInbox = await getInbox(target);
    assert.equal(targetInbox.statusCode, 200);
    assert.equal(targetInbox.headers['cache-control'], 'no-store');
    const notificationId = targetInbox.json().items[0].id;
    const acknowledge = (id) => app.inject({ method: 'POST', url: `/api/v1/coordination/notifications/${notificationId}/acknowledge`, headers: { authorization: `Bearer ${tokens.get(id)}` } });
    assert.equal((await acknowledge(primary)).statusCode, 404);
    assert.equal((await acknowledge(target)).statusCode, 200);
    assert.equal((await acknowledge(target)).statusCode, 200);
    assert.equal((await getInbox(target)).json().items.length, 0);
    assert.equal((await call('GET', '/transfer', target)).json().reason, 'Смена');
    assert.equal((await call('POST', '/transfer/accept', outsider)).statusCode, 403);
    assert.equal((await call('POST', '/transfer/accept', target)).statusCode, 200);
    assert.equal((await call('GET', '', target)).json().find((r) => r.is_primary).user_id, target);
  } finally {
    await app.close();
    if (searchId) await pool.query('DELETE FROM searches WHERE id=$1', [searchId]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [[primary, target, outsider]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[primary, target, outsider]]);
    await pool.end();
    if (oldFlag === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION; else process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION = oldFlag;
  }
});

test('coordination routes are disabled by default and in production', async () => {
  const { buildApp } = await import('../dist/app.js');
  const originalFlag = process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION;
  const originalEnv = process.env.NODE_ENV;
  try {
    delete process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION;
    delete process.env.NODE_ENV;
    const first = await buildApp();
    try { assert.equal((await first.inject({ method: 'POST', url: `/api/v1/coordination/searches/${randomUUID()}/claim` })).statusCode, 404); }
    finally { await first.close(); }
    process.env.NODE_ENV = 'production';
    process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION = 'true';
    const second = await buildApp();
    try { assert.equal((await second.inject({ method: 'POST', url: `/api/v1/coordination/searches/${randomUUID()}/claim` })).statusCode, 404); }
    finally { await second.close(); }
  } finally {
    if (originalFlag === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION; else process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION = originalFlag;
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
  }
});
