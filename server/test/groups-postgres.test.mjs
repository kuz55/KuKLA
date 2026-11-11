import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { buildApp } from '../dist/app.js';
import { pool } from '../dist/config.js';
import { FieldLeadService } from '../dist/field-lead/service.js';
import { FieldGroupsService } from '../dist/groups/service.js';

test('field groups require accepted group lead and field lead approval of membership', async () => {
  const oldFlag=process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS;
  process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS='true';
  const app=await buildApp();
  const [registrar,fieldLead,coordinator,groupLead,searcher,outsider]=Array.from({length:6},randomUUID);
  const users=[registrar,fieldLead,coordinator,groupLead,searcher,outsider];
  let search;
  try {
    for (const id of users) await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Test',$2,'hash','VIEWER')",[id,`${id}@example.invalid`]);
    await pool.query("UPDATE users SET role='SUPERUSER' WHERE id=$1",[registrar]);
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'REGISTER')",[registrar]);
    await pool.query('INSERT INTO field_lead_eligibility VALUES($1)',[fieldLead]);
    await pool.query('INSERT INTO coordinator_eligibility VALUES($1)',[coordinator]);
    search=(await pool.query("INSERT INTO searches(title,created_by) VALUES('Synthetic',$1) RETURNING id",[registrar])).rows[0].id;
    await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2),($1,$3)',[search,groupLead,searcher]);
    await pool.query('INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by) VALUES($1,$2,true,$2)',[search,coordinator]);
    const leadService=new FieldLeadService(pool);
    const appointment=await leadService.propose(registrar,search,fieldLead);
    await leadService.accept(fieldLead,search,appointment.proposalId);
    const tokens={};
    for (const id of users) {
      tokens[id]=app.jwt.sign({id,name:'Test',role:'VIEWER'});
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[id,createHash('sha256').update(tokens[id]).digest('hex')]);
    }
    const base=`/api/v1/field-groups/searches/${search}`;
    const call=(actor,method,path,payload)=>app.inject({method,url:base+path,payload,headers:actor?{authorization:`Bearer ${tokens[actor]}`}:{}});
    const data={requestId:randomUUID(),title:'Group A',candidateId:groupLead};
    assert.equal((await call(null,'POST','/groups',data)).statusCode,401);
    assert.equal((await call(coordinator,'POST','/groups',data)).statusCode,403);
    assert.equal((await call(fieldLead,'POST','/groups',{...data,requestId:undefined})).statusCode,400);
    assert.equal((await call(fieldLead,'POST','/groups',{...data,candidateId:outsider})).statusCode,404);
    const creates=await Promise.all([call(fieldLead,'POST','/groups',data),call(fieldLead,'POST','/groups',data)]);
    assert.deepEqual(creates.map(x=>x.statusCode),[200,200]);
    let response=creates[0]; assert.equal(response.headers['cache-control'],'no-store');
    const {groupId,proposalId}=response.json(); const g=`/groups/${groupId}`;
    assert.deepEqual(creates[1].json(),{groupId,proposalId});
    assert.equal((await call(fieldLead,'POST','/groups',{...data,title:'Different'})).statusCode,409);
    assert.equal((await call(fieldLead,'POST','/groups',{...data,candidateId:searcher})).statusCode,409);
    assert.equal((await pool.query("SELECT count(*)::int n FROM events WHERE search_id=$1 AND type='FIELD_GROUP_CREATED'",[search])).rows[0].n,1);
    assert.equal((await call(outsider,'GET',g)).statusCode,403);
    assert.equal((await call(groupLead,'GET','/my-lead-proposals')).json()[0].id,proposalId);
    assert.equal((await call(fieldLead,'GET','/groups')).json().items.length,1);
    assert.equal((await call(groupLead,'GET','/groups')).json().items.length,0);
    assert.equal((await call(searcher,'POST',`${g}/lead-response`,{proposalId,accept:true})).statusCode,404);
    assert.equal((await call(groupLead,'POST',`${g}/member-proposals`,{userId:searcher,action:'ADD'})).statusCode,403);
    const acceptance=await Promise.all([call(groupLead,'POST',`${g}/lead-response`,{proposalId,accept:true}),call(groupLead,'POST',`${g}/lead-response`,{proposalId,accept:true})]);
    assert.deepEqual(acceptance.map(x=>x.statusCode).sort(),[200,404]);
    assert.deepEqual((await call(fieldLead,'POST','/groups',data)).json(),{groupId,proposalId},'creation receipt survives lead acceptance');
    await pool.query("UPDATE field_groups SET title='Changed title' WHERE id=$1",[groupId]);
    assert.deepEqual((await call(fieldLead,'POST','/groups',data)).json(),{groupId,proposalId},'receipt uses immutable initial data');
    await pool.query('DELETE FROM field_lead_eligibility WHERE user_id=$1',[fieldLead]);
    assert.equal((await call(fieldLead,'POST','/groups',data)).statusCode,403,'receipt requires current field-lead eligibility');
    await pool.query('INSERT INTO field_lead_eligibility VALUES($1)',[fieldLead]);
    assert.equal((await pool.query("SELECT count(*)::int n FROM events WHERE search_id=$1 AND type='FIELD_GROUP_LEAD_ACCEPTED'",[search])).rows[0].n,1);
    response=await call(fieldLead,'GET',g);
    assert.equal(response.json().lead.user_id,groupLead);
    assert.deepEqual(response.json().members.map(x=>x.user_id),[groupLead]);
    assert.equal((await call(groupLead,'GET',g)).statusCode,200);
    assert.equal((await call(groupLead,'GET','/groups')).json().items[0].id,groupId);
    await pool.query("INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,'FIELD_GROUP_MEMBER_PROPOSED',$3)",
      [search,groupLead,{groupId,userId:searcher,action:'ADD',secret:'synthetic secret'}]);
    await pool.query("INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,'UNKNOWN_WORKFLOW',$3)",
      [search,groupLead,{groupId,secret:'synthetic secret'}]);
    assert.equal((await call(searcher,'GET',`${g}/audit`)).statusCode,403);
    assert.equal((await call(outsider,'GET',`${g}/audit`)).statusCode,403);
    assert.equal((await call(fieldLead,'GET',`${g}/audit?before=9223372036854775808`)).statusCode,400);
    const audit=await call(fieldLead,'GET',`${g}/audit?limit=1`);
    assert.equal(audit.statusCode,200); assert.equal(audit.headers['cache-control'],'no-store');
    assert.ok(audit.json().nextCursor); assert.equal(audit.json().items[0].details.userId,searcher);
    assert.ok(!audit.body.includes('secret')); assert.ok(!audit.body.includes('payload'));
    const auditNext=await call(groupLead,'GET',`${g}/audit?before=${audit.json().nextCursor}`);
    assert.equal(auditNext.statusCode,200); assert.ok(auditNext.json().items.every(x=>x.type.startsWith('FIELD_GROUP_')));
    assert.ok(auditNext.json().items.some(x=>x.type==='FIELD_GROUP_CREATED'));
    const legacyRemove=await app.inject({method:'DELETE',url:`/api/v1/searches/${search}/members/${groupLead}`,headers:{authorization:`Bearer ${tokens[registrar]}`}});
    assert.equal(legacyRemove.statusCode,409, 'legacy removal cannot bypass group roster');
    assert.equal((await call(coordinator,'POST',`${g}/members/change`,{userId:searcher,action:'ADD'})).statusCode,403);
    response=await call(groupLead,'POST',`${g}/member-proposals`,{userId:searcher,action:'ADD'});
    assert.equal(response.statusCode,200);
    let memberProposal=response.json().proposalId;
    assert.equal((await call(fieldLead,'GET',g)).json().members.length,1,'proposal must not alter group');
    assert.equal((await call(searcher,'POST',`${g}/member-decision`,{proposalId:memberProposal,approve:true})).statusCode,403);
    const failingPool={connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:(sql,params)=>{
      if (sql.startsWith('INSERT INTO events')) throw new Error('audit failure'); return c.query(sql,params);
    }}}};
    await assert.rejects(new FieldGroupsService(failingPool).decide(fieldLead,search,groupId,memberProposal,true),/audit failure/);
    assert.equal((await call(fieldLead,'GET',g)).json().members.length,1);
    assert.equal((await call(fieldLead,'POST',`${g}/member-decision`,{proposalId:memberProposal,approve:true})).statusCode,200);
    assert.equal((await call(fieldLead,'GET',g)).json().members.length,2);
    assert.equal((await call(fieldLead,'POST',`${g}/members/change`,{userId:groupLead,action:'REMOVE'})).statusCode,409);
    response=await call(groupLead,'POST',`${g}/member-proposals`,{userId:searcher,action:'REMOVE'});
    memberProposal=response.json().proposalId;
    assert.equal((await call(fieldLead,'POST',`${g}/member-decision`,{proposalId:memberProposal,approve:false})).statusCode,200);
    assert.equal((await call(fieldLead,'GET',g)).json().members.length,2);
    await pool.query('UPDATE users SET active=false WHERE id=$1',[searcher]);
    response=await call(groupLead,'POST',`${g}/member-proposals`,{userId:searcher,action:'REMOVE'});
    assert.equal(response.statusCode,200,'inactive members can be proposed for removal');
    assert.equal((await call(fieldLead,'POST',`${g}/member-decision`,{proposalId:response.json().proposalId,approve:true})).statusCode,200);
    assert.equal((await call(fieldLead,'GET',g)).json().members.length,1);
    assert.equal((await call(fieldLead,'POST',`${g}/members/change`,{userId:searcher,action:'ADD'})).statusCode,404,'inactive members cannot be added');
    await pool.query('UPDATE users SET active=true WHERE id=$1',[searcher]);
    assert.equal((await call(fieldLead,'POST',`${g}/members/change`,{userId:searcher,action:'ADD'})).statusCode,200);
    await pool.query('UPDATE users SET active=false WHERE id=$1',[searcher]);
    assert.equal((await call(fieldLead,'POST',`${g}/members/change`,{userId:searcher,action:'REMOVE'})).statusCode,200,'field lead can directly remove inactive member');
    await pool.query('UPDATE users SET active=true WHERE id=$1',[searcher]);
    // Declined lead appointment can be reissued by the field lead.
    const groupB={requestId:randomUUID(),title:'Group B',candidateId:groupLead};
    await assert.rejects(new FieldGroupsService(failingPool).create(fieldLead,search,groupB.title,groupB.candidateId,groupB.requestId),/audit failure/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_group_create_receipts WHERE request_id=$1',[groupB.requestId])).rows[0].n,0,'receipt rolls back with audit');
    response=await call(fieldLead,'POST','/groups',groupB);
    const b=response.json(); const bpath=`/groups/${b.groupId}`;
    assert.equal((await call(groupLead,'POST',`${bpath}/lead-response`,{proposalId:b.proposalId,accept:false})).statusCode,200);
    response=await call(fieldLead,'POST',`${bpath}/lead-proposals`,{candidateId:searcher});
    assert.equal(response.statusCode,200);
    assert.equal((await call(searcher,'POST',`${bpath}/lead-response`,{proposalId:response.json().proposalId,accept:true})).statusCode,200);
    await pool.query("UPDATE searches SET status='COMPLETED' WHERE id=$1",[search]);
    assert.equal((await call(fieldLead,'POST','/groups',data)).statusCode,409,'receipts require the search to be open');
    const legacy=await app.inject({url:`/api/v1/searches/${search}/events`,headers:{authorization:`Bearer ${tokens[groupLead]}`}});
    assert.equal(legacy.statusCode,200);
    assert.ok(!legacy.json().some(x=>x.type.startsWith('FIELD_GROUP_')));
  } finally {
    await app.close();
    if (search) await pool.query('DELETE FROM searches WHERE id=$1',[search]);
    await pool.query('DELETE FROM events WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    if (oldFlag===undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS; else process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS=oldFlag;
  }
});

test('group workflow is disabled by default and in production',async()=>{
  const flag=process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS,env=process.env.NODE_ENV;
  const url=`/api/v1/field-groups/searches/${randomUUID()}/my-lead-proposals`;
  try {
    delete process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS;
    let app=await buildApp(); assert.equal((await app.inject({url})).statusCode,404); await app.close();
    process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS='true'; process.env.NODE_ENV='production';
    app=await buildApp(); assert.equal((await app.inject({url})).statusCode,404); await app.close();
  } finally {
    if (flag===undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS; else process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS=flag;
    if (env===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=env;
    await pool.end();
  }
});
