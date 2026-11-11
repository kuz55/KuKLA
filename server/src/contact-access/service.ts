import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

// Development-only, least-privilege foundation: a grant targets one report,
// one search and one active search member, never the full report.
export class ContactAccessService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async lockSearch(client: PoolClient, searchId: string) {
    const search = await client.query('SELECT status FROM searches WHERE id=$1 FOR UPDATE', [searchId]);
    if (!search.rowCount) throw httpErrors.notFound('Search not found');
    return search.rows[0].status as string;
  }
  private isOpen(status: string) { return ['PLANNED','ACTIVE','PAUSED'].includes(status); }
  private async coordinator(client: PoolClient, searchId: string, actor: string) {
    const assigned = await client.query(`SELECT sc.user_id FROM search_coordinators sc
      JOIN coordinator_eligibility e ON e.user_id=sc.user_id JOIN users u ON u.id=sc.user_id
      WHERE sc.search_id=$1 AND sc.user_id=$2 AND u.active=true FOR SHARE OF sc,e,u`, [searchId,actor]);
    if (!assigned.rowCount) throw httpErrors.forbidden('Assigned active coordinator required');
  }
  private async event(client: PoolClient, searchId: string, actor: string, type: string, payload: object) {
    await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId,actor,type,payload]);
  }
  async audit(actor: string, searchId: string, before?: string, limit = 50) {
    return this.tx(async client => {
      await this.lockSearch(client,searchId);
      await this.coordinator(client,searchId,actor);
      const result = await client.query(`SELECT id::text,user_id,type,payload,created_at FROM events
        WHERE search_id=$1 AND type=ANY($2::text[]) AND ($3::bigint IS NULL OR id < $3::bigint)
        ORDER BY events.id DESC LIMIT $4`, [searchId,['CONTACT_ACCESS_GRANTED','CONTACT_ACCESS_REVOKED'],before ?? null,limit+1]);
      const items = result.rows.slice(0,limit);
      return { items, nextCursor: result.rows.length > limit ? items[items.length-1].id as string : null };
    });
  }
  async grant(actor: string, searchId: string, reportId: string, userId: string, reason: string) {
    if (!reason.trim() || reason.length > 2000) throw httpErrors.badRequest('Invalid reason');
    return this.tx(async client => {
      const status = await this.lockSearch(client,searchId);
      await this.coordinator(client,searchId,actor);
      if (!this.isOpen(status)) throw httpErrors.conflict('Search is not open');
      const member = await client.query(`SELECT m.user_id FROM search_members m JOIN users u ON u.id=m.user_id
        WHERE m.search_id=$1 AND m.user_id=$2 AND u.active=true FOR SHARE OF m,u`, [searchId,userId]);
      if (!member.rowCount) throw httpErrors.notFound('Active search member not found');
      const report = await client.query('SELECT id FROM initial_reports WHERE id=$1 AND search_id=$2 AND handed_off_at IS NOT NULL', [reportId,searchId]);
      if (!report.rowCount) throw httpErrors.notFound('Report not found');
      const created = await client.query(`INSERT INTO search_contact_grants(search_id,report_id,user_id,granted_by)
        VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING granted_at`, [searchId,reportId,userId,actor]);
      if (!created.rowCount) throw httpErrors.conflict('Contact grant already exists');
      await this.event(client,searchId,actor,'CONTACT_ACCESS_GRANTED',{reportId,userId,reason});
      return { granted: true };
    });
  }
  async revoke(actor: string, searchId: string, reportId: string, userId: string) {
    return this.tx(async client => {
      const status = await this.lockSearch(client,searchId);
      await this.coordinator(client,searchId,actor);
      if (!this.isOpen(status)) throw httpErrors.conflict('Search is not open');
      const removed = await client.query('DELETE FROM search_contact_grants WHERE search_id=$1 AND report_id=$2 AND user_id=$3 RETURNING user_id', [searchId,reportId,userId]);
      if (!removed.rowCount) throw httpErrors.notFound('Contact grant not found');
      await this.event(client,searchId,actor,'CONTACT_ACCESS_REVOKED',{reportId,userId});
      return { revoked: true };
    });
  }
  async read(actor: string, searchId: string, reportId: string) {
    return this.tx(async client => {
      const status = await this.lockSearch(client,searchId);
      if (!this.isOpen(status)) throw httpErrors.notFound('Contact not found');
      const result = await client.query(`SELECT r.id, r.applicant_contact FROM search_contact_grants g
        JOIN initial_reports r ON r.id=g.report_id AND r.search_id=g.search_id AND r.handed_off_at IS NOT NULL
        JOIN search_members m ON m.search_id=g.search_id AND m.user_id=g.user_id
        JOIN users u ON u.id=g.user_id AND u.active=true
        WHERE g.search_id=$1 AND g.report_id=$2 AND g.user_id=$3 FOR SHARE OF g,m,u`, [searchId,reportId,actor]);
      if (!result.rowCount) throw httpErrors.notFound('Contact not found');
      return { reportId: result.rows[0].id as string, applicantContact: result.rows[0].applicant_contact as string | null };
    });
  }
}
