import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { CORS_ORIGIN, JWT_SECRET, TRUST_PROXY, pool } from './config.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import searchRoutes from './routes/searches.js';
import taskRoutes from './routes/tasks.js';
import eventRoutes from './routes/events.js';
import gpsRoutes from './routes/gps.js';
import subjectRoutes from './routes/subjects.js';
import wsRoutes from './routes/ws.js';

// Build a configured app without binding a port so tests can use Fastify.inject.
export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: TRUST_PROXY.length ? TRUST_PROXY : false,
  });

  await app.register(cors, { origin: CORS_ORIGIN });
  await app.register(sensible);
  await app.register(jwt, { secret: JWT_SECRET });
  await app.register(websocket);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
  });

  app.get('/health', async () => ({
    ok: true,
    service: 'kukla-server',
    version: '2.1.0',
    time: new Date().toISOString(),
  }));
  app.get('/ready', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }

    const error = err as { validation?: unknown; statusCode?: number; message?: string };
    if (error.validation) {
      return reply.code(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message ?? 'Request validation failed',
      });
    }

    app.log.error(err);
    const status = error.statusCode ?? 500;
    return reply.code(status).send({
      error: status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'ERROR',
      message: status < 500 ? (error.message ?? 'Request failed') : 'Internal server error',
    });
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(searchRoutes);
  await app.register(taskRoutes);
  await app.register(eventRoutes);
  await app.register(gpsRoutes);
  await app.register(subjectRoutes);
  await app.register(wsRoutes);

  return app;
}
