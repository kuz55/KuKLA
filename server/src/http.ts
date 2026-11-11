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
  } catch {
    throw httpErrors.unauthorized('Authentication required');
  }
  // Authentication fails closed when the session store is unavailable, but
  // a database outage is not evidence that a user's credentials are invalid.
  // Do not pass database errors (which may contain sensitive values) onwards.
  let session;
  try {
    session = await pool.query(
      `SELECT u.id,u.name,u.email,u.phone,u.role
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,
      [tokenHash(req)]
    );
  } catch {
    throw httpErrors.serviceUnavailable('Session service unavailable');
  }
  if (!session.rowCount) throw httpErrors.unauthorized('Session expired or revoked');
  req.user = session.rows[0] as User;
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

export async function requireSearchAccessForUser(user: User, searchId: string, client?: PoolClient) {
  // Do not check existence separately for non-privileged users: both a missing
  // search and a search outside their membership must return the same 404.
  if (privilegedRoles.includes(user.role)) {
    await searchExists(searchId, client);
    return;
  }
  if (!(await canAccessSearch(user, searchId, client))) throw httpErrors.notFound('Search not found');
}

export async function requireSearchAccess(req: FastifyRequest, searchId: string, client?: PoolClient) {
  return requireSearchAccessForUser(req.user, searchId, client);
}

export async function requireSearchManagement(req: FastifyRequest, searchId: string) {
  // Check membership before management role so foreign and missing search IDs
  // stay indistinguishable on manager-only resource routes.
  await requireSearchAccess(req, searchId);
  if (!managementRoles.includes(req.user.role)) throw httpErrors.forbidden('Search management permission required');
}

export async function audit(searchId: string | null, userId: string, type: string, payload: Record<string, unknown> = {}) {
  await pool.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId, userId, type, payload]);
}
