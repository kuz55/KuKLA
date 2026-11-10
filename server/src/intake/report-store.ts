import type { PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';
import { initialReportInputSchema } from './initial-report.js';

// Internal persistence primitive. Caller must authenticate/authorize and
// supply a transaction; conflict handling and the audit belong to that unit.
export async function insertInitialReport(client: Pick<PoolClient, 'query'>, actorId: string, input: unknown, requestKey: string, fingerprint: string): Promise<{ id: string; receivedAt: Date; created: boolean }> {
  if (!actorId.trim()) throw new Error('actor is required');
  const data = initialReportInputSchema.parse(input);
  const result = await client.query<{ id: string; received_at: Date }>(
    `INSERT INTO initial_reports
      (recorded_by, applicant_name, applicant_contact, missing_person_name, last_seen_time, last_seen_place, situation, request_key, request_fingerprint)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (recorded_by, request_key) WHERE request_key IS NOT NULL DO NOTHING
     RETURNING id, received_at`,
    [actorId, data.applicantName, data.applicantContact, data.missingPersonName, data.lastSeenTime, data.lastSeenPlace, data.situation, requestKey, fingerprint],
  );
  if (result.rowCount) return { id: result.rows[0].id, receivedAt: result.rows[0].received_at, created: true };
  // PostgreSQL waits for a concurrent conflicting insert to commit, then the
  // subsequent statement sees it under the default READ COMMITTED isolation.
  const previous = await client.query<{ id: string; received_at: Date; request_fingerprint: string }>(
    'SELECT id, received_at, request_fingerprint FROM initial_reports WHERE recorded_by=$1 AND request_key=$2',
    [actorId, requestKey],
  );
  if (!previous.rowCount) throw new Error('idempotency record unavailable');
  if (previous.rows[0].request_fingerprint !== fingerprint) throw httpErrors.conflict('Request key already used for different data');
  return { id: previous.rows[0].id, receivedAt: previous.rows[0].received_at, created: false };
}
