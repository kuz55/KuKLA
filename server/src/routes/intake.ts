import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { auth, parseId } from '../http.js';
import { pool } from '../config.js';
import { IntakeService } from '../intake/service.js';

// Not registered unless explicitly enabled. No permissions are granted by
// default, even to existing administrators or coordinators.
const intakeRoutes: FastifyPluginAsync = async (app) => {
  const intake = new IntakeService(pool);
  // Database errors can contain row values. Never log or reflect them on this
  // PII-bearing route; report only a request ID for operational correlation.
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR', message: 'Request validation failed' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ requestId: req.id }, 'Intake request failed');
    return reply.code(status).send({ error: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'ERROR', message: status >= 500 ? 'Internal server error' : 'Request failed' });
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.post('/api/v1/intake/reports', { preHandler: auth }, async (req, reply) => {
    const key = z.string().uuid().parse(req.headers['idempotency-key']);
    const result = await intake.create(req.user.id, req.body, key);
    return reply.code(201).send(result);
  });
  app.post('/api/v1/intake/reports/:id/handoff', { preHandler: auth }, async (req) =>
    intake.handOff(req.user.id, parseId(req)));
  app.get('/api/v1/intake/queue', { preHandler: auth }, async (req) => {
    const query = z.object({ after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict().parse(req.query);
    return intake.queue(req.user.id, query.after, query.limit);
  });
  app.get('/api/v1/intake/my-reports/:id', { preHandler: auth }, async (req) =>
    intake.getForOperator(req.user.id, parseId(req)));
  app.get('/api/v1/intake/searches/:id/reports', { preHandler: auth }, async (req) => {
    const query = z.object({ after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict().parse(req.query);
    return intake.reportsForCoordinator(req.user.id, parseId(req), query.after, query.limit);
  });
  app.get('/api/v1/intake/reports/:id', { preHandler: auth }, async (req) =>
    intake.getForRegistrar(req.user.id, parseId(req)));
  app.post('/api/v1/intake/reports/:id/link-search', { preHandler: auth }, async (req) => {
    const body = z.object({ searchId: z.string().uuid() }).strict().parse(req.body);
    return intake.linkExisting(req.user, parseId(req), body.searchId);
  });
  app.post('/api/v1/intake/reports/:id/create-search', { preHandler: auth }, async (req, reply) => {
    const body = z.object({ title: z.string().trim().min(2).max(200) }).strict().parse(req.body);
    return reply.code(201).send(await intake.createSearch(req.user.id, parseId(req), body.title));
  });
  app.post('/api/v1/intake/reports/:id/close', { preHandler: auth }, async (req) => {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    return intake.closeWithoutSearch(req.user.id, parseId(req), body.reason);
  });
};

export default intakeRoutes;
