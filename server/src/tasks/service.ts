import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

type Priority = 'NORMAL' | 'HIGH' | 'URGENT';
export class FieldTasksService {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  // Search lock serializes task transitions with closure and group/roster changes.
  private async lockSearch(c: PoolClient, search: string) {
    const r = await c.query('SELECT status FROM searches WHERE id=$1 FOR UPDATE', [search]);
    if (!r.rowCount) throw httpErrors.notFound('Search not found');
    if (!['PLANNED','ACTIVE','PAUSED'].includes(r.rows[0].status as string)) throw httpErrors.conflict('Search is not open');
  }
  private async fieldLead(c: PoolClient, search: string, actor: string) {
    const r = await c.query(`SELECT 1 FROM search_field_leads f JOIN field_lead_eligibility e ON e.user_id=f.user_id
      JOIN users u ON u.id=f.user_id AND u.active=true WHERE f.search_id=$1 AND f.user_id=$2 FOR SHARE OF f,e,u`, [search,actor]);
    if (!r.rowCount) throw httpErrors.forbidden('Current active field lead required');
  }
  private async groupLead(c: PoolClient, search: string, group: string, actor: string) {
    const r = await c.query(`SELECT 1 FROM field_group_leads l JOIN users u ON u.id=l.user_id AND u.active=true
      JOIN search_members m ON m.search_id=l.search_id AND m.user_id=l.user_id
      WHERE l.search_id=$1 AND l.group_id=$2 AND l.user_id=$3 FOR SHARE OF l,u,m`, [search,group,actor]);
    if (!r.rowCount) throw httpErrors.forbidden('Current active group lead required');
  }
  private async task(c: PoolClient, search: string, task: string) {
    const r = await c.query('SELECT id,group_id,status FROM field_tasks WHERE search_id=$1 AND id=$2 FOR UPDATE', [search,task]);
    if (!r.rowCount) throw httpErrors.notFound('Task not found');
    return r.rows[0] as {id:string;group_id:string;status:string};
  }
  private async event(c: PoolClient, search: string, actor: string, type: string, payload: object) {
    await c.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [search,actor,type,payload]);
  }
  async create(actor:string, search:string, group:string, description:string, dueAt:string, priority:Priority, requestId:string) {
    return this.tx(async c => {
      await this.lockSearch(c,search); await this.fieldLead(c,search,actor);
      // The search lock serializes retries. Compare persisted values rather than
      // storing a reversible or low-entropy hash of potentially sensitive text.
      const previous = await c.query(`SELECT id,(group_id=$4 AND description=$5 AND due_at=$6::timestamptz AND priority=$7) AS matches
        FROM field_tasks WHERE search_id=$1 AND created_by=$2 AND create_request_id=$3`,
      [search,actor,requestId,group,description,dueAt,priority]);
      if (previous.rowCount) {
        if (!previous.rows[0].matches) throw httpErrors.conflict('Request ID already used for a different task');
        return {taskId:previous.rows[0].id as string};
      }
      const g = await c.query(`SELECT 1 FROM field_groups g JOIN field_group_leads l ON l.group_id=g.id
        JOIN users u ON u.id=l.user_id AND u.active=true JOIN search_members m ON m.search_id=l.search_id AND m.user_id=l.user_id
        WHERE g.search_id=$1 AND g.id=$2 FOR SHARE OF g,l,u,m`, [search,group]);
      if (!g.rowCount) throw httpErrors.conflict('Group requires an active accepted lead');
      const r = await c.query(`INSERT INTO field_tasks(search_id,group_id,description,due_at,priority,created_by,create_request_id)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[search,group,description,dueAt,priority,actor,requestId]);
      const id = r.rows[0].id as string;
      await this.event(c,search,actor,'FIELD_TASK_CREATED',{taskId:id,groupId:group});
      return {taskId:id};
    });
  }
  async list(actor:string, search:string, group:string, after:string|undefined, limit:number) {
    return this.tx(async c => {
      await this.lockSearch(c,search);
      const access = await c.query(`SELECT 1 FROM users u WHERE u.id=$3 AND u.active=true AND (
        EXISTS(SELECT 1 FROM search_field_leads f JOIN field_lead_eligibility e ON e.user_id=f.user_id WHERE f.search_id=$1 AND f.user_id=u.id)
        OR EXISTS(SELECT 1 FROM field_group_members gm JOIN search_members sm ON sm.search_id=gm.search_id AND sm.user_id=gm.user_id
          WHERE gm.search_id=$1 AND gm.group_id=$2 AND gm.user_id=u.id)) FOR SHARE OF u`,[search,group,actor]);
      if (!access.rowCount) throw httpErrors.forbidden('Group member or field lead required');
      const r = await c.query(`SELECT id,group_id,description,priority,due_at,status,created_at,
        (status <> 'ACCEPTED' AND due_at <= now()) AS overdue FROM field_tasks
        WHERE search_id=$1 AND group_id=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT $4`,[search,group,after ?? null,limit+1]);
      const items = r.rows.slice(0,limit);
      return {items,nextCursor:r.rows.length>limit ? items[items.length-1].id as string : null};
    });
  }
  async results(actor:string, search:string, id:string, after:string|undefined, limit:number) {
    return this.tx(async c => {
      await this.lockSearch(c,search); const t=await this.task(c,search,id);
      const access=await c.query(`SELECT 1 FROM users u WHERE u.id=$3 AND u.active=true AND (
        EXISTS(SELECT 1 FROM search_field_leads f JOIN field_lead_eligibility e ON e.user_id=f.user_id WHERE f.search_id=$1 AND f.user_id=u.id)
        OR EXISTS(SELECT 1 FROM field_group_leads l JOIN search_members m ON m.search_id=l.search_id AND m.user_id=l.user_id
          WHERE l.search_id=$1 AND l.group_id=$2 AND l.user_id=u.id)) FOR SHARE OF u`,[search,t.group_id,actor]);
      if (!access.rowCount) throw httpErrors.forbidden('Group or field lead required');
      const r=await c.query(`SELECT id,submitted_by,result,submitted_at,decision,decision_by,decision_at,return_reason
        FROM field_task_results WHERE task_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3`,[id,after ?? null,limit+1]);
      const items=r.rows.slice(0,limit);
      return {items,nextCursor:r.rows.length>limit ? items[items.length-1].id as string : null};
    });
  }
  async accept(actor:string, search:string, id:string) {
    return this.tx(async c => {
      await this.lockSearch(c,search); const t=await this.task(c,search,id); await this.groupLead(c,search,t.group_id,actor);
      if (t.status !== 'ASSIGNED') throw httpErrors.conflict('Task is not awaiting acceptance');
      await c.query("UPDATE field_tasks SET status='IN_PROGRESS' WHERE id=$1",[id]);
      await this.event(c,search,actor,'FIELD_TASK_STARTED',{taskId:id});
      return {status:'IN_PROGRESS'};
    });
  }
  async submit(actor:string, search:string, id:string, result:string) {
    return this.tx(async c => {
      await this.lockSearch(c,search); const t=await this.task(c,search,id); await this.groupLead(c,search,t.group_id,actor);
      if (t.status !== 'IN_PROGRESS') throw httpErrors.conflict('Task is not in progress');
      const r=await c.query('INSERT INTO field_task_results(task_id,submitted_by,result) VALUES($1,$2,$3) RETURNING id',[id,actor,result]);
      await c.query("UPDATE field_tasks SET status='REVIEW' WHERE id=$1",[id]);
      await this.event(c,search,actor,'FIELD_TASK_RESULT_SUBMITTED',{taskId:id,resultId:r.rows[0].id});
      return {status:'REVIEW',resultId:r.rows[0].id as string};
    });
  }
  async decide(actor:string, search:string, id:string, resultId:string, approve:boolean, reason:string|undefined) {
    return this.tx(async c => {
      await this.lockSearch(c,search); await this.fieldLead(c,search,actor); const t=await this.task(c,search,id);
      if (t.status !== 'REVIEW') throw httpErrors.conflict('Task is not under review');
      const r=await c.query(`UPDATE field_task_results SET decision=$3,decision_by=$4,decision_at=now(),return_reason=$5
        WHERE task_id=$1 AND id=$2 AND decision IS NULL RETURNING id`,[id,resultId,approve?'ACCEPTED':'RETURNED',actor,approve?null:reason]);
      if (!r.rowCount) throw httpErrors.notFound('Pending result not found');
      const status=approve?'ACCEPTED':'IN_PROGRESS';
      await c.query('UPDATE field_tasks SET status=$2 WHERE id=$1',[id,status]);
      await this.event(c,search,actor,approve?'FIELD_TASK_RESULT_ACCEPTED':'FIELD_TASK_RESULT_RETURNED',{taskId:id,resultId});
      return {status};
    });
  }
}
