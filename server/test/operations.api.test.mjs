import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestDatabase, connectTestDatabase, createTestUser, ensureTestOwner, queryTestDatabase } from './db.mjs';

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

const createSearch = async (token, title = `Ops Search ${Date.now()}`) => {
  const r = await fetch(`${base}/api/v1/searches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title }),
  });
  assert.equal(r.status, 200, 'Create search failed');
  return (await r.json()).id;
};

const timestamp = Date.now();
const users = {
  systemOwner: {
    email: process.env.KUKLA_TEST_OWNER_EMAIL ?? 'owner@kukla.local',
    password: process.env.KUKLA_TEST_OWNER_PASSWORD ?? 'owner-pass-123456',
    role: 'SYSTEM_OWNER',
  },
  leader: { email: `ops-leader-${timestamp}@test.local`, password: 'leader-pass-123456', role: 'LEADER' },
  coordinator: { email: `ops-coord-${timestamp}@test.local`, password: 'coord-pass-123456', role: 'COORDINATOR' },
  searcher: { email: `ops-searcher-${timestamp}@test.local`, password: 'searcher-pass-123456', role: 'SEARCHER' },
};

for (const [key, user] of Object.entries(users)) {
  if (key === 'systemOwner') continue;
  user.id = await createTestUser(user.role, user.email, user.password);
}
const tokens = {};
await ensureTestOwner(users.systemOwner.email, users.systemOwner.password);
for (const [key, user] of Object.entries(users)) {
  tokens[key] = await login(user.email, user.password);
}
{
  const me = await fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${tokens.systemOwner}` } });
  users.systemOwner.id = (await me.json()).id;
}

const addMember = (searchId, userId, token = tokens.leader) => fetch(
  `${base}/api/v1/searches/${searchId}/members`,
  { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ userId }) },
);

const setupManagedSearch = async () => {
  const searchId = await createSearch(tokens.leader);
  await addMember(searchId, users.searcher.id);
  return searchId;
};

test('sectors: management creates; non-manager is forbidden; member can list; team assignment is scoped', async () => {
  const searchId = await setupManagedSearch();

  const forbidden = await fetch(`${base}/api/v1/searches/${searchId}/sectors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ code: 'A1', geometry: { type: 'Polygon', coordinates: [] } }),
  });
  assert.equal(forbidden.status, 403);

  const created = await fetch(`${base}/api/v1/searches/${searchId}/sectors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ code: 'A1', name: 'Sector A1', priority: 1, geometry: { type: 'Polygon', coordinates: [] } }),
  });
  assert.equal(created.status, 200);
  const sector = await created.json();
  assert.equal(sector.code, 'A1');

  const list = await fetch(`${base}/api/v1/searches/${searchId}/sectors`, {
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(list.status, 200);
  assert.ok((await list.json()).some((s) => s.id === sector.id));

  const team = await queryTestDatabase(
    "INSERT INTO search_teams(search_id, name, team_type, status) VALUES($1,'Foot A','FOOT','ASSIGNED') RETURNING id",
    [searchId],
  );
  const teamId = team.rows[0].id;
  const assigned = await fetch(`${base}/api/v1/searches/${searchId}/sectors/${sector.id}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ teamId }),
  });
  assert.equal(assigned.status, 200, 'Team assignment should succeed');

  const foreignTeam = await queryTestDatabase(
    "INSERT INTO search_teams(search_id, name, team_type, status) VALUES($1,'Other','VEHICLE','AVAILABLE') RETURNING id",
    [users.systemOwner.id],
  );
  const badAssign = await fetch(`${base}/api/v1/searches/${searchId}/sectors/${sector.id}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ teamId: foreignTeam.rows[0].id }),
  });
  assert.equal(badAssign.status, 400, 'Team from another search must be rejected');
});

