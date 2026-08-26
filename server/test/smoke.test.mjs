import test from 'node:test';
import assert from 'node:assert/strict';
const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';
test('health endpoint', async()=>{const r=await fetch(`${base}/health`);assert.equal(r.status,200);const x=await r.json();assert.equal(x.ok,true);});
