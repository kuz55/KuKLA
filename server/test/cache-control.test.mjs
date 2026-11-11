import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../dist/app.js';

test('all API responses, including failures and unknown routes, forbid caching', async () => {
  const app = await buildApp();
  // Exercise a successful response without relying on live credentials or data.
  app.get('/api/v1/cache-test', async () => ({ token: 'synthetic' }));
  try {
    for (const [method, url, payload, expected] of [
      ['GET', '/api/v1/cache-test?ignored=yes', undefined, 200],
      ['GET', '/api/v1/searches', undefined, 401],
      ['POST', '/api/v1/auth/login', {}, 400],
      ['GET', '/api/v1/does-not-exist', undefined, 404],
      ['GET', '/api/v1?ignored=yes', undefined, 404],
    ]) {
      const response = await app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
      assert.equal(response.statusCode, expected, url);
      assert.equal(response.headers['cache-control'], 'no-store', url);
    }
    const health = await app.inject('/health');
    assert.equal(health.headers['cache-control'], undefined);
    const outside = await app.inject('/api/v10/unmatched');
    assert.equal(outside.headers['cache-control'], undefined);
  } finally {
    await app.close();
  }
});
