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

const runMigrate = (cwd, url, args = []) =>
  spawnSync('node', [path.join(serverDir, 'dist', 'migrate.js'), ...args], {
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
const GAP_DB = 'kukla_mig_gap';
const BROKEN_DB = 'kukla_mig_broken';

after(async () => {
  await dropDb(TEST_DB);
  await dropDb(TAMPER_DB);
  await dropDb(GAP_DB);
  await dropDb(BROKEN_DB);
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

test('migrations: dry-run reports pending migrations without applying them', async () => {
  await recreateDb(TEST_DB);
  try {
    const dry = runMigrate(serverDir, dbUrl(TEST_DB), ['--dry-run']);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal((dry.stdout.match(/Pending /g) || []).length, 8, 'dry-run should list all 8 migrations as pending');
    assert.doesNotMatch(dry.stdout, /Applied /);
    assert.match(dry.stdout, /would be applied/);

    await withDatabase(TEST_DB, async (pool) => {
      const migrations = await pool.query('SELECT count(*)::int AS count FROM schema_migrations');
      assert.equal(migrations.rows[0].count, 0, 'dry-run must not record applied migrations');
    });

    const applied = runMigrate(serverDir, dbUrl(TEST_DB));
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal((applied.stdout.match(/Applied /g) || []).length, 8);

    const after = runMigrate(serverDir, dbUrl(TEST_DB), ['--dry-run']);
    assert.equal(after.status, 0, after.stderr);
    assert.match(after.stdout, /nothing to apply/);
    assert.doesNotMatch(after.stdout, /Pending /);
  } finally {
    await dropDb(TEST_DB);
  }
});

test('migrations: sequence gap is rejected before touching the database', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'kukla-mig-gap-'));
  cpSync(path.join(serverDir, 'sql'), path.join(tmp, 'sql'), { recursive: true });
  rmSync(path.join(tmp, 'sql', '004_organizations_resilience.sql'));
  await recreateDb(GAP_DB);
  try {
    const result = runMigrate(tmp, dbUrl(GAP_DB));
    assert.notEqual(result.status, 0, 'a gap in migration numbering must fail');
    assert.match(`${result.stdout}${result.stderr}`, /sequence gap/i);
    await withDatabase(GAP_DB, async (pool) => {
      const migrations = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_name = 'schema_migrations'");
      assert.equal(migrations.rows[0].count, 0, 'gap must be detected before any migration is applied');
    });
  } finally {
    await dropDb(GAP_DB);
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('migrations: broken SQL rolls back and leaves no partial migration record', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'kukla-mig-broken-'));
  cpSync(path.join(serverDir, 'sql'), path.join(tmp, 'sql'), { recursive: true });
  const target = path.join(tmp, 'sql', '008_backfill_search_creators.sql');
  writeFileSync(target, `${readFileSync(target, 'utf8')}\nTHIS IS NOT VALID SQL;\n`);
  await recreateDb(BROKEN_DB);
  try {
    const result = runMigrate(tmp, dbUrl(BROKEN_DB));
    assert.notEqual(result.status, 0, 'broken SQL must fail the run');
    await withDatabase(BROKEN_DB, async (pool) => {
      const migrations = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
      const versions = migrations.rows.map((row) => row.version);
      assert.deepEqual(versions, ['001', '002', '003', '004', '005', '006', '007'], 'only migrations before the broken one may be recorded');
      assert.ok(!versions.includes('008'), 'failed migration must not be recorded');
    });
  } finally {
    await dropDb(BROKEN_DB);
    rmSync(tmp, { recursive: true, force: true });
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