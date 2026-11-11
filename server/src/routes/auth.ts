import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { allowPublicRegistration, loginRateLimit, pool } from '../config.js';
import { auth } from '../http.js';
import { canAssignRole, Role } from '../rbac.js';
import { User } from '../types.js';

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const publicUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
});

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/auth/login', {
    config: { rateLimit: { max: loginRateLimit, timeWindow: '1 minute' } },
  }, async (req) => {
    const body = z.object({ login: z.string().trim().min(1), password: z.string().min(1) }).parse(req.body);
    const result = await pool.query(
      `SELECT id,name,email,phone,role,password_hash,active
       FROM users WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1`,
      [body.login],
    );
    if (!result.rowCount || !result.rows[0].active || !(await bcrypt.compare(body.password, result.rows[0].password_hash))) {
      throw httpErrors.unauthorized('Invalid credentials');
    }

    const user = result.rows[0] as User & { password_hash: string };
    const token = app.jwt.sign({ ...publicUser(user), jti: crypto.randomUUID() }, { expiresIn: '12h' });
    await pool.query(
      `INSERT INTO sessions(user_id,token_hash,expires_at)
       VALUES($1,$2,now()+interval '12 hours')`,
      [user.id, sha256(token)],
    );
    return { token, user: publicUser(user) };
  });

  app.post('/api/v1/auth/accept-invitation', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const body = z.object({
      token: z.string().min(32).max(256),
      password: z.string().min(12).max(128),
    }).parse(req.body);
    const tokenHash = sha256(body.token);
    const preview = await pool.query(
      `SELECT id FROM user_invitations
       WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()`,
      [tokenHash],
    );
    if (!preview.rowCount) throw httpErrors.badRequest('Invitation is invalid or expired');

    // Hash outside the transaction to avoid holding database locks during bcrypt.
    const passwordHash = await bcrypt.hash(body.password, 12);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const invitationResult = await client.query(
        `SELECT id,name,email,phone,role,invited_by
         FROM user_invitations
         WHERE token_hash=$1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()
         FOR UPDATE`,
        [tokenHash],
      );
      if (!invitationResult.rowCount) throw httpErrors.badRequest('Invitation is invalid or expired');
      const invitation = invitationResult.rows[0] as {
        id: string; name: string; email: string | null; phone: string | null; role: Role; invited_by: string;
      };

      const contactKey = invitation.email ? `email:${invitation.email.toLowerCase()}` : `phone:${invitation.phone}`;
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [contactKey]);
      const inviter = await client.query('SELECT role FROM users WHERE id=$1 AND active=true FOR SHARE', [invitation.invited_by]);
      if (!inviter.rowCount || !canAssignRole(inviter.rows[0].role as Role, invitation.role)) {
        throw httpErrors.badRequest('Invitation is no longer valid');
      }

      const existing = await client.query(
        `SELECT 1 FROM users
         WHERE ($1::text IS NOT NULL AND lower(email)=lower($1))
            OR ($2::text IS NOT NULL AND phone=$2)
         LIMIT 1`,
        [invitation.email, invitation.phone],
      );
      if (existing.rowCount) throw httpErrors.conflict('An account already exists for this contact');

      const created = await client.query(
        `INSERT INTO users(name,email,phone,password_hash,role)
         VALUES($1,$2,$3,$4,$5)
         RETURNING id,name,email,phone,role`,
        [invitation.name, invitation.email, invitation.phone, passwordHash, invitation.role],
      );
      const user = created.rows[0] as User;
      await client.query(
        'UPDATE user_invitations SET accepted_at=now(),accepted_user_id=$1 WHERE id=$2',
        [user.id, invitation.id],
      );
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES(NULL,$1,$2,$3)',
        [user.id, 'USER_INVITATION_ACCEPTED', { invitationId: invitation.id }],
      );

      const sessionToken = app.jwt.sign({ ...publicUser(user), jti: crypto.randomUUID() }, { expiresIn: '12h' });
      await client.query(
        `INSERT INTO sessions(user_id,token_hash,expires_at)
         VALUES($1,$2,now()+interval '12 hours')`,
        [user.id, sha256(sessionToken)],
      );
      await client.query('COMMIT');
      return { token: sessionToken, user: publicUser(user) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/auth/register', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    if (!allowPublicRegistration) throw httpErrors.forbidden('Public registration is disabled');
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email(),
      phone: z.string().trim().optional(),
      password: z.string().min(12).max(128),
    }).parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 12);
    try {
      const result = await pool.query(
        `INSERT INTO users(name,email,phone,password_hash,role)
         VALUES($1,$2,$3,$4,'SEARCHER')
         RETURNING id,name,email,phone,role,active`,
        [body.name, body.email.toLowerCase(), body.phone ?? null, passwordHash],
      );
      return result.rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw httpErrors.conflict('User already exists');
      throw error;
    }
  });

  app.post('/api/v1/auth/logout', { preHandler: auth }, async (req) => {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [sha256(req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '')]);
    return { ok: true };
  });

  app.get('/api/v1/me', { preHandler: auth }, async (req) => req.user);
};

export default authRoutes;
