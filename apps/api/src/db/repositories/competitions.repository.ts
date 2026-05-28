/**
 * CompetitionsRepository — write/read helpers for `competitions`
 * (SPEC §5.12, §6.15). Lifecycle: draft → open → closed → results_published.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, lte, or, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { competitions } from '../schema';

import type { Competition, NewCompetition } from '../schema';
import type { AgeGroup } from '@jp/shared';

@Injectable()
export class CompetitionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<Competition | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(competitions)
      .where(eq(competitions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: NewCompetition): Promise<Competition> {
    const [row] = await this.drizzle.db.insert(competitions).values(input).returning();
    if (!row) throw new Error('[Competitions.insert] no row returned');
    return row;
  }

  async update(
    id: string,
    patch: Partial<Omit<NewCompetition, 'id'>>,
  ): Promise<Competition | null> {
    const [row] = await this.drizzle.db
      .update(competitions)
      .set({ ...patch, updated_at: new Date() })
      .where(eq(competitions.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * List competitions visible to a caller. Filters:
   *   - city_id matches student's city
   *   - age_group ∈ eligible_age_groups (or the array is empty/null = "all")
   *   - status ∈ {'open', 'closed', 'results_published'} — drafts are admin-only
   */
  async listForCaller(opts: {
    city_id: string;
    age_group: AgeGroup;
    msv_enrolled: boolean;
    now: Date;
    limit?: number;
    offset?: number;
  }): Promise<Competition[]> {
    const where = [
      eq(competitions.city_id, opts.city_id),
      inArray(competitions.status, ['open', 'closed', 'results_published']),
      or(
        eq(competitions.msv_only, false),
        opts.msv_enrolled ? eq(competitions.msv_only, true) : sql`false`,
      )!,
      or(
        sql`${competitions.eligible_age_groups} IS NULL`,
        sql`array_length(${competitions.eligible_age_groups}, 1) IS NULL`,
        sql`${opts.age_group}::age_group_enum = ANY(${competitions.eligible_age_groups})`,
      )!,
    ];
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    void opts.now;
    return this.drizzle.dbRead
      .select()
      .from(competitions)
      .where(and(...where))
      .orderBy(desc(competitions.event_date))
      .limit(limit)
      .offset(offset);
  }

  async listForAdmin(opts: {
    city_id: string;
    status?: 'draft' | 'open' | 'closed' | 'results_published';
    limit?: number;
    offset?: number;
  }): Promise<Competition[]> {
    const where = [eq(competitions.city_id, opts.city_id)];
    if (opts.status) where.push(eq(competitions.status, opts.status));
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(competitions)
      .where(and(...where))
      .orderBy(desc(competitions.created_at))
      .limit(limit)
      .offset(offset);
  }

  /** Sanity test for the registration window. */
  isWindowOpen(c: Competition, now: Date): boolean {
    if (c.registration_window_start && c.registration_window_start.getTime() > now.getTime()) {
      return false;
    }
    if (c.registration_window_end && c.registration_window_end.getTime() < now.getTime()) {
      return false;
    }
    return true;
  }

  /** Used by tests + admin debugging. */
  async recentSince(since: Date, limit = 50): Promise<Competition[]> {
    return this.drizzle.dbRead
      .select()
      .from(competitions)
      .where(and(gt(competitions.created_at, since)))
      .orderBy(desc(competitions.created_at))
      .limit(limit);
  }

  /** Read all upcoming events (event_date >= today) — used by the dashboard. */
  async upcoming(cityId: string, today: string): Promise<Competition[]> {
    return this.drizzle.dbRead
      .select()
      .from(competitions)
      .where(
        and(
          eq(competitions.city_id, cityId),
          inArray(competitions.status, ['open', 'closed']),
          gte(competitions.event_date, today),
        ),
      )
      .orderBy(competitions.event_date);
    void lte;
  }
}
