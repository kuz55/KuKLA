import { FastifyPluginAsync } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import crypto from 'node:crypto';
import { z } from 'zod';
import { adminRoles, managementRoles, privilegedRoles, Role, canManageUser, canAssignRole } from '../rbac.js';
import { pool } from '../config.js';
import { parseId, roles } from '../http.js';

const invitationRole = z.enum(['SUPERADMIN', 'SUPERUSER', 'ADMIN', 'LEADER', 'COORDINATOR', 'SEARCHER', 'VIEWER']);
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const userRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/users', { preHandler: roles(...managementRoles) }, async (req) => {
    if (privilegedRoles.includes(req.user.role) || adminRoles.includes(req.user.role)) {
      return (await pool.query('SELECT id,name,email,phone,role,active,created_at FROM users ORDER BY name')).rows;
    }
    return (await pool.query(
      `SELECT DISTINCT u.id,u.name,u.email,u.phone,u.role,u.active,u.created_at
       FROM users u JOIN search_members sm ON sm.user_id=u.id
       JOIN search_members mine ON mine.search_id=sm.search_id
       WHERE mine.user_id=$1 ORDER BY u.name`,
      [req.user.id],
    )).rows;
  });

  app.get('/api/v1/users/invitations', { preHandler: roles(...adminRoles) }, async () => {
    return (await pool.query(
      `SELECT id,name,email,phone,role,invited_by,expires_at,accepted_at,accepted_user_id,revoked_at,created_at
       FROM user_invitations ORDER BY created_at DESC LIMIT 500`,
    )).rows;
  });

  app.post('/api/v1/users/invitations', {
    preHandler: roles(...adminRoles),
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req) => {
    const body = z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().optional(),
      phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional(),
      role: invitationRole,
    }).refine((value) => Boolean(value.email) !== Boolean(value.phone), {
      message: 'Provide exactly one contact: email or E.164 phone number',
    }).parse(req.body);

    if (!canAssignRole(req.user.role, body.role)) {
      throw httpErrors.forbidden('Insufficient permissions to invite a user with this role');
    }

    const email = body.email?.toLowerCase() ?? null;
    const phone = body.phone ?? null;
    const contactKey = email ? `email:${email}` : `phone:${phone}`;
    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const inviter = await client.query(
        'SELECT role FROM users WHERE id=$1 AND active=true FOR SHARE',
        [req.user.id],
      );
      if (!inviter.rowCount || !canAssignRole(inviter.rows[0].role as Role, body.role)) {
        throw httpErrors.forbidden('Insufficient permissions to invite a user with this role');
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [contactKey]);
      const existing = await client.query(
        `SELECT 1 FROM users
         WHERE ($1::text IS NOT NULL AND lower(email)=lower($1))
            OR ($2::text IS NOT NULL AND phone=$2)
         UNION ALL
         SELECT 1 FROM user_invitations
         WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now()
           AND (($1::text IS NOT NULL AND lower(email)=lower($1)) OR ($2::text IS NOT NULL AND phone=$2))
         LIMIT 1`,
        [email, phone],
      );
      if (existing.rowCount) throw httpErrors.conflict('A user or active invitation already exists for this contact');

      const result = await client.query(
        `INSERT INTO user_invitations(name,email,phone,role,token_hash,invited_by,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours')
         RETURNING id,name,email,phone,role,expires_at,created_at`,
        [body.name, email, phone, body.role, tokenHash, req.user.id],
      );
      const invitation = result.rows[0];
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES(NULL,$1,$2,$3)',
        [req.user.id, 'USER_INVITED', { invitationId: invitation.id, role: body.role }],
      );
      await client.query('COMMIT');
      // The raw token is shown exactly once. The caller must deliver it to the
      // invitee over a trusted channel; only its hash is retained in the DB.
      return { ...invitation, token };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.delete('/api/v1/users/invitations/:id', { preHandler: roles(...adminRoles) }, async (req) => {
    const id = parseId(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await client.query(
        'SELECT role FROM users WHERE id=$1 AND active=true FOR SHARE',
        [req.user.id],
      );
      if (!actor.rowCount || !adminRoles.includes(actor.rows[0].role as Role)) {
        throw httpErrors.forbidden('Insufficient permissions to revoke invitations');
      }
      const result = await client.query(
        `UPDATE user_invitations SET revoked_at=now()
         WHERE id=$1 AND accepted_at IS NULL AND revoked_at IS NULL
         RETURNING id,role`,
        [id],
      );
      if (!result.rowCount) throw httpErrors.notFound('Pending invitation not found');
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES(NULL,$1,$2,$3)',
        [req.user.id, 'USER_INVITATION_REVOKED', { invitationId: id, role: result.rows[0].role }],
      );
      await client.query('COMMIT');
      return { ok: true };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.patch('/api/v1/users/:id', { preHandler: roles(...adminRoles) }, async (req) => {
    const id = parseId(req);
    const body = z.object({
      name: z.string().trim().min(2).max(120).optional(),
      role: z.enum(['SYSTEM_OWNER', 'SUPERADMIN', 'SUPERUSER', 'ADMIN', 'LEADER', 'COORDINATOR', 'SEARCHER', 'VIEWER']).optional(),
      active: z.boolean().optional(),
      phone: z.string().trim().optional(),
    }).refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' }).parse(req.body);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock actor and target together in a stable order. Re-read roles under lock so
      // a concurrent demotion/deactivation cannot rely on stale preHandler claims.
      const locked = await client.query(
        `SELECT id,role,active FROM users
         WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [[req.user.id, id]],
      );
      const actor = locked.rows.find((user) => user.id === req.user.id) as
        { id: string; role: Role; active: boolean } | undefined;
      const current = locked.rows.find((user) => user.id === id) as
        { id: string; role: Role; active: boolean } | undefined;

      if (!actor || !actor.active || !adminRoles.includes(actor.role)) {
        throw httpErrors.forbidden('Insufficient permissions to modify users');
      }
      if (!current) throw httpErrors.notFound('User not found');
      const actorRole = actor.role;
      const currentRole = current.role;

      if (!canManageUser(actorRole, currentRole)) {
        throw httpErrors.forbidden('Insufficient permissions to modify this user');
      }
      if (body.role !== undefined && !canAssignRole(actorRole, body.role)) {
        throw httpErrors.forbidden('Insufficient permissions to assign this role');
      }
      if (id === actor.id && body.active === false) {
        throw httpErrors.badRequest('You cannot deactivate yourself');
      }
      if (id === actor.id && body.role !== undefined && body.role !== actorRole) {
        throw httpErrors.badRequest('You cannot change your own role');
      }
      if (currentRole === 'SYSTEM_OWNER' && (body.active === false || (body.role !== undefined && body.role !== 'SYSTEM_OWNER'))) {
        throw httpErrors.badRequest('SYSTEM_OWNER cannot be deactivated or demoted through the user API');
      }
      if (body.role === 'SYSTEM_OWNER' && currentRole !== 'SYSTEM_OWNER') {
        throw httpErrors.forbidden('SYSTEM_OWNER can only be established by the secure bootstrap process');
      }

      if (currentRole === 'ADMIN' && body.active === false) {
        const administrators = await client.query(
          `SELECT count(*)::int AS count FROM users
           WHERE role IN ('SYSTEM_OWNER','SUPERADMIN','SUPERUSER','ADMIN') AND active = true AND id <> $1`,
          [id],
        );
        if (administrators.rows[0].count === 0) {
          throw httpErrors.badRequest('Cannot deactivate the last active system administrator');
        }
      }

      const result = await client.query(
        `UPDATE users SET name=COALESCE($1,name),role=COALESCE($2,role),active=COALESCE($3,active),phone=COALESCE($4,phone)
         WHERE id=$5 RETURNING id,name,email,phone,role,active,created_at`,
        [body.name ?? null, body.role ?? null, body.active ?? null, body.phone ?? null, id],
      );
      const revokedGrants = body.active === false
        ? await client.query('DELETE FROM search_contact_grants WHERE user_id=$1', [id])
        : null;
      await client.query(
        'INSERT INTO events(search_id,user_id,type,payload) VALUES(NULL,$1,$2,$3)',
        [actor.id, 'USER_UPDATED', { userId: id, changes: body, contactGrantsRevoked: revokedGrants?.rowCount ?? 0 }],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });
};

export default userRoutes;
