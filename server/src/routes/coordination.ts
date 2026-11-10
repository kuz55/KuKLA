import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { pool } from '../config.js';
import { auth, parseId } from '../http.js';
import { CoordinationService } from '../coordination/service.js';

// Experimental only. Explicit coordinator eligibility is required, and no
// existing system role is automatically treated as an operational coordinator.
const coordinationRoutes: FastifyPluginAsync = async (app) => {
  const service = new CoordinationService(pool);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Request validation failed' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ requestId: req.id }, 'Coordination request failed');
    return reply.code(status).send({ error: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'ERROR', message: status >= 500 ? 'Internal server error' : 'Request failed' });
  });
  app.addHook('onSend', async (_req, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.get('/api/v1/coordination/notifications', { preHandler: auth }, async (req) => {
    const query = z.object({ after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict().parse(req.query);
    return service.notifications(req.user.id, query.after, query.limit);
  });
  app.post('/api/v1/coordination/notifications/:id/acknowledge', { preHandler: auth }, async (req) => service.acknowledgeNotification(req.user.id, parseId(req)));
  app.get('/api/v1/coordination/searches/:id', { preHandler: auth }, async (req) => service.state(req.user.id, parseId(req)));
  app.post('/api/v1/coordination/searches/:id/claim', { preHandler: auth }, async (req, reply) => {
    const result = await service.claim(req.user.id, parseId(req));
    return reply.code(result.claimed ? 200 : 409).send(result);
  });
  app.post('/api/v1/coordination/searches/:id/additional', { preHandler: auth }, async (req) => {
    const body = z.object({ userId: z.string().uuid() }).strict().parse(req.body);
    return service.addAdditional(req.user.id, parseId(req), body.userId);
  });
  app.post('/api/v1/coordination/searches/:id/transfer', { preHandler: auth }, async (req) => {
    const body = z.object({ userId: z.string().uuid(), retainPrevious: z.boolean(), reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    return service.proposeTransfer(req.user.id, parseId(req), body.userId, body.retainPrevious, body.reason);
  });
  app.get('/api/v1/coordination/searches/:id/transfer', { preHandler: auth }, async (req) => service.pendingForUser(req.user.id, parseId(req)));
  app.post('/api/v1/coordination/searches/:id/transfer/accept', { preHandler: auth }, async (req) => service.acceptTransfer(req.user.id, parseId(req)));
  app.post('/api/v1/coordination/searches/:id/transfer/decline', { preHandler: auth }, async (req) => service.declineTransfer(req.user.id, parseId(req)));
  app.post('/api/v1/coordination/searches/:id/transfer/cancel', { preHandler: auth }, async (req) => {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    return service.cancelTransfer(req.user.id, parseId(req), body.reason);
  });
};

export default coordinationRoutes;
