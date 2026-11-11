import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../dist/app.js';
import { pool } from '../dist/config.js';

test('session store outages fail closed as 503, not invalid credentials', async () => {
  const app = await buildApp();
  const original = pool.query;
  const id = randomUUID();
  const token = app.jwt.sign({ id, role: 'VIEWER', name: 'Test' });
  const headers = { authorization: `Bearer ${token}` };
  let calls = 0, mode = 'outage';
  pool.query = async () => {
    calls++;
    if (mode === 'outage') throw new Error('sensitive database error value');
    if (mode === 'revoked') return { rowCount: 0, rows: [] };
    return { rowCount: 1, rows: [{ id, name:'Test', email:null, phone:null, role:'VIEWER' }] };
  };
  try {
    assert.equal((await app.inject({url:'/api/v1/me'})).statusCode,401);
    assert.equal((await app.inject({url:'/api/v1/me',headers:{authorization:'Bearer invalid'}})).statusCode,401);
    assert.equal(calls,0, 'invalid JWT must not query the database');
    let response = await app.inject({url:'/api/v1/me',headers});
    assert.equal(response.statusCode,503);
    assert.ok(!response.body.includes('sensitive database error value'));
    mode = 'active';
    response = await app.inject({url:'/api/v1/me',headers});
    assert.equal(response.statusCode,200);
    assert.equal(response.json().id,id);
    mode = 'revoked';
    assert.equal((await app.inject({url:'/api/v1/me',headers})).statusCode,401);
  } finally {
    pool.query = original;
    await app.close();
  }
});
