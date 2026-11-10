import type { Pool, PoolClient } from 'pg';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { JWT_SECRET } from '../config.js';
import { initialReportInputSchema } from './initial-report.js';
import { httpErrors } from '@fastify/sensible';
import { insertInitialReport } from './report-store.js';
import { requireSearchAccessForUser } from '../http.js';
import type { User } from '../types.js';

type Permission = 'RECORD' | 'REGISTER';

async function permission(client: PoolClient, actor: string, right: Permission) {
  // Shared row locks serialize permission revocation and user deactivation with the protected transaction.
  const result = await client.query(
    'SELECT 1 FROM intake_permissions p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.permission=$2 AND u.active=true FOR SHARE OF p, u', [actor, right],
  );
  if (!result.rowCount) throw httpErrors.forbidden('Intake permission required');
}

export class IntakeService {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async create(actor: string, input: unknown, requestKey: string) {
    const key = z.string().uuid().parse(requestKey);
    const data = initialReportInputSchema.parse(input);
    // Canonical, validated fields; keyed hash avoids storing another PII copy.
    // This experimental API remains disabled in production. Key rotation makes
    // old requests conflict safely instead of duplicating their reports.
    const fingerprint = createHmac('sha256', JWT_SECRET).update('initial-report-v1\0').update(JSON.stringify(data)).digest('hex');
    return this.transaction(async (client) => {
      await permission(client, actor, 'RECORD');
      const report = await insertInitialReport(client, actor, data, key, fingerprint);
      if (report.created) await client.query("INSERT INTO initial_report_audit(report_id, actor_id, action) VALUES ($1,$2,'CREATED')", [report.id, actor]);
      return { id: report.id, receivedAt: report.receivedAt };
    });
  }

  async handOff(actor: string, reportId: string) {
    return this.transaction(async (client) => {
      await permission(client, actor, 'RECORD');
      // Only the original operator can hand off. Atomic update prevents
      // simultaneous requests from producing duplicate audit events.
      const result = await client.query(
        'UPDATE initial_reports SET handed_off_at=now() WHERE id=$1 AND recorded_by=$2 AND handed_off_at IS NULL RETURNING handed_off_at',
        [reportId, actor],
      );
      if (!result.rowCount) {
        const previous = await client.query('SELECT handed_off_at FROM initial_reports WHERE id=$1 AND recorded_by=$2', [reportId, actor]);
        if (!previous.rowCount || previous.rows[0].handed_off_at === null) throw httpErrors.notFound('Report not found');
        return { handedOffAt: previous.rows[0].handed_off_at as Date };
      }
      await client.query("INSERT INTO initial_report_audit(report_id, actor_id, action) VALUES ($1,$2,'HANDED_OFF')", [reportId, actor]);
      return { handedOffAt: result.rows[0].handed_off_at as Date };
    });
  }

  async queue(actor: string, after?: string, limit = 100) {
    return this.transaction(async (client) => {
      await permission(client, actor, 'REGISTER');
      // The cursor is a report ID rather than a JS timestamp: PostgreSQL
      // timestamps can have microsecond precision, which JS Date would lose.
      const result = await client.query(
        `SELECT id, received_at, handed_off_at FROM initial_reports
         WHERE handed_off_at IS NOT NULL AND resolved_at IS NULL
           AND ($1::uuid IS NULL OR (handed_off_at, id) >
             (SELECT handed_off_at, id FROM initial_reports WHERE id=$1 AND handed_off_at IS NOT NULL))
         ORDER BY handed_off_at ASC, id ASC LIMIT $2`,
        [after ?? null, limit + 1],
      );
      const items = result.rows.slice(0, limit);
      return { items, nextCursor: result.rows.length > limit ? items[items.length - 1].id as string : null };
    });
  }

  async getForRegistrar(actor: string, reportId: string) {
    return this.transaction(async (client) => {
      await permission(client, actor, 'REGISTER');
      const result = await client.query(
        `SELECT id, received_at, handed_off_at, applicant_name, applicant_contact, missing_person_name,
                last_seen_time, last_seen_place, situation, resolved_at, resolved_by, search_id, resolution_reason
         FROM initial_reports WHERE id=$1 AND handed_off_at IS NOT NULL`, [reportId],
      );
      if (!result.rowCount) throw httpErrors.notFound('Report not found');
      return result.rows[0];
    });
  }

  async getForOperator(actor: string, reportId: string) {
    return this.transaction(async (client) => {
      await permission(client, actor, 'RECORD');
      const result = await client.query(
        `SELECT id, received_at, handed_off_at, applicant_name, applicant_contact, missing_person_name,
                last_seen_time, last_seen_place, situation, resolved_at, resolved_by, search_id, resolution_reason
         FROM initial_reports WHERE id=$1 AND recorded_by=$2`, [reportId, actor],
      );
      if (!result.rowCount) throw httpErrors.notFound('Report not found');
      return result.rows[0];
    });
  }

