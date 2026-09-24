import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestDatabase, createTestUser, ensureTestOwner } from './db.mjs';

const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';

after(closeTestDatabase);

// Helper: login and get token
const login = async (email, password) => {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: email, password }),
  });
  assert.equal(r.status, 200, `Login failed for ${email}`);
  const data = await r.json();
  return data.token;
};

// Helper: create search (requires management role token)
const createSearch = async (token, title = `Test Search ${Date.now()}`) => {
  const r = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  assert.equal(r.status, 200, `Create search failed`);
  const data = await r.json();
  return data.id;
};

// Setup: test users for each role
const timestamp = Date.now();
const users = {
  // SYSTEM_OWNER is created by bootstrap (005_rbac_bootstrap.sql); reuse it.
  // DB constraint ux_users_single_system_owner forbids a second active owner.
  systemOwner: {
    email: process.env.KUKLA_TEST_OWNER_EMAIL ?? 'owner@kukla.local',
    password: process.env.KUKLA_TEST_OWNER_PASSWORD ?? 'owner-pass-123456',
    role: 'SYSTEM_OWNER',
  },
  superadmin: { email: `sa-${timestamp}@test.local`, password: 'sa-pass-123456', role: 'SUPERADMIN' },
  superuser: { email: `su-${timestamp}@test.local`, password: 'su-pass-123456', role: 'SUPERUSER' },
  admin: { email: `admin-${timestamp}@test.local`, password: 'admin-pass-123456', role: 'ADMIN' },
  leader: { email: `leader-${timestamp}@test.local`, password: 'leader-pass-123456', role: 'LEADER' },
  coordinator: { email: `coord-${timestamp}@test.local`, password: 'coord-pass-123456', role: 'COORDINATOR' },
  searcher: { email: `searcher-${timestamp}@test.local`, password: 'searcher-pass-123456', role: 'SEARCHER' },
  viewer: { email: `viewer-${timestamp}@test.local`, password: 'viewer-pass-123456', role: 'VIEWER' },
};

// Create users in DB (skip systemOwner — only one active owner allowed)
for (const [key, user] of Object.entries(users)) {
  if (key === 'systemOwner') continue;
  users[key].id = await createTestUser(user.role, user.email, user.password);
}

// Login all users
const tokens = {};
await ensureTestOwner(users.systemOwner.email, users.systemOwner.password);
for (const [key, user] of Object.entries(users)) {
  tokens[key] = await login(user.email, user.password);
}

// Retrieve bootstrap owner's id via /me
{
  const me = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${tokens.systemOwner}` },
  });
  assert.equal(me.status, 200, 'Bootstrap owner login failed; check owner@kukla.local credentials');
  users.systemOwner.id = (await me.json()).id;
}

// ============================================================================
// GET /api/v1/users — who can list users (managementRoles)
// ============================================================================

test('GET /users: SYSTEM_OWNER returns 200', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.systemOwner}` } });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(Array.isArray(data));
});

test('GET /users: SUPERADMIN returns 200', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.superadmin}` } });
  assert.equal(r.status, 200);
});

test('GET /users: SUPERUSER returns 200', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.superuser}` } });
  assert.equal(r.status, 200);
});

test('GET /users: ADMIN returns 200', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  assert.equal(r.status, 200);
});

test('GET /users: LEADER returns 200 (filtered list)', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.leader}` } });
  assert.equal(r.status, 200);
});

test('GET /users: COORDINATOR returns 200 (filtered list)', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.coordinator}` } });
  assert.equal(r.status, 200);
});

