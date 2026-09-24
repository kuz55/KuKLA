import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;

export const databaseUrl = process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla';

const pool = new Pool({ connectionString: databaseUrl });

export const createTestUser = async (role, email, password = 'test-pass-123456') => {
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    `INSERT INTO users(name, email, password_hash, role, active)
     VALUES($1, $2, $3, $4, true)
     RETURNING id`,
    [`Test ${role}`, email, passwordHash, role],
  );
  return rows[0].id;
};

export const ensureTestOwner = async (
  email = process.env.KUKLA_TEST_OWNER_EMAIL ?? 'owner@kukla.local',
  password = process.env.KUKLA_TEST_OWNER_PASSWORD ?? 'owner-pass-123456',
) => {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [86325149]);
    const existing = await client.query(
      "SELECT id FROM users WHERE role = 'SYSTEM_OWNER' AND active = true LIMIT 1",
    );
    if (existing.rowCount) return existing.rows[0].id;

    const passwordHash = await bcrypt.hash(password, 12);
    const created = await client.query(
      `INSERT INTO users(name, email, password_hash, role, active)
       VALUES($1, $2, $3, 'SYSTEM_OWNER', true)
       RETURNING id`,
      ['Test System Owner', email, passwordHash],
    );
    return created.rows[0].id;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [86325149]);
    client.release();
  }
};

export const closeTestDatabase = async () => pool.end();
