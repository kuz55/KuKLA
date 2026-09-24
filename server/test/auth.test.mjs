import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';

const registerUser = async (email, password = 'qa-test-pass-123456') => {
  const r = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `QA ${email}`, email, password }),
  });
  return r;
};

const loginUser = async (login, password) => {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  return r;
};

test('/health returns 200 and ok:true', async () => {
  const r = await fetch(`${base}/health`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
  assert.equal(data.service, 'kukla-server');
});

test('/ready returns 200 and ok:true', async () => {
  const r = await fetch(`${base}/ready`);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.ok, true);
});

test('register creates user with role SEARCHER', async () => {
  const email = `test-${Date.now()}@kukla.local`;
  const r = await registerUser(email);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.email, email);
  assert.equal(data.role, 'SEARCHER');
  assert.equal(data.active, true);
});

test('login with valid credentials returns token', async () => {
  const email = `login-${Date.now()}@kukla.local`;
  const password = 'valid-pass-123456';
  await registerUser(email, password);
  const r = await loginUser(email, password);
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(data.token);
  assert.ok(data.token.length > 100);
  assert.equal(data.user.email, email);
});

test('login with wrong password returns 401', async () => {
  const email = `wrong-${Date.now()}@kukla.local`;
  await registerUser(email, 'correct-pass-123456');
  const r = await loginUser(email, 'wrong-pass-123456');
  assert.equal(r.status, 401);
  const data = await r.json();
  assert.equal(data.error, 'UNAUTHORIZED');
  assert.equal(data.message, 'Invalid credentials');
});

test('login with non-existent user returns 401 (indistinguishable from wrong password)', async () => {
  const r = await loginUser(`ghost-${Date.now()}@kukla.local`, 'whatever-123456');
  assert.equal(r.status, 401);
  const data = await r.json();
  assert.equal(data.error, 'UNAUTHORIZED');
  assert.equal(data.message, 'Invalid credentials');
});

test('login with invalid payload returns 500 (F-02: ZodError not caught)', async () => {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@kukla.local', password: 'pass' }),
  });
  assert.equal(r.status, 500);
  const data = await r.json();
  assert.equal(data.error, 'ERROR');
});

test('/me without token returns 401', async () => {
  const r = await fetch(`${base}/api/v1/me`);
  assert.equal(r.status, 401);
  const data = await r.json();
  assert.equal(data.error, 'UNAUTHORIZED');
});

test('/me with invalid token returns 401', async () => {
  const r = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: 'Bearer garbage.token.here' },
  });
  assert.equal(r.status, 401);
  const data = await r.json();
  assert.equal(data.error, 'UNAUTHORIZED');
});

test('/me with valid token returns user data', async () => {
  const email = `me-${Date.now()}@kukla.local`;
  const password = 'me-pass-123456';
  await registerUser(email, password);
  const loginR = await loginUser(email, password);
  const { token } = await loginR.json();
  const r = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.email, email);
  assert.equal(data.role, 'SEARCHER');
});

test('logout revokes session', async () => {
  const email = `logout-${Date.now()}@kukla.local`;
  const password = 'logout-pass-123456';
  await registerUser(email, password);
  const loginR = await loginUser(email, password);
  const { token } = await loginR.json();
  const logoutR = await fetch(`${base}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(logoutR.status, 200);
  const logoutData = await logoutR.json();
  assert.equal(logoutData.ok, true);
  const meR = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(meR.status, 401);
  const meData = await meR.json();
  assert.equal(meData.message, 'Session expired or revoked');
});
