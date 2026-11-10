import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInitialReport } from '../dist/intake/initial-report.js';

const unknownReport = () => ({
  applicantName: null,
  applicantContact: null,
  missingPersonName: null,
  lastSeenTime: null,
  lastSeenPlace: null,
  situation: null,
});
const now = new Date('2026-11-10T12:00:00Z');

test('unknown information does not prevent initial report preparation', () => {
  assert.deepEqual(prepareInitialReport(unknownReport(), now), {
    ...unknownReport(), receivedAt: '2026-11-10T12:00:00.000Z',
  });
});

test('known values are trimmed, but unknown remains distinct', () => {
  const input = { ...unknownReport(), applicantName: ' Анна ', situation: '  Звонок  ' };
  const result = prepareInitialReport(input, now);
  assert.equal(result.applicantName, 'Анна');
  assert.equal(result.applicantContact, null);
  assert.equal(result.situation, 'Звонок');
  assert.equal(input.applicantName, ' Анна ');
});

test('each field must be explicitly known or unknown', () => {
  for (const key of Object.keys(unknownReport())) {
    const omitted = unknownReport();
    delete omitted[key];
    assert.throws(() => prepareInitialReport(omitted, now), undefined, key);
    assert.throws(() => prepareInitialReport({ ...unknownReport(), [key]: '  ' }, now), undefined, key);
    assert.throws(() => prepareInitialReport({ ...unknownReport(), [key]: 17 }, now), undefined, key);
  }
});

test('receipt timestamp is server-supplied and input cannot contain extra fields', () => {
  assert.throws(() => prepareInitialReport({ ...unknownReport(), receivedAt: '2000-01-01' }, now));
  assert.throws(() => prepareInitialReport({ ...unknownReport(), medicalNotes: 'private' }, now));
  assert.throws(() => prepareInitialReport(unknownReport(), new Date('invalid')));
});
