import pg from 'pg';

const { Pool } = pg;

export const isProduction = process.env.NODE_ENV === 'production';

export const requiredSecret = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (!value || (isProduction && value === fallback)) throw new Error(`${name} must be configured`);
  return value;
};

export const JWT_SECRET = requiredSecret('JWT_SECRET', 'dev-secret-change-me');
export const DATABASE_URL = requiredSecret('DATABASE_URL', 'postgres://kukla:kukla@localhost:5432/kukla');
export const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (isProduction ? undefined : 'http://localhost:3000');
if (!CORS_ORIGIN) throw new Error('CORS_ORIGIN must be configured');
export const allowPublicRegistration = process.env.ALLOW_PUBLIC_REGISTRATION === 'true' || (!isProduction && process.env.ALLOW_PUBLIC_REGISTRATION !== 'false');
export const loginRateLimit = Number(process.env.RATE_LIMIT_LOGIN_MAX ?? 5);
if (!Number.isSafeInteger(loginRateLimit) || loginRateLimit < 1) throw new Error('RATE_LIMIT_LOGIN_MAX must be a positive integer');

export const pool = new Pool({ connectionString: DATABASE_URL });
