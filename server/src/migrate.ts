import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla';
const pool = new Pool({ connectionString: databaseUrl });
const migrationsDir = path.resolve(process.cwd(), 'sql');
const migrationName = /^(\d{3})_(.+)\.sql$/;

type MigrationFile = { version: string; name: string; checksum: string; sql: string };

// Раннер намеренно остаётся самостоятельным: он фиксирует версию схемы,
// отказывается переигрывать применённую миграцию с другим checksum и
// выполняется отдельной командой, а не скрыто при старте приложения.
async function loadMigrations(): Promise<MigrationFile[]> {
  const entries = (await fs.readdir(migrationsDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && migrationName.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (!entries.length) throw new Error(`No migrations found in ${migrationsDir}`);

  const files: MigrationFile[] = [];
  for (const file of entries) {
    const match = file.match(migrationName);
    if (!match) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    files.push({ version: match[1], name: file, checksum: createHash('sha256').update(sql).digest('hex'), sql });
  }
  files.sort((a, b) => a.version.localeCompare(b.version));

  // Непрерывность нумерации: пропущенный номер означает незакоммиченную
  // миграцию в истории, применять поверх неё следующие нельзя.
  for (let i = 1; i < files.length; i++) {
    const previous = Number(files[i - 1].version);
    const current = Number(files[i].version);
    if (current !== previous + 1) {
      throw new Error(`Migration sequence gap: ${files[i - 1].name} is followed by ${files[i].name} (expected ${String(previous + 1).padStart(3, '0')})`);
    }
  }

  return files;
}

function verifyApplied(applied: { version: string; name: string; checksum: string }[], files: Map<string, MigrationFile>) {
  for (const row of applied) {
    const file = files.get(row.version);
    if (!file) throw new Error(`Applied migration ${row.version} is missing from ${migrationsDir}`);
    if (file.name !== row.name || file.checksum !== row.checksum) {
      throw new Error(`Migration checksum/name mismatch for ${row.version}: database=${row.name}/${row.checksum}, file=${file.name}/${file.checksum}`);
    }
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = await loadMigrations();
  const fileMap = new Map(files.map((file) => [file.version, file]));

  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        execution_ms integer NOT NULL DEFAULT 0
      )
    `);
    await client.query('SELECT pg_advisory_lock($1)', [74211501]);

    const applied = await client.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version');
    verifyApplied(applied.rows, fileMap);

    const appliedVersions = new Set(applied.rows.map((row) => row.version as string));
    const pending = files.filter((file) => !appliedVersions.has(file.version));
    const currentVersion = applied.rows.length ? (applied.rows[applied.rows.length - 1].version as string) : 'none';
    console.log(`Current schema version: ${currentVersion}`);

    if (dryRun) {
      if (pending.length) {
        for (const file of pending) console.log(`Pending ${file.name}`);
        console.log(`Dry run: ${pending.length} migration(s) would be applied.`);
      } else {
        console.log('Dry run: database schema is up to date, nothing to apply.');
      }
      return;
    }

    for (const file of pending) {
      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query(
          'INSERT INTO schema_migrations(version,name,checksum,execution_ms) VALUES($1,$2,$3,$4)',
          [file.version, file.name, file.checksum, Date.now() - started]
        );
        await client.query('COMMIT');
        console.log(`Applied ${file.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`Database schema is up to date (${files.length} migrations).`);
  } finally {
    try { await client.query('SELECT pg_advisory_unlock($1)', [74211501]); } catch { /* connection may already be gone */ }
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});