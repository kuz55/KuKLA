import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const witnessRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/witnesses', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchAccess(req, searchId);
    return (await pool.query(
      'SELECT * FROM witnesses WHERE search_id=$1 ORDER BY created_at DESC',
      [searchId],
    )).rows;
  });

  app.post('/api/v1/searches/:id/witnesses', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const body = z.object({
      name: z.string().optional(),
      phone: z.string().optional(),
      contactAt: z.string().datetime().optional(),
      locationLat: z.number().min(-90).max(90).optional(),
      locationLng: z.number().min(-180).max(180).optional(),
      statement: z.string().min(2),
      reliability: z.enum(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH']).optional(),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchAccess(req, searchId, client);
      const member = await client.query(
        `SELECT 1 FROM search_members sm JOIN users u ON u.id = sm.user_id
         WHERE sm.search_id = $1 AND sm.user_id = $2 AND u.active = true`,
        [searchId, req.user.id],
      );
      if (!member.rowCount) throw httpErrors.forbidden('Only search members may record witnesses');
      const result = await client.query(
        `INSERT INTO witnesses(search_id, name, phone, contact_at, location_lat, location_lng, statement, reliability, created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [searchId, body.name ?? null, body.phone ?? null, body.contactAt ?? null,
          body.locationLat ?? null, body.locationLng ?? null, body.statement, body.reliability ?? null, req.user.id],
      );
      const witness = result.rows[0];
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'WITNESS_CREATED', { witnessId: witness.id }]);
      await commitSearchMutation(req, client);
      return witness;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/searches/:id/witnesses/:wid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const witnessId = z.string().uuid().parse((req.params as { wid: string }).wid);
    const body = z.object({
      name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
      contactAt: z.string().datetime().nullable().optional(),
      locationLat: z.number().min(-90).max(90).nullable().optional(),
      locationLng: z.number().min(-180).max(180).nullable().optional(),
      statement: z.string().min(2).optional(),
      reliability: z.enum(['UNKNOWN', 'LOW', 'MEDIUM', 'HIGH']).nullable().optional(),
    }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const current = await client.query(
        'SELECT id FROM witnesses WHERE id=$1 AND search_id=$2 FOR UPDATE',
        [witnessId, searchId],
      );
      if (!current.rowCount) throw httpErrors.notFound('Witness not found');
      const sets: string[] = [];
      const values: unknown[] = [witnessId];
      let i = 2;
      for (const [key, col] of [
        ['name', 'name'], ['phone', 'phone'], ['contactAt', 'contact_at'],
        ['locationLat', 'location_lat'], ['locationLng', 'location_lng'],
        ['statement', 'statement'], ['reliability', 'reliability'],
      ] as const) {
        if (body[key] !== undefined) { sets.push(`${col}=$${i++}`); values.push(body[key]); }
      }
      let witness = current.rows[0];
      if (sets.length) {
        const result = await client.query(
          `UPDATE witnesses SET ${sets.join(', ')} WHERE id=$1 RETURNING *`,
          values,
        );
        witness = result.rows[0];
      }
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'WITNESS_UPDATED', { witnessId }]);
      await commitSearchMutation(req, client);
      return witness;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/searches/:id/witnesses/:wid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const witnessId = z.string().uuid().parse((req.params as { wid: string }).wid);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const result = await client.query(
        'DELETE FROM witnesses WHERE id=$1 AND search_id=$2 RETURNING id',
        [witnessId, searchId],
      );
      if (!result.rowCount) throw httpErrors.notFound('Witness not found');
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'WITNESS_DELETED', { witnessId }]);
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

export default witnessRoutes;
