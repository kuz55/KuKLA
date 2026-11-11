import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../dist/app.js';

test('contact access is unavailable by default and in production', async () => {
  const flag = process.env.KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS, env = process.env.NODE_ENV;
  const url = `/api/v1/contact-access/searches/${randomUUID()}/reports/${randomUUID()}/contact`;
  try {
    delete process.env.KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS;
    let app = await buildApp();
    assert.equal((await app.inject({url})).statusCode,404);
    await app.close();
    process.env.KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS = 'true';
    process.env.NODE_ENV = 'production';
    app = await buildApp();
    assert.equal((await app.inject({url})).statusCode,404);
    await app.close();
  } finally {
    if (flag === undefined) delete process.env.KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS; else process.env.KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS = flag;
    if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env;
  }
});
