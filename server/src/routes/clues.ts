import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const clueRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/clues', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchAccess(req, searchId);
    return (await pool.query(
      `SELECT c.*, u.name AS reported_by_name, s.code AS sector_code
       FROM clues c
       LEFT JOIN users u ON u.id = c.reported_by
       LEFT JOIN search_sectors s ON s.id = c.sector_id
       WHERE c.search_id = $1 ORDER BY c.created_at DESC`,
      [searchId],
    )).rows;
  });

  app.post('/api/v1/searches/:id/clues', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const body = z.object({
      clueType: z.string().min(2),
      description: z.string().min(2),
      sectorId: z.string().uuid().optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      observedAt: z.string().datetime().optional(),
      status: z.enum(['NEW', 'CONFIRMED', 'DISMISSED', 'RESOLVED']).default('NEW'),
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
      if (!member.rowCount) throw httpErrors.forbidden('Only search members may report clues');
      if (body.sectorId) {
        const sector = await client.query(
          'SELECT id FROM search_sectors WHERE id=$1 AND search_id=$2',
          [body.sectorId, searchId],
        );
        if (!sector.rowCount) throw httpErrors.badRequest('Sector does not belong to this search');
      }
      const result = await client.query(
        `INSERT INTO clues(search_id, sector_id, reported_by, clue_type, description, lat, lng, observed_at, status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [searchId, body.sectorId ?? null, req.user.id, body.clueType, body.description,
          body.lat ?? null, body.lng ?? null, body.observedAt ?? null, body.status],
      );
      const clue = result.rows[0];
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'CLUE_CREATED', { clueId: clue.id }]);
      await commitSearchMutation(req, client);
      return clue;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/searches/:id/clues/:cid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const clueId = z.string().uuid().parse((req.params as { cid: string }).cid);
    const body = z.object({
      clueType: z.string().min(2).optional(),
      description: z.string().min(2).nullable().optional(),
      sectorId: z.string().uuid().nullable().optional(),
      status: z.enum(['NEW', 'CONFIRMED', 'DISMISSED', 'RESOLVED']).optional(),
    }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const current = await client.query(
        'SELECT id FROM clues WHERE id=$1 AND search_id=$2 FOR UPDATE',
        [clueId, searchId],
      );
      if (!current.rowCount) throw httpErrors.notFound('Clue not found');
      const sets: string[] = [];
      const values: unknown[] = [clueId];
      let i = 2;
      for (const [key, col] of [['clueType', 'clue_type'], ['description', 'description'],
        ['sectorId', 'sector_id'], ['status', 'status']] as const) {
        if (body[key] !== undefined) { sets.push(`${col}=$${i++}`); values.push(body[key]); }
      }
      let clue = current.rows[0];
      if (sets.length) {
        const result = await client.query(
          `UPDATE clues SET ${sets.join(', ')} WHERE id=$1 RETURNING *`,
          values,
        );
        clue = result.rows[0];
      }
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'CLUE_UPDATED', { clueId }]);
      await commitSearchMutation(req, client);
      return clue;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/searches/:id/clues/:cid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const clueId = z.string().uuid().parse((req.params as { cid: string }).cid);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const result = await client.query(
        'DELETE FROM clues WHERE id=$1 AND search_id=$2 RETURNING id',
        [clueId, searchId],
      );
      if (!result.rowCount) throw httpErrors.notFound('Clue not found');
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'CLUE_DELETED', { clueId }]);
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

export default clueRoutes;
