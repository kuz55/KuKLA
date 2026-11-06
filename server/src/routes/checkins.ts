import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { managementRoles } from '../rbac.js';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const checkinRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/checkins', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchAccess(req, searchId);
    return (await pool.query(
      `SELECT c.*, u.name AS user_name, t.name AS team_name
       FROM checkins c
       LEFT JOIN users u ON u.id = c.user_id
       LEFT JOIN search_teams t ON t.id = c.team_id
       WHERE c.search_id = $1
       ORDER BY c.created_at DESC
       LIMIT 500`,
      [searchId],
    )).rows;
  });

  app.post('/api/v1/searches/:id/checkins', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const body = z.object({
      status: z.enum(['OK', 'DELAYED', 'HELP', 'EMERGENCY']),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      battery: z.number().int().min(0).max(100).optional(),
      network: z.string().optional(),
      accuracy: z.number().nonnegative().optional(),
      teamId: z.string().uuid().optional(),
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
      if (!member.rowCount) throw httpErrors.forbidden('Only search members may submit check-ins');
      if (body.teamId) {
        const team = await client.query(
          'SELECT id FROM search_teams WHERE id=$1 AND search_id=$2',
          [body.teamId, searchId],
        );
        if (!team.rowCount) throw httpErrors.badRequest('Team does not belong to this search');
      }

      const result = await client.query(
        `INSERT INTO checkins(search_id, user_id, team_id, status, lat, lng, battery, network, accuracy)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [searchId, req.user.id, body.teamId ?? null, body.status, body.lat ?? null, body.lng ?? null,
          body.battery ?? null, body.network ?? null, body.accuracy ?? null],
      );
      const checkin = result.rows[0];

      if (body.status === 'EMERGENCY' || body.status === 'HELP') {
        const eventType = body.status === 'EMERGENCY' ? 'SOS' : 'HELP';
        const severity = body.status === 'EMERGENCY' ? 'EMERGENCY' : 'ALERT';
        await client.query(
          `INSERT INTO emergency_events(search_id, user_id, team_id, type, severity, lat, lng, message, status)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,'OPEN')`,
          [searchId, req.user.id, body.teamId ?? null, eventType, severity,
            body.lat ?? null, body.lng ?? null, `Полевой чекин со статусом ${body.status}`],
        );
        const managers = await client.query(
          `SELECT DISTINCT sm.user_id
           FROM search_members sm JOIN users u ON u.id = sm.user_id
           WHERE sm.search_id = $1 AND u.role = ANY($2::text[])`,
          [searchId, managementRoles],
        );
        for (const m of managers.rows) {
          await client.query(
            'INSERT INTO notifications(search_id, user_id, type, title, body, severity) VALUES($1,$2,$3,$4,$5,$6)',
            [searchId, m.user_id, 'SOS', `Сигнал ${eventType} от полевой группы`,
              `Статус: ${body.status}`, severity],
          );
        }
      }

      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'CHECKIN_CREATED', { status: body.status }]);
      await commitSearchMutation(req, client);
      return checkin;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/searches/:id/checkins/emergencies', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const client = await pool.connect();
    try {
      await requireSearchManagement(req, searchId, client);
      return (await client.query(
        `SELECT e.*, u.name AS user_name, t.name AS team_name
         FROM emergency_events e
         LEFT JOIN users u ON u.id = e.user_id
         LEFT JOIN search_teams t ON t.id = e.team_id
         WHERE e.search_id = $1 AND e.status IN ('OPEN','ACKNOWLEDGED')
         ORDER BY e.created_at DESC`,
        [searchId],
      )).rows;
    } finally {
      client.release();
    }
  });
};

export default checkinRoutes;
