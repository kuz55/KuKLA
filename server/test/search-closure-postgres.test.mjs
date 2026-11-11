import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { SearchClosureService } from '../dist/search-closure/service.js';
import { FieldLeadService } from '../dist/field-lead/service.js';

test('PostgreSQL serializes concurrent closure and invalidates confirmation on replacement', async () => {
  const pool = new pg.Pool({connectionString: process.env.DATABASE_URL ?? 'postgres://kukla:kukla@localhost:5432/kukla'});
  const [registrar, coordinator, extra, lead, replacement] = Array.from({length:5}, randomUUID);
  const users = [registrar,coordinator,extra,lead,replacement];
  let search;
  try {
    for (const id of users) await pool.query("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Test',$2,'hash','VIEWER')",[id,`${id}@example.invalid`]);
    await pool.query("INSERT INTO intake_permissions(user_id,permission) VALUES($1,'REGISTER')",[registrar]);
    await pool.query('INSERT INTO coordinator_eligibility(user_id) VALUES($1),($2)',[coordinator,extra]);
    await pool.query('INSERT INTO field_lead_eligibility(user_id) VALUES($1),($2)',[lead,replacement]);
    search = (await pool.query("INSERT INTO searches(title,created_by) VALUES('Test',$1) RETURNING id",[registrar])).rows[0].id;
    await pool.query('INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by) VALUES($1,$2,true,$2),($1,$3,false,$2)',[search,coordinator,extra]);
    const field = new FieldLeadService(pool), closure = new SearchClosureService(pool);
    let proposal = await field.propose(registrar,search,lead);
    await field.accept(lead,search,proposal.proposalId);
    await closure.confirm(lead,search);
    proposal = await field.propose(registrar,search,replacement);
    await field.accept(replacement,search,proposal.proposalId);
    await assert.rejects(closure.close(coordinator,search),{statusCode:409});
    await closure.confirm(replacement,search);
    const results = await Promise.allSettled([closure.close(coordinator,search),closure.close(extra,search)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.find(x=>x.status==='rejected').reason.statusCode,409);
    assert.equal((await pool.query("SELECT count(*)::int n FROM events WHERE search_id=$1 AND type='SEARCH_CLOSED'",[search])).rows[0].n,1);
    assert.equal((await closure.reopen(extra,search,'New evidence')).status,'PLANNED');
    await assert.rejects(closure.close(coordinator,search),{statusCode:409});
    await closure.close(extra,search,'Field lead unavailable');
    const rows = (await pool.query("SELECT payload FROM events WHERE search_id=$1 AND type='SEARCH_CLOSED' ORDER BY id",[search])).rows;
    assert.equal(rows[0].payload.fieldLeadId,replacement);
    assert.equal(rows[1].payload.exceptionReason,'Field lead unavailable');
  } finally {
    if (search) {
      await pool.query('DELETE FROM events WHERE search_id=$1',[search]);
      await pool.query('DELETE FROM searches WHERE id=$1',[search]);
    }
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users]);
    await pool.end();
  }
});
