import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';
import { managementRoles } from '../rbac.js';

const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/events', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchAccess(req, id);
    return (await pool.query(
      `SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id
       WHERE e.search_id=$1 AND ($2::boolean OR e.type NOT IN ('SUBJECT_CREATED','SUBJECT_UPDATED'))
       ORDER BY e.created_at DESC LIMIT 500`,
      [id, managementRoles.includes(req.user.role)],
    )).rows;
  });

  // System events are emitted by the API itself. Do not let client-supplied
  // arbitrary type strings forge lifecycle, membership or task audit entries.
  app.post('/api/v1/searches/:id/events', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, id, client);
      const body = z.object({ note: z.string().trim().min(1).max(2000) }).parse(req.body);
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [id, req.user.id, 'COORDINATOR_NOTE', { note: body.note }],
      );
      await commitSearchMutation(req, client);
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default eventRoutes;
