import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { CORS_ORIGIN, JWT_SECRET, pool } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import searchRoutes from './routes/searches.js';
import taskRoutes from './routes/tasks.js';
import eventRoutes from './routes/events.js';
import gpsRoutes from './routes/gps.js';
import wsRoutes from './routes/ws.js';

// Собирает полностью сконфигурированное приложение, не занимая порт, чтобы
// тесты и инструменты могли импортировать его и поднять на своём listener.
export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(sensible);
  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(websocket);
  // Общий мягкий лимит на всё приложение: защита от исчерпания пула соединений
  // и от зафлуживания логов. Жёсткие лимиты на auth-эндпоинты — в routes/auth.
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  app.get('/health', async () => ({ ok:true, service:'kukla-server', version:'2.1.0', time:new Date().toISOString() }));
  app.get('/ready', async (_req, reply) => { try { await pool.query('SELECT 1'); return {ok:true}; } catch { return reply.code(503).send({ok:false}); } });

  // Регистрируется до роутов: плагины наследуют обработчик родителя на момент
  // регистрации, иначе ответы об ошибках вернулись бы к дефолтному формату.
  app.setErrorHandler((err,_req,reply)=>{const error=err as {validation?:unknown;statusCode?:number;message?:string};app.log.error(err);if(error.validation)return reply.code(400).send({error:'VALIDATION_ERROR',message:error.message??'Validation error'});const status=error.statusCode??500;return reply.code(status).send({error:status===401?'UNAUTHORIZED':status===403?'FORBIDDEN':status===404?'NOT_FOUND':'ERROR',message:status<500?(error.message??'Request failed'):'Internal server error'});});

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(searchRoutes);
  await app.register(taskRoutes);
  await app.register(eventRoutes);
  await app.register(gpsRoutes);
  await app.register(wsRoutes);

  return app;
}