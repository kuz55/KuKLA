import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, parseId, requireSearchAccess } from '../http.js';

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative().optional(),
  altitude: z.number().optional(),
  speed: z.number().nonnegative().optional(),
  recorded_at: z.iso.datetime().optional(),
});

const gpsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/searches/:id/gps', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchAccess(req, id);
    const body = z.object({ points: z.array(pointSchema).min(1).max(1000) }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const point of body.points) {
        await client.query(
          `INSERT INTO gps_points(search_id,user_id,lat,lng,accuracy,altitude,speed,recorded_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8,now()))`,
          [id, req.user.id, point.lat, point.lng, point.accuracy ?? null, point.altitude ?? null, point.speed ?? null, point.recorded_at ?? null],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return { ok: true, count: body.points.length };
  });

  app.get('/api/v1/searches/:id/gps', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    await requireSearchAccess(req, id);
    const query = z.object({
      since: z.iso.datetime().optional(),
      userId: z.uuid().optional(),
      limit: z.coerce.number().int().min(1).max(10000).default(5000),
    }).parse(req.query);

    // Select the newest bounded window, then return it in chronological order
    // so map clients draw the currently relevant track without reversing it.
    return (await pool.query(
      `SELECT recent.* FROM (
         SELECT g.*,u.name user_name
         FROM gps_points g JOIN users u ON u.id=g.user_id
         WHERE g.search_id=$1
           AND ($2::timestamptz IS NULL OR g.recorded_at >= $2)
           AND ($3::uuid IS NULL OR g.user_id = $3)
         ORDER BY g.recorded_at DESC, g.id DESC
         LIMIT $4
       ) recent
       ORDER BY recent.recorded_at ASC, recent.id ASC`,
      [id, query.since ?? null, query.userId ?? null, query.limit],
    )).rows;
  });

  app.get('/api/v1/searches/:id/snapshot', { preHandler: auth }, async (req) => {
    const id = parseId(req);
    const client = await pool.connect();
    try {
      // Use one read-only MVCC snapshot for both authorization and every section
      // so an offline client cannot receive a cross-version mixture of data.
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await requireSearchAccess(req, id, client);
      const search = await client.query('SELECT * FROM searches WHERE id=$1', [id]);
      const members = await client.query(
        'SELECT u.id,u.name,u.role,m.joined_at FROM search_members m JOIN users u ON u.id=m.user_id WHERE m.search_id=$1',
        [id],
      );
      const tasks = await client.query('SELECT * FROM tasks WHERE search_id=$1 ORDER BY created_at', [id]);
      const events = await client.query(
        'SELECT e.*,u.name user_name FROM events e LEFT JOIN users u ON u.id=e.user_id WHERE e.search_id=$1 ORDER BY e.created_at DESC LIMIT 200',
        [id],
      );
      const gps = await client.query(
        'SELECT g.*,u.name user_name FROM gps_points g JOIN users u ON u.id=g.user_id WHERE g.search_id=$1 ORDER BY g.recorded_at DESC,g.id DESC LIMIT 5000',
        [id],
      );
      await client.query('COMMIT');
      return {
        search: search.rows[0],
        members: members.rows,
        tasks: tasks.rows,
        events: events.rows,
        gps: gps.rows,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default gpsRoutes;
