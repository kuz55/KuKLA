import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { FieldLeadService } from '../dist/field-lead/service.js';

test('field lead assignment and replacement require acceptance and record exceptions', async () => {
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla'});
  const [registrar, coordinator, first, second, outsider] = Array.from({length: 5}, randomUUID);
  const users = [registrar, coordinator, first, second, outsider];
  let searchId;
  try {
    for (const id of users) await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Test',$2,'hash','VIEWER')", [id,`${id}@example.invalid`]);
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'REGISTER')", [registrar]);
    await pool.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1)', [coordinator]);
    await pool.query('INSERT INTO field_lead_eligibility(user_id) VALUES($1),($2)', [first,second]);
    searchId = (await pool.query("INSERT INTO searches(title,created_by) VALUES('Test',$1) RETURNING id", [registrar])).rows[0].id;
    await pool.query('INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by) VALUES($1,$2,true,$2)', [searchId,coordinator]);
    const service = new FieldLeadService(pool);
    await assert.rejects(service.propose(coordinator,searchId,first), {statusCode:403});
    await assert.rejects(service.propose(outsider,searchId,first), {statusCode:403});
    await assert.rejects(service.propose(registrar,searchId,outsider), {statusCode:403});
    const failingPool = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, values) => {
        if (sql.startsWith('INSERT INTO events')) throw new Error('audit unavailable');
        return client.query(sql, values);
      } };
    } };
    await assert.rejects(new FieldLeadService(failingPool).propose(registrar,searchId,first), /audit unavailable/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_lead_proposals WHERE search_id=$1',[searchId])).rows[0].n, 0);
    const concurrent = await Promise.allSettled([service.propose(registrar,searchId,first),service.propose(registrar,searchId,first)]);
    assert.equal(concurrent.filter(x => x.status === 'fulfilled').length,1);
    assert.equal(concurrent.find(x => x.status === 'rejected').reason.statusCode,409);
    const proposal = concurrent.find(x => x.status === 'fulfilled').value;
    assert.equal((await service.pending(first,searchId)).id, proposal.proposalId);
    await assert.rejects(service.accept(second,searchId,proposal.proposalId), {statusCode:404});
    assert.equal((await pool.query('SELECT count(*)::int n FROM search_field_leads WHERE search_id=$1',[searchId])).rows[0].n, 0);
    assert.equal(await service.processOverdueReminders(),0);
    await pool.query("UPDATE field_lead_proposals SET created_at=now()-interval '11 minutes' WHERE id=$1",[proposal.proposalId]);
    const failNotifications = { connect: async () => {
      const client = await pool.connect();
      return { release: () => client.release(), query: (sql, values) => {
        if (sql.startsWith('INSERT INTO field_lead_notifications')) throw new Error('inbox unavailable');
        return client.query(sql,values);
      } };
    }, query: (...args) => pool.query(...args) };
    await assert.rejects(new FieldLeadService(failNotifications).processOverdueReminders(), /inbox unavailable/);
    assert.equal((await pool.query('SELECT reminder_created_at FROM field_lead_proposals WHERE id=$1',[proposal.proposalId])).rows[0].reminder_created_at,null);
    const reminders = await Promise.all([service.processOverdueReminders(),service.processOverdueReminders()]);
    assert.equal(reminders.reduce((a,b)=>a+b,0),1);
    assert.ok((await service.notifications(registrar)).items.some(n=>n.kind==='NO_RESPONSE' && n.proposal_id===proposal.proposalId));
    assert.ok((await service.notifications(coordinator)).items.some(n=>n.kind==='NO_RESPONSE' && n.proposal_id===proposal.proposalId));
    const inbox = await service.notifications(first);
    assert.equal(inbox.items[0].proposal_id,proposal.proposalId);
    await assert.rejects(service.acknowledge(outsider,inbox.items[0].id), {statusCode:404});
    await pool.query('DELETE FROM field_lead_eligibility WHERE user_id=$1',[first]);
    assert.equal((await service.notifications(first)).items.length,0);
    await pool.query('INSERT INTO field_lead_eligibility(user_id) VALUES($1)',[first]);
    const ack = await service.acknowledge(first,inbox.items[0].id);
    assert.deepEqual(await service.acknowledge(first,inbox.items[0].id),ack);
    const accepted = await Promise.all(Array.from({length:4},()=>service.accept(first,searchId,proposal.proposalId)));
    assert.ok(accepted.every(x=>+x.acceptedAt===+accepted[0].acceptedAt));
    assert.equal((await pool.query("SELECT count(*)::int n FROM events WHERE search_id=$1 AND type='FIELD_LEAD_ACCEPTED'",[searchId])).rows[0].n,1);
    assert.ok((await service.notifications(registrar)).items.some(n=>n.kind==='ACCEPTED' && n.proposal_id===proposal.proposalId));
    const replacement = await service.propose(coordinator,searchId,second);
    assert.equal((await pool.query('SELECT user_id FROM search_field_leads WHERE search_id=$1',[searchId])).rows[0].user_id, first);
    await service.decline(second,searchId,replacement.proposalId);
    assert.equal((await pool.query('SELECT user_id FROM search_field_leads WHERE search_id=$1',[searchId])).rows[0].user_id, first);
    const cancelled = await service.propose(registrar,searchId,second);
    await assert.rejects(service.cancel(outsider,searchId,cancelled.proposalId,'No response'), {statusCode:403});
    await service.cancel(coordinator,searchId,cancelled.proposalId,'No response');
    await assert.rejects(service.accept(second,searchId,cancelled.proposalId), {statusCode:404});
    const notifications = await service.notifications(second);
    assert.ok(notifications.items.some(n=>n.kind==='CANCELLED' && n.proposal_id===cancelled.proposalId));
    assert.equal(JSON.stringify(notifications).includes('No response'),false);
    const next = await service.propose(registrar,searchId,second);
    await assert.rejects(service.accept(second,searchId,replacement.proposalId), {statusCode:404});
    await pool.query('DELETE FROM field_lead_eligibility WHERE user_id=$1',[second]);
    await assert.rejects(service.accept(second,searchId,next.proposalId), {statusCode:403});
    assert.equal((await pool.query('SELECT user_id FROM search_field_leads WHERE search_id=$1',[searchId])).rows[0].user_id, first);
    await pool.query('INSERT INTO field_lead_eligibility(user_id) VALUES($1)',[second]);
    await service.accept(second,searchId,next.proposalId);
    assert.equal((await pool.query('SELECT user_id FROM search_field_leads WHERE search_id=$1',[searchId])).rows[0].user_id, second);
    await service.accept(first,searchId,proposal.proposalId);
    assert.equal((await pool.query('SELECT user_id FROM search_field_leads WHERE search_id=$1',[searchId])).rows[0].user_id, second);
    await assert.rejects(service.remove(outsider,searchId,'Unavailable'), {statusCode:403});
    await service.remove(coordinator,searchId,'Unavailable');
    assert.equal((await pool.query('SELECT count(*)::int n FROM search_field_leads WHERE search_id=$1',[searchId])).rows[0].n, 0);
    const event = await pool.query("SELECT payload FROM events WHERE search_id=$1 AND type='FIELD_LEAD_EXCEPTIONALLY_REMOVED'",[searchId]);
    assert.equal(event.rows[0].payload.reason, 'Unavailable');
  } finally {
    if (searchId) await pool.query('DELETE FROM searches WHERE id=$1',[searchId]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    await pool.end();
  }
});

