import type { FastifyPluginAsync } from 'fastify';
import { z, ZodError } from 'zod';
import { auth, parseId } from '../http.js';
import { pool } from '../config.js';
import { FieldTasksService } from '../tasks/service.js';
import { TaskOverdueInbox } from '../tasks/overdue.js';

const tasksRoutes: FastifyPluginAsync = async app => {
  const service=new FieldTasksService(pool);
  const inbox=new TaskOverdueInbox(pool);
  // Optional best-effort worker; no device delivery or delivery guarantee.
  let timer:NodeJS.Timeout|undefined, running:Promise<void>|undefined;
  if (process.env.KUKLA_ENABLE_EXPERIMENTAL_TASK_REMINDERS === 'true') {
    app.addHook('onReady',async()=>{
      timer=setInterval(()=>{
        if (running) return;
        running=inbox.process().then(()=>undefined).catch(()=>{app.log.error('Task overdue batch failed');})
          .finally(()=>{running=undefined;});
      },30_000);
      timer.unref();
    });
    app.addHook('onClose',async()=>{if (timer) clearInterval(timer); if (running) await running;});
  }
  const root='/api/v1/field-tasks/searches/:id';
  const groupId=(params:unknown)=>z.object({groupId:z.string().uuid()}).passthrough().parse(params).groupId;
  const taskId=(params:unknown)=>z.object({taskId:z.string().uuid()}).passthrough().parse(params).taskId;
  const page=z.object({after:z.string().uuid().optional(),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict();
  app.setErrorHandler((err,req,reply) => {
    if (err instanceof ZodError) return reply.code(400).send({error:'VALIDATION_ERROR'});
    const status=(err as {statusCode?:number}).statusCode ?? 500;
    if (status>=500) req.log.error({requestId:req.id},'Field task request failed');
    return reply.code(status).send({error:status===401?'UNAUTHORIZED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':status===409?'CONFLICT':'ERROR'});
  });
  app.addHook('onSend',async (_req,reply,payload)=>{reply.header('Cache-Control','no-store'); return payload;});
  app.get('/api/v1/field-tasks/notifications',{preHandler:auth},async req=>{
    const q=page.parse(req.query); return inbox.list(req.user.id,q.after,q.limit);
  });
  app.post('/api/v1/field-tasks/notifications/:id/acknowledge',{preHandler:auth},async req=>inbox.acknowledge(req.user.id,parseId(req)));
  app.post(`${root}/groups/:groupId/tasks`,{preHandler:auth},async req=>{
    const body=z.object({description:z.string().trim().min(1).max(4000),priority:z.enum(['NORMAL','HIGH','URGENT']),
      dueAt:z.iso.datetime({offset:true}).refine(v=>!v.startsWith('0000-') && Number.isFinite(Date.parse(v)))}).strict().parse(req.body);
    return service.create(req.user.id,parseId(req),groupId(req.params),body.description,body.dueAt,body.priority);
  });
  app.get(`${root}/groups/:groupId/tasks`,{preHandler:auth},async req=>{
    const q=page.parse(req.query); return service.list(req.user.id,parseId(req),groupId(req.params),q.after,q.limit);
  });
  app.get(`${root}/tasks/:taskId/results`,{preHandler:auth},async req=>{
    const q=page.parse(req.query); return service.results(req.user.id,parseId(req),taskId(req.params),q.after,q.limit);
  });
  app.post(`${root}/tasks/:taskId/accept`,{preHandler:auth},async req=>service.accept(req.user.id,parseId(req),taskId(req.params)));
  app.post(`${root}/tasks/:taskId/results`,{preHandler:auth},async req=>{
    const body=z.object({result:z.string().trim().min(1).max(4000)}).strict().parse(req.body);
    return service.submit(req.user.id,parseId(req),taskId(req.params),body.result);
  });
  app.post(`${root}/tasks/:taskId/decision`,{preHandler:auth},async req=>{
    const body=z.discriminatedUnion('approve',[
      z.object({resultId:z.string().uuid(),approve:z.literal(true)}).strict(),
      z.object({resultId:z.string().uuid(),approve:z.literal(false),reason:z.string().trim().min(1).max(2000)}).strict(),
    ]).parse(req.body);
    return service.decide(req.user.id,parseId(req),taskId(req.params),body.resultId,body.approve,body.approve?undefined:body.reason);
  });
};
export default tasksRoutes;
