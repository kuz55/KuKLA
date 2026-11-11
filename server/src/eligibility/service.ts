import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

export type OperationalEligibility = 'COORDINATOR' | 'FIELD_LEAD';

// Experimental only. This is deliberately not a mapping from legacy roles.
export class EligibilityService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
  private table(kind: OperationalEligibility) {
    return kind === 'COORDINATOR' ? 'coordinator_eligibility' : 'field_lead_eligibility';
  }
  private async leader(c: PoolClient, actor: string) {
    const result = await c.query(`SELECT l.user_id FROM leadership_eligibility l JOIN users u ON u.id=l.user_id
      WHERE l.user_id=$1 AND u.active=true FOR SHARE OF l,u`, [actor]);
    if (!result.rowCount) throw httpErrors.forbidden('Active leadership eligibility required');
  }
  private async event(c: PoolClient, actor: string, target: string, kind: OperationalEligibility, action: string) {
    await c.query('INSERT INTO events(search_id,user_id,type,payload) VALUES(NULL,$1,$2,$3)',
      [actor, action, {userId:target, eligibility:kind}]);
  }
  private async hasAssignments(c: PoolClient, target: string, kind: OperationalEligibility) {
    const refs = kind === 'COORDINATOR'
      ? await c.query(`SELECT 1 FROM search_coordinators WHERE user_id=$1
          UNION ALL SELECT 1 FROM coordinator_transfers WHERE initiated_by=$1 OR from_user_id=$1 OR to_user_id=$1 LIMIT 1`, [target])
      : await c.query(`SELECT 1 FROM search_field_leads WHERE user_id=$1
          UNION ALL SELECT 1 FROM field_lead_proposals WHERE candidate_id=$1 LIMIT 1`, [target]);
    return Boolean(refs.rowCount);
  }
  async audit(actor: string, before?: string, limit = 50) {
    return this.tx(async c => {
      await this.leader(c,actor);
      const result = await c.query(`SELECT id::text,user_id,type,payload,created_at FROM events
        WHERE search_id IS NULL AND type=ANY($1::text[]) AND ($2::bigint IS NULL OR id < $2::bigint)
        ORDER BY id DESC LIMIT $3`, [['OPERATIONAL_ELIGIBILITY_GRANTED','OPERATIONAL_ELIGIBILITY_REVOKED'],before ?? null,limit+1]);
      const items = result.rows.slice(0,limit);
      return {items,nextCursor:result.rows.length > limit ? items[items.length-1].id as string : null};
    });
  }
  async status(actor: string, target: string) {
    return this.tx(async c => {
      await this.leader(c,actor);
      const result = await c.query(`SELECT u.active,
        EXISTS(SELECT 1 FROM coordinator_eligibility e WHERE e.user_id=u.id) AS coordinator,
        EXISTS(SELECT 1 FROM field_lead_eligibility e WHERE e.user_id=u.id) AS field_lead
        FROM users u WHERE u.id=$1`, [target]);
      if (!result.rowCount) throw httpErrors.notFound('User not found');
      return result.rows[0];
    });
  }
  async grant(actor: string, target: string, kind: OperationalEligibility) {
    return this.tx(async c => {
      await this.leader(c,actor);
      const user = await c.query('SELECT id FROM users WHERE id=$1 AND active=true FOR SHARE', [target]);
      if (!user.rowCount) throw httpErrors.notFound('Active user not found');
      const result = await c.query(`INSERT INTO ${this.table(kind)}(user_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING user_id`, [target]);
      if (result.rowCount) {
        // Do not reactivate an old assignment left by a previous out-of-band
        // eligibility removal. The eventual handover policy is not defined.
        if (await this.hasAssignments(c,target,kind)) throw httpErrors.conflict('Existing assignments require resolution first');
        await this.event(c,actor,target,kind,'OPERATIONAL_ELIGIBILITY_GRANTED');
      }
      return { granted: true, created: Boolean(result.rowCount) };
    });
  }
  async revoke(actor: string, target: string, kind: OperationalEligibility) {
    return this.tx(async c => {
      await this.leader(c,actor);
      // Assignment services hold a SHARE lock on this row while assigning.
      // Taking UPDATE first serializes revocation with new assignments.
      const row = await c.query(`SELECT user_id FROM ${this.table(kind)} WHERE user_id=$1 FOR UPDATE`, [target]);
      if (!row.rowCount) return { revoked: true, removed: false };
      // Interim conservative guard: do not silently drop active assignments or
      // later revive them on re-grant. Handover policy for revocation is not yet
      // complete, so such a role change is explicitly rejected for now.
      if (await this.hasAssignments(c,target,kind)) throw httpErrors.conflict('Active assignments or proposals require resolution first');
      await c.query(`DELETE FROM ${this.table(kind)} WHERE user_id=$1`, [target]);
      await this.event(c,actor,target,kind,'OPERATIONAL_ELIGIBILITY_REVOKED');
      return { revoked: true, removed: true };
    });
  }
}
