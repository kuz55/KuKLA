// Only for a fresh, isolated training database. Never run against real data.
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
if (process.env.NODE_ENV !== 'test' || process.env.KUKLA_TRAINING_SEED !== 'synthetic-only') throw new Error('Training seed is disabled');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL});
const accounts = [
  ['operator','Учебная горячая линия'], ['registrar','Учебный регистратор'],
  ['coordinator','Учебный координатор'], ['fieldlead','Учебный старший на месте'],
  ['grouplead','Учебный старший группы'], ['searcher','Учебный поисковик'],
  ['leader','Учебный руководитель'],
].map(([name,display]) => ({name,display,email:`${name}@training.invalid`,password:randomBytes(18).toString('base64url')}));
try {
  // Hash before the transaction, then exclusively serialize the emptiness check.
  for (const a of accounts) a.hash=await bcrypt.hash(a.password,12);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kukla-training-seed'))");
    const database=await client.query('SELECT current_database() AS name');
    if (database.rows[0].name !== 'kukla_training') throw new Error('Wrong database');
    await client.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const existing=await client.query('SELECT 1 FROM users LIMIT 1');
    if (existing.rowCount) throw new Error('Database is not empty');
    for (const a of accounts) {
      const result=await client.query("INSERT INTO users(name,email,password_hash,role,active) VALUES($1,$2,$3,'VIEWER',true) RETURNING id",[a.display,a.email,a.hash]);
      a.id=result.rows[0].id;
    }
    const id=name=>accounts.find(a=>a.name===name).id;
    await client.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'RECORD'),($2,'REGISTER')",[id('operator'),id('registrar')]);
    await client.query('INSERT INTO leadership_eligibility(user_id) VALUES($1)',[id('leader')]);
    await client.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1)',[id('coordinator')]);
    await client.query('INSERT INTO field_lead_eligibility(user_id) VALUES($1)',[id('fieldlead')]);
    await client.query('COMMIT');
    process.stdout.write(JSON.stringify(accounts.map(({name,email,password})=>({name,email,password})),null,2)+'\n');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
} finally { await pool.end(); }
