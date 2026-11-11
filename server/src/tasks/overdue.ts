import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

// These expressions only interpolate fixed SQL aliases, never request data.
const currentRecipient = (task: string, user: string) => `(
  EXISTS (SELECT 1 FROM search_field_leads f JOIN field_lead_eligibility e ON e.user_id=f.user_id
    WHERE f.search_id=${task}.search_id AND f.user_id=${user}) OR
  EXISTS (SELECT 1 FROM field_group_leads l JOIN search_members m ON m.search_id=l.search_id AND m.user_id=l.user_id
    WHERE l.search_id=${task}.search_id AND l.group_id=${task}.group_id AND l.user_id=${user}))`;
const visible = `u.active=true AND s.status IN ('PLANNED','ACTIVE','PAUSED') AND t.status<>'ACCEPTED'
  AND t.due_at<=now() AND ${currentRecipient('t','n.recipient_id')}`;

export class TaskOverdueInbox {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn:(c:PoolClient)=>Promise<T>):Promise<T> {
    const c=await this.pool.connect();
    try { await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result; }
    catch(error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  }
  // Best effort and retryable: deduplicate per task and recipient. The search
  // lock serializes insertion with group changes, task acceptance and closure.
  async process(limit=50) {
    const due=await this.pool.query<{id:string;search_id:string}>(`SELECT t.id,t.search_id FROM field_tasks t
      JOIN searches s ON s.id=t.search_id
      WHERE t.status<>'ACCEPTED' AND t.due_at<=now() AND s.status IN ('PLANNED','ACTIVE','PAUSED')
        AND EXISTS (SELECT 1 FROM users u WHERE u.active=true AND ${currentRecipient('t','u.id')}
          AND NOT EXISTS (SELECT 1 FROM field_task_overdue_notifications n WHERE n.task_id=t.id AND n.recipient_id=u.id))
      ORDER BY t.due_at,t.id LIMIT $1`,[limit]);
    let created=0;
    for (const task of due.rows) {
      created+=await this.tx(async c=>{
        const search=await c.query('SELECT status FROM searches WHERE id=$1 FOR UPDATE',[task.search_id]);
        if (!search.rowCount || !['PLANNED','ACTIVE','PAUSED'].includes(search.rows[0].status as string)) return 0;
        const inserted=await c.query(`INSERT INTO field_task_overdue_notifications(task_id,recipient_id)
          SELECT t.id,u.id FROM field_tasks t JOIN users u ON u.active=true
          WHERE t.id=$1 AND t.search_id=$2 AND t.status<>'ACCEPTED' AND t.due_at<=now()
          AND ${currentRecipient('t','u.id')} ON CONFLICT(task_id,recipient_id) DO NOTHING RETURNING id`,[task.id,task.search_id]);
        return inserted.rowCount ?? 0;
      });
    }
    return created;
  }
  async list(actor:string, after:string|undefined, limit:number) {
    const result=await this.pool.query(`SELECT n.id,t.search_id,t.id AS task_id,n.created_at
      FROM field_task_overdue_notifications n JOIN field_tasks t ON t.id=n.task_id
      JOIN searches s ON s.id=t.search_id JOIN users u ON u.id=n.recipient_id
      WHERE n.recipient_id=$1 AND n.acknowledged_at IS NULL AND ${visible}
        AND ($2::uuid IS NULL OR (n.created_at,n.id) >
          (SELECT x.created_at,x.id FROM field_task_overdue_notifications x WHERE x.id=$2 AND x.recipient_id=$1))
      ORDER BY n.created_at,n.id LIMIT $3`,[actor,after ?? null,limit+1]);
    const items=result.rows.slice(0,limit);
    return {items,nextCursor:result.rows.length>limit ? items[items.length-1].id as string : null};
  }
  async acknowledge(actor:string, id:string) {
    return this.tx(async c=>{
      const search=await c.query(`SELECT t.search_id FROM field_task_overdue_notifications n
        JOIN field_tasks t ON t.id=n.task_id WHERE n.id=$1 AND n.recipient_id=$2`,[id,actor]);
      if (!search.rowCount) throw httpErrors.notFound('Notification not found');
      await c.query('SELECT id FROM searches WHERE id=$1 FOR UPDATE',[search.rows[0].search_id]);
      const result=await c.query(`UPDATE field_task_overdue_notifications n SET acknowledged_at=COALESCE(n.acknowledged_at,now())
        FROM field_tasks t JOIN searches s ON s.id=t.search_id JOIN users u ON u.id=$1
        WHERE n.id=$2 AND n.recipient_id=$1 AND t.id=n.task_id AND ${visible}
        RETURNING n.acknowledged_at`,[actor,id]);
      if (!result.rowCount) throw httpErrors.notFound('Notification not found');
      return {acknowledgedAt:result.rows[0].acknowledged_at as Date};
    });
  }
}
