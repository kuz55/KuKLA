import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { managementRoles, privilegedRoles } from '../rbac.js';
import { pool } from '../config.js';
import { auth, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const taskRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/tasks', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchAccess(req, id);
    return (await pool.query(
      `SELECT t.*,u.name assignee
       FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
       WHERE t.search_id=$1 ORDER BY t.status,t.priority,t.created_at`,
      [id],
    )).rows;
  });

  app.post('/api/v1/searches/:id/tasks', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchManagement(req, searchId);
    const body = z.object({
      title: z.string().min(2),
      description: z.string().optional(),
      assigneeId: z.string().uuid().optional(),
      priority: z.number().int().min(1).max(3).default(2),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (body.assigneeId) {
        const member = await client.query(
          `SELECT 1 FROM search_members sm JOIN users u ON u.id=sm.user_id
           WHERE sm.search_id=$1 AND sm.user_id=$2 AND u.active=true`,
          [searchId, body.assigneeId],
        );
        if (!member.rowCount) throw httpErrors.badRequest('Assignee must be an active member of the search');
      }

      const result = await client.query(
        `INSERT INTO tasks(search_id,title,description,assignee_id,priority,lat,lng,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [searchId, body.title, body.description ?? null, body.assigneeId ?? null, body.priority, body.lat ?? null, body.lng ?? null, req.user.id],
      );
      const task = result.rows[0];
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'TASK_CREATED', { taskId: task.id }],
      );
      await client.query('COMMIT');
      return task;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/tasks/:id', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    const body = z.object({
      status: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']).optional(),
      assigneeId: z.string().uuid().nullable().optional(),
      description: z.string().nullable().optional(),
      priority: z.number().int().min(1).max(3).optional(),
    }).refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Filter authorization in the locking query so a task outside the user's
      // searches is neither distinguishable from a missing task nor locked.
      const current = await client.query(
        `SELECT t.* FROM tasks t
         WHERE t.id=$1
           AND (
             $2::boolean
             OR EXISTS (
               SELECT 1 FROM search_members sm
               WHERE sm.search_id=t.search_id AND sm.user_id=$3
             )
             OR EXISTS (
               SELECT 1 FROM search_organizations so
               JOIN organization_members om ON om.organization_id=so.organization_id
               WHERE so.search_id=t.search_id AND om.user_id=$3 AND om.active=true
             )
           )
         FOR UPDATE OF t`,
        [id, privilegedRoles.includes(req.user.role), req.user.id],
      );
      if (!current.rowCount) throw httpErrors.notFound('Task not found');
      const task = current.rows[0];

      const manager = managementRoles.includes(req.user.role);
      if (!privilegedRoles.includes(req.user.role) && !manager) {
        if (req.user.role !== 'SEARCHER' || task.assignee_id !== req.user.id) {
          throw httpErrors.forbidden('You may only update tasks assigned to you');
        }
        if (body.assigneeId !== undefined || body.priority !== undefined) {
          throw httpErrors.forbidden('Searchers cannot reassign or reprioritize tasks');
        }
      }

      if (body.assigneeId) {
        const member = await client.query(
          `SELECT 1 FROM search_members sm JOIN users u ON u.id=sm.user_id
           WHERE sm.search_id=$1 AND sm.user_id=$2 AND u.active=true`,
          [task.search_id, body.assigneeId],
        );
        if (!member.rowCount) throw httpErrors.badRequest('Assignee must be an active member of the search');
      }

      const result = await client.query(
        `UPDATE tasks SET
           status=CASE WHEN $1::boolean THEN $2 ELSE status END,
           assignee_id=CASE WHEN $3::boolean THEN $4 ELSE assignee_id END,
           description=CASE WHEN $5::boolean THEN $6 ELSE description END,
           priority=CASE WHEN $7::boolean THEN $8 ELSE priority END,
           completed_at=CASE
             WHEN $1 AND $2='DONE' THEN now()
             WHEN $1 THEN NULL
             ELSE completed_at
           END
         WHERE id=$9 RETURNING *`,
        [
          body.status !== undefined, body.status ?? null,
          body.assigneeId !== undefined, body.assigneeId,
          body.description !== undefined, body.description,
          body.priority !== undefined, body.priority ?? null,
          id,
        ],
      );
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [task.search_id, req.user.id, 'TASK_UPDATED', { taskId: id, changes: body }],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default taskRoutes;
