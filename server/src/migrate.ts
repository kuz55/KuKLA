import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla';
const pool = new Pool({ connectionString: databaseUrl });
const migrationsDir = path.resolve(process.cwd(), 'sql');
const migrationName = /^(\d{3})_(.+)\.sql$/;

async function main() {
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

    const entries = (await fs.readdir(migrationsDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && migrationName.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    if (!entries.length) throw new Error(`No migrations found in ${migrationsDir}`);

    const files = new Map<string, { name:string; checksum:string; sql:string }>();
    for (const file of entries) {
      const match = file.match(migrationName);
      if (!match) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      files.set(match[1], { name: file, checksum: createHash('sha256').update(sql).digest('hex'), sql });
    }

    const applied = await client.query('SELECT version,name,checksum FROM schema_migrations ORDER BY version');
    for (const row of applied.rows) {
      const file = files.get(row.version);
      if (!file) throw new Error(`Applied migration ${row.version} is missing from ${migrationsDir}`);
      if (file.name !== row.name || file.checksum !== row.checksum) {
        throw new Error(`Migration checksum/name mismatch for ${row.version}: database=${row.name}/${row.checksum}, file=${file.name}/${file.checksum}`);
      }
    }

    for (const [version, file] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const existing = applied.rows.find((row) => row.version === version);
      if (existing) continue;

      const started = Date.now();
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query(
          'INSERT INTO schema_migrations(version,name,checksum,execution_ms) VALUES($1,$2,$3,$4)',
          [version, file.name, file.checksum, Date.now() - started]
        );
        await client.query('COMMIT');
        console.log(`Applied ${file.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    console.log(`Database schema is up to date (${files.size} migrations).`);
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
