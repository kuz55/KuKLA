import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

// Experimental workflow only. Every mutation shares the search row lock with
// field-lead replacement and coordinator assignment. Audit is transactional.
export class SearchClosureService {
  constructor(private readonly pool: Pool) {}

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  private async lockSearch(client: PoolClient, searchId: string) {
    const result = await client.query<{ status: string }>('SELECT status FROM searches WHERE id=$1 FOR UPDATE', [searchId]);
    if (!result.rowCount) throw httpErrors.notFound('Search not found');
    return result.rows[0].status;
  }

  private async coordinator(client: PoolClient, actor: string, searchId: string) {
    const result = await client.query(`SELECT sc.user_id FROM search_coordinators sc
      JOIN coordinator_eligibility e ON e.user_id=sc.user_id JOIN users u ON u.id=sc.user_id
      WHERE sc.search_id=$1 AND sc.user_id=$2 AND u.active=true FOR SHARE OF sc,e,u`, [searchId,actor]);
    if (!result.rowCount) throw httpErrors.forbidden('Assigned active coordinator required');
  }

  private async event(client: PoolClient, searchId: string, actor: string, type: string, payload: object) {
    await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId,actor,type,payload]);
  }

  async audit(actor: string, searchId: string, before?: string, limit = 50) {
    return this.tx(async client => {
      await this.lockSearch(client, searchId);
      await this.coordinator(client, actor, searchId);
      const result = await client.query(`SELECT id::text,user_id,type,payload,created_at FROM events
        WHERE search_id=$1 AND type=ANY($2::text[]) AND ($3::bigint IS NULL OR id < $3::bigint)
        ORDER BY id DESC LIMIT $4`, [searchId, ['SEARCH_CLOSURE_CONFIRMED','SEARCH_CLOSED','SEARCH_REOPENED'], before ?? null, limit + 1]);
      const items = result.rows.slice(0, limit);
      return { items, nextCursor: result.rows.length > limit ? items[items.length - 1].id as string : null };
    });
  }

  async confirm(actor: string, searchId: string) {
    return this.tx(async client => {
      // Match the ordering used by the field-lead service to avoid deadlocks.
      const eligible = await client.query(`SELECT e.user_id FROM field_lead_eligibility e JOIN users u ON u.id=e.user_id
        WHERE e.user_id=$1 AND u.active=true FOR SHARE OF e,u`, [actor]);
      if (!eligible.rowCount) throw httpErrors.forbidden('Active field lead required');
      const status = await this.lockSearch(client, searchId);
      if (!['PLANNED','ACTIVE','PAUSED'].includes(status)) throw httpErrors.conflict('Search is not open');
      const lead = await client.query('SELECT assignment_id FROM search_field_leads WHERE search_id=$1 AND user_id=$2', [searchId,actor]);
      if (!lead.rowCount) throw httpErrors.forbidden('Current field lead required');
      // Preserve the timestamp and event on an identical retry.
      const saved = await client.query(`INSERT INTO search_closure_confirmations(search_id,field_lead_id,assignment_id)
        SELECT search_id,user_id,assignment_id FROM search_field_leads WHERE search_id=$1 AND user_id=$2
        ON CONFLICT(search_id) DO UPDATE SET field_lead_id=EXCLUDED.field_lead_id,assignment_id=EXCLUDED.assignment_id,confirmed_at=now()
        WHERE (search_closure_confirmations.field_lead_id,search_closure_confirmations.assignment_id)
          IS DISTINCT FROM (EXCLUDED.field_lead_id,EXCLUDED.assignment_id)
        RETURNING confirmed_at`, [searchId,actor]);
      if (saved.rowCount) await this.event(client, searchId, actor, 'SEARCH_CLOSURE_CONFIRMED', {});
      return { confirmed: true };
    });
  }

  async close(actor: string, searchId: string, exceptionReason?: string) {
    if (exceptionReason !== undefined && (!exceptionReason.trim() || exceptionReason.length > 2000)) throw httpErrors.badRequest('Invalid exception reason');
    return this.tx(async client => {
      const status = await this.lockSearch(client, searchId);
      await this.coordinator(client, actor, searchId);
      if (!['PLANNED','ACTIVE','PAUSED'].includes(status)) throw httpErrors.conflict('Search is not open');
      const confirmation = await client.query(`SELECT c.field_lead_id FROM search_closure_confirmations c
        JOIN search_field_leads f ON f.search_id=c.search_id AND f.user_id=c.field_lead_id AND f.assignment_id=c.assignment_id
        JOIN field_lead_eligibility e ON e.user_id=f.user_id JOIN users u ON u.id=f.user_id AND u.active=true
        WHERE c.search_id=$1 FOR SHARE OF e,u`, [searchId]);
      if (!confirmation.rowCount && !exceptionReason) throw httpErrors.conflict('Field lead confirmation or exception reason required');
      if (confirmation.rowCount && exceptionReason) throw httpErrors.conflict('Exception is only for closure without confirmation');
      await client.query('INSERT INTO search_closures(search_id,previous_status,closed_by) VALUES($1,$2,$3)', [searchId,status,actor]);
      await client.query("UPDATE searches SET status='COMPLETED',ended_at=now() WHERE id=$1", [searchId]);
      await client.query('DELETE FROM search_closure_confirmations WHERE search_id=$1', [searchId]);
      const revoked = await client.query('DELETE FROM search_contact_grants WHERE search_id=$1', [searchId]);
      await this.event(client, searchId, actor, 'SEARCH_CLOSED', { previousStatus: status, fieldLeadId: confirmation.rows[0]?.field_lead_id ?? null, exceptionReason: exceptionReason ?? null, contactGrantsRevoked: revoked.rowCount });
      return { status: 'COMPLETED' };
    });
  }

  async reopen(actor: string, searchId: string, reason: string) {
    if (!reason.trim() || reason.length > 2000) throw httpErrors.badRequest('Invalid reason');
    return this.tx(async client => {
      const status = await this.lockSearch(client, searchId);
      await this.coordinator(client, actor, searchId);
      if (status !== 'COMPLETED') throw httpErrors.conflict('Search is not closed');
      const closure = await client.query<{previous_status: string}>('DELETE FROM search_closures WHERE search_id=$1 RETURNING previous_status', [searchId]);
      // Do not silently guess a previous status for legacy closed searches.
      if (!closure.rowCount) throw httpErrors.conflict('Closure record not available');
      const restored = closure.rows[0].previous_status;
      await client.query('UPDATE searches SET status=$2,ended_at=NULL WHERE id=$1', [searchId,restored]);
      await client.query('DELETE FROM search_closure_confirmations WHERE search_id=$1', [searchId]);
      await this.event(client, searchId, actor, 'SEARCH_REOPENED', { status: restored, reason });
      return { status: restored };
    });
  }
}
