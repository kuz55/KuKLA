import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../dist/app.js';

const app = await buildApp();
after(() => app.close());

test('Zod request validation errors return HTTP 400 with field details', async () => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: 'not-the-login-field', password: 'short' },
  });

  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.error, 'VALIDATION_ERROR');
  assert.ok(Array.isArray(body.details));
  assert.ok(body.details.some((detail) => detail.path === 'login'));
});
