import type { Pool, PoolClient } from 'pg';
import { httpErrors } from '@fastify/sensible';

type LockedPrimary = { user_id: string };

export class CoordinationService {
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

  private async lockSearch(client: PoolClient, searchId: string) {
    const search = await client.query('SELECT id FROM searches WHERE id=$1 FOR UPDATE', [searchId]);
    if (!search.rowCount) throw httpErrors.notFound('Search not found');
  }

  private async requireEligible(client: PoolClient, userId: string) {
    const result = await client.query(
      `SELECT 1 FROM coordinator_eligibility e JOIN users u ON u.id=e.user_id
       WHERE e.user_id=$1 AND u.active=true FOR SHARE OF e,u`, [userId],
    );
    if (!result.rowCount) throw httpErrors.forbidden('Coordinator eligibility required');
  }

  private async requireAssigned(client: PoolClient, searchId: string, actorId: string) {
    await this.requireEligible(client, actorId);
    const result = await client.query('SELECT 1 FROM search_coordinators WHERE search_id=$1 AND user_id=$2', [searchId, actorId]);
    if (!result.rowCount) throw httpErrors.notFound('Search not found');
  }

  private async primary(client: PoolClient, searchId: string): Promise<LockedPrimary> {
    const result = await client.query<LockedPrimary>('SELECT user_id FROM search_coordinators WHERE search_id=$1 AND is_primary', [searchId]);
    if (!result.rowCount) throw httpErrors.conflict('Search has no primary coordinator');
    return result.rows[0];
  }

  private async event(client: PoolClient, searchId: string, actorId: string, type: string, payload: object) {
    await client.query('INSERT INTO events(search_id,user_id,type,payload) VALUES($1,$2,$3,$4)', [searchId, actorId, type, payload]);
  }

  private async notify(client: PoolClient, searchId: string, recipients: string[], kind: string, transferId: string) {
    const unique = [...new Set(recipients)];
    if (!unique.length) return;
    await client.query(
      'INSERT INTO coordination_notifications(recipient_id,search_id,kind,transfer_id) SELECT id,$2,$3,$4 FROM unnest($1::uuid[]) AS id',
      [unique, searchId, kind, transferId],
    );
  }

