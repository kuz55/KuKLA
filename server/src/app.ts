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
import wsRoutes from './routes/ws.js';
import intakeRoutes from './routes/intake.js';
import coordinationRoutes from './routes/coordination.js';
import fieldLeadRoutes from './routes/field-lead.js';
import searchClosureRoutes from './routes/search-closure.js';
import contactAccessRoutes from './routes/contact-access.js';
import eligibilityRoutes from './routes/eligibility.js';
import groupsRoutes from './routes/groups.js';

// Build a configured app without binding a port so tests can use Fastify.inject.
export async function buildApp() {
  const app = Fastify({
    logger: true,
    // Fastify's default request and 404 logs include the full URL and query.
    // Use route templates instead of user-controlled paths, query or headers.
    disableRequestLogging: true,
    trustProxy: TRUST_PROXY.length ? TRUST_PROXY : false,
  });

  app.addHook('onResponse', async (req, reply) => {
    req.log.info({ method: req.method, route: req.routeOptions.url ?? 'unmatched', statusCode: reply.statusCode, elapsedMs: reply.elapsedTime }, 'request completed');
  });
  app.setNotFoundHandler(async (_req, reply) => reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found' }));

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

  app.setErrorHandler((err, req, reply) => {
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

    const status = error.statusCode ?? 500;
    // Database and plugin errors can embed submitted values, SQL parameters,
    // URLs or credentials. Keep correlation and status, never the raw error.
    if (status >= 500) req.log.error({ requestId: req.id, statusCode: status }, 'Request failed');
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
  await app.register(wsRoutes);
  if (process.env.NODE_ENV !== 'production' && process.env.KUKLA_ENABLE_EXPERIMENTAL_INTAKE === 'true') {
    await app.register(intakeRoutes);
  }

  if (process.env.NODE_ENV !== 'production' && process.env.KUKLA_ENABLE_EXPERIMENTAL_COORDINATION === 'true') {
    await app.register(coordinationRoutes);
  }

  if (process.env.NODE_ENV !== 'production' && process.env.KUKLA_ENABLE_EXPERIMENTAL_FIELD_LEAD === 'true') {
    await app.register(fieldLeadRoutes);
  }

  if (process.env.NODE_ENV !== 'production' && process.env.KUKLA_ENABLE_EXPERIMENTAL_SEARCH_CLOSURE === 'true') {
    await app.register(searchClosureRoutes);
  }

  if (process.env.NODE_ENV !== 'production' && process.env.KUKLA_ENABLE_EXPERIMENTAL_CONTACT_ACCESS === 'true') {
    await app.register(contactAccessRoutes);
  }

  if (process.env.NODE_ENV !== 'production' && process.env.KUKLA_ENABLE_EXPERIMENTAL_ELIGIBILITY === 'true') {
    await app.register(eligibilityRoutes);
  }

  if (process.env.NODE_ENV !== 'production' && process.env.KUKLA_ENABLE_EXPERIMENTAL_GROUPS === 'true') {
    await app.register(groupsRoutes);
  }

  return app;
}
