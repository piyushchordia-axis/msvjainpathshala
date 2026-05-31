/**
 * NiyamsRepository — CRUD + audience-aware listing for `niyams` (SPEC §5.8,
 * §6.10).
 *
 * `niyams` carries `audience_kind` + `audience_filters` (JSONB). The mobile
 * "active niyams for me" feed evaluates the audience server-side against the
 * caller's age_group + batch + centre + city so the client never has to know
 * the audience taxonomy.
 *
 * Soft-delete via `deleted_at`; never hard-delete (consistent with the rest of
 * the codebase).
 */

import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, or, sql, gte } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { niyams } from '../schema';

import type { NewNiyam, Niyam } from '../schema';
import type { NiyamType } from '@jp/shared';

export interface ListNiyamsForCaller {
  city_id: string;
  centre_id: string;
  batch_id: string | null;
  age_group: string;
  msv_enrolled: boolean;
  /** YYYY-MM-DD (today) — used to filter out ended niyams. */
  today: string;
  type?: NiyamType;
}

@Injectable()
export class NiyamsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<Niyam | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(niyams)
      .where(and(eq(niyams.id, id), isNull(niyams.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewNiyam): Promise<Niyam> {
    const [row] = await this.drizzle.db.insert(niyams).values(input).returning();
    if (!row) throw new Error('[NiyamsRepository.create] INSERT did not return a row');
    return row;
  }

  async update(
    id: string,
    patch: Partial<Omit<NewNiyam, 'id' | 'created_at' | 'created_by_user_id'>>,
  ): Promise<Niyam | null> {
    const [row] = await this.drizzle.db
      .update(niyams)
      .set({ ...patch, updated_at: new Date() })
      .where(and(eq(niyams.id, id), isNull(niyams.deleted_at)))
      .returning();
    return row ?? null;
  }

  async softDelete(id: string): Promise<Niyam | null> {
    const [row] = await this.drizzle.db
      .update(niyams)
      .set({ deleted_at: new Date(), updated_at: new Date() })
      .where(and(eq(niyams.id, id), isNull(niyams.deleted_at)))
      .returning();
    return row ?? null;
  }

  /**
   * Lists Niyams "active for the caller" — start_date ≤ today, end_date is
   * null or ≥ today, city matches the student, audience filter satisfied.
   *
   * `audience_kind`:
   *   - 'all'        → always included (subject to city_id)
   *   - 'msv_only'   → only when caller's MSV status is approved
   *   - 'age_group'  → audience_filters.age_groups[] must contain caller age_group
   *   - 'batch'      → audience_filters.batch_ids[] must contain caller batch_id
   *   - 'centre'     → audience_filters.centre_ids[] must contain caller centre_id
   *   - 'city'       → already covered by the city_id filter
   *
   * We push the per-row audience checks into the JSONB operators so the
   * query stays sargable; the only post-filter is `msv_only` which we
   * decide in TS based on `opts.msv_enrolled`.
   */
  async listActiveForCaller(opts: ListNiyamsForCaller): Promise<Niyam[]> {
    const where = [
      isNull(niyams.deleted_at),
      eq(niyams.city_id, opts.city_id),
      lte(niyams.start_date, opts.today),
      or(isNull(niyams.end_date), gte(niyams.end_date, opts.today))!,
    ];
    if (opts.type) where.push(eq(niyams.type, opts.type));

    // Audience filter. We evaluate in Postgres to avoid reading the entire
    // table into memory; the JSONB operators are GIN-indexable when the
    // city grows large.
    const audienceClause = or(
      eq(niyams.audience_kind, 'all'),
      eq(niyams.audience_kind, 'city'),
      // msv_only handled in the next clause via opts.msv_enrolled gate
      opts.msv_enrolled ? eq(niyams.audience_kind, 'msv_only') : sql`false`,
      and(
        eq(niyams.audience_kind, 'age_group'),
        sql`(${niyams.audience_filters} -> 'age_groups') @> ${JSON.stringify([opts.age_group])}::jsonb`,
      )!,
      opts.batch_id
        ? and(
            eq(niyams.audience_kind, 'batch'),
            sql`(${niyams.audience_filters} -> 'batch_ids') @> ${JSON.stringify([opts.batch_id])}::jsonb`,
          )!
        : sql`false`,
      and(
        eq(niyams.audience_kind, 'centre'),
        sql`(${niyams.audience_filters} -> 'centre_ids') @> ${JSON.stringify([opts.centre_id])}::jsonb`,
      )!,
    )!;
    where.push(audienceClause);

    return this.drizzle.dbRead
      .select()
      .from(niyams)
      .where(and(...where))
      .orderBy(asc(niyams.type), desc(niyams.start_date));
  }

  /**
   * Admin listing — by city, with optional type / audience_kind filters and
   * paging. Returns the row including soft-deleted ones when `includeDeleted`.
   */
  async listForAdmin(opts: {
    city_id: string;
    centre_id?: string;
    batch_id?: string;
    type?: NiyamType;
    limit?: number;
    offset?: number;
  }): Promise<Niyam[]> {
    const where = [isNull(niyams.deleted_at), eq(niyams.city_id, opts.city_id)];
    if (opts.type) where.push(eq(niyams.type, opts.type));
    if (opts.centre_id) {
      // Either niyam was created against a specific centre via audience_filters,
      // OR it's broader. To keep this query simple admin tables filter in app
      // code after fetching; here we just return city-scoped rows.
    }
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    return this.drizzle.dbRead
      .select()
      .from(niyams)
      .where(and(...where))
      .orderBy(desc(niyams.start_date))
      .limit(limit)
      .offset(offset);
  }

  async findManyByIds(ids: string[]): Promise<Niyam[]> {
    if (ids.length === 0) return [];
    return this.drizzle.dbRead.select().from(niyams).where(inArray(niyams.id, ids));
  }
}
