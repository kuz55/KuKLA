import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { pool } from '../config.js';
import { auth, parseId } from '../http.js';
import { FieldLeadService } from '../field-lead/service.js';

const fieldLeadRoutes: FastifyPluginAsync = async app => {
  const service = new FieldLeadService(pool);
  // This is a best-effort development worker, not a delivery guarantee. Polls
  // do not overlap, and application shutdown waits for an in-flight batch.
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  app.addHook('onReady', async () => {
    timer = setInterval(() => {
      if (running) return;
      running = service.processOverdueReminders().then(() => undefined).catch(() => {
        app.log.error('Field lead reminder batch failed');
      }).finally(() => { running = undefined; });
    }, 30_000);
    timer.unref();
  });
  app.addHook('onClose', async () => { if (timer) clearInterval(timer); if (running) await running; });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    const status = (err as {statusCode?: number}).statusCode ?? 500;
    if (status >= 500) req.log.error({ requestId: req.id }, 'Field lead request failed');
    return reply.code(status).send({ error: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'ERROR' });
  });
  app.addHook('onSend', async (_req, reply, payload) => { reply.header('Cache-Control', 'no-store'); return payload; });
  app.get('/api/v1/field-lead/notifications', { preHandler: auth }, async req => {
    const query = z.object({ after: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(100) }).strict().parse(req.query);
    return service.notifications(req.user.id, query.after, query.limit);
  });
  app.post('/api/v1/field-lead/notifications/:id/acknowledge', { preHandler: auth }, async req => service.acknowledge(req.user.id, parseId(req)));
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
  app.post('/api/v1/field-lead/searches/:id/proposals/cancel', { preHandler: auth }, async req => {
    const body = z.object({ proposalId: z.string().uuid(), reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    return service.cancel(req.user.id, parseId(req), body.proposalId, body.reason);
  });
  app.post('/api/v1/field-lead/searches/:id/exceptional-removal', { preHandler: auth }, async req => {
    const body = z.object({ reason: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    return service.remove(req.user.id, parseId(req), body.reason);
  });
};
export default fieldLeadRoutes;
