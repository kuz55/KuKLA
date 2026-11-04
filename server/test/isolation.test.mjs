import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeTestDatabase, createTestUser, ensureTestOwner } from './db.mjs';

const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';

after(closeTestDatabase);

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
  u.id = await createTestUser(u.role, u.email, u.password);
}
const T = {};
await ensureTestOwner(U.owner.email, U.owner.password);
for (const [k, u] of Object.entries(U)) T[k] = await login(u.email, u.password);
{
  const me = await fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${T.owner}` } });
  assert.equal(me.status, 200, 'Bootstrap owner login failed');
  U.owner.id = (await me.json()).id;
}

const H = (t) => ({ Authorization: `Bearer ${t}` });
const J = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

// Fixture: a leader creates a search and explicitly adds the searcher.
// A self-join request must not grant access; viewer and leader2 stay outside.
const createR = await fetch(`${base}/api/v1/searches`, {
  method: 'POST', headers: J(T.leader), body: JSON.stringify({ title: `Isolation Search ${ts}` }),
});
assert.equal(createR.status, 200);
const searchId = (await createR.json()).id;
const joinR = await fetch(`${base}/api/v1/searches/${searchId}/join`, { method: 'POST', headers: H(T.searcher) });
assert.equal(joinR.status, 403);
const addR = await fetch(`${base}/api/v1/searches/${searchId}/members`, {
  method: 'POST', headers: J(T.leader), body: JSON.stringify({ userId: U.searcher.id }),
});
assert.equal(addR.status, 200);

// ============================================================================
// Non-members: scoped resources must be hidden with a not-found response
// ============================================================================

test('Isolation: non-member VIEWER GET tasks → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, { headers: H(T.viewer) });
  assert.equal(r.status, 404);
});

test('Isolation: non-member VIEWER GET members → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/members`, { headers: H(T.viewer) });
  assert.equal(r.status, 404);
});

test('Isolation: non-member VIEWER GET events → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/events`, { headers: H(T.viewer) });
  assert.equal(r.status, 404);
});

test('Isolation: non-member VIEWER GET gps → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/gps`, { headers: H(T.viewer) });
  assert.equal(r.status, 404);
});

test('Isolation: non-member VIEWER GET snapshot → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/snapshot`, { headers: H(T.viewer) });
  assert.equal(r.status, 404);
});

test('Isolation: non-member VIEWER POST events → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/events`, {
    method: 'POST', headers: J(T.viewer), body: JSON.stringify({ note: 'Unauthorized note' }),
  });
  assert.equal(r.status, 404);
});

test('Isolation: non-member VIEWER POST gps → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/gps`, {
    method: 'POST', headers: J(T.viewer), body: JSON.stringify({ points: [{ lat: 55.75, lng: 37.62 }] }),
  });
  assert.equal(r.status, 404);
});

test('Isolation: foreign and unknown search ids match across protected search routes', async () => {
  const unknownId = randomUUID();
  const requests = [
    ['GET search', (id) => fetch(`${base}/api/v1/searches/${id}`, { headers: H(T.viewer) })],
    ['PATCH search', (id) => fetch(`${base}/api/v1/searches/${id}`, {
      method: 'PATCH', headers: J(T.viewer), body: JSON.stringify({ status: 'COMPLETED' }),
    })],
    ['GET members', (id) => fetch(`${base}/api/v1/searches/${id}/members`, { headers: H(T.viewer) })],
    ['POST members', (id) => fetch(`${base}/api/v1/searches/${id}/members`, {
      method: 'POST', headers: J(T.viewer), body: JSON.stringify({ userId: U.searcher.id }),
    })],
    ['DELETE member', (id) => fetch(`${base}/api/v1/searches/${id}/members/${U.searcher.id}`, {
      method: 'DELETE', headers: H(T.viewer),
    })],
    ['GET tasks', (id) => fetch(`${base}/api/v1/searches/${id}/tasks`, { headers: H(T.viewer) })],
    ['POST tasks', (id) => fetch(`${base}/api/v1/searches/${id}/tasks`, {
      method: 'POST', headers: J(T.viewer), body: JSON.stringify({ title: 'Hidden task' }),
    })],
    ['GET events', (id) => fetch(`${base}/api/v1/searches/${id}/events`, { headers: H(T.viewer) })],
    ['POST events', (id) => fetch(`${base}/api/v1/searches/${id}/events`, {
      method: 'POST', headers: J(T.viewer), body: JSON.stringify({ note: 'Hidden note' }),
    })],
    ['GET gps', (id) => fetch(`${base}/api/v1/searches/${id}/gps`, { headers: H(T.viewer) })],
    ['POST gps', (id) => fetch(`${base}/api/v1/searches/${id}/gps`, {
      method: 'POST', headers: J(T.viewer), body: JSON.stringify({ points: [{ lat: 55.75, lng: 37.62 }] }),
    })],
    ['GET snapshot', (id) => fetch(`${base}/api/v1/searches/${id}/snapshot`, { headers: H(T.viewer) })],
  ];

  for (const [route, request] of requests) {
    const foreign = await request(searchId);
    const unknown = await request(unknownId);
    assert.equal(foreign.status, 404, `${route}: foreign search`);
    assert.equal(unknown.status, 404, `${route}: unknown search`);
    assert.deepEqual(await foreign.json(), await unknown.json(), `${route}: response body`);
  }
});

// ============================================================================
// Non-member MANAGER (second LEADER): search access must hide the foreign operation
// ============================================================================

test('Isolation: non-member LEADER PATCH search → 404 (resource access check)', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    method: 'PATCH', headers: J(T.leader2), body: JSON.stringify({ status: 'COMPLETED' }),
  });
  assert.equal(r.status, 404);
});

test('Isolation: non-member LEADER POST tasks → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST', headers: J(T.leader2), body: JSON.stringify({ title: 'Foreign task' }),
  });
  assert.equal(r.status, 404);
});

test('Isolation: non-member LEADER DELETE member → 404', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/members/${U.searcher.id}`, {
    method: 'DELETE', headers: H(T.leader2),
  });
  assert.equal(r.status, 404);
});

test('Isolation: non-member LEADER cannot add users to a foreign search', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/members`, {
    method: 'POST', headers: J(T.leader2), body: JSON.stringify({ userId: U.viewer.id }),
  });
  assert.equal(r.status, 404);
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

test('Isolation: member SEARCHER cannot forge events in the audit stream', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/events`, {
    method: 'POST', headers: J(T.searcher), body: JSON.stringify({ type: 'SEARCH_CREATED', payload: { title: 'Forged' } }),
  });
  assert.equal(r.status, 403);
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

test('Isolation: existing and unknown search ids are indistinguishable to non-members', async () => {
  const existing = await fetch(`${base}/api/v1/searches/${searchId}`, { headers: H(T.viewer) });
  const unknown = await fetch(`${base}/api/v1/searches/${randomUUID()}`, { headers: H(T.viewer) });
  assert.equal(existing.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await existing.json(), await unknown.json());
});

test('Isolation: SYSTEM_OWNER privileged bypass GET snapshot → 200', async () => {
  const r = await fetch(`${base}/api/v1/searches/${searchId}/snapshot`, { headers: H(T.owner) });
  assert.equal(r.status, 200);
});
