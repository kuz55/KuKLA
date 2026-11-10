import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { pool } from '../config.js';
import { auth, parseId } from '../http.js';
import { FieldLeadService } from '../field-lead/service.js';

const fieldLeadRoutes: FastifyPluginAsync = async app => {
  const service = new FieldLeadService(pool);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    const status = (err as {statusCode?: number}).statusCode ?? 500;
    if (status >= 500) req.log.error({ requestId: req.id }, 'Field lead request failed');
    return reply.code(status).send({ error: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'ERROR' });
  });
  app.addHook('onSend', async (_req, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.post('/api/v1/field-lead/searches/:id/proposals', { preHandler: auth }, async req => {
    const body = z.object({ candidateId: z.string().uuid() }).strict().parse(req.body);
    return service.propose(req.user.id, parseId(req), body.candidateId);
  });
  app.get('/api/v1/field-lead/searches/:id/proposals/mine', { preHandler: auth }, async req => service.pending(req.user.id, parseId(req)));
  app.post('/api/v1/field-lead/searches/:id/proposals/accept', { preHandler: auth }, async req => {
    const body = z.object({ proposalId: z.string().uuid() }).strict().parse(req.body);
    return service.accept(req.user.id, parseId(req), body.proposalId);
  });
  app.post('/api/v1/field-lead/searches/:id/proposals/decline', { preHandler: auth }, async req => {
    const body = z.object({ proposalId: z.string().uuid() }).strict().parse(req.body);
    return service.decline(req.user.id, parseId(req), body.proposalId);
  });
  app.post('/api/v1/field-lead/searches/:id/exceptional-removal', { preHandler: auth }, async req => {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    return service.remove(req.user.id, parseId(req), body.reason);
  });
};
export default fieldLeadRoutes;
