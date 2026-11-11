import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../dist/app.js';
import { pool } from '../dist/config.js';

test('audit cursors order event IDs numerically across a digit boundary',async()=>{
  const flags=['KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY','KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS',
    'KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE','KUKLA_ENABLE_EXPERIMENTAL_GROUPS','KUKLA_ENABLE_EXPERIMENTAL_TASKS'];
  const previous=flags.map(key=>process.env[key]); flags.forEach(key=>{process.env[key]='true';});
  const app=await buildApp(), actor=randomUUID(); let search;
  // Explicit IDs are test-only and do not alter the ordinary event sequence.
  // The larger ID must sort first numerically, not by its text representation.
  const lower=9000000000000000n, higher=10000000000000000n;
  const pairs=[
    ['SEARCH_CLOSED','SEARCH_REOPENED'],['CONTACT_ACCESS_GRANTED','CONTACT_ACCESS_REVOKED'],
    ['OPERATIONAL_ELIGIBILITY_GRANTED','OPERATIONAL_ELIGIBILITY_REVOKED'],
    ['FIELD_GROUP_CREATED','FIELD_GROUP_LEAD_ACCEPTED'],['FIELD_TASK_CREATED','FIELD_TASK_STARTED'],
  ];
  const ids=pairs.flatMap((_,i)=>[(lower+BigInt(i)).toString(),(higher+BigInt(i)).toString()]);
  try {
    await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Synthetic',$2,'hash','VIEWER')",[actor,`${actor}@example.invalid`]);
    await pool.query('INSERT INTO leadership_eligibility VALUES($1)',[actor]);
    await pool.query('INSERT INTO coordinator_eligibility VALUES($1)',[actor]);
    await pool.query('INSERT INTO field_lead_eligibility VALUES($1)',[actor]);
    search=(await pool.query("INSERT INTO searches(title,created_by) VALUES('Synthetic',$1) RETURNING id",[actor])).rows[0].id;
    await pool.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[search,actor]);
    await pool.query('INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by) VALUES($1,$2,true,$2)',[search,actor]);
    await pool.query('INSERT INTO search_field_leads(search_id,user_id,assigned_by) VALUES($1,$2,$2)',[search,actor]);
    const group=(await pool.query("INSERT INTO field_groups(search_id,title,created_by) VALUES($1,'Synthetic',$2) RETURNING id",[search,actor])).rows[0].id;
    await pool.query('INSERT INTO field_group_leads(group_id,search_id,user_id) VALUES($1,$2,$3)',[group,search,actor]);
    const task=(await pool.query("INSERT INTO field_tasks(search_id,group_id,description,priority,due_at,created_by) VALUES($1,$2,'Synthetic','NORMAL','2030-01-01',$3) RETURNING id",[search,group,actor])).rows[0].id;
    for (let i=0;i<pairs.length;i++) for (let j=0;j<2;j++) {
      await pool.query('INSERT INTO events(id,search_id,user_id,type,payload) VALUES($1,$2,$3,$4,$5)',
        [ids[i*2+j],i===2?null:search,actor,pairs[i][j],{groupId:group,taskId:task}]);
    }
    const token=app.jwt.sign({id:actor,name:'Synthetic',role:'VIEWER'});
    await pool.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')",[actor,createHash('sha256').update(token).digest('hex')]);
    const roots=[`/api/v1/search-closure/searches/${search}/audit`,`/api/v1/contact-access/searches/${search}/audit`,
      '/api/v1/eligibility/audit',`/api/v1/field-groups/searches/${search}/groups/${group}/audit`,
      `/api/v1/field-tasks/searches/${search}/tasks/${task}/audit`];
    for (let i=0;i<roots.length;i++) {
      const get=url=>app.inject({url,headers:{authorization:`Bearer ${token}`}});
      const first=await get(`${roots[i]}?limit=1`);
      assert.equal(first.statusCode,200,roots[i]);
      assert.equal(first.json().items[0].id,ids[i*2+1],roots[i]);
      assert.equal(first.json().nextCursor,ids[i*2+1]);
      const second=await get(`${roots[i]}?limit=1&before=${first.json().nextCursor}`);
      assert.equal(second.statusCode,200); assert.equal(second.json().items[0].id,ids[i*2],roots[i]);
    }
  } finally {
    await app.close();
    await pool.query('DELETE FROM events WHERE id=ANY($1::bigint[])',[ids]);
    if (search) await pool.query('DELETE FROM searches WHERE id=$1',[search]);
    await pool.query('DELETE FROM sessions WHERE user_id=$1',[actor]);
    await pool.query('DELETE FROM users WHERE id=$1',[actor]);
    flags.forEach((key,i)=>{if (previous[i]===undefined) delete process.env[key]; else process.env[key]=previous[i];});
    await pool.end();
  }
});
