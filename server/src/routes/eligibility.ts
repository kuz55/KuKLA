import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { auth, parseId } from '../http.js';
import { pool } from '../config.js';
import { EligibilityService } from '../eligibility/service.js';

const eligibilityRoutes: FastifyPluginAsync = async app => {
  const service = new EligibilityService(pool);
  const kind = z.enum(['COORDINATOR','FIELD_LEAD']);
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({error:'VALIDATION_ERROR'});
    const status = (err as {statusCode?:number}).statusCode ?? 500;
    if (status >= 500) req.log.error({requestId:req.id}, 'Eligibility request failed');
    return reply.code(status).send({error:status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 409 ? 'CONFLICT' : 'ERROR'});
  });
  app.addHook('onSend', async (_req,reply,payload) => { reply.header('Cache-Control','no-store'); return payload; });
  app.get('/api/v1/eligibility/users/:id', {preHandler:auth}, async req => service.status(req.user.id,parseId(req)));
  app.post('/api/v1/eligibility/users/:id/grant', {preHandler:auth}, async req => {
    const body = z.object({kind}).strict().parse(req.body);
    return service.grant(req.user.id,parseId(req),body.kind);
  });
  app.post('/api/v1/eligibility/users/:id/revoke', {preHandler:auth}, async req => {
    const body = z.object({kind}).strict().parse(req.body);
    return service.revoke(req.user.id,parseId(req),body.kind);
  });
};
export default eligibilityRoutes;
