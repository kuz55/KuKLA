import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { allowVkRegistration, pool, vkIdClientId, vkIdRedirectUri } from '../config.js';
import { auth } from '../http.js';
import type { Role } from '../rbac.js';

const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const base64url = (value: Buffer) => value.toString('base64url');
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

type VkUserInfo = { user?: { user_id?: string | number; first_name?: string; last_name?: string } };

const vkIdRoutes: FastifyPluginAsync = async (app) => {
  const configured = Boolean(vkIdClientId && vkIdRedirectUri);

  app.post('/api/v1/auth/vk/start', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (_req, reply) => {
    if (!configured) return reply.code(503).send({ error: 'VK_ID_NOT_CONFIGURED', message: 'Вход через VK ID пока не настроен' });

    const state = base64url(crypto.randomBytes(32));
    const pollSecret = base64url(crypto.randomBytes(32));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const created = await pool.query(
      `INSERT INTO vk_auth_requests(state_hash,poll_secret_hash,code_verifier)
       VALUES($1,$2,$3) RETURNING id`,
      [digest(state), digest(pollSecret), verifier],
    );

    const authorize = new URL('https://id.vk.ru/authorize');
    authorize.search = new URLSearchParams({
      client_id: vkIdClientId,
      redirect_uri: vkIdRedirectUri,
      response_type: 'code',
      state,
      code_challenge: challenge,
      code_challenge_method: 's256',
    }).toString();
    return { requestId: created.rows[0].id, pollSecret, authorizationUrl: authorize.toString(), expiresIn: 600 };
  });

  app.post('/api/v1/auth/vk/link/start', { preHandler: auth, config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (!configured) return reply.code(503).send({ error: 'VK_ID_NOT_CONFIGURED', message: 'Вход через VK ID пока не настроен' });
    const state = base64url(crypto.randomBytes(32));
    const pollSecret = base64url(crypto.randomBytes(32));
    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const created = await pool.query(
      `INSERT INTO vk_auth_requests(state_hash,poll_secret_hash,code_verifier,requested_user_id)
       VALUES($1,$2,$3,$4) RETURNING id`,
      [digest(state), digest(pollSecret), verifier, req.user.id],
    );
    const authorize = new URL('https://id.vk.ru/authorize');
    authorize.search = new URLSearchParams({ client_id: vkIdClientId, redirect_uri: vkIdRedirectUri,
      response_type: 'code', state, code_challenge: challenge, code_challenge_method: 's256' }).toString();
    return { requestId: created.rows[0].id, pollSecret, authorizationUrl: authorize.toString(), expiresIn: 600 };
  });

  app.get('/api/v1/auth/vk/callback', async (req, reply) => {
    if (!configured) return reply.code(503).type('text/plain').send('Вход через VK ID не настроен.');
    const parsed = z.object({
      code: z.string().min(1).max(4096).optional(),
      state: z.string().min(20).max(256),
      device_id: z.string().min(1).max(256).optional(),
      error: z.string().max(256).optional(),
    }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).type('text/plain').send('Не удалось завершить вход. Вернитесь в KuKLA и повторите попытку.');

    const client = await pool.connect();
    let requestId: string | undefined;
    let verifier: string | undefined;
    let requestedUserId: string | null = null;
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id,code_verifier,requested_user_id FROM vk_auth_requests
         WHERE state_hash=$1 AND status='pending' AND expires_at>now() FOR UPDATE`,
        [digest(parsed.data.state)],
      );
      if (!found.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(400).type('text/plain').send('Ссылка входа истекла или уже использована. Вернитесь в KuKLA.');
      }
      requestId = found.rows[0].id as string;
      verifier = found.rows[0].code_verifier as string;
      requestedUserId = found.rows[0].requested_user_id as string | null;
      await client.query("UPDATE vk_auth_requests SET status='consumed' WHERE id=$1", [requestId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      if (parsed.data.error || !parsed.data.code || !parsed.data.device_id) throw new Error('VK authorization was not completed');
      const tokenUrl = new URL('https://id.vk.ru/oauth2/auth');
      tokenUrl.search = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: vkIdClientId,
        redirect_uri: vkIdRedirectUri,
        code_verifier: verifier!,
        state: parsed.data.state,
        device_id: parsed.data.device_id,
      }).toString();
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: parsed.data.code }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!tokenResponse.ok) throw new Error('VK token exchange failed');
      const tokens = await tokenResponse.json() as { access_token?: string; state?: string; user_id?: string | number };
      if (!tokens.access_token || !tokens.state || !safeEqual(tokens.state, parsed.data.state) || tokens.user_id == null) {
        throw new Error('VK token response did not pass validation');
      }

      const infoUrl = new URL('https://id.vk.ru/oauth2/user_info');
      infoUrl.searchParams.set('client_id', vkIdClientId);
      const infoResponse = await fetch(infoUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: tokens.access_token }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!infoResponse.ok) throw new Error('VK profile lookup failed');
      const info = await infoResponse.json() as VkUserInfo;
      const subject = String(info.user?.user_id ?? tokens.user_id);
      if (!subject || subject !== String(tokens.user_id)) throw new Error('VK profile identifier mismatch');

      const displayName = [info.user?.first_name, info.user?.last_name].filter(Boolean).join(' ').trim() || `VK ID ${subject}`;
      const db = await pool.connect();
      try {
        await db.query('BEGIN');
        let user = await db.query(
          `SELECT u.id,u.name,u.email,u.phone,u.role,u.active
           FROM auth_identities i JOIN users u ON u.id=i.user_id
           WHERE i.provider='vk_id' AND i.subject=$1 FOR UPDATE OF u`,
          [subject],
        );
        let sessionUser: { id: string; name: string; email?: string; phone?: string; role: Role };
        if (user.rowCount) {
          if (requestedUserId && user.rows[0].id !== requestedUserId) throw new Error('Этот VK ID уже привязан к другой учётной записи KuKLA');
          if (!user.rows[0].active) throw new Error('KuKLA account is disabled');
          sessionUser = user.rows[0] as typeof sessionUser;
        } else if (requestedUserId) {
          user = await db.query('SELECT id,name,email,phone,role,active FROM users WHERE id=$1 FOR UPDATE', [requestedUserId]);
          if (!user.rowCount || !user.rows[0].active) throw new Error('KuKLA account is disabled or no longer exists');
          sessionUser = user.rows[0] as typeof sessionUser;
          await db.query("INSERT INTO auth_identities(user_id,provider,subject) VALUES($1,'vk_id',$2)", [sessionUser.id, subject]);
        } else {
          if (!allowVkRegistration) throw new Error('VK ID registration is disabled');
          // Provider email/phone are deliberately ignored; identity is never auto-linked by contact details.
          const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 12);
          user = await db.query(
            `INSERT INTO users(name,password_hash,role,active)
             VALUES($1,$2,'SEARCHER',true) RETURNING id,name,email,phone,role`,
            [displayName, passwordHash],
          );
          sessionUser = user.rows[0] as typeof sessionUser;
          await db.query("INSERT INTO auth_identities(user_id,provider,subject) VALUES($1,'vk_id',$2)", [sessionUser.id, subject]);
        }
        await db.query(
          `UPDATE vk_auth_requests SET status='complete',result_user=$2::jsonb,completed_at=now()
           WHERE id=$1 AND status='consumed'`,
          [requestId, JSON.stringify(sessionUser)],
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      } finally {
        db.release();
      }
      return reply.type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>KuKLA</title><p>Вход выполнен. Вернитесь в приложение KuKLA.</p>');
    } catch (error) {
      app.log.warn({ err: error, requestId }, 'VK ID authorization failed');
      if (requestId) await pool.query("UPDATE vk_auth_requests SET status='failed',result_user=NULL WHERE id=$1", [requestId]);
      return reply.code(400).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>KuKLA</title><p>Не удалось войти через VK ID. Вернитесь в KuKLA и повторите попытку.</p>');
    }
  });

  app.post('/api/v1/auth/vk/poll', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ requestId: z.string().uuid(), pollSecret: z.string().min(32).max(256) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Некорректный запрос входа' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT status,result_user FROM vk_auth_requests
         WHERE id=$1 AND poll_secret_hash=$2 AND expires_at>now() FOR UPDATE`,
        [parsed.data.requestId, digest(parsed.data.pollSecret)],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'AUTH_REQUEST_EXPIRED', message: 'Запрос входа не найден или истёк' });
      }
      const row = result.rows[0] as { status: string; result_user: { id: string; name: string; email?: string; phone?: string; role: Role } | null };
      if (row.status === 'pending' || row.status === 'consumed') {
        await client.query('COMMIT');
        return { status: 'pending' };
      }
      if (row.status !== 'complete' || !row.result_user) {
        await client.query("DELETE FROM vk_auth_requests WHERE id=$1", [parsed.data.requestId]);
        await client.query('COMMIT');
        return { status: 'failed' };
      }
      const user = row.result_user;
      const token = app.jwt.sign(user, { expiresIn: '12h' });
      await client.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '12 hours')", [user.id, digest(token)]);
      await client.query("UPDATE vk_auth_requests SET status='consumed',result_user=NULL WHERE id=$1", [parsed.data.requestId]);
      await client.query('COMMIT');
      return { status: 'complete', token, user };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default vkIdRoutes;
