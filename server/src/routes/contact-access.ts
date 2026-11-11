import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { pool } from '../config.js';
import { auth, parseId } from '../http.js';
import { ContactAccessService } from '../contact-access/service.js';

const contactAccessRoutes: FastifyPluginAsync = async app => {
  const service = new ContactAccessService(pool);
  const reportId = (params: unknown) => z.object({reportId: z.string().uuid()}).passthrough().parse(params).reportId;
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'VALIDATION_ERROR' });
    const status = (err as {statusCode?: number}).statusCode ?? 500;
    if (status >= 500) req.log.error({requestId:req.id}, 'Contact access request failed');
    return reply.code(status).send({error: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'ERROR'});
  });
  app.addHook('onSend', async (_req,reply,payload) => { reply.header('Cache-Control','no-store'); return payload; });
  app.get('/api/v1/contact-access/searches/:id/audit', {preHandler:auth}, async req => {
    const query = z.object({
      before: z.string().refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().parse(req.query);
    return service.audit(req.user.id,parseId(req),query.before,query.limit);
  });
  const root = '/api/v1/contact-access/searches/:id/reports/:reportId';
  app.post(`${root}/grants`, {preHandler:auth}, async req => {
    const body = z.object({userId:z.string().uuid(),reason:z.string().trim().min(1).max(2000)}).strict().parse(req.body);
    return service.grant(req.user.id,parseId(req),reportId(req.params),body.userId,body.reason);
  });
  app.post(`${root}/revoke`, {preHandler:auth}, async req => {
    const body = z.object({userId:z.string().uuid()}).strict().parse(req.body);
    return service.revoke(req.user.id,parseId(req),reportId(req.params),body.userId);
  });
  app.get(`${root}/contact`, {preHandler:auth}, async req => service.read(req.user.id,parseId(req),reportId(req.params)));
};
export default contactAccessRoutes;
