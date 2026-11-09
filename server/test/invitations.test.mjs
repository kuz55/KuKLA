import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { closeTestDatabase, createTestUser, ensureTestOwner, queryTestDatabase } from './db.mjs';

const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';
after(closeTestDatabase);

const login = async (email, password) => {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login: email, password }),
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
};

const ownerEmail = process.env.KUKLA_TEST_OWNER_EMAIL ?? 'owner@kukla.local';
const ownerPassword = process.env.KUKLA_TEST_OWNER_PASSWORD ?? 'owner-pass-123456';
const ownerId = await ensureTestOwner(ownerEmail, ownerPassword);
const ownerToken = await login(ownerEmail, ownerPassword);
const timestamp = Date.now();
const invitedEmail = `invited-${timestamp}@test.local`;
let invitation;

const authHeaders = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

test('admin invitation is one-time, creates a session, and cannot be replayed', async () => {
  const created = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ name: 'Invited Searcher', email: invitedEmail, role: 'SEARCHER' }),
  });
  assert.equal(created.status, 200);
  invitation = await created.json();
  assert.ok(invitation.id);
  assert.ok(invitation.token);
  assert.ok(invitation.expires_at);

  const accepted = await fetch(`${base}/api/v1/auth/accept-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invitation.token, password: 'invite-test-password-123' }),
  });
  assert.equal(accepted.status, 200);
  const session = await accepted.json();
  assert.equal(session.user.email, invitedEmail);
  assert.equal(session.user.role, 'SEARCHER');
  assert.ok(session.token);

  const me = await fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).id, session.user.id);

  const replay = await fetch(`${base}/api/v1/auth/accept-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invitation.token, password: 'another-invite-password-123' }),
  });
  assert.equal(replay.status, 400);
});

test('concurrent acceptance of one invitation creates only one account and session', async () => {
  const email = `concurrent-${timestamp}@test.local`;
  const created = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ name: 'Concurrent Invite', email, role: 'SEARCHER' }),
  });
  assert.equal(created.status, 200);
  const pending = await created.json();

  const responses = await Promise.all([
    fetch(`${base}/api/v1/auth/accept-invitation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pending.token, password: 'concurrent-password-1234' }),
    }),
    fetch(`${base}/api/v1/auth/accept-invitation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: pending.token, password: 'another-concurrent-password-1234' }),
    }),
  ]);
  const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
  assert.deepEqual(statuses, [200, 400]);

  const accepted = await responses.find((response) => response.status === 200).json();
  assert.equal(accepted.user.email, email);
  const session = await fetch(`${base}/api/v1/me`, {
    headers: { Authorization: `Bearer ${accepted.token}` },
  });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).id, accepted.user.id);
});

test('acceptance and revocation races produce exactly one terminal state', async () => {
  const email = `accept-revoke-race-${timestamp}@test.local`;
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const inserted = await queryTestDatabase(
    `INSERT INTO user_invitations(name,email,role,token_hash,invited_by,expires_at)
     VALUES($1,$2,'SEARCHER',$3,$4,now()+interval '24 hours') RETURNING id`,
    ['Acceptance/revocation race', email, tokenHash, ownerId],
  );
  const invitationId = inserted.rows[0].id;

  const [acceptance, revocation] = await Promise.all([
    fetch(`${base}/api/v1/auth/accept-invitation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'race-test-password-1234' }),
    }),
    fetch(`${base}/api/v1/users/invitations/${invitationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}` },
    }),
  ]);

  if (acceptance.status === 200) {
    assert.equal(revocation.status, 404);
  } else {
    assert.equal(acceptance.status, 400);
    assert.equal(revocation.status, 200);
  }

  const state = await queryTestDatabase(
    'SELECT accepted_at,revoked_at FROM user_invitations WHERE id=$1',
    [invitationId],
  );
  assert.equal(Number(Boolean(state.rows[0].accepted_at)) + Number(Boolean(state.rows[0].revoked_at)), 1);
  const user = await queryTestDatabase('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
  assert.equal(user.rowCount, acceptance.status === 200 ? 1 : 0);
});

test('an invitation must provide exactly one valid contact method', async () => {
  const missingContact = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ name: 'Missing Contact', role: 'SEARCHER' }),
  });
  assert.equal(missingContact.status, 400);

  const multipleContacts = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({
      name: 'Multiple Contacts',
      email: `multiple-${timestamp}@test.local`,
      phone: '+358401234567',
      role: 'SEARCHER',
    }),
  });
  assert.equal(multipleContacts.status, 400);
});

test('expired invitations cannot be accepted', async () => {
  const email = `expired-${timestamp}@test.local`;
  const created = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ name: 'Expired Invite', email, role: 'SEARCHER' }),
  });
  assert.equal(created.status, 200);
  const pending = await created.json();
  await queryTestDatabase(
    "UPDATE user_invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
    [pending.id],
  );

  const acceptance = await fetch(`${base}/api/v1/auth/accept-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pending.token, password: 'expired-invite-password-123' }),
  });
  assert.equal(acceptance.status, 400);
  assert.equal((await acceptance.json()).message, 'Invitation is invalid or expired');

  const state = await queryTestDatabase(
    'SELECT accepted_at FROM user_invitations WHERE id=$1',
    [pending.id],
  );
  assert.equal(state.rows[0].accepted_at, null);
});

