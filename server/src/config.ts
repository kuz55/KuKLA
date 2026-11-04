import pg from 'pg';

const { Pool } = pg;

export const isProduction = process.env.NODE_ENV === 'production';

const placeholderSecret = /(^|[-_\s])(change(?:me)?|replace|example|placeholder|todo|your|secret|password)([-_\s]|$)/i;

export const requiredSecret = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value || (isProduction && value === fallback)) throw new Error(`${name} must be configured`);
  return value;
};

export const JWT_SECRET = requiredSecret('JWT_SECRET', 'dev-secret-change-me');
export const DATABASE_URL = requiredSecret('DATABASE_URL', 'postgres://kukla:kukla@localhost:5432/kukla');

if (isProduction) {
  if (JWT_SECRET.length < 32 || placeholderSecret.test(JWT_SECRET)) {
    throw new Error('JWT_SECRET must be a non-placeholder secret with at least 32 characters');
  }

  const databasePassword = (() => {
    try {
      return decodeURIComponent(new URL(DATABASE_URL).password);
    } catch {
      throw new Error('DATABASE_URL must be a valid PostgreSQL URL with a password');
    }
  })();
  if (databasePassword.length < 24 || placeholderSecret.test(databasePassword)) {
    throw new Error('DATABASE_URL password must be a non-placeholder secret with at least 24 characters');
  }
}

export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (isProduction ? undefined : 'http://localhost:5173');
if (!CORS_ORIGIN) throw new Error('CORS_ORIGIN must be configured');

// Fastify only trusts X-Forwarded-* headers from explicitly configured proxy
// addresses. In Compose, the default bridge subnet is trusted for the Nginx hop.
export const TRUST_PROXY = (process.env.TRUST_PROXY ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const allowPublicRegistration = process.env.ALLOW_PUBLIC_REGISTRATION === 'true' || (!isProduction && process.env.ALLOW_PUBLIC_REGISTRATION !== 'false');
export const loginRateLimit = Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 5);
if (!Number.isSafeInteger(loginRateLimit) || loginRateLimit < 1) throw new Error('RATE_LIMIT_LOGIN_MAX must be a positive integer');

export const pool = new Pool({ connectionString: DATABASE_URL });
