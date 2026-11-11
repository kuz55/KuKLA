// CLI fixture only; never registered as a route or usable in production.
import pg from 'pg';
const searchId=process.env.KUKLA_TRAINING_SEARCH_ID ?? '';
if (process.env.NODE_ENV !== 'test' || process.env.KUKLA_TRAINING_ENROL !== 'synthetic-only' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchId)) {
  throw new Error('Training enrolment disabled or invalid search ID');
}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try {
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    if ((await c.query('SELECT current_database() AS name')).rows[0].name !== 'kukla_training') throw new Error('Wrong database');
    const search=await c.query(`SELECT s.id FROM searches s JOIN users u ON u.id=s.created_by
      WHERE s.id=$1 AND s.status IN ('PLANNED','ACTIVE','PAUSED') AND u.email='registrar@training.invalid' AND u.active=true
      FOR UPDATE OF s`,[searchId]);
    if (!search.rowCount) throw new Error('Open training search created by the synthetic registrar required');
    const users=await c.query(`SELECT id,email FROM users WHERE email=ANY($1::text[]) AND active=true AND role='VIEWER' ORDER BY email FOR SHARE`,
      [['grouplead@training.invalid','searcher@training.invalid']]);
    if (users.rowCount!==2) throw new Error('Expected active synthetic accounts not found');
    let added=0;
    for (const user of users.rows) {
      const r=await c.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',[searchId,user.id]);
      if (r.rowCount) {
        added++;
        await c.query("INSERT INTO events(search_id,user_id,type,payload) VALUES($1,NULL,'TRAINING_FIXTURE_MEMBER_ADDED',$2)",
          [searchId,{userId:user.id,source:'training fixture'}]);
      }
    }
    await c.query('COMMIT');
    console.log(`Training fixture: ${added} account(s) added; ${users.rowCount-added} already present.`);
  } catch(error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
} finally { await pool.end(); }
