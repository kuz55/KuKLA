import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../config.js';
import { audit, auth, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const eventRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/events', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchAccess(req, id);
    return (await pool.query(
      'SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.search_id=$1 ORDER BY e.created_at DESC LIMIT 500',
      [id],
    )).rows;
  });

  // System events are emitted by the API itself. Do not let client-supplied
  // arbitrary type strings forge lifecycle, membership or task audit entries.
  app.post('/api/v1/searches/:id/events', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchManagement(req, id);
    const body = z.object({ note: z.string().trim().min(1).max(2000) }).parse(req.body);
    await audit(id, req.user.id, 'COORDINATOR_NOTE', { note: body.note });
    return { ok: true };
  });
};

export default eventRoutes;