test('GET /users: SEARCHER returns 403', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.searcher}` } });
  assert.equal(r.status, 403);
});

test('GET /users: VIEWER returns 403', async () => {
  const r = await fetch(`${base}/api/v1/users`, { headers: { Authorization: `Bearer ${tokens.viewer}` } });
  assert.equal(r.status, 403);
});

// ============================================================================
// PATCH /api/v1/users/:id — who can modify users (adminRoles + canManageUser)
// ============================================================================

test('PATCH /users: ADMIN can change LEADER role to COORDINATOR', async () => {
  const targetId = await createTestUser('LEADER', `target-${Date.now()}@test.local`);
  const r = await fetch(`${base}/api/v1/users/${targetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
    body: JSON.stringify({ role: 'COORDINATOR' }),
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.role, 'COORDINATOR');
});

test('PATCH /users: ADMIN cannot change SYSTEM_OWNER role', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.systemOwner.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
    body: JSON.stringify({ role: 'ADMIN' }),
  });
  assert.equal(r.status, 403);
});

test('PATCH /users: LEADER returns 403 (not in adminRoles)', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.searcher.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ role: 'COORDINATOR' }),
  });
  assert.equal(r.status, 403);
});

test('PATCH /users: SEARCHER returns 403', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.viewer.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ role: 'COORDINATOR' }),
  });
  assert.equal(r.status, 403);
});

// canManageUser(ADMIN, ADMIN) === false → 403 fires BEFORE the self-guard 400.
// An ADMIN cannot modify any admin-tier user, including themselves.
test('PATCH /users: ADMIN cannot deactivate themselves (canManageUser(ADMIN,ADMIN)=false → 403)', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.admin.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(r.status, 403);
});

test('PATCH /users: ADMIN cannot change their own role (canManageUser(ADMIN,ADMIN)=false → 403)', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.admin.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
    body: JSON.stringify({ role: 'LEADER' }),
  });
  assert.equal(r.status, 403);
});

// The self-guard 400 branches are reachable only for SYSTEM_OWNER
// (the only role with canManageUser(X, X) === true). Requests are rejected, DB state is untouched.
test('PATCH /users: SYSTEM_OWNER cannot deactivate themselves (self-guard 400)', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.systemOwner.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.systemOwner}` },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.equal(data.message, 'You cannot deactivate yourself');
});

test('PATCH /users: SYSTEM_OWNER cannot change their own role (self-guard 400)', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.systemOwner.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.systemOwner}` },
    body: JSON.stringify({ role: 'SUPERADMIN' }),
  });
  assert.equal(r.status, 400);
  const data = await r.json();
  assert.equal(data.message, 'You cannot change your own role');
});

test('PATCH /users: SUPERADMIN cannot deactivate SYSTEM_OWNER (canManageUser returns false)', async () => {
  const r = await fetch(`${base}/api/v1/users/${users.systemOwner.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.superadmin}` },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(r.status, 403);
});

test('PATCH /users: SYSTEM_OWNER role cannot be assigned via API (only bootstrap)', async () => {
  const targetId = await createTestUser('ADMIN', `target2-${Date.now()}@test.local`);
  const r = await fetch(`${base}/api/v1/users/${targetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.superadmin}` },
    body: JSON.stringify({ role: 'SYSTEM_OWNER' }),
  });
  assert.equal(r.status, 403);
});

// Finding F-07: the "last active admin" guard is unreachable through the API.
// The actor must itself be an active admin-class user (auth requires active=true),
// and the guard counts admin-class users excluding only the TARGET — so the count
// can never be 0 while a valid actor exists. Kept as a skipped test to document it.
test('PATCH /users: last-active-admin guard (F-07: unreachable via API, see report)', { skip: 'F-07: actor is always an active admin-class user, count excluding target >= 1' }, () => {});

// ============================================================================
// Search isolation (canAccessSearch)
// ============================================================================

test('Search isolation: SEARCHER cannot access search they are not member of', async () => {
  const searchId = await createSearch(tokens.leader);
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(r.status, 403);
});

test('Search isolation: SEARCHER can access search they joined', async () => {
  const searchId = await createSearch(tokens.leader);
  const joinR = await fetch(`${base}/api/v1/searches/${searchId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(joinR.status, 200);
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(r.status, 200);
});

test('Search isolation: SYSTEM_OWNER can access any search (privileged bypass)', async () => {
  const searchId = await createSearch(tokens.leader);
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.systemOwner}` },
  });
  assert.equal(r.status, 200);
});