test('invitation management never returns token hashes and rejects duplicate contacts', async () => {
  const listed = await fetch(`${base}/api/v1/users/invitations`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  assert.equal(listed.status, 200);
  const rows = await listed.json();
  const acceptedRow = rows.find((row) => row.id === invitation.id);
  assert.ok(acceptedRow);
  assert.equal('token' in acceptedRow, false);
  assert.equal('token_hash' in acceptedRow, false);

  const duplicate = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ name: 'Duplicate', email: invitedEmail, role: 'SEARCHER' }),
  });
  assert.equal(duplicate.status, 409);
});

test('pending invitations can be revoked, and non-admins cannot manage them', async () => {
  const email = `revoke-${timestamp}@test.local`;
  const created = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ name: 'Revoked Invite', email, role: 'SEARCHER' }),
  });
  assert.equal(created.status, 200);
  const pending = await created.json();
  const duplicatePending = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ name: 'Duplicate Pending', email, role: 'SEARCHER' }),
  });
  assert.equal(duplicatePending.status, 409);

  const searcherEmail = `non-admin-${timestamp}@test.local`;
  await createTestUser('SEARCHER', searcherEmail);
  const searcherToken = await login(searcherEmail, 'test-pass-123456');
  const listDenied = await fetch(`${base}/api/v1/users/invitations`, {
    headers: { Authorization: `Bearer ${searcherToken}` },
  });
  assert.equal(listDenied.status, 403);
  const revokeDenied = await fetch(`${base}/api/v1/users/invitations/${pending.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${searcherToken}` },
  });
  assert.equal(revokeDenied.status, 403);

  const revoked = await fetch(`${base}/api/v1/users/invitations/${pending.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(revoked.status, 200);
  const revokeAgain = await fetch(`${base}/api/v1/users/invitations/${pending.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(revokeAgain.status, 404);

  const acceptance = await fetch(`${base}/api/v1/auth/accept-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pending.token, password: 'revoked-invite-password-123' }),
  });
  assert.equal(acceptance.status, 400);
});

test('a SEARCHER cannot invite or assign elevated roles', async () => {
  const email = `unauthorized-${timestamp}@test.local`;
  await createTestUser('SEARCHER', email);
  const token = await login(email, 'test-pass-123456');
  const response = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ name: 'Unauthorized', email: `forbidden-${timestamp}@test.local`, role: 'ADMIN' }),
  });
  assert.equal(response.status, 403);
});

test('an invitation becomes invalid if its inviter loses assignment permission', async () => {
  const inviterEmail = `demoted-inviter-${timestamp}@test.local`;
  const inviterId = await createTestUser('ADMIN', inviterEmail);
  const inviterToken = await login(inviterEmail, 'test-pass-123456');
  const email = `demoted-invite-${timestamp}@test.local`;
  const created = await fetch(`${base}/api/v1/users/invitations`, {
    method: 'POST',
    headers: authHeaders(inviterToken),
    body: JSON.stringify({ name: 'Demoted Invite', email, role: 'SEARCHER' }),
  });
  assert.equal(created.status, 200);
  const pending = await created.json();

  const demoted = await fetch(`${base}/api/v1/users/${inviterId}`, {
    method: 'PATCH',
    headers: authHeaders(ownerToken),
    body: JSON.stringify({ role: 'SEARCHER' }),
  });
  assert.equal(demoted.status, 200);
  assert.equal((await demoted.json()).role, 'SEARCHER');

  const acceptance = await fetch(`${base}/api/v1/auth/accept-invitation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: pending.token, password: 'demoted-invite-password-123' }),
  });
  assert.equal(acceptance.status, 400);
  assert.equal((await acceptance.json()).message, 'Invitation is no longer valid');

  const [invitationState, userState] = await Promise.all([
    queryTestDatabase('SELECT accepted_at FROM user_invitations WHERE id=$1', [pending.id]),
    queryTestDatabase('SELECT id FROM users WHERE lower(email)=lower($1)', [email]),
  ]);
  assert.equal(invitationState.rows[0].accepted_at, null);
  assert.equal(userState.rowCount, 0);
});