  // Lock eligibility first, then the search, matching coordination operations.
  // Assignment provides access only to this experimental, search-scoped API.
  async reportsForCoordinator(actor: string, searchId: string, after?: string, limit = 100) {
    return this.transaction(async (client) => {
      const eligible = await client.query(
        `SELECT 1 FROM coordinator_eligibility e JOIN users u ON u.id=e.user_id
         WHERE e.user_id=$1 AND u.active=true FOR SHARE OF e,u`, [actor],
      );
      if (!eligible.rowCount) throw httpErrors.forbidden('Coordinator eligibility required');
      const assigned = await client.query(
        `SELECT s.id FROM searches s JOIN search_coordinators c ON c.search_id=s.id
         WHERE s.id=$1 AND c.user_id=$2 FOR SHARE OF s,c`, [searchId, actor],
      );
      if (!assigned.rowCount) throw httpErrors.notFound('Search not found');
      const result = await client.query(
        `SELECT id, received_at, handed_off_at, applicant_name, applicant_contact, missing_person_name,
                last_seen_time, last_seen_place, situation, resolved_at, resolved_by, search_id
         FROM initial_reports
         WHERE search_id=$1 AND handed_off_at IS NOT NULL
           AND ($2::uuid IS NULL OR (received_at,id) >
             (SELECT received_at,id FROM initial_reports WHERE id=$2 AND search_id=$1 AND handed_off_at IS NOT NULL))
         ORDER BY received_at,id LIMIT $3`, [searchId, after ?? null, limit + 1],
      );
      const items = result.rows.slice(0, limit);
      return { items, nextCursor: result.rows.length > limit ? items[items.length - 1].id as string : null };
    });
  }

  // Lock the report before any resolution. Competing registrars serialize;
  // exactly one can resolve it, and drafts remain indistinguishable from missing.
  private async lockUnresolved(client: PoolClient, reportId: string) {
    const result = await client.query(
      'SELECT resolved_at FROM initial_reports WHERE id=$1 AND handed_off_at IS NOT NULL FOR UPDATE', [reportId],
    );
    if (!result.rowCount) throw httpErrors.notFound('Report not found');
    if (result.rows[0].resolved_at !== null) throw httpErrors.conflict('Report already resolved');
  }

  private async link(client: PoolClient, actorId: string, reportId: string, searchId: string) {
    const result = await client.query(
      'UPDATE initial_reports SET resolved_at=now(), resolved_by=$1, search_id=$2 WHERE id=$3 RETURNING resolved_at',
      [actorId, searchId, reportId],
    );
    await client.query(
      "INSERT INTO initial_report_audit(report_id, actor_id, action, search_id) VALUES ($1,$2,'SEARCH_LINKED',$3)",
      [reportId, actorId, searchId],
    );
    return { searchId, resolvedAt: result.rows[0].resolved_at as Date };
  }

  async linkExisting(actor: User, reportId: string, searchId: string) {
    return this.transaction(async (client) => {
      await permission(client, actor.id, 'REGISTER');
      await this.lockUnresolved(client, reportId);
      // Access to an unrelated existing search is never conferred by linking.
      await requireSearchAccessForUser(actor, searchId, client);
      return this.link(client, actor.id, reportId, searchId);
    });
  }

  async createSearch(actorId: string, reportId: string, title: string) {
    return this.transaction(async (client) => {
      await permission(client, actorId, 'REGISTER');
      await this.lockUnresolved(client, reportId);
      const search = await client.query<{ id: string }>(
        'INSERT INTO searches(title, created_by) VALUES($1,$2) RETURNING id', [title, actorId],
      );
      const searchId = search.rows[0].id;
      await client.query('INSERT INTO search_members(search_id,user_id) VALUES($1,$2)', [searchId, actorId]);
      await client.query("INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,'SEARCH_CREATED',$3)",
        [searchId, actorId, { title }]);
      return this.link(client, actorId, reportId, searchId);
    });
  }

  async closeWithoutSearch(actorId: string, reportId: string, reason: string) {
    return this.transaction(async (client) => {
      await permission(client, actorId, 'REGISTER');
      await this.lockUnresolved(client, reportId);
      const result = await client.query(
        'UPDATE initial_reports SET resolved_at=now(), resolved_by=$1, resolution_reason=$2 WHERE id=$3 RETURNING resolved_at',
        [actorId, reason, reportId],
      );
      await client.query(
        "INSERT INTO initial_report_audit(report_id,actor_id,action,reason) VALUES($1,$2,'CLOSED_WITHOUT_SEARCH',$3)",
        [reportId, actorId, reason],
      );
      return { resolvedAt: result.rows[0].resolved_at as Date };
    });
  }

}
