import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = readFileSync(path.join(serverDir, '..', 'infrastructure', '.env'), 'utf8');
const envGet = (k) => (envFile.match(new RegExp(`^${k}=(.+)$`, 'm')) || [])[1]?.trim();
const pgUser = envGet('POSTGRES_USER') ?? 'kukla';
const pgPass = envGet('POSTGRES_PASSWORD') ?? 'kukla';
const dbUrl = (db) => `postgres://${pgUser}:${pgPass}@localhost:5433/${db}`;

// run compiled migrator with a chosen cwd (migrate.js reads ./sql from cwd)
const runMigrate = (cwd, databaseUrl) =>
  spawnSync('node', [path.join(serverDir, 'dist', 'migrate.js')], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });

const psqlMaint = (sql) =>
  execSync(`docker exec -i infrastructure-postgres-1 psql -U ${pgUser} -d postgres -c "${sql}"`).toString();

const psql = (db, sql) =>
  execSync(`docker exec -i infrastructure-postgres-1 psql -U ${pgUser} -d ${db} -t -A -c "${sql}"`).toString().trim();

const recreateDb = (db) => {
  psqlMaint(`DROP DATABASE IF EXISTS ${db}`);
  psqlMaint(`CREATE DATABASE ${db}`);
};

const TEST_DB = 'kukla_mig_test';
const TAMPER_DB = 'kukla_mig_tamper';

test('migrations: re-run on already migrated dev DB is a no-op (idempotency)', () => {
  const r = runMigrate(serverDir, dbUrl(envGet('POSTGRES_DB') ?? 'kukla'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /up to date/);
  assert.doesNotMatch(r.stdout, /Applied /);
});

test('migrations: clean DB applies all 8 migrations, schema complete, second run no-op', () => {
  recreateDb(TEST_DB);
  try {
    const first = runMigrate(serverDir, dbUrl(TEST_DB));
    assert.equal(first.status, 0, first.stderr);
    const applied = (first.stdout.match(/Applied /g) || []).length;
    assert.equal(applied, 8, 'expected exactly 8 applied migrations on clean DB');
    assert.equal(psql(TEST_DB, 'SELECT count(*) FROM schema_migrations'), '8');
    assert.equal(
      psql(TEST_DB, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"),
      '30',
      'expected 30 public tables after full migration'
    );
    const second = runMigrate(serverDir, dbUrl(TEST_DB));
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /Applied /);
    assert.match(second.stdout, /up to date/);
  } finally {
    psqlMaint(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  }
});

test('migrations: tampered migration file is rejected by checksum guard', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'kukla-mig-'));
  cpSync(path.join(serverDir, 'sql'), path.join(tmp, 'sql'), { recursive: true });
  recreateDb(TAMPER_DB);
  try {
    const first = runMigrate(tmp, dbUrl(TAMPER_DB));
    assert.equal(first.status, 0, first.stderr);
    const target = path.join(tmp, 'sql', '001_init.sql');
    writeFileSync(target, readFileSync(target, 'utf8') + '\n-- tampered by QA\n');
    const second = runMigrate(tmp, dbUrl(TAMPER_DB));
    assert.notEqual(second.status, 0, 'tampered migration must fail');
    assert.match(`${second.stdout}${second.stderr}`, /checksum/i);
  } finally {
    psqlMaint(`DROP DATABASE IF EXISTS ${TAMPER_DB}`);
    rmSync(tmp, { recursive: true, force: true });
  }
});
