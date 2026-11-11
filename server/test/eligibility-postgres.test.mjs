import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { buildApp } from '../dist/app.js';
import { pool } from '../dist/config.js';
import { EligibilityService } from '../dist/eligibility/service.js';
import { CoordinationService } from '../dist/coordination/service.js';
import { FieldLeadService } from '../dist/field-lead/service.js';

test('leadership eligibility manages operational eligibility without legacy role mapping', async () => {
  const prev = process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY;
  process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY = 'true';
  const app = await buildApp();
  const [leader, legacyLeader, registrar, coordinator, candidate, inactive] = Array.from({length:6},randomUUID);
  const users = [leader,legacyLeader,registrar,coordinator,candidate,inactive];
  let search;
  try {
    for (const id of users) await pool.query("INSERT INTO users(id,name,email,password_hash,role,active) VALUES($1,'Test',$2,'hash',$3,$4)", [id,`${id}@example.invalid`,id===legacyLeader?'LEADER':'VIEWER',id!==inactive]);
    await pool.query('INSERT INTO leadership_eligibility(user_id) VALUES($1)', [leader]);
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'REGISTER')",[registrar]);
    search = (await pool.query("INSERT INTO searches(title,created_by) VALUES('Test',$1) RETURNING id",[registrar])).rows[0].id;
    const tokens = {};
    for (const id of users) {
      tokens[id] = app.jwt.sign({id,role:'VIEWER',name:'Test'});
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[id,createHash('sha256').update(tokens[id]).digest('hex')]);
    }
    const url = id => `/api/v1/eligibility/users/${id}`;
    const call = (actor,method,path,payload) => app.inject({method,url:path,headers:actor?{authorization:`Bearer ${tokens[actor]}`}:{},payload});
    assert.equal((await call(null,'GET',url(coordinator))).statusCode,401);
    assert.equal((await call(legacyLeader,'POST',url(coordinator)+'/grant',{kind:'COORDINATOR'})).statusCode,403);
    assert.equal((await call(leader,'POST',url(inactive)+'/grant',{kind:'COORDINATOR'})).statusCode,404);
    assert.equal((await call(leader,'POST',url(coordinator)+'/grant',{kind:'LEADER'})).statusCode,400);
    let response = await call(leader,'POST',url(coordinator)+'/grant',{kind:'COORDINATOR'});
    assert.equal(response.statusCode,200); assert.deepEqual(response.json(),{granted:true,created:true});
    assert.equal(response.headers['cache-control'],'no-store');
    assert.deepEqual((await call(leader,'POST',url(coordinator)+'/grant',{kind:'COORDINATOR'})).json(),{granted:true,created:false});
    assert.deepEqual((await call(leader,'GET',url(coordinator))).json(),{active:true,coordinator:true,field_lead:false});
    assert.equal((await pool.query("SELECT count(*)::int n FROM events WHERE user_id=$1 AND type='OPERATIONAL_ELIGIBILITY_GRANTED'",[leader])).rows[0].n,1);
    const audit = '/api/v1/eligibility/audit';
    assert.equal((await call(legacyLeader,'GET',audit)).statusCode,403);
    assert.equal((await call(leader,'GET',`${audit}?before=bad`)).statusCode,400);
    response = await call(leader,'GET',`${audit}?limit=100`);
    assert.equal(response.statusCode,200);
    assert.equal(response.headers['cache-control'],'no-store');
    assert.ok(response.json().items.some(entry => entry.user_id===leader && entry.type==='OPERATIONAL_ELIGIBILITY_GRANTED' && entry.payload.userId===coordinator));
    const failingPool = {connect:async () => {
      const c = await pool.connect();
      return {release:()=>c.release(),query:(sql,params)=> {
        if (sql.startsWith('INSERT INTO events')) throw new Error('audit failed');
        return c.query(sql,params);
      }};
    }};
    await assert.rejects(new EligibilityService(failingPool).grant(leader,candidate,'FIELD_LEAD'),/audit failed/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_lead_eligibility WHERE user_id=$1',[candidate])).rows[0].n,0);
    const roles = new EligibilityService(pool), coordination = new CoordinationService(pool);
    const results = await Promise.allSettled([roles.revoke(leader,coordinator,'COORDINATOR'),coordination.claim(coordinator,search)]);
    if (results[0].status === 'fulfilled') {
      assert.equal(results[1].status,'rejected'); assert.equal(results[1].reason.statusCode,403);
      await roles.grant(leader,coordinator,'COORDINATOR');
      await coordination.claim(coordinator,search);
    } else {
      assert.equal(results[0].reason.statusCode,409); assert.equal(results[1].status,'fulfilled');
    }
    assert.equal((await call(leader,'POST',url(coordinator)+'/revoke',{kind:'COORDINATOR'})).statusCode,409);
    await roles.grant(leader,candidate,'FIELD_LEAD');
    const field = new FieldLeadService(pool);
    let proposal = await field.propose(registrar,search,candidate);
    assert.equal((await call(leader,'POST',url(candidate)+'/revoke',{kind:'FIELD_LEAD'})).statusCode,409);
    await field.accept(candidate,search,proposal.proposalId);
    assert.equal((await call(leader,'POST',url(candidate)+'/revoke',{kind:'FIELD_LEAD'})).statusCode,409);
    await field.remove(coordinator,search,'synthetic exception');
    assert.deepEqual((await call(leader,'POST',url(candidate)+'/revoke',{kind:'FIELD_LEAD'})).json(),{revoked:true,removed:true});
    assert.deepEqual((await call(leader,'POST',url(candidate)+'/revoke',{kind:'FIELD_LEAD'})).json(),{revoked:true,removed:false});
    const page = (await call(leader,'GET',`${audit}?limit=1`)).json();
    assert.equal(page.items.length,1);
    assert.ok(page.nextCursor);
    const nextPage = (await call(leader,'GET',`${audit}?limit=1&before=${page.nextCursor}`)).json();
    assert.equal(nextPage.items.length,1);
    assert.notEqual(nextPage.items[0].id,page.items[0].id);
    // No resurrection of a legacy stale assignment after out-of-band removal.
    await pool.query('DELETE FROM coordinator_eligibility WHERE user_id=$1',[coordinator]);
    assert.equal((await call(leader,'POST',url(coordinator)+'/grant',{kind:'COORDINATOR'})).statusCode,409);
    assert.equal((await pool.query('SELECT count(*)::int n FROM coordinator_eligibility WHERE user_id=$1',[coordinator])).rows[0].n,0);
    await pool.query('UPDATE users SET active=false WHERE id=$1',[leader]);
    assert.equal((await call(leader,'GET',url(candidate))).statusCode,401);
  } finally {
    await app.close();
    if (search) await pool.query('DELETE FROM searches WHERE id=$1',[search]);
    await pool.query('DELETE FROM events WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    if (prev === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY; else process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY=prev;
  }
});

test('eligibility management is unavailable by default and in production', async () => {
  const prev = process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY, env = process.env.NODE_ENV;
  try {
    delete process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY;
    let app = await buildApp();
    assert.equal((await app.inject({url:`/api/v1/eligibility/users/${randomUUID()}`})).statusCode,404);
    await app.close();
    process.env.NODE_ENV='production'; process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY='true';
    app = await buildApp();
    assert.equal((await app.inject({url:`/api/v1/eligibility/users/${randomUUID()}`})).statusCode,404);
    await app.close();
  } finally {
    if (prev === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY; else process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY=prev;
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=env;
    await pool.end();
  }
});