  async claim(actorId: string, searchId: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      const current = await client.query<LockedPrimary>('SELECT user_id FROM search_coordinators WHERE search_id=$1 AND is_primary', [searchId]);
      if (current.rowCount) {
        return { primaryId: current.rows[0].user_id, claimed: current.rows[0].user_id === actorId };
      }
      await client.query('INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by) VALUES($1,$2,true,$2)', [searchId, actorId]);
      await this.event(client, searchId, actorId, 'COORDINATOR_CLAIMED', { coordinatorId: actorId });
      return { primaryId: actorId, claimed: true };
    });
  }

  async addAdditional(actorId: string, searchId: string, userId: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      await this.requireAssigned(client, searchId, actorId);
      await this.requireEligible(client, userId);
      const inserted = await client.query(
        `INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by)
         VALUES($1,$2,false,$3) ON CONFLICT DO NOTHING RETURNING user_id`, [searchId, userId, actorId],
      );
      if (inserted.rowCount) await this.event(client, searchId, actorId, 'COORDINATOR_ADDED', { coordinatorId: userId });
      return { coordinatorId: userId };
    });
  }

  async proposeTransfer(actorId: string, searchId: string, toId: string, retainPrevious: boolean, reason: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      await this.requireAssigned(client, searchId, actorId);
      const primary = await this.primary(client, searchId);
      if (primary.user_id === toId) throw httpErrors.badRequest('Target is already primary');
      await this.requireEligible(client, toId);
      const inserted = await client.query(
        `INSERT INTO coordinator_transfers(search_id,initiated_by,from_user_id,to_user_id,retain_previous,reason)
         VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id,created_at`,
        [searchId, actorId, primary.user_id, toId, retainPrevious, reason],
      );
      if (!inserted.rowCount) throw httpErrors.conflict('A transfer is already pending');
      await this.event(client, searchId, actorId, 'COORDINATOR_TRANSFER_REQUESTED', { fromId: primary.user_id, toId, retainPrevious, reason });
      await this.notify(client, searchId, [toId], 'TRANSFER_REQUESTED', inserted.rows[0].id as string);
      return { transferId: inserted.rows[0].id as string, fromId: primary.user_id, toId, createdAt: inserted.rows[0].created_at as Date };
    });
  }

  async acceptTransfer(actorId: string, searchId: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      const pending = await client.query(
        'SELECT id,initiated_by,from_user_id,to_user_id,retain_previous,reason FROM coordinator_transfers WHERE search_id=$1 AND to_user_id=$2',
        [searchId, actorId],
      );
      if (!pending.rowCount) throw httpErrors.notFound('Transfer not found');
      const transfer = pending.rows[0] as { id: string; initiated_by: string; from_user_id: string; to_user_id: string; retain_previous: boolean; reason: string };
      await this.requireAssigned(client, searchId, transfer.initiated_by);
      const current = await this.primary(client, searchId);
      if (current.user_id !== transfer.from_user_id) throw httpErrors.conflict('Primary coordinator changed');
      if (transfer.retain_previous) {
        await client.query('UPDATE search_coordinators SET is_primary=false WHERE search_id=$1 AND user_id=$2', [searchId, transfer.from_user_id]);
      } else {
        await client.query('DELETE FROM search_coordinators WHERE search_id=$1 AND user_id=$2', [searchId, transfer.from_user_id]);
      }
      await client.query(
        `INSERT INTO search_coordinators(search_id,user_id,is_primary,assigned_by) VALUES($1,$2,true,$3)
         ON CONFLICT(search_id,user_id) DO UPDATE SET is_primary=true,assigned_by=EXCLUDED.assigned_by,assigned_at=now()`,
        [searchId, actorId, transfer.initiated_by],
      );
      await client.query('DELETE FROM coordinator_transfers WHERE search_id=$1', [searchId]);
      await this.event(client, searchId, actorId, 'COORDINATOR_TRANSFER_ACCEPTED', {
        fromId: transfer.from_user_id, toId: actorId, retainPrevious: transfer.retain_previous, reason: transfer.reason,
      });
      await this.notify(client, searchId, [transfer.from_user_id, transfer.initiated_by].filter((id) => id !== actorId), 'TRANSFER_ACCEPTED', transfer.id);
      return { primaryId: actorId };
    });
  }

  async state(actorId: string, searchId: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      await this.requireAssigned(client, searchId, actorId);
      const rows = await client.query('SELECT user_id,is_primary,assigned_at FROM search_coordinators WHERE search_id=$1 ORDER BY is_primary DESC,user_id', [searchId]);
      return rows.rows;
    });
  }

  async pendingForUser(actorId: string, searchId: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      const pending = await client.query(
        `SELECT id,initiated_by,from_user_id,to_user_id,retain_previous,reason,created_at
         FROM coordinator_transfers WHERE search_id=$1 AND to_user_id=$2`, [searchId, actorId],
      );
      if (!pending.rowCount) throw httpErrors.notFound('Transfer not found');
      return pending.rows[0];
    });
  }

  async declineTransfer(actorId: string, searchId: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      const pending = await client.query(
        'DELETE FROM coordinator_transfers WHERE search_id=$1 AND to_user_id=$2 RETURNING id,from_user_id,to_user_id,initiated_by', [searchId, actorId],
      );
      if (!pending.rowCount) throw httpErrors.notFound('Transfer not found');
      await this.event(client, searchId, actorId, 'COORDINATOR_TRANSFER_DECLINED', { fromId: pending.rows[0].from_user_id, toId: actorId });
      await this.notify(client, searchId, [pending.rows[0].from_user_id, pending.rows[0].initiated_by].filter((id: string) => id !== actorId), 'TRANSFER_DECLINED', pending.rows[0].id as string);
      return { declined: true };
    });
  }

  async cancelTransfer(actorId: string, searchId: string, reason: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      await this.lockSearch(client, searchId);
      await this.requireAssigned(client, searchId, actorId);
      const pending = await client.query(
        'DELETE FROM coordinator_transfers WHERE search_id=$1 RETURNING id,from_user_id,to_user_id', [searchId],
      );
      if (!pending.rowCount) throw httpErrors.notFound('Transfer not found');
      await this.event(client, searchId, actorId, 'COORDINATOR_TRANSFER_CANCELLED', { fromId: pending.rows[0].from_user_id, toId: pending.rows[0].to_user_id, reason });
      if (pending.rows[0].to_user_id !== actorId) await this.notify(client, searchId, [pending.rows[0].to_user_id], 'TRANSFER_CANCELLED', pending.rows[0].id as string);
      return { cancelled: true };
    });
  }

  async notifications(actorId: string, after?: string, limit = 100) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      const result = await client.query(
        `SELECT id,search_id,transfer_id,kind,created_at FROM coordination_notifications
         WHERE recipient_id=$1 AND acknowledged_at IS NULL
           AND ($2::uuid IS NULL OR (created_at,id) >
             (SELECT created_at,id FROM coordination_notifications WHERE id=$2 AND recipient_id=$1))
         ORDER BY created_at,id LIMIT $3`, [actorId, after ?? null, limit + 1],
      );
      const items = result.rows.slice(0, limit);
      return { items, nextCursor: result.rows.length > limit ? items[items.length - 1].id as string : null };
    });
  }

  async acknowledgeNotification(actorId: string, notificationId: string) {
    return this.transaction(async (client) => {
      await this.requireEligible(client, actorId);
      const result = await client.query(
        `UPDATE coordination_notifications SET acknowledged_at=COALESCE(acknowledged_at,now())
         WHERE id=$1 AND recipient_id=$2 RETURNING acknowledged_at`, [notificationId, actorId],
      );
      if (!result.rowCount) throw httpErrors.notFound('Notification not found');
      return { acknowledgedAt: result.rows[0].acknowledged_at as Date };
    });
  }

}
