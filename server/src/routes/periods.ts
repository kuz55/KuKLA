import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const periodRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/periods', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchAccess(req, searchId);
    return (await pool.query(
      `SELECT p.*, u.name AS created_by_name
       FROM operational_periods p LEFT JOIN users u ON u.id = p.created_by
       WHERE p.search_id = $1 ORDER BY p.starts_at`,
      [searchId],
    )).rows;
  });

  app.post('/api/v1/searches/:id/periods', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const body = z.object({
      name: z.string().min(2),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime().optional(),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const result = await client.query(
        `INSERT INTO operational_periods(search_id, name, starts_at, ends_at, created_by)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [searchId, body.name, body.startsAt, body.endsAt ?? null, req.user.id],
      );
      const period = result.rows[0];
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'PERIOD_CREATED', { periodId: period.id }]);
      await commitSearchMutation(req, client);
      return period;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/searches/:id/periods/:pid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const periodId = z.string().uuid().parse((req.params as { pid: string }).pid);
    const body = z.object({
      name: z.string().min(2).optional(),
      status: z.enum(['PLANNED', 'ACTIVE', 'CLOSED']).optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().nullable().optional(),
      briefing: z.string().nullable().optional(),
      debriefing: z.string().nullable().optional(),
    }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const current = await client.query(
        'SELECT id FROM operational_periods WHERE id=$1 AND search_id=$2 FOR UPDATE',
        [periodId, searchId],
      );
      if (!current.rowCount) throw httpErrors.notFound('Operational period not found');
      const sets: string[] = [];
      const values: unknown[] = [periodId];
      let i = 2;
      for (const [key, col, transform] of [
        ['name', 'name', (v: unknown) => v],
        ['status', 'status', (v: unknown) => v],
        ['startsAt', 'starts_at', (v: unknown) => v],
        ['endsAt', 'ends_at', (v: unknown) => v],
        ['briefing', 'briefing', (v: unknown) => v],
        ['debriefing', 'debriefing', (v: unknown) => v],
      ] as const) {
        if (body[key] !== undefined) { sets.push(`${col}=$${i++}`); values.push(transform(body[key])); }
      }
      let period = current.rows[0];
      if (sets.length) {
        const result = await client.query(
          `UPDATE operational_periods SET ${sets.join(', ')} WHERE id=$1 RETURNING *`,
          values,
        );
        period = result.rows[0];
      }
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'PERIOD_UPDATED', { periodId }]);
      await commitSearchMutation(req, client);
      return period;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default periodRoutes;
