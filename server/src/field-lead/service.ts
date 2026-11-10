import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

// Experimental only. Search locks serialize decisions and replacement.
export class FieldLeadService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
  private async lockSearch(c: PoolClient, id: string) {
    const r = await c.query('SELECT id FROM searches WHERE id=$1 FOR UPDATE', [id]);
    if (!r.rowCount) throw httpErrors.notFound('Search not found');
  }
  private async active(c: PoolClient, id: string) {
    const r = await c.query('SELECT id FROM users WHERE id=$1 AND active=true FOR SHARE', [id]);
    if (!r.rowCount) throw httpErrors.forbidden('Active user required');
  }
  private async eligible(c: PoolClient, id: string) {
    const r = await c.query(`SELECT e.user_id FROM field_lead_eligibility e JOIN users u ON u.id=e.user_id
      WHERE e.user_id=$1 AND u.active=true FOR SHARE OF e,u`, [id]);
    if (!r.rowCount) throw httpErrors.forbidden('Field lead eligibility required');
  }
  private async registrar(c: PoolClient, id: string): Promise<boolean> {
    const r = await c.query("SELECT user_id FROM intake_permissions WHERE user_id=$1 AND permission='REGISTER' FOR SHARE", [id]);
    return !!r.rowCount;
  }
  private async coordinator(c: PoolClient, searchId: string, id: string): Promise<boolean> {
    const r = await c.query(`SELECT sc.user_id FROM search_coordinators sc
      JOIN coordinator_eligibility e ON e.user_id=sc.user_id
      WHERE sc.search_id=$1 AND sc.user_id=$2 FOR SHARE OF sc,e`, [searchId,id]);
    return !!r.rowCount;
  }
  private async event(c: PoolClient, searchId: string, actor: string, type: string, payload: object) {
    await c.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId, actor, type, payload]);
  }
  async propose(actor: string, searchId: string, candidate: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      const isRegistrar = await this.registrar(c, actor);
      await this.eligible(c, candidate);
      await this.lockSearch(c, searchId);
      const current = await c.query('SELECT user_id FROM search_field_leads WHERE search_id=$1', [searchId]);
      if (!isRegistrar && !(current.rowCount && await this.coordinator(c, searchId, actor))) throw httpErrors.forbidden('Registrar or assigned coordinator required');
      if (current.rows[0]?.user_id === candidate) throw httpErrors.conflict('Candidate is already the field lead');
      const proposal = await c.query(`INSERT INTO field_lead_proposals(search_id,candidate_id,proposed_by)
        VALUES($1,$2,$3) ON CONFLICT(search_id) DO NOTHING RETURNING id,created_at`, [searchId,candidate,actor]);
      if (!proposal.rowCount) throw httpErrors.conflict('A proposal is already pending');
      const id = proposal.rows[0].id as string;
      await this.event(c, searchId, actor, 'FIELD_LEAD_PROPOSED', { proposalId: id, candidateId: candidate });
      return { proposalId: id, createdAt: proposal.rows[0].created_at as Date };
    });
  }
  async pending(actor: string, searchId: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      const r = await c.query('SELECT id,search_id,proposed_by,created_at FROM field_lead_proposals WHERE search_id=$1 AND candidate_id=$2', [searchId,actor]);
      if (!r.rowCount) throw httpErrors.notFound('Proposal not found');
      return r.rows[0];
    });
  }
  async accept(actor: string, searchId: string, proposalId: string) {
    return this.tx(async c => {
      await this.eligible(c, actor);
      await this.lockSearch(c, searchId);
      const r = await c.query('SELECT id,proposed_by FROM field_lead_proposals WHERE search_id=$1 AND id=$2 AND candidate_id=$3', [searchId,proposalId,actor]);
      if (!r.rowCount) throw httpErrors.notFound('Proposal not found');
      const former = await c.query('SELECT user_id FROM search_field_leads WHERE search_id=$1', [searchId]);
      await c.query(`INSERT INTO search_field_leads(search_id,user_id,assigned_by) VALUES($1,$2,$3)
        ON CONFLICT(search_id) DO UPDATE SET user_id=EXCLUDED.user_id,assigned_by=EXCLUDED.assigned_by,assigned_at=now()`, [searchId,actor,r.rows[0].proposed_by]);
      await c.query('DELETE FROM field_lead_proposals WHERE id=$1', [proposalId]);
      await this.event(c, searchId, actor, 'FIELD_LEAD_ACCEPTED', { proposalId, previousId: former.rows[0]?.user_id ?? null, fieldLeadId: actor });
      return { fieldLeadId: actor };
    });
  }
  async decline(actor: string, searchId: string, proposalId: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      await this.lockSearch(c, searchId);
      const r = await c.query('DELETE FROM field_lead_proposals WHERE search_id=$1 AND id=$2 AND candidate_id=$3 RETURNING id', [searchId,proposalId,actor]);
      if (!r.rowCount) throw httpErrors.notFound('Proposal not found');
      await this.event(c, searchId, actor, 'FIELD_LEAD_DECLINED', { proposalId });
      return { declined: true };
    });
  }
  async remove(actor: string, searchId: string, reason: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      await this.lockSearch(c, searchId);
      if (!await this.coordinator(c, searchId, actor)) throw httpErrors.forbidden('Assigned coordinator required');
      const r = await c.query('DELETE FROM search_field_leads WHERE search_id=$1 RETURNING user_id', [searchId]);
      if (!r.rowCount) throw httpErrors.notFound('Field lead not found');
      await this.event(c, searchId, actor, 'FIELD_LEAD_EXCEPTIONALLY_REMOVED', { fieldLeadId: r.rows[0].user_id, reason });
      return { removed: true };
    });
  }
}
