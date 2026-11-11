import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('request logs omit query, headers and unmatched paths', () => {
  const script = `
    import { buildApp } from './dist/app.js';
    const app = await buildApp();
    for (const url of ['/health?contact=QUERY_SECRET', '/private-PATH_SECRET?token=QUERY_SECRET']) {
      await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer HEADER_SECRET' } });
    }
    await app.close();
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: serverDir, env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout + result.stderr;
  for (const secret of ['QUERY_SECRET', 'PATH_SECRET', 'HEADER_SECRET']) assert.ok(!output.includes(secret), output);
  const logs = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(logs.some((entry) => entry.route === '/health' && entry.statusCode === 200));
  assert.ok(logs.some((entry) => entry.route === 'unmatched' && entry.statusCode === 404));
});
