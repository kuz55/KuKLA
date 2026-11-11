import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../dist/config.js';
import { buildApp } from '../dist/app.js';
import { SearchClosureService } from '../dist/search-closure/service.js';

test('experimental closure API: assignment-bound confirmation, permissions, audit and rollback', async () => {
  const db = new PGlite();
  const originalQuery = pool.query, originalConnect = pool.connect;
  const originalFlag = process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE;
  let app;
  try {
    await db.exec(`CREATE TABLE users(id uuid PRIMARY KEY, name text, email text, phone text, role text, active boolean);
      CREATE TABLE sessions(token_hash text, user_id uuid, expires_at timestamptz);
      CREATE TABLE searches(id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'PLANNED', ended_at timestamptz);
      CREATE TABLE events(search_id uuid, user_id uuid, type text, payload jsonb);
      CREATE TABLE search_contact_grants(search_id uuid);
      CREATE TABLE coordinator_eligibility(user_id uuid PRIMARY KEY REFERENCES users(id));
      CREATE TABLE search_coordinators(search_id uuid REFERENCES searches(id), user_id uuid REFERENCES users(id), is_primary boolean, PRIMARY KEY(search_id,user_id));
      CREATE TABLE field_lead_eligibility(user_id uuid PRIMARY KEY REFERENCES users(id));
      CREATE TABLE search_field_leads(search_id uuid PRIMARY KEY REFERENCES searches(id), user_id uuid REFERENCES users(id), assigned_at timestamptz DEFAULT now());`);
    await db.exec(await readFile(new URL('../sql/020_search_closure.sql', import.meta.url), 'utf8'));
    const [primary, extra, lead, outsider, search] = Array.from({length:5}, randomUUID);
    for (const id of [primary,extra,lead,outsider]) await db.query("INSERT INTO users(id,name,role,active) VALUES($1,'Test','VIEWER',true)",[id]);
    await db.query('INSERT INTO searches(id,status) VALUES($1,\'PAUSED\')',[search]);
    await db.query('INSERT INTO coordinator_eligibility VALUES($1),($2)',[primary,extra]);
    await db.query('INSERT INTO search_coordinators VALUES($1,$2,true),($1,$3,false)',[search,primary,extra]);
    await db.query('INSERT INTO field_lead_eligibility VALUES($1)',[lead]);
    await db.query('INSERT INTO search_field_leads(search_id,user_id) VALUES($1,$2)',[search,lead]);
    const client = { query: (sql, params) => db.query(sql, params), release: () => {} };
    pool.query = (sql, params) => db.query(sql, params);
    pool.connect = async () => client;
    process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE = 'true';
    app = await buildApp();
    const tokens = {};
    for (const id of [primary,extra,lead,outsider]) {
      const token = app.jwt.sign({id,role:'VIEWER',name:'Test'});
      tokens[id] = token;
      await db.query("INSERT INTO sessions VALUES($1,$2,now()+interval '1 hour')",[createHash('sha256').update(token).digest('hex'),id]);
    }
    const base = `/api/v1/search-closure/searches/${search}`;
    const call = (path,id,payload) => app.inject({method:'POST',url:base+path,headers:id?{authorization:`Bearer ${tokens[id]}`}:{},payload});
    assert.equal((await call('/confirm',null,{})).statusCode,401);
    assert.equal((await call('/confirm',outsider,{})).statusCode,403);
    assert.equal((await call('/close',outsider,{exceptionReason:'test'})).statusCode,403);
    assert.equal((await call('/close',primary,{})).statusCode,409);
    assert.equal((await call('/close',primary,{exceptionReason:' '})).statusCode,400);
    assert.equal((await call('/confirm',lead,{})).statusCode,200);
    assert.equal((await call('/confirm',lead,{})).statusCode,200);
    assert.equal((await db.query("SELECT count(*)::int n FROM events WHERE type='SEARCH_CLOSURE_CONFIRMED'")).rows[0].n,1);
    assert.equal((await call('/close',primary,{exceptionReason:'not needed'})).statusCode,409);
    // A new accepted assignment, even to the same person, invalidates old confirmation.
    await db.query('UPDATE search_field_leads SET assignment_id=gen_random_uuid() WHERE search_id=$1',[search]);
    assert.equal((await call('/close',primary,{})).statusCode,409);
    assert.equal((await call('/confirm',lead,{})).statusCode,200);
    await db.query('UPDATE users SET active=false WHERE id=$1',[lead]);
    assert.equal((await call('/close',primary,{})).statusCode,409);
    await db.query('UPDATE users SET active=true WHERE id=$1',[lead]);
    const failing = {connect: async () => ({...client,query: (sql,params) => {
      if (sql.startsWith('INSERT INTO events')) throw new Error('audit failure');
      return db.query(sql,params);
    }})};
    await assert.rejects(new SearchClosureService(failing).close(primary,search), /audit failure/);
    assert.equal((await db.query('SELECT status FROM searches WHERE id=$1',[search])).rows[0].status,'PAUSED');
    assert.equal((await db.query('SELECT count(*)::int n FROM search_closures')).rows[0].n,0);
    assert.equal((await call('/close',extra,{})).statusCode,200);
    assert.equal((await call('/close',extra,{})).statusCode,409);
    assert.equal((await call('/reopen',outsider,{reason:'test'})).statusCode,403);
    assert.equal((await call('/reopen',primary,{reason:' '})).statusCode,400);
    const reopened = await call('/reopen',extra,{reason:'new information'});
    assert.equal(reopened.statusCode,200);
    assert.equal(reopened.json().status,'PAUSED');
    assert.equal((await call('/close',primary,{})).statusCode,409, 'reopening cannot reuse confirmation');
    assert.equal((await call('/close',primary,{exceptionReason:'lead unavailable'})).statusCode,200);
    const events = (await db.query("SELECT user_id,type,payload FROM events WHERE type IN ('SEARCH_CLOSED','SEARCH_REOPENED') ORDER BY ctid")).rows;
    assert.equal(events.length,3);
    assert.equal(events[0].user_id,extra);
    assert.equal(events[0].payload.fieldLeadId,lead);
    assert.equal(events[1].payload.reason,'new information');
    assert.equal(events[2].payload.exceptionReason,'lead unavailable');
    assert.equal(events[2].payload.fieldLeadId,null);
  } finally {
    if (app) await app.close();
    pool.query = originalQuery; pool.connect = originalConnect;
    if (originalFlag === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE;
    else process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE = originalFlag;
    await db.close();
  }
});

test('closure endpoints are disabled by default and in production', async () => {
  const flag = process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE, env = process.env.NODE_ENV;
  try {
    delete process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE;
    let app = await buildApp();
    assert.equal((await app.inject({method:'POST',url:`/api/v1/search-closure/searches/${randomUUID()}/close`,payload:{}})).statusCode,404);
    await app.close();
    process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE = 'true'; process.env.NODE_ENV = 'production';
    app = await buildApp();
    assert.equal((await app.inject({method:'POST',url:`/api/v1/search-closure/searches/${randomUUID()}/close`,payload:{}})).statusCode,404);
    await app.close();
  } finally {
    if (flag === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE; else process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE = flag;
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
  }
});
