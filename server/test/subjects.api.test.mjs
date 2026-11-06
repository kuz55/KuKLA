import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { closeTestDatabase, createTestUser, queryTestDatabase } from './db.mjs';

const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';
after(closeTestDatabase);

const login = async (email, password) => {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: email, password }),
  });
  assert.equal(response.status, 200, `Login failed for ${email}`);
  return (await response.json()).token;
};

const request = (token, path, method = 'GET', body) => fetch(`${base}/api/v1${path}`, {
  method,
  headers: {
    Authorization: `Bearer ${token}`,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const timestamp = Date.now();
const makeUser = async (role, email, password) => ({
  id: await createTestUser(role, email, password),
  email,
  password,
});
const users = {
  leader: await makeUser('LEADER', `subject-leader-${timestamp}@test.local`, 'subject-leader-pass-123456'),
  otherLeader: await makeUser('LEADER', `subject-other-${timestamp}@test.local`, 'subject-other-pass-123456'),
  regionalManager: await makeUser('REGIONAL_MANAGER', `subject-regional-${timestamp}@test.local`, 'subject-regional-pass-123456'),
  searcher: await makeUser('SEARCHER', `subject-searcher-${timestamp}@test.local`, 'subject-searcher-pass-123456'),
  viewer: await makeUser('VIEWER', `subject-viewer-${timestamp}@test.local`, 'subject-viewer-pass-123456'),
  outsider: await makeUser('SEARCHER', `subject-outsider-${timestamp}@test.local`, 'subject-outsider-pass-123456'),
};
const tokens = {};
for (const [key, user] of Object.entries(users)) tokens[key] = await login(user.email, user.password);

const createSearch = async (token, title) => {
  const response = await request(token, '/searches', 'POST', { title });
  assert.equal(response.status, 200, 'Search creation failed');
  return (await response.json()).id;
};

const searchId = await createSearch(tokens.leader, `Subject API Search ${timestamp}`);
const otherSearchId = await createSearch(tokens.otherLeader, `Other Subject Search ${timestamp}`);
for (const key of ['searcher', 'viewer', 'regionalManager']) {
  const response = await request(tokens.leader, `/searches/${searchId}/members`, 'POST', { userId: users[key].id });
  assert.equal(response.status, 200);
}

let subjectId;
let foreignSubjectId;

const subjectPayload = {
  fullName: 'Тестовый человек',
  age: 31,
  sex: 'Не указано',
  description: 'Краткое описание для теста',
  clothing: 'Синяя куртка',
  medicalNotes: 'Сведения ограниченного доступа',
  photoUrl: 'https://example.invalid/subject.jpg',
  photo_url: 'https://example.invalid/subject.jpg',
  lastKnownLat: 58.0105,
  lastKnownLng: 56.2502,
  lastKnownAt: '2026-11-04T03:00:00.000Z',
};

test('subject profiles are visible only to authorized search managers', async () => {
  const managerRead = await request(tokens.leader, `/searches/${searchId}/subjects`);
  assert.equal(managerRead.status, 200);
  assert.deepEqual(await managerRead.json(), []);

  const regionalManagerRead = await request(tokens.regionalManager, `/searches/${searchId}/subjects`);
  assert.equal(regionalManagerRead.status, 200);
  assert.deepEqual(await regionalManagerRead.json(), []);

  const searcherRead = await request(tokens.searcher, `/searches/${searchId}/subjects`);
  const viewerRead = await request(tokens.viewer, `/searches/${searchId}/subjects`);
  assert.equal(searcherRead.status, 403);
  assert.equal(viewerRead.status, 403);

  const foreignRead = await request(tokens.outsider, `/searches/${searchId}/subjects`);
  const unknownRead = await request(tokens.outsider, `/searches/${randomUUID()}/subjects`);
  const managerWithoutAccess = await request(tokens.regionalManager, `/searches/${otherSearchId}/subjects`);
  assert.equal(foreignRead.status, 404);
  assert.equal(unknownRead.status, 404);
  assert.equal(managerWithoutAccess.status, 404, 'A management role alone does not grant access to another search');
  assert.deepEqual(await foreignRead.json(), await unknownRead.json());
});

test('manager can create a validated subject profile with a non-PII audit record', async () => {
  const denied = await request(tokens.searcher, `/searches/${searchId}/subjects`, 'POST', subjectPayload);
  assert.equal(denied.status, 403);

  const unknown = await request(tokens.leader, `/searches/${randomUUID()}/subjects`, 'POST', subjectPayload);
  assert.equal(unknown.status, 404);

  const invalid = await request(tokens.leader, `/searches/${searchId}/subjects`, 'POST', {
    fullName: 'Invalid location',
    lastKnownLat: 58.01,
  });
  assert.equal(invalid.status, 400, 'Latitude and longitude must be supplied together');

  const created = await request(tokens.leader, `/searches/${searchId}/subjects`, 'POST', subjectPayload);
  assert.equal(created.status, 200);
  const subject = await created.json();
  subjectId = subject.id;
  assert.equal(subject.searchId, searchId);
  assert.equal(subject.fullName, subjectPayload.fullName);
  assert.equal(subject.medicalNotes, subjectPayload.medicalNotes);
  assert.equal(Object.hasOwn(subject, 'photoUrl'), false);
  assert.equal(Object.hasOwn(subject, 'photo_url'), false);
  const photoColumn = await queryTestDatabase('SELECT photo_url FROM subjects WHERE id=$1', [subjectId]);
  assert.equal(photoColumn.rows[0].photo_url, null, 'Photo URL is not accepted or stored by this API slice');
  assert.equal(subject.lastKnownLat, subjectPayload.lastKnownLat);
  assert.equal(subject.lastKnownLng, subjectPayload.lastKnownLng);
  assert.ok(subject.createdAt);
  assert.ok(subject.updatedAt);

  const audit = await queryTestDatabase(
    `SELECT payload FROM events WHERE search_id=$1 AND type='SUBJECT_CREATED' ORDER BY id DESC LIMIT 1`,
    [searchId],
  );
  assert.deepEqual(audit.rows[0].payload, { subjectId }, 'Audit payload must not duplicate sensitive profile fields');

  const managerEvents = await request(tokens.leader, `/searches/${searchId}/events`);
  const regionalManagerEvents = await request(tokens.regionalManager, `/searches/${searchId}/events`);
  const memberEvents = await request(tokens.searcher, `/searches/${searchId}/events`);
  assert.ok((await managerEvents.json()).some((event) => event.type === 'SUBJECT_CREATED'));
  const regionalSubjects = await request(tokens.regionalManager, `/searches/${searchId}/subjects`);
  assert.ok((await regionalSubjects.json()).some((record) => record.id === subjectId));
  assert.ok((await regionalManagerEvents.json()).some((event) => event.type === 'SUBJECT_CREATED'));
  assert.ok(!(await memberEvents.json()).some((event) => event.type === 'SUBJECT_CREATED'), 'Subject audit metadata is manager-only too');
  const [managerSnapshot, memberSnapshot] = await Promise.all([
    request(tokens.leader, `/searches/${searchId}/snapshot`),
    request(tokens.searcher, `/searches/${searchId}/snapshot`),
  ]);
  assert.ok((await managerSnapshot.json()).events.some((event) => event.type === 'SUBJECT_CREATED'));
  assert.ok(!(await memberSnapshot.json()).events.some((event) => event.type === 'SUBJECT_CREATED'), 'Subject audit metadata must also be hidden from snapshots');
});

test('manager can update a subject and the change audit contains field names only', async () => {
  const denied = await request(tokens.viewer, `/searches/${searchId}/subjects/${subjectId}`, 'PATCH', { description: 'Unauthorized' });
  assert.equal(denied.status, 403);

  const empty = await request(tokens.leader, `/searches/${searchId}/subjects/${subjectId}`, 'PATCH', {});
  assert.equal(empty.status, 400);

  const update = {
    description: 'Обновлённое описание',
    medicalNotes: null,
    lastKnownLat: null,
    lastKnownLng: null,
    lastKnownAt: null,
  };
  const response = await request(tokens.leader, `/searches/${searchId}/subjects/${subjectId}`, 'PATCH', update);
  assert.equal(response.status, 200);
  const subject = await response.json();
  assert.equal(subject.description, update.description);
  assert.equal(subject.medicalNotes, null);
  assert.equal(subject.lastKnownLat, null);
  assert.equal(subject.lastKnownLng, null);
  assert.equal(subject.lastKnownAt, null);

  const audit = await queryTestDatabase(
    `SELECT payload FROM events WHERE search_id=$1 AND type='SUBJECT_UPDATED' ORDER BY id DESC LIMIT 1`,
    [searchId],
  );
  assert.deepEqual(audit.rows[0].payload, { subjectId, fields: Object.keys(update) });
  const memberEvents = await request(tokens.searcher, `/searches/${searchId}/events`);
  assert.ok(!(await memberEvents.json()).some((event) => event.type === 'SUBJECT_UPDATED'), 'Subject update audit metadata is manager-only too');
});

test('hard deletion is not exposed by the subject API', async () => {
  const response = await request(tokens.leader, `/searches/${searchId}/subjects/${subjectId}`, 'DELETE');
  assert.equal(response.status, 404);
  const stored = await queryTestDatabase('SELECT id FROM subjects WHERE id=$1', [subjectId]);
  assert.equal(stored.rowCount, 1, 'The subject remains stored because deletion is out of scope');
});

test('subject ids are scoped to their search and unknown ids remain indistinguishable', async () => {
  const foreignCreate = await request(tokens.otherLeader, `/searches/${otherSearchId}/subjects`, 'POST', {
    fullName: 'Foreign subject',
  });
  assert.equal(foreignCreate.status, 200);
  foreignSubjectId = (await foreignCreate.json()).id;

  const foreign = await request(tokens.leader, `/searches/${searchId}/subjects/${foreignSubjectId}`, 'PATCH', { description: 'Attempted cross-search update' });
  const unknown = await request(tokens.leader, `/searches/${searchId}/subjects/${randomUUID()}`, 'PATCH', { description: 'Unknown subject' });
  assert.equal(foreign.status, 404);
  assert.equal(unknown.status, 404);
  assert.deepEqual(await foreign.json(), await unknown.json());
});

test('subject update and its audit event roll back together on audit failure', async () => {
  const triggerName = `test_subject_audit_failure_${timestamp}`;
  const functionName = `test_subject_audit_failure_fn_${timestamp}`;
  await queryTestDatabase(`
    CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.type = 'SUBJECT_UPDATED' THEN RAISE EXCEPTION 'forced subject audit failure'; END IF;
      RETURN NEW;
    END;
    $$
  `);
  await queryTestDatabase(`
    CREATE TRIGGER ${triggerName} BEFORE INSERT ON events
    FOR EACH ROW EXECUTE FUNCTION ${functionName}()
  `);

  try {
    const before = await queryTestDatabase('SELECT description FROM subjects WHERE id=$1', [subjectId]);
    const response = await request(tokens.leader, `/searches/${searchId}/subjects/${subjectId}`, 'PATCH', {
      description: 'This must roll back',
    });
    assert.equal(response.status, 500);

    const after = await queryTestDatabase('SELECT description FROM subjects WHERE id=$1', [subjectId]);
    assert.equal(after.rows[0].description, before.rows[0].description);
    const audit = await queryTestDatabase(
      "SELECT count(*)::int AS count FROM events WHERE search_id=$1 AND type='SUBJECT_UPDATED'",
      [searchId],
    );
    assert.equal(audit.rows[0].count, 1, 'Only the earlier successful update should remain');
  } finally {
    await queryTestDatabase(`DROP TRIGGER IF EXISTS ${triggerName} ON events`);
    await queryTestDatabase(`DROP FUNCTION IF EXISTS ${functionName}()`);
  }
});
