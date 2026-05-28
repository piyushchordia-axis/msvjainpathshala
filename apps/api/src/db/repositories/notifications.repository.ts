/**
 * NotificationsRepository — typed access to `notifications` rows.
 *
 * Step 12 surface:
 *   - `insert` one row (in-app feed; written before any push/sms/email job
 *     is enqueued so the feed is the source of truth).
 *   - `listForUser` cursor-paginated read (newest first; cursor = ISO
 *     created_at).
 *   - `markRead` / `markAllRead`.
 *   - `unreadCount`.
 *
 * Reads go through `dbRead`; writes through `db` per §17.1.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { notifications } from '../schema';

import type { NewNotification, Notification } from '../schema';

export interface ListForUserOpts {
  /** ISO created_at cursor — return rows strictly older than this. */
  cursor?: string;
  limit: number;
  /** Restrict to unread (used by some surfaces; default is "all"). */
  only_unread?: boolean;
}

@Injectable()
export class NotificationsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(input: NewNotification): Promise<Notification> {
    const [row] = await this.drizzle.db.insert(notifications).values(input).returning();
    if (!row) {
      throw new Error('[NotificationsRepository.insert] INSERT…RETURNING produced no row');
    }
    return row;
  }

  async insertMany(rows: NewNotification[]): Promise<Notification[]> {
    if (rows.length === 0) return [];
    return this.drizzle.db.insert(notifications).values(rows).returning();
  }

  async findById(id: string): Promise<Notification | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForUser(userId: string, opts: ListForUserOpts): Promise<Notification[]> {
    const filters = [eq(notifications.user_id, userId)];
    if (opts.cursor) {
      filters.push(lt(notifications.created_at, new Date(opts.cursor)));
    }
    if (opts.only_unread) {
      filters.push(eq(notifications.is_read, false));
    }
    return this.drizzle.dbRead
      .select()
      .from(notifications)
      .where(and(...filters))
      .orderBy(desc(notifications.created_at))
      .limit(opts.limit);
  }

  async markRead(userId: string, id: string): Promise<Notification | null> {
    const [row] = await this.drizzle.db
      .update(notifications)
      .set({ is_read: true, updated_at: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.user_id, userId)))
      .returning();
    return row ?? null;
  }

  async markAllRead(userId: string): Promise<number> {
    const rows = await this.drizzle.db
      .update(notifications)
      .set({ is_read: true, updated_at: new Date() })
      .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)))
      .returning({ id: notifications.id });
    return rows.length;
  }

  async unreadCount(userId: string): Promise<number> {
    const rows = await this.drizzle.dbRead
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)));
    return rows[0]?.count ?? 0;
  }

  /**
   * Update delivery status on a notification (used by the push/sms/email
   * workers once they have a definitive outcome from the provider).
   */
  async updateStatus(id: string, status: Notification['status']): Promise<void> {
    await this.drizzle.db
      .update(notifications)
      .set({ status, updated_at: new Date() })
      .where(eq(notifications.id, id));
  }

  /** Used by gallery / niyam rejection to hide derived feed entries. */
  async deleteBySourceEntity(kind: string, entityId: string): Promise<number> {
    const rows = await this.drizzle.db
      .delete(notifications)
      .where(
        and(
          eq(notifications.source_entity_kind, kind),
          eq(notifications.source_entity_id, entityId),
        ),
      )
      .returning({ id: notifications.id });
    // soft-delete? we just hard-delete the in-app row when the source is gone;
    // it's an in-app convenience feed, not an audit log.
    void isNull; // keep the import used when we extend filtering
    return rows.length;
  }
}
