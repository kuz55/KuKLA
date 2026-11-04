import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeTestDatabase, connectTestDatabase, createTestUser, ensureTestOwner, queryTestDatabase } from './db.mjs';

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

const addMember = async (searchId, userId, token = tokens.leader) => fetch(`${base}/api/v1/searches/${searchId}/members`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ userId }),
});

const waitForDatabaseLockWait = async (queryPattern, timeoutMs = 5000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = await queryTestDatabase(
      `SELECT 1 FROM pg_stat_activity
       WHERE datname=current_database() AND state='active'
         AND wait_event_type='Lock' AND query LIKE $1
       LIMIT 1`,
      [queryPattern],
    );
    if (waiting.rowCount) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

const lockActivityAvailable = async (t) => {
  try {
    const version = await queryTestDatabase('SELECT version()');
    if (/PGlite/i.test(version.rows[0]?.version ?? '')) {
      t.skip('PGlite serializes socket transactions and cannot exercise concurrent row/advisory lock waits');
      return false;
    }
    await queryTestDatabase('SELECT wait_event_type,wait_event FROM pg_stat_activity LIMIT 0');
    return true;
  } catch {
    t.skip('The test database does not expose PostgreSQL lock-wait activity');
    return false;
  }
};

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

test('PATCH /users: user change rolls back if its audit insert fails', async () => {
  const email = `audit-rollback-${Date.now()}@test.local`;
  const targetId = await createTestUser('SEARCHER', email);
  const suffix = targetId.replaceAll('-', '');
  const functionName = `fail_user_updated_${suffix}`;
  const triggerName = `fail_user_updated_${suffix}`;

  try {
    await queryTestDatabase(`
      CREATE FUNCTION ${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.type = 'USER_UPDATED' AND NEW.payload->>'userId' = '${targetId}' THEN
          RAISE EXCEPTION 'Injected audit failure for integration test';
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryTestDatabase(
      `CREATE TRIGGER ${triggerName} BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );

    const response = await fetch(`${base}/api/v1/users/${targetId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.systemOwner}` },
      body: JSON.stringify({ name: 'Must Roll Back' }),
    });
    assert.equal(response.status, 500);

    const [user, auditEvent] = await Promise.all([
      queryTestDatabase('SELECT name FROM users WHERE id=$1', [targetId]),
      queryTestDatabase(
        "SELECT id FROM events WHERE type='USER_UPDATED' AND payload->>'userId'=$1",
        [targetId],
      ),
    ]);
    assert.equal(user.rows[0].name, 'Test SEARCHER');
    assert.equal(auditEvent.rowCount, 0);
  } finally {
    await queryTestDatabase(`DROP TRIGGER IF EXISTS ${triggerName} ON events`);
    await queryTestDatabase(`DROP FUNCTION IF EXISTS ${functionName}()`);
  }
});

test('PATCH /users: existing sessions reflect role changes and stop after deactivation', async () => {
  const email = `live-role-${Date.now()}@test.local`;
  const userId = await createTestUser('LEADER', email);
  const token = await login(email, 'test-pass-123456');

  const before = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(before.status, 200);
  assert.equal((await before.json()).role, 'LEADER');

  const demoted = await fetch(`${base}/api/v1/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.systemOwner}` },
    body: JSON.stringify({ role: 'SEARCHER' }),
  });
  assert.equal(demoted.status, 200);

  const afterDemotion = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(afterDemotion.status, 200);
  assert.equal((await afterDemotion.json()).role, 'SEARCHER');
  const forbidden = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: 'Old role must not grant access' }),
  });
  assert.equal(forbidden.status, 403);

  const deactivated = await fetch(`${base}/api/v1/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.systemOwner}` },
    body: JSON.stringify({ active: false }),
  });
  assert.equal(deactivated.status, 200);

  const afterDeactivation = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(afterDeactivation.status, 401);
  assert.equal((await afterDeactivation.json()).message, 'Session expired or revoked');
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

test('Search isolation: a non-member receives 404 for an existing search', async () => {
  const searchId = await createSearch(tokens.leader);
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(r.status, 404);
});

