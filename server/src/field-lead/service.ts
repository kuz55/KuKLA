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
    const r = await c.query<{status:string}>('SELECT status FROM searches WHERE id=$1 FOR UPDATE', [id]);
    if (!r.rowCount) throw httpErrors.notFound('Search not found');
    return r.rows[0].status;
  }
  private async lockOpenSearch(c: PoolClient, id: string) {
    const status = await this.lockSearch(c, id);
    if (!['PLANNED','ACTIVE','PAUSED'].includes(status)) throw httpErrors.conflict('Search is not open');
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
  private async notify(c: PoolClient, searchId: string, proposalId: string, kind: string, audience: string, recipients: string[]) {
    if (!recipients.length) return;
    await c.query(`INSERT INTO field_lead_notifications(recipient_id,search_id,proposal_id,kind,audience)
      SELECT DISTINCT id,$2::uuid,$3::uuid,$4::text,$5::text FROM unnest($1::uuid[]) AS id`, [recipients,searchId,proposalId,kind,audience]);
  }
  private async managers(c: PoolClient, searchId: string, proposer: string, actor: string): Promise<string[]> {
    const r = await c.query(`SELECT sc.user_id FROM search_coordinators sc
      JOIN coordinator_eligibility e ON e.user_id=sc.user_id JOIN users u ON u.id=sc.user_id
      WHERE sc.search_id=$1 AND u.active=true
      UNION SELECT ir.resolved_by AS user_id FROM initial_reports ir
      JOIN users u ON u.id=ir.resolved_by AND u.active=true
      JOIN intake_permissions p ON p.user_id=ir.resolved_by AND p.permission='REGISTER'
      WHERE ir.search_id=$1`, [searchId]);
    return [...new Set([proposer, ...r.rows.map(row => row.user_id as string)])].filter(id => id !== actor);
  }
  async propose(actor: string, searchId: string, candidate: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      const isRegistrar = await this.registrar(c, actor);
      await this.eligible(c, candidate);
      await this.lockOpenSearch(c, searchId);
      const current = await c.query('SELECT user_id FROM search_field_leads WHERE search_id=$1', [searchId]);
      if (!isRegistrar && !(current.rowCount && await this.coordinator(c, searchId, actor))) throw httpErrors.forbidden('Registrar or assigned coordinator required');
      if (current.rows[0]?.user_id === candidate) throw httpErrors.conflict('Candidate is already the field lead');
      const proposal = await c.query(`INSERT INTO field_lead_proposals(search_id,candidate_id,proposed_by)
        VALUES($1,$2,$3) ON CONFLICT(search_id) DO NOTHING RETURNING id,created_at`, [searchId,candidate,actor]);
      if (!proposal.rowCount) throw httpErrors.conflict('A proposal is already pending');
      const id = proposal.rows[0].id as string;
      await this.event(c, searchId, actor, 'FIELD_LEAD_PROPOSED', { proposalId: id, candidateId: candidate });
      await this.notify(c, searchId, id, 'PROPOSED', 'CANDIDATE', [candidate]);
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
      await this.lockOpenSearch(c, searchId);
      const r = await c.query('SELECT id,proposed_by FROM field_lead_proposals WHERE search_id=$1 AND id=$2 AND candidate_id=$3', [searchId,proposalId,actor]);
      if (!r.rowCount) {
        // A receipt only confirms a past acceptance; it never restores a lead.
        const receipt = await c.query('SELECT accepted_at FROM field_lead_acceptance_receipts WHERE proposal_id=$1 AND search_id=$2 AND candidate_id=$3', [proposalId,searchId,actor]);
        if (!receipt.rowCount) throw httpErrors.notFound('Proposal not found');
        return { fieldLeadId: actor, acceptedAt: receipt.rows[0].accepted_at as Date };
      }
      const former = await c.query('SELECT user_id FROM search_field_leads WHERE search_id=$1', [searchId]);
      await c.query(`INSERT INTO search_field_leads(search_id,user_id,assigned_by) VALUES($1,$2,$3)
        ON CONFLICT(search_id) DO UPDATE SET user_id=EXCLUDED.user_id,assigned_by=EXCLUDED.assigned_by,assigned_at=now(),assignment_id=gen_random_uuid()`, [searchId,actor,r.rows[0].proposed_by]);
      await c.query('DELETE FROM field_lead_proposals WHERE id=$1', [proposalId]);
      const receipt = await c.query('INSERT INTO field_lead_acceptance_receipts(proposal_id,search_id,candidate_id) VALUES($1,$2,$3) RETURNING accepted_at', [proposalId,searchId,actor]);
      await this.event(c, searchId, actor, 'FIELD_LEAD_ACCEPTED', { proposalId, previousId: former.rows[0]?.user_id ?? null, fieldLeadId: actor });
      await this.notify(c, searchId, proposalId, 'ACCEPTED', 'MANAGER', await this.managers(c, searchId, r.rows[0].proposed_by as string, actor));
      return { fieldLeadId: actor, acceptedAt: receipt.rows[0].accepted_at as Date };
    });
  }
  async decline(actor: string, searchId: string, proposalId: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      await this.lockOpenSearch(c, searchId);
      const r = await c.query('DELETE FROM field_lead_proposals WHERE search_id=$1 AND id=$2 AND candidate_id=$3 RETURNING id,proposed_by', [searchId,proposalId,actor]);
      if (!r.rowCount) throw httpErrors.notFound('Proposal not found');
      await this.event(c, searchId, actor, 'FIELD_LEAD_DECLINED', { proposalId });
      await this.notify(c, searchId, proposalId, 'DECLINED', 'MANAGER', await this.managers(c, searchId, r.rows[0].proposed_by as string, actor));
      return { declined: true };
    });
  }
  async cancel(actor: string, searchId: string, proposalId: string, reason: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      const isRegistrar = await this.registrar(c, actor);
      await this.lockOpenSearch(c, searchId);
      if (!isRegistrar && !await this.coordinator(c, searchId, actor)) throw httpErrors.forbidden('Registrar or assigned coordinator required');
      const r = await c.query('DELETE FROM field_lead_proposals WHERE id=$1 AND search_id=$2 RETURNING candidate_id', [proposalId,searchId]);
      if (!r.rowCount) throw httpErrors.notFound('Proposal not found');
      await this.event(c, searchId, actor, 'FIELD_LEAD_PROPOSAL_CANCELLED', { proposalId, candidateId: r.rows[0].candidate_id, reason });
      if (r.rows[0].candidate_id !== actor) await this.notify(c, searchId, proposalId, 'CANCELLED', 'CANDIDATE', [r.rows[0].candidate_id as string]);
      return { cancelled: true };
    });
  }
  private inboxAccess(alias: string) {
    return `((${alias}.audience='CANDIDATE' AND EXISTS
      (SELECT 1 FROM field_lead_eligibility e WHERE e.user_id=$1)) OR
      (${alias}.audience='MANAGER' AND (EXISTS
        (SELECT 1 FROM intake_permissions p WHERE p.user_id=$1 AND p.permission='REGISTER') OR EXISTS
        (SELECT 1 FROM search_coordinators sc JOIN coordinator_eligibility e ON e.user_id=sc.user_id
         WHERE sc.search_id=${alias}.search_id AND sc.user_id=$1))))`;
  }
  async notifications(actor: string, after?: string, limit = 100) {
    return this.tx(async c => {
      await this.active(c, actor);
      const r = await c.query(`SELECT n.id,n.search_id,n.proposal_id,n.kind,n.created_at FROM field_lead_notifications n
        WHERE n.recipient_id=$1 AND n.acknowledged_at IS NULL AND ${this.inboxAccess('n')}
        AND ($2::uuid IS NULL OR (n.created_at,n.id) >
          (SELECT x.created_at,x.id FROM field_lead_notifications x WHERE x.id=$2 AND x.recipient_id=$1 AND ${this.inboxAccess('x')}))
        ORDER BY n.created_at,n.id LIMIT $3`, [actor,after ?? null,limit+1]);
      const items = r.rows.slice(0,limit);
      return { items, nextCursor: r.rows.length > limit ? items[items.length-1].id as string : null };
    });
  }
  async acknowledge(actor: string, id: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      const r = await c.query(`UPDATE field_lead_notifications n SET acknowledged_at=COALESCE(n.acknowledged_at,now())
        WHERE n.id=$2 AND n.recipient_id=$1 AND ${this.inboxAccess('n')} RETURNING n.acknowledged_at`, [actor,id]);
      if (!r.rowCount) throw httpErrors.notFound('Notification not found');
      return { acknowledgedAt: r.rows[0].acknowledged_at as Date };
    });
  }
  // Invoked by the experimental worker. Database time is authoritative; a
  // lock on each search serializes a reminder with response/cancellation.
  // A failed insert rolls back the marker so a later poll can retry.
  async processOverdueReminders(limit = 50) {
    const due = await this.pool.query<{ search_id: string; id: string }>(
      `SELECT p.search_id,p.id FROM field_lead_proposals p JOIN searches s ON s.id=p.search_id
       WHERE p.reminder_created_at IS NULL AND s.status IN ('PLANNED','ACTIVE','PAUSED')
       AND p.created_at <= now() - interval '10 minutes' ORDER BY p.created_at,p.id LIMIT $1`, [limit]);
    let created = 0;
    for (const item of due.rows) {
      const result = await this.tx(async c => {
        const status = await this.lockSearch(c, item.search_id);
        if (!['PLANNED','ACTIVE','PAUSED'].includes(status)) return false;
        const pending = await c.query(`SELECT id,proposed_by FROM field_lead_proposals
          WHERE search_id=$1 AND id=$2 AND reminder_created_at IS NULL AND created_at <= now() - interval '10 minutes'`, [item.search_id,item.id]);
        if (!pending.rowCount) return false;
        const proposer = pending.rows[0].proposed_by as string;
        // Include proposer, even though they would be the actor for a normal
        // transition; managers() otherwise excludes its actor argument.
        const recipients = await this.managers(c, item.search_id, proposer, '');
        if (!recipients.length) return false;
        await this.notify(c, item.search_id, item.id, 'NO_RESPONSE', 'MANAGER', recipients);
        await c.query('UPDATE field_lead_proposals SET reminder_created_at=now() WHERE id=$1', [item.id]);
        return true;
      });
      if (result) created++;
    }
    return created;
  }
  async remove(actor: string, searchId: string, reason: string) {
    return this.tx(async c => {
      await this.active(c, actor);
      await this.lockOpenSearch(c, searchId);
      if (!await this.coordinator(c, searchId, actor)) throw httpErrors.forbidden('Assigned coordinator required');
      const r = await c.query('DELETE FROM search_field_leads WHERE search_id=$1 RETURNING user_id', [searchId]);
      if (!r.rowCount) throw httpErrors.notFound('Field lead not found');
      await this.event(c, searchId, actor, 'FIELD_LEAD_EXCEPTIONALLY_REMOVED', { fieldLeadId: r.rows[0].user_id, reason });
      return { removed: true };
    });
  }
}
