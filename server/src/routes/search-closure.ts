import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { pool } from '../config.js';
import { auth, parseId } from '../http.js';
import { SearchClosureService } from '../search-closure/service.js';

const searchClosureRoutes: FastifyPluginAsync = async app => {
  const service = new SearchClosureService(pool);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ requestId: req.id }, 'Search closure request failed');
    return reply.code(status).send({ error: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'ERROR' });
  });
  app.addHook('onSend', async (_req, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.post('/api/v1/search-closure/searches/:id/confirm', { preHandler: auth }, async req => {
    z.object({}).strict().parse(req.body);
    return service.confirm(req.user.id, parseId(req));
  });
  app.post('/api/v1/search-closure/searches/:id/close', { preHandler: auth }, async req => {
    const body = z.object({ exceptionReason: z.string().trim().min(1).max(2000).optional() }).strict().parse(req.body);
    return service.close(req.user.id, parseId(req), body.exceptionReason);
  });
  app.post('/api/v1/search-closure/searches/:id/reopen', { preHandler: auth }, async req => {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    return service.reopen(req.user.id, parseId(req), body.reason);
  });
};
export default searchClosureRoutes;