test('Search isolation: self-join cannot grant access; a manager can add a SEARCHER', async () => {
  const searchId = await createSearch(tokens.leader);
  const joinR = await fetch(`${base}/api/v1/searches/${searchId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  const unknownJoin = await fetch(`${base}/api/v1/searches/${randomUUID()}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(joinR.status, 403);
  assert.equal(unknownJoin.status, 403);
  assert.deepEqual(await joinR.json(), await unknownJoin.json());
  const denied = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(denied.status, 404);

  const addR = await addMember(searchId, users.searcher.id);
  assert.equal(addR.status, 200);
  const allowed = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(allowed.status, 200);
});

test('Search isolation: SYSTEM_OWNER can access any search (privileged bypass)', async () => {
  const searchId = await createSearch(tokens.leader);
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.systemOwner}` },
  });
  assert.equal(r.status, 200);
});

test('Search isolation: a viewer receives 404 for an existing search outside their membership', async () => {
  const searchId = await createSearch(tokens.leader);
  const r = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.viewer}` },
  });
  assert.equal(r.status, 404);
});

test('Search membership: unshared ids are hidden and only an authorized manager may add members', async () => {
  const searchId = await createSearch(tokens.leader);
  const denied = await addMember(searchId, users.viewer.id, tokens.searcher);
  const unknown = await addMember(randomUUID(), users.viewer.id, tokens.searcher);
  assert.equal(denied.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await denied.json(), await unknown.json());

  const addSearcher = await addMember(searchId, users.searcher.id);
  assert.equal(addSearcher.status, 200);
  const memberDenied = await addMember(searchId, users.viewer.id, tokens.searcher);
  assert.equal(memberDenied.status, 403);

  const first = await addMember(searchId, users.viewer.id);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).added, true);

  const repeated = await addMember(searchId, users.viewer.id);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).added, false);

  const access = await fetch(`${base}/api/v1/searches/${searchId}`, {
    headers: { Authorization: `Bearer ${tokens.viewer}` },
  });
  assert.equal(access.status, 200);
});

test('Audit stream accepts coordinator notes but rejects user-forged system event types', async () => {
  const searchId = await createSearch(tokens.leader);
  const note = await fetch(`${base}/api/v1/searches/${searchId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ note: 'Briefing completed' }),
  });
  assert.equal(note.status, 200);

  const forged = await fetch(`${base}/api/v1/searches/${searchId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ type: 'SEARCH_CREATED', payload: { title: 'Fake' } }),
  });
  assert.equal(forged.status, 400);
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
  const addR = await addMember(searchId, users.searcher.id);
  assert.equal(addR.status, 200);
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
  const addR = await addMember(searchId, users.searcher.id);
  assert.equal(addR.status, 200);
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
  const addR = await addMember(searchId, users.searcher.id);
  assert.equal(addR.status, 200);
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

test('PATCH /tasks: existing and unknown task ids are indistinguishable outside membership', async () => {
  const searchId = await createSearch(tokens.leader);
  const taskR = await fetch(`${base}/api/v1/searches/${searchId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ title: 'Task' }),
  });
  assert.equal(taskR.status, 200);
  const task = await taskR.json();
  const existing = await fetch(`${base}/api/v1/tasks/${task.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.viewer}` },
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
  });
  const unknown = await fetch(`${base}/api/v1/tasks/${randomUUID()}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.viewer}` },
    body: JSON.stringify({ status: 'IN_PROGRESS' }),
  });
  assert.equal(existing.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await existing.json(), await unknown.json());
});

test('Search-scoped PATCH rechecks membership after a concurrent revocation commits', { timeout: 15000 }, async (t) => {
  const searchId = await createSearch(tokens.leader, `Search Write Race ${Date.now()}`);
  const before = await queryTestDatabase(
    `SELECT s.title, (SELECT count(*) FROM events e WHERE e.search_id=s.id)::int AS event_count
     FROM searches s WHERE s.id=$1`,
    [searchId],
  );
  assert.equal(before.rowCount, 1);

  if (!(await lockActivityAvailable(t))) return;

  const blocker = await connectTestDatabase();
  let mutation;
  let committed = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`search:${searchId}`]);
    mutation = fetch(`${base}/api/v1/searches/${searchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
      body: JSON.stringify({ title: 'Must not commit after revocation' }),
    });

    assert.equal(
      await waitForDatabaseLockWait('%pg_advisory_xact_lock%'),
      true,
      'PATCH did not wait for the search-scoped lock',
    );
    await blocker.query('DELETE FROM search_members WHERE search_id=$1 AND user_id=$2', [searchId, users.leader.id]);
    await blocker.query('COMMIT');
    committed = true;

    const response = await mutation;
    assert.equal(response.status, 404, 'The write must be denied after its membership is revoked');
    const after = await queryTestDatabase(
      `SELECT s.title, (SELECT count(*) FROM events e WHERE e.search_id=s.id)::int AS event_count
       FROM searches s WHERE s.id=$1`,
      [searchId],
    );
    assert.deepEqual(after.rows[0], before.rows[0], 'Denied write must not change search data or append an audit event');
  } finally {
    if (!committed) await blocker.query('ROLLBACK').catch(() => {});
    blocker.release();
    if (mutation) await mutation.catch(() => {});
  }
});

