import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const closeoutRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/closeout', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchAccess(req, searchId);
    const result = await pool.query(
      'SELECT * FROM search_closeout WHERE search_id=$1',
      [searchId],
    );
    if (!result.rowCount) throw httpErrors.notFound('Search is not closed');
    return result.rows[0];
  });

  app.post('/api/v1/searches/:id/closeout', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const body = z.object({
      reason: z.string().min(2),
      outcome: z.enum(['FOUND_ALIVE', 'FOUND_DECEASED', 'INCONCLUSIVE', 'CANCELLED', 'HANDED_OVER']).default('INCONCLUSIVE'),
      summary: z.string().optional(),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const exists = await client.query(
        'SELECT id FROM search_closeout WHERE search_id=$1',
        [searchId],
      );
      if (exists.rowCount) throw httpErrors.conflict('Search already closed');
      const result = await client.query(
        `INSERT INTO search_closeout(search_id, reason, outcome, summary, closed_by)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [searchId, body.reason, body.outcome, body.summary ?? null, req.user.id],
      );
      const closeout = result.rows[0];
      await client.query(
        "UPDATE searches SET status='COMPLETED', ended_at=now() WHERE id=$1",
        [searchId],
      );
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'SEARCH_CLOSED', { outcome: body.outcome }]);
      await commitSearchMutation(req, client);
      return closeout;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default closeoutRoutes;