test('field-lead HTTP authentication, validation and production gate', async () => {
  const { buildApp } = await import('../dist/app.js');
  const { pool } = await import('../dist/config.js');
  const before = process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD;
  process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD = 'true';
  const app = await buildApp();
  const [registrar, candidate] = [randomUUID(),randomUUID()];
  let searchId;
  try {
    for (const id of [registrar,candidate]) await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Test',$2,'hash','VIEWER')",[id,`${id}@example.invalid`]);
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'REGISTER')",[registrar]);
    await pool.query('INSERT INTO field_lead_eligibility(user_id) VALUES($1)',[candidate]);
    searchId = (await pool.query("INSERT INTO searches(title,created_by) VALUES('Test',$1) RETURNING id",[registrar])).rows[0].id;
    const tokens = new Map();
    for (const id of [registrar,candidate]) {
      const token = app.jwt.sign({id, name:'Test', role:'VIEWER'});
      tokens.set(id,token);
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[id,createHash('sha256').update(token).digest('hex')]);
    }
    const base = `/api/v1/field-lead/searches/${searchId}`;
    const call = (method,path,id,payload) => app.inject({method,url:base+path,headers:id?{authorization:`Bearer ${tokens.get(id)}`}:{},payload});
    assert.equal((await call('POST','/proposals',undefined,{candidateId:candidate})).statusCode,401);
    assert.equal((await call('POST','/proposals',registrar,{candidateId:'invalid'})).statusCode,400);
    const res = await call('POST','/proposals',registrar,{candidateId:candidate});
    assert.equal(res.statusCode,200);
    assert.equal(res.headers['cache-control'],'no-store');
    const inbox = await app.inject({method:'GET',url:'/api/v1/field-lead/notifications',headers:{authorization:`Bearer ${tokens.get(candidate)}`}});
    assert.equal(inbox.statusCode,200);
    assert.equal(inbox.json().items[0].proposal_id,res.json().proposalId);
    const ack = await app.inject({method:'POST',url:`/api/v1/field-lead/notifications/${inbox.json().items[0].id}/acknowledge`,headers:{authorization:`Bearer ${tokens.get(candidate)}`}});
    assert.equal(ack.statusCode,200);
    assert.equal((await call('POST','/proposals/accept',candidate,{proposalId:res.json().proposalId})).statusCode,200);
    assert.equal((await call('POST','/exceptional-removal',registrar,{reason:' '})).statusCode,400);
  } finally {
    await app.close();
    if (searchId) await pool.query('DELETE FROM searches WHERE id=$1',[searchId]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[[registrar,candidate]]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[registrar,candidate]]);
    await pool.end();
    if (before === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD; else process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD = before;
  }
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD = 'true';
  const production = await buildApp();
  try { assert.equal((await production.inject({method:'GET',url:`/api/v1/field-lead/searches/${randomUUID()}/proposals/mine`})).statusCode,404); }
  finally {
    await production.close();
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
    if (before === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD; else process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD = before;
  }
});