test('Search PATCH re-reads the actor role after a concurrent demotion commits', { timeout: 15000 }, async (t) => {
  const searchId = await createSearch(tokens.leader, `Search Role Race ${Date.now()}`);
  const before = await queryTestDatabase(
    `SELECT s.title, (SELECT count(*) FROM events e WHERE e.search_id=s.id)::int AS event_count
     FROM searches s WHERE s.id=$1`,
    [searchId],
  );
  if (!(await lockActivityAvailable(t))) return;

  const blocker = await connectTestDatabase();
  let mutation;
  let committed = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query("UPDATE users SET role='SEARCHER' WHERE id=$1", [users.leader.id]);
    mutation = fetch(`${base}/api/v1/searches/${searchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
      body: JSON.stringify({ title: 'Must not commit after demotion' }),
    });

    assert.equal(
      await waitForDatabaseLockWait('%ORDER BY id FOR SHARE%'),
      true,
      'PATCH did not wait for the actor role lock',
    );
    await blocker.query('COMMIT');
    committed = true;

    const response = await mutation;
    assert.equal(response.status, 403, 'A demoted member must lose manager permission before writing');
    const after = await queryTestDatabase(
      `SELECT s.title, (SELECT count(*) FROM events e WHERE e.search_id=s.id)::int AS event_count
       FROM searches s WHERE s.id=$1`,
      [searchId],
    );
    assert.deepEqual(after.rows[0], before.rows[0], 'Denied write must not change search data or append an audit event');
  } finally {
    if (!committed) await blocker.query('ROLLBACK').catch(() => {});
    blocker.release();
    if (mutation) await mutation.catch(() => {});
  }
});

test('Search PATCH rejects a session revoked while its transaction is starting', { timeout: 15000 }, async (t) => {
  const searchId = await createSearch(tokens.coordinator, `Search Session Race ${Date.now()}`);
  const before = await queryTestDatabase(
    `SELECT s.title, (SELECT count(*) FROM events e WHERE e.search_id=s.id)::int AS event_count
     FROM searches s WHERE s.id=$1`,
    [searchId],
  );
  if (!(await lockActivityAvailable(t))) return;

  const blocker = await connectTestDatabase();
  let mutation;
  let committed = false;
  try {
    await blocker.query('BEGIN');
    const removed = await blocker.query('DELETE FROM sessions WHERE user_id=$1', [users.coordinator.id]);
    assert.ok(removed.rowCount > 0, 'Expected a live session to revoke');
    mutation = fetch(`${base}/api/v1/searches/${searchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.coordinator}` },
      body: JSON.stringify({ title: 'Must not commit after logout' }),
    });

    assert.equal(
      await waitForDatabaseLockWait('%FROM sessions%'),
      true,
      'PATCH did not wait for the session lock',
    );
    await blocker.query('COMMIT');
    committed = true;

    const response = await mutation;
    assert.equal(response.status, 401, 'A revoked session must be rejected before writing');
    const after = await queryTestDatabase(
      `SELECT s.title, (SELECT count(*) FROM events e WHERE e.search_id=s.id)::int AS event_count
       FROM searches s WHERE s.id=$1`,
      [searchId],
    );
    assert.deepEqual(after.rows[0], before.rows[0], 'Rejected write must not change search data or append an audit event');
  } finally {
    if (!committed) await blocker.query('ROLLBACK').catch(() => {});
    blocker.release();
    if (mutation) await mutation.catch(() => {});
  }
});
