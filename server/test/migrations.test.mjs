import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, cpSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla';
const currentDatabase = new URL(databaseUrl).pathname.slice(1);
const maintenanceUrl = new URL(databaseUrl);
maintenanceUrl.pathname = '/postgres';
const maintenancePool = new Pool({ connectionString: maintenanceUrl.toString() });

const dbUrl = (database) => {
  const url = new URL(databaseUrl);
  url.pathname = `/${database}`;
  return url.toString();
};

const runMigrate = (cwd, url) =>
  spawnSync('node', [path.join(serverDir, 'dist', 'migrate.js')], {
    cwd,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
  });

const withDatabase = async (database, callback) => {
  const pool = new Pool({ connectionString: dbUrl(database) });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
};

const recreateDb = async (database) => {
  await maintenancePool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [database]);
  await maintenancePool.query(`DROP DATABASE IF EXISTS ${database}`);
  await maintenancePool.query(`CREATE DATABASE ${database}`);
};

const dropDb = async (database) => {
  await maintenancePool.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [database]);
  await maintenancePool.query(`DROP DATABASE IF EXISTS ${database}`);
};

const TEST_DB = 'kukla_mig_test';
const TAMPER_DB = 'kukla_mig_tamper';

after(async () => {
  await dropDb(TEST_DB);
  await dropDb(TAMPER_DB);
  await maintenancePool.end();
});

test('migrations: re-run on already migrated dev DB is a no-op (idempotency)', () => {
  const result = runMigrate(serverDir, dbUrl(currentDatabase));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /up to date/);
  assert.doesNotMatch(result.stdout, /Applied /);
});

test('migrations: clean DB applies all 8 migrations, schema complete, second run no-op', async () => {
  await recreateDb(TEST_DB);
  try {
    const first = runMigrate(serverDir, dbUrl(TEST_DB));
    assert.equal(first.status, 0, first.stderr);
    assert.equal((first.stdout.match(/Applied /g) || []).length, 8, 'expected exactly 8 applied migrations on clean DB');

    await withDatabase(TEST_DB, async (pool) => {
      const migrations = await pool.query('SELECT count(*)::int AS count FROM schema_migrations');
      assert.equal(migrations.rows[0].count, 8);
      const tables = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'");
      assert.equal(tables.rows[0].count, 30, 'expected 30 public tables after full migration');
    });

    const second = runMigrate(serverDir, dbUrl(TEST_DB));
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stdout, /Applied /);
    assert.match(second.stdout, /up to date/);
  } finally {
    await dropDb(TEST_DB);
  }
});

test('migrations: tampered migration file is rejected by checksum guard', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'kukla-mig-'));
  cpSync(path.join(serverDir, 'sql'), path.join(tmp, 'sql'), { recursive: true });
  await recreateDb(TAMPER_DB);
  try {
    const first = runMigrate(tmp, dbUrl(TAMPER_DB));
    assert.equal(first.status, 0, first.stderr);
    const target = path.join(tmp, 'sql', '001_init.sql');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n-- tampered by QA\n`);
    const second = runMigrate(tmp, dbUrl(TAMPER_DB));
    assert.notEqual(second.status, 0, 'tampered migration must fail');
    assert.match(`${second.stdout}${second.stderr}`, /checksum/i);
  } finally {
    await dropDb(TAMPER_DB);
    rmSync(tmp, { recursive: true, force: true });
  }
});