import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';

const createTestUser = (role, email, password = 'test-pass-123456') => {
  const name = `Test ${role}`;
  const sql = `INSERT INTO users(name,email,password_hash,role,active) VALUES('${name}','${email}',crypt('${password}',gen_salt('bf',12)),'${role}',true) RETURNING id`;
  const out = execSync(`docker exec -i infrastructure-postgres-1 psql -U kukla -d kukla -t -A -c "${sql}"`).toString();
  const m = out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (!m) throw new Error(`createTestUser: no UUID in psql output: ${JSON.stringify(out)}`);
  return m[0];
};

const login = async (email, password) => {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: email, password }),
  });
  assert.equal(r.status, 200, `Login failed for ${email}`);
  return (await r.json()).token;
};

const ts = Date.now();
const U = {
  owner: { email: process.env.KUKLA_TEST_OWNER_EMAIL ?? 'owner@kukla.local', password: process.env.KUKLA_TEST_OWNER_PASSWORD ?? 'owner-pass-123456' },
  leader: { email: `iso-leader-${ts}@test.local`, password: 'leader-pass-123456', role: 'LEADER' },
  leader2: { email: `iso-leader2-${ts}@test.local`, password: 'leader-pass-123456', role: 'LEADER' },
  searcher: { email: `iso-searcher-${ts}@test.local`, password: 'searcher-pass-123456', role: 'SEARCHER' },
  viewer: { email: `iso-viewer-${ts}@test.local`, password: 'viewer-pass-123456', role: 'VIEWER' },
};
for (const [k, u] of Object.entries(U)) {
  if (k === 'owner') continue;
  u.id = createTestUser(u.role, u.email, u.password);
}
const T = {};
for (const [k, u] of Object.entries(U)) T[k] = await login(u.email, u.password);
{
  const me = await fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${T.owner}` } });
  assert.equal(me.status, 200, 'Bootstrap owner login failed');
  U.owner.id = (await me.json()).id;
}

const H = (t) => ({ Authorization: `Bearer ${t}` });
const J = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

// Fixture: leader creates a search, searcher joins (member), viewer and leader2 stay outside
const createR = await fetch(`${base}/api/v1/searches`, {
  method: 'POST', headers: J(T.leader), body: JSON.stringify({ title: `Isolation Search ${ts}` }),
});
assert.equal(createR.status, 200);
const searchId = (await createR.json()).id;
const joinR = await fetch(`${base}/api/v1/searches/${searchId}/join`, { method: 'POST', headers: H(T.searcher) });
assert.equal(joinR.status, 200);

// ============================================================================
// Non-member (VIEWER): every nested resource must be 403
// ============================================================================

test('Isolation: non-member VIEWER GET tasks → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, { headers: H(T.viewer) });
  assert.equal(r.status, 403);
});

test('Isolation: non-member VIEWER GET members → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/members`, { headers: H(T.viewer) });
  assert.equal(r.status, 403);
});

test('Isolation: non-member VIEWER GET events → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/events`, { headers: H(T.viewer) });
  assert.equal(r.status, 403);
});

test('Isolation: non-member VIEWER GET gps → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/gps`, { headers: H(T.viewer) });
  assert.equal(r.status, 403);
});

test('Isolation: non-member VIEWER GET snapshot → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/snapshot`, { headers: H(T.viewer) });
  assert.equal(r.status, 403);
});

test('Isolation: non-member VIEWER POST events → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/events`, {
    method: 'POST', headers: J(T.viewer), body: JSON.stringify({ type: 'QA_PROBE' }),
  });
  assert.equal(r.status, 403);
});

test('Isolation: non-member VIEWER POST gps → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/gps`, {
    method: 'POST', headers: J(T.viewer), body: JSON.stringify({ points: [{ lat: 55.75, lng: 37.62 }] }),
  });
  assert.equal(r.status, 403);
});

// ============================================================================
// Non-member MANAGER (second LEADER): role gate passes, canAccessSearch must stop
// ============================================================================

test('Isolation: non-member LEADER PATCH search → 403 (canAccessSearch, not role gate)', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    method: 'PATCH', headers: J(T.leader2), body: JSON.stringify({ status: 'COMPLETED' }),
  });
  assert.equal(r.status, 403);
});

test('Isolation: non-member LEADER POST tasks → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST', headers: J(T.leader2), body: JSON.stringify({ title: 'Foreign task' }),
  });
  assert.equal(r.status, 403);
});

test('Isolation: non-member LEADER DELETE member → 403', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/members/${U.searcher.id}`, {
    method: 'DELETE', headers: H(T.leader2),
  });
  assert.equal(r.status, 403);
});

// ============================================================================
// Member (SEARCHER): positive control — nested resources accessible
// ============================================================================

test('Isolation: member SEARCHER GET tasks → 200', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, { headers: H(T.searcher) });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(await r.json()));
});

test('Isolation: member SEARCHER GET snapshot → 200 with sections', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/snapshot`, { headers: H(T.searcher) });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(data.search);
  assert.ok(Array.isArray(data.members));
  assert.ok(Array.isArray(data.tasks));
});

test('Isolation: member SEARCHER POST events → 200', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/events`, {
    method: 'POST', headers: J(T.searcher), body: JSON.stringify({ type: 'QA_TEST_EVENT' }),
  });
  assert.equal(r.status, 200);
});

test('Isolation: member SEARCHER POST gps → 200', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/gps`, {
    method: 'POST', headers: J(T.searcher), body: JSON.stringify({ points: [{ lat: 55.75, lng: 37.62 }] }),
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.count, 1);
});

// ============================================================================
// Edge cases
// ============================================================================

// F-09: 404 for unknown id vs 403 for existing-but-foreign lets an authenticated
// user probe which search ids exist (enumeration oracle). Low severity, documented.
test('Isolation: non-existent search id → 404 (F-09: existence oracle, see report)', async () => {
  const r = await fetch(`${base}/api/v1/searches/${randomUUID()}`, { headers: H(T.searcher) });
  assert.equal(r.status, 404);
});

test('Isolation: SYSTEM_OWNER privileged bypass GET snapshot → 200', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/snapshot`, { headers: H(T.owner) });
  assert.equal(r.status, 200);
});