test('Search isolation: VIEWER cannot access search even if they know id', async () => {
  const searchId = await createSearch(tokens.leader);
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.viewer}` },
  });
  assert.equal(r.status, 403);
});

// ============================================================================
// POST /api/v1/searches — who can create searches (managementRoles)
// ============================================================================

test('POST /searches: LEADER can create search', async () => {
  const r = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ title: `Leader Search ${Date.now()}` }),
  });
  assert.equal(r.status, 200);
});

test('POST /searches: COORDINATOR can create search', async () => {
  const r = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.coordinator}` },
    body: JSON.stringify({ title: `Coord Search ${Date.now()}` }),
  });
  assert.equal(r.status, 200);
});

test('POST /searches: ADMIN can create search', async () => {
  const r = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.admin}` },
    body: JSON.stringify({ title: `Admin Search ${Date.now()}` }),
  });
  assert.equal(r.status, 200);
});

test('POST /searches: SEARCHER returns 403', async () => {
  const r = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ title: `Searcher Search ${Date.now()}` }),
  });
  assert.equal(r.status, 403);
});

test('POST /searches: VIEWER returns 403', async () => {
  const r = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.viewer}` },
    body: JSON.stringify({ title: `Viewer Search ${Date.now()}` }),
  });
  assert.equal(r.status, 403);
});

// ============================================================================
// PATCH /api/v1/tasks/:id — task update permissions
// ============================================================================

test('PATCH /tasks: LEADER can update any task in their search', async () => {
  const searchId = await createSearch(tokens.leader);
  const taskR = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ title: 'Test Task' }),
  });
  assert.equal(taskR.status, 200);
  const task = await taskR.json();
  const r = await fetch(`${base}/api/v1/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
  });
  assert.equal(r.status, 200);
});

test('PATCH /tasks: SEARCHER can update their own assigned task', async () => {
  const searchId = await createSearch(tokens.leader);
  const joinR = await fetch(`${base}/api/v1/searches/${searchId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(joinR.status, 200);
  const taskR = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ title: 'Assigned Task', assigneeId: users.searcher.id }),
  });
  assert.equal(taskR.status, 200);
  const task = await taskR.json();
  const r = await fetch(`${base}/api/v1/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ status: 'DONE' }),
  });
  assert.equal(r.status, 200);
});

test('PATCH /tasks: SEARCHER cannot update task assigned to someone else', async () => {
  const searchId = await createSearch(tokens.leader);
  const joinR = await fetch(`${base}/api/v1/searches/${searchId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(joinR.status, 200);
  const taskR = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ title: 'Other Task', assigneeId: users.leader.id }),
  });
  assert.equal(taskR.status, 200);
  const task = await taskR.json();
  const r = await fetch(`${base}/api/v1/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ status: 'DONE' }),
  });
  assert.equal(r.status, 403);
});

test('PATCH /tasks: SEARCHER cannot reassign tasks', async () => {
  const searchId = await createSearch(tokens.leader);
  const joinR = await fetch(`${base}/api/v1/searches/${searchId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(joinR.status, 200);
  const taskR = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ title: 'My Task', assigneeId: users.searcher.id }),
  });
  assert.equal(taskR.status, 200);
  const task = await taskR.json();
  const r = await fetch(`${base}/api/v1/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ assigneeId: users.leader.id }),
  });
  assert.equal(r.status, 403);
});

test('PATCH /tasks: VIEWER returns 403 (no search access)', async () => {
  const searchId = await createSearch(tokens.leader);
  const taskR = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ title: 'Task' }),
  });
  assert.equal(taskR.status, 200);
  const task = await taskR.json();
  const r = await fetch(`${base}/api/v1/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.viewer}` },
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
  });
  assert.equal(r.status, 403);
});
