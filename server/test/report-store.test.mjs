import test from 'node:test';
import assert from 'node:assert/strict';
import { insertInitialReport } from '../dist/intake/report-store.js';

const empty = () => ({ applicantName: null, applicantContact: null, missingPersonName: null, lastSeenTime: null, lastSeenPlace: null, situation: null });

test('inserts validated report with parameters and database-generated receipt time', async () => {
  const time = new Date('2026-11-10T10:00:00Z');
  let calls = 0;
  const client = { query: async (sql, params) => {
    calls++;
    assert.match(sql, /INSERT INTO initial_reports/);
    assert.doesNotMatch(sql, /received_at\s*\)/);
    assert.doesNotMatch(sql, /Анна/);
    assert.deepEqual(params, ['actor-id', 'Анна', null, null, null, null, null, 'test-key', 'test-fingerprint']);
    return { rowCount: 1, rows: [{ id: 'report-id', received_at: time }] };
  } };
  assert.deepEqual(await insertInitialReport(client, 'actor-id', { ...empty(), applicantName: ' Анна ' }, 'test-key', 'test-fingerprint'), { id: 'report-id', receivedAt: time, created: true });
  assert.equal(calls, 1);
});

test('invalid input or missing actor never reaches the database', async () => {
  const client = { query: async () => { throw new Error('must not query'); } };
  await assert.rejects(insertInitialReport(client, ' ', empty()), /actor is required/);
  await assert.rejects(insertInitialReport(client, 'actor-id', { ...empty(), situation: '  ' }));
  await assert.rejects(insertInitialReport(client, 'actor-id', { ...empty(), receivedAt: 'fake' }));
});
