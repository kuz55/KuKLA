import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const parseUuid = (value: unknown) => z.string().uuid().parse(value);
const geometry = z.record(z.string(), z.unknown()).default({});

const sectorRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/sectors', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchAccess(req, searchId);
    return (await pool.query(
      `SELECT s.*, COALESCE(
          json_agg(json_build_object(
            'id', a.id, 'teamId', a.team_id, 'operationalPeriodId', a.operational_period_id,
            'assignedAt', a.assigned_at, 'releasedAt', a.released_at
          )) FILTER (WHERE a.id IS NOT NULL), '[]') AS assignments
       FROM search_sectors s
       LEFT JOIN sector_assignments a ON a.sector_id = s.id
       WHERE s.search_id = $1
       GROUP BY s.id
       ORDER BY s.code`,
      [searchId],
    )).rows;
  });

  app.post('/api/v1/searches/:id/sectors', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const parsed = z.object({
      code: z.string().min(1).max(20),
      name: z.string().optional(),
      priority: z.number().int().min(1).max(3).default(2),
      geometry,
      notes: z.string().optional(),
    }).safeParse(req.body);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      if (!parsed.success) throw parsed.error;
      const b = parsed.data;
      const result = await client.query(
        `INSERT INTO search_sectors(search_id, code, name, priority, geometry, notes, created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [searchId, b.code, b.name ?? null, b.priority, b.geometry, b.notes ?? null, req.user.id],
      );
      const sector = result.rows[0];
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'SECTOR_CREATED', { sectorId: sector.id }]);
      await commitSearchMutation(req, client);
      return sector;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/searches/:id/sectors/:sid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const sectorId = parseUuid((req.params as { sid: string }).sid);
    const body = z.object({
      code: z.string().min(1).max(20).optional(),
      name: z.string().nullable().optional(),
      status: z.enum(['UNSEARCHED', 'ASSIGNED', 'SEARCHING', 'COMPLETE', 'SUSPENDED']).optional(),
      priority: z.number().int().min(1).max(3).optional(),
      pod: z.number().min(0).max(100).nullable().optional(),
      geometry,
      notes: z.string().nullable().optional(),
    }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const current = await client.query(
        'SELECT id FROM search_sectors WHERE id=$1 AND search_id=$2 FOR UPDATE',
        [sectorId, searchId],
      );
      if (!current.rowCount) throw httpErrors.notFound('Sector not found');
      const sets: string[] = [];
      const values: unknown[] = [sectorId];
      let i = 2;
      for (const [key, col] of [
        ['code', 'code'], ['name', 'name'], ['status', 'status'], ['priority', 'priority'],
        ['pod', 'pod'], ['geometry', 'geometry'], ['notes', 'notes'],
      ] as const) {
        if (body[key] !== undefined) { sets.push(`${col}=$${i++}`); values.push(body[key]); }
      }
      let sector = current.rows[0];
      if (sets.length) {
        const result = await client.query(
          `UPDATE search_sectors SET ${sets.join(', ')} WHERE id=$1 RETURNING *`,
          values,
        );
        sector = result.rows[0];
      }
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'SECTOR_UPDATED', { sectorId }]);
      await commitSearchMutation(req, client);
      return sector;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/searches/:id/sectors/:sid/assignments', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const sectorId = parseUuid((req.params as { sid: string }).sid);
    await requireSearchAccess(req, searchId);
    return (await pool.query(
      `SELECT a.*, t.name AS team_name, t.team_type, p.name AS period_name
       FROM sector_assignments a
       JOIN search_teams t ON t.id = a.team_id
       LEFT JOIN operational_periods p ON p.id = a.operational_period_id
       WHERE a.sector_id = $1
       ORDER BY a.assigned_at`,
      [sectorId],
    )).rows;
  });

  app.post('/api/v1/searches/:id/sectors/:sid/assignments', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const sectorId = parseUuid((req.params as { sid: string }).sid);
    const body = z.object({
      teamId: z.string().uuid(),
      operationalPeriodId: z.string().uuid().optional(),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const team = await client.query(
        'SELECT id FROM search_teams WHERE id=$1 AND search_id=$2',
        [body.teamId, searchId],
      );
      if (!team.rowCount) throw httpErrors.badRequest('Team does not belong to this search');
      if (body.operationalPeriodId) {
        const period = await client.query(
          'SELECT id FROM operational_periods WHERE id=$1 AND search_id=$2',
          [body.operationalPeriodId, searchId],
        );
        if (!period.rowCount) throw httpErrors.badRequest('Operational period does not belong to this search');
      }
      const result = await client.query(
        `INSERT INTO sector_assignments(search_id, sector_id, team_id, operational_period_id, assigned_by)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (sector_id, team_id, operational_period_id) DO UPDATE
           SET released_at = NULL
         RETURNING *`,
        [searchId, sectorId, body.teamId, body.operationalPeriodId ?? null, req.user.id],
      );
      await client.query(
        "UPDATE search_sectors SET status = 'ASSIGNED' WHERE id=$1 AND status = 'UNSEARCHED'",
        [sectorId],
      );
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'SECTOR_ASSIGNED', { sectorId, teamId: body.teamId }]);
      await commitSearchMutation(req, client);
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/searches/:id/sectors/:sid/assignments/:aid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const sectorId = parseUuid((req.params as { sid: string }).sid);
    const assignmentId = parseUuid((req.params as { aid: string }).aid);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const result = await client.query(
        `UPDATE sector_assignments SET released_at = now()
         WHERE id=$1 AND sector_id=$2 AND search_id=$3 AND released_at IS NULL
         RETURNING *`,
        [assignmentId, sectorId, searchId],
      );
      if (!result.rowCount) throw httpErrors.notFound('Assignment not found');
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'SECTOR_UNASSIGNED', { sectorId, assignmentId }]);
      await commitSearchMutation(req, client);
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default sectorRoutes;
