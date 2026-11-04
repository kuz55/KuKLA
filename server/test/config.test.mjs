import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const importConfig = (overrides) => spawnSync(
  process.execPath,
  ['--input-type=module', '-e', "await import('./dist/config.js')"],
  {
    cwd: serverDir,
    env: { ...process.env, NODE_ENV: 'production', ...overrides },
    encoding: 'utf8',
  },
);

test('production config rejects example credentials', () => {
  const result = importConfig({
    DATABASE_URL: 'postgres://kukla:replace-with-a-long-random-password@postgres:5432/kukla',
    JWT_SECRET: 'replace-with-a-long-random-secret',
    CORS_ORIGIN: 'https://kukla.example',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /JWT_SECRET must be a non-placeholder secret/);
});

test('production config rejects a placeholder database password', () => {
  const result = importConfig({
    DATABASE_URL: 'postgres://kukla:replace-with-a-long-random-password@postgres:5432/kukla',
    JWT_SECRET: 'fedcba9876543210'.repeat(4),
    CORS_ORIGIN: 'https://kukla.example',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /DATABASE_URL password must be a non-placeholder secret/);
});

test('production config accepts strong independent secrets', () => {
  const secret = '0123456789abcdef'.repeat(4);
  const result = importConfig({
    DATABASE_URL: `postgres://kukla:${secret}@postgres:5432/kukla`,
    JWT_SECRET: 'fedcba9876543210'.repeat(4),
    CORS_ORIGIN: 'https://kukla.example',
  });
  assert.equal(result.status, 0, result.stderr);
});
