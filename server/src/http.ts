import { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
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

async function searchExists(searchId: string, client?: PoolClient) {
  const r = client
    ? await client.query('SELECT id FROM searches WHERE id=$1', [searchId])
    : await pool.query('SELECT id FROM searches WHERE id=$1', [searchId]);
  if (!r.rowCount) throw httpErrors.notFound('Search not found');
}

async function canAccessSearch(user: User, searchId: string, client?: PoolClient): Promise<boolean> {
  if (privilegedRoles.includes(user.role)) return true;
  const query = `SELECT 1 FROM search_members WHERE search_id=$1 AND user_id=$2
     UNION SELECT 1 FROM search_organizations so JOIN organization_members om ON om.organization_id=so.organization_id
     WHERE so.search_id=$1 AND om.user_id=$2 AND om.active=true LIMIT 1`;
  const values = [searchId, user.id];
  const r = client ? await client.query(query, values) : await pool.query(query, values);
  return Boolean(r.rowCount);
}

export async function requireSearchAccess(req: FastifyRequest, searchId: string, client?: PoolClient) {
  // Do not check existence separately for non-privileged users: both a missing
  // search and a search outside their membership must return the same 404.
  if (privilegedRoles.includes(req.user.role)) {
    await searchExists(searchId, client);
    return;
  }
  if (!(await canAccessSearch(req.user, searchId, client))) throw httpErrors.notFound('Search not found');
}

export async function lockMutationActor(req: FastifyRequest, client: PoolClient, additionalUserIds: string[] = []) {
  const session = await client.query(
    `SELECT 1 FROM sessions
     WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp()
     FOR SHARE`,
    [tokenHash(req), req.user.id],
  );
  if (!session.rowCount) throw httpErrors.unauthorized('Session expired or revoked');

  // Use the same stable user-id order as PATCH /users, which locks actor and
  // target together. This keeps concurrent role changes/deactivation ordered.
  const ids = [...new Set([req.user.id, ...additionalUserIds])].sort();
  const users = await client.query(
    `SELECT id,role,active FROM users
     WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE`,
    [ids],
  );
  const actor = users.rows.find((user) => user.id === req.user.id) as
    { id: string; role: Role; active: boolean } | undefined;
  if (!actor || !actor.active) throw httpErrors.unauthorized('Session expired or revoked');
  req.user.role = actor.role;
}

async function lockSearchMutation(client: PoolClient, searchId: string) {
  // Serialize mutations within one search so membership revocation and writes
  // have a clear order. Every protected write rechecks access after this lock.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`search:${searchId}`]);
}

async function requireCurrentSession(req: FastifyRequest, client: PoolClient) {
  const session = await client.query(
    `SELECT 1 FROM sessions
     WHERE token_hash=$1 AND user_id=$2 AND expires_at>clock_timestamp()`,
    [tokenHash(req), req.user.id],
  );
  if (!session.rowCount) throw httpErrors.unauthorized('Session expired or revoked');
}

export async function commitSearchMutation(req: FastifyRequest, client: PoolClient) {
  // Expiration is time-based (unlike logout, which is blocked by the session
  // row lock), so check once more at the commit boundary.
  await requireCurrentSession(req, client);
  await client.query('COMMIT');
}

export async function requireSearchWriteAccess(
  req: FastifyRequest,
  searchId: string,
  client: PoolClient,
  additionalUserIds: string[] = [],
) {
  await lockMutationActor(req, client, additionalUserIds);
  await requireSearchAccess(req, searchId, client);
  await lockSearchMutation(client, searchId);
  // Revalidate after any lock wait. The session row and actor row are also held
  // until transaction end so logout, role changes, and deactivation serialize.
  await requireCurrentSession(req, client);
  // Access may have been revoked while this request waited for the search lock.
  await requireSearchAccess(req, searchId, client);
}

export async function requireSearchManagement(
  req: FastifyRequest,
  searchId: string,
  client: PoolClient,
  additionalUserIds: string[] = [],
) {
  await requireSearchWriteAccess(req, searchId, client, additionalUserIds);
  if (!managementRoles.includes(req.user.role)) throw httpErrors.forbidden('Search management permission required');
}
