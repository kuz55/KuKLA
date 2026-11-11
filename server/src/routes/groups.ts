import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { auth, parseId } from '../http.js';
import { pool } from '../config.js';
import { FieldGroupsService } from '../groups/service.js';

const groupsRoutes: FastifyPluginAsync = async app => {
  const service = new FieldGroupsService(pool);
  const groupId = (params: unknown) => z.object({groupId:z.string().uuid()}).passthrough().parse(params).groupId;
  const action = z.enum(['ADD','REMOVE']);
  app.setErrorHandler((err,req,reply) => {
    if (err instanceof ZodError) return reply.code(400).send({error:'VALIDATION_ERROR'});
    const status = (err as {statusCode?:number}).statusCode ?? 500;
    if (status >= 500) req.log.error({requestId:req.id},'Field group request failed');
    return reply.code(status).send({error:status===401?'UNAUTHORIZED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':status===409?'CONFLICT':'ERROR'});
  });
  app.addHook('onSend',async (_req,reply,payload) => {reply.header('Cache-Control','no-store'); return payload;});
  const root = '/api/v1/field-groups/searches/:id';
  app.get(`${root}/groups`,{preHandler:auth},async req => {
    const query=z.object({after:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict().parse(req.query);
    return service.list(req.user.id,parseId(req),query.after,query.limit);
  });
  app.post(`${root}/groups`,{preHandler:auth},async req => {
    const body = z.object({title:z.string().trim().min(2).max(200),candidateId:z.string().uuid()}).strict().parse(req.body);
    return service.create(req.user.id,parseId(req),body.title,body.candidateId);
  });
  app.get(`${root}/my-lead-proposals`,{preHandler:auth},async req => service.myProposals(req.user.id,parseId(req)));
  app.get(`${root}/groups/:groupId`,{preHandler:auth},async req => service.groupState(req.user.id,parseId(req),groupId(req.params)));
  app.get(`${root}/groups/:groupId/audit`,{preHandler:auth},async req => {
    const query=z.object({before:z.string().refine(v=>/^[1-9][0-9]{0,18}$/.test(v) && BigInt(v)<=9223372036854775807n).optional(),
      limit:z.coerce.number().int().min(1).max(100).default(50)}).strict().parse(req.query);
    return service.audit(req.user.id,parseId(req),groupId(req.params),query.before,query.limit);
  });
  app.post(`${root}/groups/:groupId/lead-proposals`,{preHandler:auth},async req => {
    const body=z.object({candidateId:z.string().uuid()}).strict().parse(req.body);
    return service.proposeLead(req.user.id,parseId(req),groupId(req.params),body.candidateId);
  });
  app.post(`${root}/groups/:groupId/lead-response`,{preHandler:auth},async req => {
    const body=z.object({proposalId:z.string().uuid(),accept:z.boolean()}).strict().parse(req.body);
    return service.respond(req.user.id,parseId(req),groupId(req.params),body.proposalId,body.accept);
  });
  app.post(`${root}/groups/:groupId/members/change`,{preHandler:auth},async req => {
    const body=z.object({userId:z.string().uuid(),action}).strict().parse(req.body);
    return service.apply(req.user.id,parseId(req),groupId(req.params),body.userId,body.action);
  });
  app.post(`${root}/groups/:groupId/member-proposals`,{preHandler:auth},async req => {
    const body=z.object({userId:z.string().uuid(),action}).strict().parse(req.body);
    return service.propose(req.user.id,parseId(req),groupId(req.params),body.userId,body.action);
  });
  app.post(`${root}/groups/:groupId/member-decision`,{preHandler:auth},async req => {
    const body=z.object({proposalId:z.string().uuid(),approve:z.boolean()}).strict().parse(req.body);
    return service.decide(req.user.id,parseId(req),groupId(req.params),body.proposalId,body.approve);
  });
};
export default groupsRoutes;
