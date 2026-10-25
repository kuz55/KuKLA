import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { Role } from './rbac.js';

type VkUserInfo = {
  user?: {
    user_id?: string | number;
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
};

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const base64url = (value: Buffer) => value.toString('base64url');
const equal = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function registerVkIdAuth(app: FastifyInstance, pool: Pool) {
  const clientId = process.env.VK_ID_CLIENT_ID?.trim();
  const redirectUri = process.env.VK_ID_REDIRECT_URI?.trim();
  const enabled = Boolean(clientId && redirectUri);

  app.post('/api/v1/auth/vk/start', async (_req, reply) => {
    if (!enabled) return reply.code(503).send({ error: 'VK_ID_NOT_CONFIGURED', message: 'Вход через VK ID пока не настроен' });

    const state = base64url(randomBytes(32));
    const pollSecret = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const created = await pool.query(
      `INSERT INTO vk_auth_requests(state_hash,poll_secret_hash,code_verifier)
       VALUES($1,$2,$3) RETURNING id`,
      [hash(state), hash(pollSecret), verifier],
    );

    const authorize = new URL('https://id.vk.ru/authorize');
    authorize.search = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri!,
      response_type: 'code',
      state,
      code_challenge: challenge,
      code_challenge_method: 's256',
    }).toString();

    return reply.send({ requestId: created.rows[0].id, pollSecret, authorizationUrl: authorize.toString(), expiresIn: 600 });
  });

  app.get('/api/v1/auth/vk/callback', async (req, reply) => {
    if (!enabled) return reply.code(503).type('text/plain').send('Вход через VK ID не настроен.');
    const query = z.object({
      code: z.string().min(1).max(4096).optional(),
      state: z.string().min(20).max(256),
      device_id: z.string().min(1).max(256).optional(),
      error: z.string().max(256).optional(),
    }).safeParse(req.query);
    if (!query.success) return reply.code(400).type('text/plain').send('Не удалось завершить вход. Вернитесь в KuKLA и повторите попытку.');

    const client = await pool.connect();
    let requestId: string | undefined;
    let verifier: string | undefined;
    try {
      await client.query('BEGIN');
      const found = await client.query(
        `SELECT id,code_verifier FROM vk_auth_requests
         WHERE state_hash=$1 AND status='pending' AND expires_at>now()
         FOR UPDATE`,
        [hash(query.data.state)],
      );
      if (!found.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(400).type('text/plain').send('Ссылка входа истекла или уже использована. Вернитесь в KuKLA.');
      }
      requestId = found.rows[0].id;
      verifier = found.rows[0].code_verifier;
      await client.query("UPDATE vk_auth_requests SET status='consumed' WHERE id=$1", [requestId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      if (query.data.error || !query.data.code || !query.data.device_id) throw new Error('VK authorization was not completed');
      const tokenUrl = new URL('https://id.vk.ru/oauth2/auth');
      tokenUrl.search = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId!,
        redirect_uri: redirectUri!,
        code_verifier: verifier!,
        state: query.data.state,
        device_id: query.data.device_id,
      }).toString();
      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: query.data.code }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!tokenResponse.ok) throw new Error('VK token exchange failed');
      const tokens = await tokenResponse.json() as { access_token?: string; state?: string; user_id?: string | number };
      if (!tokens.access_token || !tokens.state || !equal(tokens.state, query.data.state) || tokens.user_id == null) {
        throw new Error('VK token response did not pass validation');
      }

      const infoUrl = new URL('https://id.vk.ru/oauth2/user_info');
      infoUrl.searchParams.set('client_id', clientId!);
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

      const name = [info.user?.first_name, info.user?.last_name].filter(Boolean).join(' ').trim() || `VK ID ${subject}`;
      const db = await pool.connect();
      let sessionUser: { id: string; name: string; email?: string; phone?: string; role: Role };
      try {
        await db.query('BEGIN');
        const linked = await db.query(
          `SELECT u.id,u.name,u.email,u.phone,u.role,u.active
           FROM auth_identities i JOIN users u ON u.id=i.user_id
           WHERE i.provider='vk_id' AND i.subject=$1 FOR UPDATE OF u`,
          [subject],
        );
        if (linked.rowCount) {
          if (!linked.rows[0].active) throw new Error('This KuKLA account is disabled');
          sessionUser = linked.rows[0] as typeof sessionUser;
        } else {
          // Never auto-link an existing account by a provider-supplied email or phone.
          const passwordHash = await bcrypt.hash(randomBytes(48).toString('base64url'), 12);
          const created = await db.query(
            `INSERT INTO users(name,password_hash,role,active)
             VALUES($1,$2,'SEARCHER',true) RETURNING id,name,email,phone,role`,
            [name, passwordHash],
          );
          sessionUser = created.rows[0] as typeof sessionUser;
          await db.query("INSERT INTO auth_identities(user_id,provider,subject) VALUES($1,'vk_id',$2)", [sessionUser.id, subject]);
        }
        const token = app.jwt.sign(
          { id: sessionUser.id, name: sessionUser.name, email: sessionUser.email, phone: sessionUser.phone, role: sessionUser.role },
          { expiresIn: '12h' },
        );
        await db.query(
          "INSERT INTO sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '12 hours')",
          [sessionUser.id, hash(token)],
        );
        await db.query(
          `UPDATE vk_auth_requests SET status='complete',result_token=$2,result_user=$3::jsonb,completed_at=now()
           WHERE id=$1 AND status='consumed'`,
          [requestId, token, JSON.stringify(sessionUser)],
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
      if (requestId) await pool.query("UPDATE vk_auth_requests SET status='failed',result_token=NULL,result_user=NULL WHERE id=$1", [requestId]);
      return reply.code(400).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>KuKLA</title><p>Не удалось войти через VK ID. Вернитесь в KuKLA и повторите попытку.</p>');
    }
  });

  app.post('/api/v1/auth/vk/poll', async (req, reply) => {
    const body = z.object({ requestId: z.string().uuid(), pollSecret: z.string().min(32).max(256) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Некорректный запрос входа' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `SELECT status,result_token,result_user FROM vk_auth_requests
         WHERE id=$1 AND poll_secret_hash=$2 AND expires_at>now()
         FOR UPDATE`,
        [body.data.requestId, hash(body.data.pollSecret)],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'AUTH_REQUEST_EXPIRED', message: 'Запрос входа не найден или истёк' });
      }
      const row = result.rows[0];
      if (row.status === 'pending' || row.status === 'consumed') {
        await client.query('COMMIT');
        return reply.send({ status: 'pending' });
      }
      if (row.status === 'failed') {
        await client.query("DELETE FROM vk_auth_requests WHERE id=$1", [body.data.requestId]);
        await client.query('COMMIT');
        return reply.send({ status: 'failed' });
      }
      await client.query("UPDATE vk_auth_requests SET status='consumed',result_token=NULL,result_user=NULL WHERE id=$1", [body.data.requestId]);
      await client.query('COMMIT');
      return reply.send({ status: 'complete', token: row.result_token, user: row.result_user });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
}
