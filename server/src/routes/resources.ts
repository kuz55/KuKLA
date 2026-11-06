import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import { z } from 'zod';
import { pool } from '../config.js';
import { auth, commitSearchMutation, parseId, requireSearchAccess, requireSearchManagement } from '../http.js';

const resourceRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/searches/:id/resources', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    await requireSearchAccess(req, searchId);
    return (await pool.query(
      'SELECT * FROM resources WHERE search_id=$1 ORDER BY resource_type, name',
      [searchId],
    )).rows;
  });

  app.post('/api/v1/searches/:id/resources', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const body = z.object({
      resourceType: z.enum(['VEHICLE', 'K9', 'UAV', 'AIRCRAFT', 'RADIO', 'MEDICAL', 'EQUIPMENT', 'OTHER']),
      name: z.string().min(2),
      status: z.enum(['AVAILABLE', 'ASSIGNED', 'IN_USE', 'UNAVAILABLE', 'LOST']).default('AVAILABLE'),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const result = await client.query(
        `INSERT INTO resources(search_id, resource_type, name, status, metadata)
         VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [searchId, body.resourceType, body.name, body.status, body.metadata],
      );
      const resource = result.rows[0];
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'RESOURCE_CREATED', { resourceId: resource.id }]);
      await commitSearchMutation(req, client);
      return resource;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/searches/:id/resources/:rid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const resourceId = z.string().uuid().parse((req.params as { rid: string }).rid);
    const body = z.object({
      name: z.string().min(2).optional(),
      status: z.enum(['AVAILABLE', 'ASSIGNED', 'IN_USE', 'UNAVAILABLE', 'LOST']).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const current = await client.query(
        'SELECT id FROM resources WHERE id=$1 AND search_id=$2 FOR UPDATE',
        [resourceId, searchId],
      );
      if (!current.rowCount) throw httpErrors.notFound('Resource not found');
      const sets: string[] = [];
      const values: unknown[] = [resourceId];
      let i = 2;
      for (const [key, col] of [['name', 'name'], ['status', 'status'], ['metadata', 'metadata']] as const) {
        if (body[key] !== undefined) { sets.push(`${col}=$${i++}`); values.push(body[key]); }
      }
      let resource = current.rows[0];
      if (sets.length) {
        const result = await client.query(
          `UPDATE resources SET ${sets.join(', ')} WHERE id=$1 RETURNING *`,
          values,
        );
        resource = result.rows[0];
      }
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'RESOURCE_UPDATED', { resourceId }]);
      await commitSearchMutation(req, client);
      return resource;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/searches/:id/resources/:rid', { preHandler: auth }, async (req) => {
    const searchId = parseId(req);
    const resourceId = z.string().uuid().parse((req.params as { rid: string }).rid);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireSearchManagement(req, searchId, client);
      const result = await client.query(
        'DELETE FROM resources WHERE id=$1 AND search_id=$2 RETURNING id',
        [resourceId, searchId],
      );
      if (!result.rowCount) throw httpErrors.notFound('Resource not found');
      await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)',
        [searchId, req.user.id, 'RESOURCE_DELETED', { resourceId }]);
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

export default resourceRoutes;
