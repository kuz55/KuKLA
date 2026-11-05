import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { privilegedRoles, searchCreationRoles } from '../rbac.js';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement, roles } from '../http.js';
import { Params } from '../types.js';

const searchRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches', { preHandler: auth }, async (req) => {
    const privileged = privilegedRoles.includes(req.user.role);
    const query = privileged
      ? `SELECT s.*,u.name creator,
           (SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,
           (SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks,
           (SELECT count(*) FROM gps_points g WHERE g.search_id=s.id) gps_points
         FROM searches s LEFT JOIN users u ON u.id=s.created_by
         ORDER BY s.created_at DESC`
      : `SELECT s.*,u.name creator,
           (SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,
           (SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks,
           (SELECT count(*) FROM gps_points g WHERE g.search_id=s.id) gps_points
         FROM searches s LEFT JOIN users u ON u.id=s.created_by
         WHERE EXISTS (
           SELECT 1 FROM search_members sm WHERE sm.search_id=s.id AND sm.user_id=$1
         ) OR EXISTS (
           SELECT 1 FROM search_organizations so
           JOIN organization_members om ON om.organization_id=so.organization_id
           WHERE so.search_id=s.id AND om.user_id=$1 AND om.active=true
         )
         ORDER BY s.created_at DESC`;
    return (await pool.query(query, privileged ? [] : [req.user.id])).rows;
  });

  app.get('/api/v1/searches/:id', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchAccess(req, id);
    const result = await pool.query(
      `SELECT s.*,u.name creator,
         (SELECT count(*) FROM search_members m WHERE m.search_id=s.id) member_count,
         (SELECT count(*) FROM tasks t WHERE t.search_id=s.id AND t.status NOT IN ('DONE','CANCELLED')) open_tasks,
         (SELECT count(*) FROM gps_points g WHERE g.search_id=s.id) gps_points
       FROM searches s LEFT JOIN users u ON u.id=s.created_by WHERE s.id=$1`,
      [id],
    );
    return result.rows[0];
  });

  app.post('/api/v1/searches', { preHandler: roles(...searchCreationRoles) }, async (req) => {
    const body = z.object({
      title: z.string().min(2),
      area: z.string().optional(),
      description: z.string().optional(),
      incident_lat: z.number().min(-90).max(90).optional(),
      incident_lng: z.number().min(-180).max(180).optional(),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO searches(title,area,description,incident_lat,incident_lng,created_by)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [body.title, body.area ?? null, body.description ?? null, body.incident_lat ?? null, body.incident_lng ?? null, req.user.id],
      );
      const search = result.rows[0];
      await client.query(
        'INSERT INTO search_members(search_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [search.id, req.user.id],
      );
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [search.id, req.user.id, 'SEARCH_CREATED', { title: body.title }],
      );
      await client.query('COMMIT');
      return search;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/searches/:id', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, id, client);
      const body = z.object({
        status: z.enum(['PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']).optional(),
        title: z.string().min(2).optional(),
        area: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        incident_lat: z.number().min(-90).max(90).nullable().optional(),
        incident_lng: z.number().min(-180).max(180).nullable().optional(),
      }).refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' }).parse(req.body);

      const result = await client.query(
        `UPDATE searches SET
           title=CASE WHEN $1::boolean THEN $2 ELSE title END,
           area=CASE WHEN $3::boolean THEN $4 ELSE area END,
           description=CASE WHEN $5::boolean THEN $6 ELSE description END,
           status=CASE WHEN $7::boolean THEN $8 ELSE status END,
           incident_lat=CASE WHEN $9::boolean THEN $10 ELSE incident_lat END,
           incident_lng=CASE WHEN $11::boolean THEN $12 ELSE incident_lng END,
           started_at=CASE WHEN $7 AND $8='ACTIVE' AND started_at IS NULL THEN now() ELSE started_at END,
           ended_at=CASE
             WHEN $7 AND $8 IN ('COMPLETED','CANCELLED') THEN now()
             WHEN $7 AND $8='ACTIVE' THEN NULL
             ELSE ended_at
           END
         WHERE id=$13 RETURNING *`,
        [
          body.title !== undefined, body.title ?? null,
          body.area !== undefined, body.area,
          body.description !== undefined, body.description,
          body.status !== undefined, body.status ?? null,
          body.incident_lat !== undefined, body.incident_lat,
          body.incident_lng !== undefined, body.incident_lng,
          id,
        ],
      );
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [id, req.user.id, 'SEARCH_UPDATED', { changes: body }],
      );
      await commitSearchMutation(req, client);
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/searches/:id/members', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchAccess(req, id);
    return (await pool.query(
      `SELECT u.id,u.name,u.email,u.phone,u.role,m.joined_at
       FROM search_members m JOIN users u ON u.id=m.user_id
       WHERE m.search_id=$1 ORDER BY m.joined_at`,
      [id],
    )).rows;
  });

  // Membership is granted by an authorized manager. A self-join request must
  // never make operational data visible before the search team approves it.
  app.post('/api/v1/searches/:id/join', { preHandler: auth }, async (req) => {
    // Validate shape, but do not reveal whether the referenced operation exists.
    parseId(req);
    throw httpErrors.forbidden('A search manager must add you to this operation');
  });

  app.post('/api/v1/searches/:id/members', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const parsed = z.object({ userId: z.string().uuid() }).safeParse(req.body);
      await requireSearchManagement(req, id, client, parsed.success ? [parsed.data.userId] : []);
      if (!parsed.success) throw parsed.error;
      const body = parsed.data;
      const target = await client.query('SELECT id FROM users WHERE id=$1 AND active=true FOR SHARE', [body.userId]);
      if (!target.rowCount) throw httpErrors.notFound('Active user not found');
      const added = await client.query(
        'INSERT INTO search_members(search_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING user_id',
        [id, body.userId],
      );
      if (added.rowCount) {
        await client.query(
          'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
          [id, req.user.id, 'MEMBER_ADDED', { userId: body.userId }],
        );
      }
      await commitSearchMutation(req, client);
      return { ok: true, added: Boolean(added.rowCount) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/searches/:id/members/:userId', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, id, client);
      const userId = z.string().uuid().parse((req.params as Params).userId);
      const removed = await client.query(
        'DELETE FROM search_members WHERE search_id=$1 AND user_id=$2 RETURNING user_id',
        [id, userId],
      );
      if (removed.rowCount) {
        await client.query(
          'INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
          [id, req.user.id, 'MEMBER_REMOVED', { userId }],
        );
      }
      await commitSearchMutation(req, client);
      return { ok: true, removed: Boolean(removed.rowCount) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default searchRoutes;
