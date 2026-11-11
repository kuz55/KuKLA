import type { Pool } from 'pg';
import { httpErrors } from '@fastify/sensible';

// Fixed aliases are internal SQL constants, never interpolated from requests.
const access=`u.active=true AND s.status IN ('PLANNED','ACTIVE','PAUSED') AND (
  (n.kind='LEAD_PROPOSED' AND EXISTS (SELECT 1 FROM field_group_lead_proposals p
    JOIN search_members m ON m.search_id=p.search_id AND m.user_id=p.candidate_id
    WHERE p.id=n.proposal_id AND p.group_id=n.group_id AND p.search_id=n.search_id AND p.candidate_id=n.recipient_id)) OR
  (n.kind IN ('LEAD_ACCEPTED','LEAD_DECLINED') AND EXISTS
    (SELECT 1 FROM search_field_leads f JOIN field_lead_eligibility e ON e.user_id=f.user_id
     WHERE f.search_id=n.search_id AND f.user_id=n.recipient_id)))`;

export class GroupLeadInbox {
  constructor(private readonly pool:Pool) {}
  async list(actor:string, after:string|undefined, limit:number) {
    const r=await this.pool.query(`SELECT n.id,n.search_id,n.group_id,n.proposal_id,n.kind,n.created_at
      FROM field_group_lead_notifications n JOIN searches s ON s.id=n.search_id JOIN users u ON u.id=n.recipient_id
      WHERE n.recipient_id=$1 AND n.acknowledged_at IS NULL AND ${access}
      AND ($2::uuid IS NULL OR (n.created_at,n.id) >
        (SELECT x.created_at,x.id FROM field_group_lead_notifications x WHERE x.id=$2 AND x.recipient_id=$1))
      ORDER BY n.created_at,n.id LIMIT $3`,[actor,after ?? null,limit+1]);
    const items=r.rows.slice(0,limit);
    return {items,nextCursor:r.rows.length>limit ? items[items.length-1].id as string : null};
  }
  async acknowledge(actor:string, id:string) {
    const c=await this.pool.connect();
    try {
      await c.query('BEGIN');
      const lock=await c.query(`SELECT s.status FROM field_group_lead_notifications n JOIN searches s ON s.id=n.search_id
        WHERE n.id=$1 AND n.recipient_id=$2 FOR UPDATE OF s`,[id,actor]);
      if (!lock.rowCount || !['PLANNED','ACTIVE','PAUSED'].includes(lock.rows[0].status as string)) throw httpErrors.notFound('Notification not found');
      const user=await c.query('SELECT id FROM users WHERE id=$1 AND active=true FOR SHARE',[actor]);
      if (!user.rowCount) throw httpErrors.notFound('Notification not found');
      const r=await c.query(`UPDATE field_group_lead_notifications n SET acknowledged_at=COALESCE(n.acknowledged_at,now())
        FROM searches s,users u WHERE n.id=$2 AND n.recipient_id=$1 AND s.id=n.search_id AND u.id=n.recipient_id AND ${access}
        RETURNING n.acknowledged_at`,[actor,id]);
      if (!r.rowCount) throw httpErrors.notFound('Notification not found');
      await c.query('COMMIT'); return {acknowledgedAt:r.rows[0].acknowledged_at as Date};
    } catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
}