test('periods: create and set briefing/debriefing', async () => {
  const searchId = await setupManagedSearch();
  const created = await fetch(`${base}/api/v1/searches/${searchId}/periods`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ name: 'Shift 1', startsAt: new Date().toISOString() }),
  });
  assert.equal(created.status, 200);
  const period = await created.json();

  const patched = await fetch(`${base}/api/v1/searches/${searchId}/periods/${period.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ status: 'ACTIVE', briefing: 'Утренний инструктаж', debriefing: 'Итоги смены' }),
  });
  assert.equal(patched.status, 200);
  const updated = await patched.json();
  assert.equal(updated.briefing, 'Утренний инструктаж');
  assert.equal(updated.debriefing, 'Итоги смены');
});

test('check-ins: SOS/HELP raises an emergency event and notifies managers', async () => {
  const searchId = await setupManagedSearch();
  const sos = await fetch(`${base}/api/v1/searches/${searchId}/checkins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ status: 'EMERGENCY', lat: 55.0, lng: 73.0 }),
  });
  assert.equal(sos.status, 200);

  const emergencies = await fetch(`${base}/api/v1/searches/${searchId}/checkins/emergencies`, {
    headers: { Authorization: `Bearer ${tokens.leader}` },
  });
  assert.equal(emergencies.status, 200);
  const list = await emergencies.json();
  assert.ok(list.length >= 1, 'An open emergency should be reported');

  const notifications = await queryTestDatabase(
    "SELECT 1 FROM notifications WHERE search_id=$1 AND type='SOS' AND user_id=$2",
    [searchId, users.leader.id],
  );
  assert.ok(notifications.rowCount >= 1, 'Manager should be notified of the SOS');
});

test('clues: member reports; manager updates and deletes', async () => {
  const searchId = await setupManagedSearch();
  const created = await fetch(`${base}/api/v1/searches/${searchId}/clues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.searcher}` },
    body: JSON.stringify({ clueType: 'CLOTHING', description: 'Найдена куртка', lat: 55.1, lng: 73.1 }),
  });
  assert.equal(created.status, 200);
  const clue = await created.json();

  const updated = await fetch(`${base}/api/v1/searches/${searchId}/clues/${clue.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ status: 'CONFIRMED' }),
  });
  assert.equal(updated.status, 200);

  const deleted = await fetch(`${base}/api/v1/searches/${searchId}/clues/${clue.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokens.leader}` },
  });
  assert.equal(deleted.status, 200);
});

test('resources: management CRUD', async () => {
  const searchId = await setupManagedSearch();
  const created = await fetch(`${base}/api/v1/searches/${searchId}/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ resourceType: 'K9', name: 'Собака Рекс' }),
  });
  assert.equal(created.status, 200);
  const resource = await created.json();

  const patched = await fetch(`${base}/api/v1/searches/${searchId}/resources/${resource.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ status: 'IN_USE' }),
  });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).status, 'IN_USE');

  const deleted = await fetch(`${base}/api/v1/searches/${searchId}/resources/${resource.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokens.leader}` },
  });
  assert.equal(deleted.status, 200);
});

test('closeout: management closes the search and marks it COMPLETED', async () => {
  const searchId = await setupManagedSearch();
  const closed = await fetch(`${base}/api/v1/searches/${searchId}/closeout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ reason: 'Поиск завершён', outcome: 'INCONCLUSIVE', summary: 'Обследовано 12 секторов' }),
  });
  assert.equal(closed.status, 200);

  const reopen = await fetch(`${base}/api/v1/searches/${searchId}/closeout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.leader}` },
    body: JSON.stringify({ reason: 'повторно' }),
  });
  assert.equal(reopen.status, 409, 'Double closeout must be rejected');

  const status = await queryTestDatabase('SELECT status FROM searches WHERE id=$1', [searchId]);
  assert.equal(status.rows[0].status, 'COMPLETED');

  const view = await fetch(`${base}/api/v1/searches/${searchId}/closeout`, {
    headers: { Authorization: `Bearer ${tokens.searcher}` },
  });
  assert.equal(view.status, 200, 'Members may read the closeout record');
});
