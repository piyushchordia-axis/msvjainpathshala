/**
 * NoticesRepository — write/read helpers for `notices` (SPEC §5.10, §6.13).
 *
 * Scope semantics:
 *   - 'batch'    → must carry `batch_id`; visible to that batch's parents/shikshak
 *   - 'centre'   → must carry `centre_id`; visible across all batches in centre
 *   - 'city'     → just `city_id`
 *   - 'state'    → city_id of any city in the state (we still keep city_id NOT NULL
 *                  because the schema requires it — pick the requesting actor's city)
 *   - 'national' → city_id still NOT NULL — same convention
 *   - 'msv'      → msv_only=true, applies across the city/centre filters
 *
 * `published_at` is set on the create path when `scheduled_for IS NULL` —
 * otherwise the scheduled-publisher cron flips it on the appointed minute.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { notices } from '../schema';

import type { Notice, NewNotice } from '../schema';
import type { NoticeAudience } from '@jp/shared';

export interface ListNoticesForCaller {
  city_id: string;
  centre_id: string | null;
  batch_id: string | null;
  msv_enrolled: boolean;
  /** ISO datetime — used to filter unpublished + scheduled notices. */
  now: Date;
  limit?: number;
  offset?: number;
}

@Injectable()
export class NoticesRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<Notice | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(notices)
      .where(and(eq(notices.id, id), isNull(notices.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: NewNotice): Promise<Notice> {
    const [row] = await this.drizzle.db.insert(notices).values(input).returning();
    if (!row) throw new Error('[Notices.insert] no row returned');
    return row;
  }

  async update(
    id: string,
    patch: Partial<Omit<NewNotice, 'id' | 'created_by_user_id'>>,
  ): Promise<Notice | null> {
    const [row] = await this.drizzle.db
      .update(notices)
      .set({ ...patch, updated_at: new Date() })
      .where(and(eq(notices.id, id), isNull(notices.deleted_at)))
      .returning();
    return row ?? null;
  }

  /**
   * Unified feed for the caller — combines all scopes the caller belongs to.
   * Only PUBLISHED notices (published_at <= now) are visible.
   */
  async listForCaller(opts: ListNoticesForCaller): Promise<Notice[]> {
    const where = [isNull(notices.deleted_at), lte(notices.published_at, opts.now)];
    const scopeOr = or(
      // Anything pinned to this caller's city.
      and(eq(notices.scope, 'city'), eq(notices.city_id, opts.city_id)),
      // Centre-scoped (must carry centre_id).
      opts.centre_id
        ? and(eq(notices.scope, 'centre'), eq(notices.centre_id, opts.centre_id))
        : sql`false`,
      // Batch-scoped.
      opts.batch_id
        ? and(eq(notices.scope, 'batch'), eq(notices.batch_id, opts.batch_id))
        : sql`false`,
      // State + national: still city-bound in our schema.
      and(eq(notices.scope, 'state'), eq(notices.city_id, opts.city_id)),
      eq(notices.scope, 'national'),
      // MSV-cohort.
      opts.msv_enrolled
        ? and(eq(notices.scope, 'msv'), eq(notices.city_id, opts.city_id))
        : sql`false`,
    )!;
    where.push(scopeOr);

    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(notices)
      .where(and(...where))
      .orderBy(desc(notices.pinned), desc(notices.published_at))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Guest / public feed — only `is_public = true` notices that are published.
   */
  async listPublic(opts: { now: Date; limit?: number; offset?: number }): Promise<Notice[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(notices)
      .where(
        and(
          eq(notices.is_public, true),
          isNull(notices.deleted_at),
          lte(notices.published_at, opts.now),
        ),
      )
      .orderBy(desc(notices.pinned), desc(notices.published_at))
      .limit(limit)
      .offset(offset);
  }

  /** Admin list — scoped to actor's city. Returns all (including scheduled, unpublished). */
  async listForAdmin(opts: {
    city_id: string;
    scope?: NoticeAudience;
    limit?: number;
    offset?: number;
  }): Promise<Notice[]> {
    const where = [eq(notices.city_id, opts.city_id), isNull(notices.deleted_at)];
    if (opts.scope) where.push(eq(notices.scope, opts.scope));
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(notices)
      .where(and(...where))
      .orderBy(desc(notices.pinned), desc(notices.created_at))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Scheduled-notice publisher: find notices whose `scheduled_for` has
   * passed AND `published_at IS NULL`. Used by the cron processor.
   */
  async findDueForPublish(now: Date, limit = 200): Promise<Notice[]> {
    return this.drizzle.db
      .select()
      .from(notices)
      .where(
        and(
          isNull(notices.published_at),
          isNull(notices.deleted_at),
          sql`${notices.scheduled_for} IS NOT NULL`,
          lte(notices.scheduled_for, now),
        ),
      )
      .orderBy(notices.scheduled_for)
      .limit(limit);
  }

  /** Flip a notice from "scheduled" to "published". Returns the updated row. */
  async markPublished(id: string, publishedAt: Date): Promise<Notice | null> {
    const [row] = await this.drizzle.db
      .update(notices)
      .set({ published_at: publishedAt, updated_at: publishedAt })
      .where(and(eq(notices.id, id), isNull(notices.published_at)))
      .returning();
    return row ?? null;
  }

  async setPinned(id: string, pinned: boolean): Promise<Notice | null> {
    const [row] = await this.drizzle.db
      .update(notices)
      .set({ pinned, updated_at: new Date() })
      .where(and(eq(notices.id, id), isNull(notices.deleted_at)))
      .returning();
    return row ?? null;
  }

  async softDelete(id: string): Promise<Notice | null> {
    const [row] = await this.drizzle.db
      .update(notices)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(and(eq(notices.id, id), isNull(notices.deleted_at)))
      .returning();
    return row ?? null;
  }

  /** Used by tests + admin debugging. */
  async recentSince(since: Date, limit = 50): Promise<Notice[]> {
    return this.drizzle.dbRead
      .select()
      .from(notices)
      .where(and(gt(notices.created_at, since), isNull(notices.deleted_at)))
      .orderBy(desc(notices.created_at))
      .limit(limit);
  }

  async findManyByIds(ids: string[]): Promise<Notice[]> {
    if (ids.length === 0) return [];
    return this.drizzle.dbRead.select().from(notices).where(inArray(notices.id, ids));
  }
}
