import { FastifyRequest } from 'fastify';
import { httpErrors } from '@fastify/sensible';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Role, managementRoles, privilegedRoles } from './rbac.js';
import { pool } from './config.js';
import { Params, User } from './types.js';

export const parseId = (req: FastifyRequest) => z.string().uuid().parse((req.params as Params).id);

export const tokenHash = (req: FastifyRequest) =>
  crypto.createHash('sha256').update(req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '').digest('hex');

export const auth = async (req: FastifyRequest) => {
  try {
    await req.jwtVerify();
    const session = await pool.query(
      `SELECT u.id,u.name,u.email,u.phone,u.role
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
      [tokenHash(req)]
    );
    if (!session.rowCount) throw httpErrors.unauthorized('Session expired or revoked');
    req.user = session.rows[0] as User;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 401) throw error;
    throw httpErrors.unauthorized('Authentication required');
  }
};

export const roles = (...allowed: Role[]) => async (req: FastifyRequest) => {
  await auth(req);
  if (!allowed.includes(req.user.role)) throw httpErrors.forbidden('Insufficient permissions');
};

export async function searchExists(searchId: string) {
  const r = await pool.query('SELECT id FROM searches WHERE id=$1', [searchId]);
  if (!r.rowCount) throw httpErrors.notFound('Search not found');
}

async function canAccessSearch(user: User, searchId: string): Promise<boolean> {
  if (privilegedRoles.includes(user.role)) return true;
  const r = await pool.query(
    `SELECT 1 FROM search_members WHERE search_id=$1 AND user_id=$2
     UNION SELECT 1 FROM search_organizations so JOIN organization_members om ON om.organization_id=so.organization_id
     WHERE so.search_id=$1 AND om.user_id=$2 AND om.active=true LIMIT 1`,
    [searchId, user.id]
  );
  return Boolean(r.rowCount);
}

export async function requireSearchAccess(req: FastifyRequest, searchId: string) {
  await searchExists(searchId);
  if (!(await canAccessSearch(req.user, searchId))) throw httpErrors.forbidden('Access to this search is denied');
}

export async function requireSearchManagement(req: FastifyRequest, searchId: string) {
  await requireSearchAccess(req, searchId);
  if (!managementRoles.includes(req.user.role)) throw httpErrors.forbidden('Search management permission required');
}

export async function audit(searchId: string | null, userId: string, type: string, payload: Record<string, unknown> = {}) {
  await pool.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId, userId, type, payload]);
}
