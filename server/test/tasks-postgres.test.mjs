import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { buildApp } from '../dist/app.js';
import { pool } from '../dist/config.js';
import { FieldTasksService } from '../dist/tasks/service.js';
import { TaskOverdueInbox } from '../dist/tasks/overdue.js';

test('group task lifecycle enforces roles, results, review and overdue without changing status', async () => {
  const old=process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS;
  process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS='true';
  const app=await buildApp();
  const [field,lead,member,outsider]=Array.from({length:4},randomUUID), users=[field,lead,member,outsider];
  let search;
  try {
    for (const id of users) await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Synthetic',$2,'hash','VIEWER')",[id,`${id}@example.invalid`]);
    search=(await pool.query("INSERT INTO searches(title,created_by) VALUES('Synthetic',$1) RETURNING id",[field])).rows[0].id;
    await pool.query('INSERT INTO field_lead_eligibility VALUES($1)',[field]);
    await pool.query('INSERT INTO search_field_leads(search_id,user_id,assigned_by) VALUES($1,$2,$2)',[search,field]);
    await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2),($1,$3)',[search,lead,member]);
    const group=(await pool.query("INSERT INTO field_groups(search_id,title,created_by) VALUES($1,'Synthetic',$2) RETURNING id",[search,field])).rows[0].id;
    await pool.query('INSERT INTO field_group_leads(search_id,group_id,user_id) VALUES($1,$2,$3)',[search,group,lead]);
    await pool.query('INSERT INTO field_group_members(search_id,group_id,user_id) VALUES($1,$2,$3),($1,$2,$4)',[search,group,lead,member]);
    const tokens={};
    for (const id of users) {
      tokens[id]=app.jwt.sign({id,name:'Synthetic',role:'VIEWER'});
      await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[id,createHash('sha256').update(tokens[id]).digest('hex')]);
    }
    const base=`/api/v1/field-tasks/searches/${search}`, groupPath=`/groups/${group}/tasks`;
    const call=(user,method,path,payload)=>app.inject({method,url:base+path,payload,headers:user?{authorization:`Bearer ${tokens[user]}`}:{}});
    const data={requestId:randomUUID(),description:'Synthetic task',priority:'URGENT',dueAt:'2020-01-01T00:00:00Z'};
    assert.equal((await call(null,'POST',groupPath,data)).statusCode,401);
    assert.equal((await call(lead,'POST',groupPath,data)).statusCode,403);
    assert.equal((await call(field,'POST',groupPath,{...data,requestId:undefined})).statusCode,400);
    assert.equal((await call(field,'POST',groupPath,{...data,dueAt:'2020-01-01'})).statusCode,400);
    assert.equal((await call(field,'POST',groupPath,{...data,description:'  '})).statusCode,400);
    const creation=await Promise.all([call(field,'POST',groupPath,data),call(field,'POST',groupPath,data)]);
    assert.deepEqual(creation.map(r=>r.statusCode),[200,200]);
    const id=creation[0].json().taskId, task=`/tasks/${id}`;
    assert.equal(creation[1].json().taskId,id,'concurrent retries return the same task');
    assert.equal(creation[0].headers['cache-control'],'no-store');
    assert.equal((await call(field,'POST',groupPath,{...data,dueAt:'2020-01-01T03:00:00+03:00'})).json().taskId,id,'equivalent timestamps match');
    assert.equal((await call(field,'POST',groupPath,{...data,description:'Different task'})).statusCode,409);
    assert.equal((await call(field,'POST',`/groups/${randomUUID()}/tasks`,data)).statusCode,409);
    assert.equal((await pool.query("SELECT count(*)::int n FROM events WHERE search_id=$1 AND type='FIELD_TASK_CREATED'",[search])).rows[0].n,1);
    let response;
    assert.equal((await call(outsider,'GET',groupPath)).statusCode,403);
    let item=(await call(member,'GET',groupPath)).json().items[0];
    assert.equal(item.overdue,true); assert.equal(item.status,'ASSIGNED'); assert.equal(item.priority,'URGENT');
    const inbox=new TaskOverdueInbox(pool);
    const brokenInboxPool={query:(...args)=>pool.query(...args),connect:async()=>{const c=await pool.connect();return {
      release:()=>c.release(),query:async(sql,params)=>{
        if (sql.startsWith('INSERT INTO field_task_overdue_notifications')) { await c.query(sql,params); throw new Error('inbox failure'); }
        return c.query(sql,params);
      }
    };}};
    await assert.rejects(new TaskOverdueInbox(brokenInboxPool).process(),/inbox failure/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_task_overdue_notifications WHERE task_id=$1',[id])).rows[0].n,0,'failed notification batch rolls back');
    await Promise.all([inbox.process(),inbox.process()]);
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_task_overdue_notifications WHERE task_id=$1',[id])).rows[0].n,2,'concurrent scans must not duplicate recipients');
    const notification=async user=>app.inject({url:'/api/v1/field-tasks/notifications',headers:{authorization:`Bearer ${tokens[user]}`}});
    const notifyField=await notification(field), notifyLead=await notification(lead);
    assert.equal(notifyField.headers['cache-control'],'no-store');
    assert.equal(notifyField.json().items.filter(x=>x.task_id===id).length,1);
    await pool.query('DELETE FROM field_lead_eligibility WHERE user_id=$1',[field]);
    assert.equal((await notification(field)).json().items.length,0,'lost eligibility hides earlier notifications');
    await pool.query('INSERT INTO field_lead_eligibility VALUES($1)',[field]);
    const notice=notifyLead.json().items.find(x=>x.task_id===id).id;
    assert.equal((await notification(member)).json().items.length,0);
    assert.equal((await app.inject({method:'POST',url:`/api/v1/field-tasks/notifications/${notice}/acknowledge`,headers:{authorization:`Bearer ${tokens[member]}`}})).statusCode,404);
    const ack=()=>app.inject({method:'POST',url:`/api/v1/field-tasks/notifications/${notice}/acknowledge`,headers:{authorization:`Bearer ${tokens[lead]}`}});
    assert.equal((await ack()).statusCode,200); assert.equal((await ack()).statusCode,200);
    assert.equal((await notification(lead)).json().items.length,0);
    await inbox.process();
    assert.equal((await notification(lead)).json().items.length,0,'acknowledged reminder is not duplicated');
    assert.equal((await call(member,'POST',`${task}/accept`)).statusCode,403);
    assert.equal((await call(lead,'POST',`${task}/results`,{result:'early'})).statusCode,409);
    const accepting=await Promise.all([call(lead,'POST',`${task}/accept`),call(lead,'POST',`${task}/accept`)]);
    assert.deepEqual(accepting.map(r=>r.statusCode).sort(),[200,409]);
    assert.equal((await call(lead,'POST',`${task}/results`,{result:'   '})).statusCode,400);
    const failingPool={connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:(sql,params)=>{
      if (sql.startsWith('INSERT INTO events')) throw new Error('audit failure'); return c.query(sql,params);
    }}}};
    await assert.rejects(new FieldTasksService(failingPool).submit(lead,search,id,'Synthetic result'),/audit failure/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_task_results WHERE task_id=$1',[id])).rows[0].n,0);
    const retryData={...data,requestId:randomUUID(),dueAt:'2035-01-01T00:00:00Z'};
    await assert.rejects(new FieldTasksService(failingPool).create(field,search,group,retryData.description,retryData.dueAt,retryData.priority,retryData.requestId),/audit failure/);
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_tasks WHERE create_request_id=$1',[retryData.requestId])).rows[0].n,0,'task and request receipt roll back with audit');
    response=await call(lead,'POST',`${task}/results`,{result:'First result'});
    assert.equal(response.statusCode,200); let resultId=response.json().resultId;
    assert.equal((await call(member,'GET',`${task}/results`)).statusCode,403);
    assert.equal((await call(lead,'POST',`${task}/decision`,{resultId,approve:true})).statusCode,403);
    assert.equal((await call(field,'POST',`${task}/decision`,{resultId,approve:false,reason:'  '})).statusCode,400);
    assert.equal((await call(field,'POST',`${task}/decision`,{resultId,approve:false,reason:'More detail needed'})).statusCode,200);
    assert.equal((await call(field,'GET',`${task}/results`)).json().items[0].return_reason,'More detail needed');
    item=(await call(member,'GET',groupPath)).json().items[0]; assert.equal(item.status,'IN_PROGRESS'); assert.equal(item.overdue,true);
    response=await call(lead,'POST',`${task}/results`,{result:'Second result'}); resultId=response.json().resultId;
    assert.equal((await call(field,'POST',`${task}/decision`,{resultId:randomUUID(),approve:true})).statusCode,404);
    assert.equal((await call(field,'POST',`${task}/decision`,{resultId,approve:true})).statusCode,200);
    item=(await call(member,'GET',groupPath)).json().items[0]; assert.equal(item.status,'ACCEPTED'); assert.equal(item.overdue,false);
    assert.equal((await notification(field)).json().items.filter(x=>x.task_id===id).length,0,'accepted task is no longer shown as overdue');
    await inbox.process();
    assert.equal((await pool.query('SELECT count(*)::int n FROM field_task_overdue_notifications WHERE task_id=$1',[id])).rows[0].n,2);
    assert.equal((await call(lead,'GET',`${task}/results?limit=1`)).json().items.length,1);
    assert.ok((await call(lead,'GET',`${task}/results?limit=1`)).json().nextCursor);
    assert.equal((await call(lead,'POST',`${task}/results`,{result:'late'})).statusCode,409);
    await pool.query('UPDATE users SET active=false WHERE id=$1',[member]);
    assert.equal((await call(member,'GET',groupPath)).statusCode,401);
    response=await call(field,'POST',groupPath,retryData);
    assert.equal(response.statusCode,200,'request can retry after rolled-back creation');
    assert.equal((await call(field,'POST',groupPath,retryData)).json().taskId,response.json().taskId);
    await pool.query("UPDATE searches SET status='COMPLETED' WHERE id=$1",[search]);
    assert.equal((await call(field,'POST',groupPath,data)).statusCode,409);
    const legacy=await app.inject({url:`/api/v1/searches/${search}/events`,headers:{authorization:`Bearer ${tokens[lead]}`}});
    assert.equal(legacy.statusCode,200); assert.ok(!legacy.json().some(e=>e.type.startsWith('FIELD_TASK_')));
  } finally {
    await app.close();
    if (search) await pool.query('DELETE FROM searches WHERE id=$1',[search]);
    await pool.query('DELETE FROM events WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[users]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    if (old===undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS; else process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS=old;
  }
});

test('task API is disabled by default and in production',async()=>{
  const flag=process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS,env=process.env.NODE_ENV;
  const url=`/api/v1/field-tasks/searches/${randomUUID()}/groups/${randomUUID()}/tasks`;
  try {
    delete process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS;
    let app=await buildApp(); assert.equal((await app.inject({url})).statusCode,404); await app.close();
    process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS='true'; process.env.NODE_ENV='production';
    app=await buildApp(); assert.equal((await app.inject({url})).statusCode,404); await app.close();
  } finally {
    if (flag===undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS; else process.env.KUKLA_ENABLE_EXPERIMENTAL_TASKS=flag;
    if (env===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=env;
    await pool.end();
  }
});
