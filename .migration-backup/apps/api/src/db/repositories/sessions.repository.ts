/**
 * SessionsRepository — query helpers for the `sessions` table (SPEC §5.6, §6.8).
 *
 * `findOrCreateForToday` is the workhorse used by the id-less check-in flow:
 * the shikshak taps "Check-in" on a batch card; if no session row exists for
 * today, we create one in-place with the batch's scheduled times.
 *
 * Mutators take an optional `tx` so the SessionsService can keep check-in
 * inside the same transaction as audit logs / fanout enqueue when desired.
 */

import { Injectable } from '@nestjs/common';
import { and, asc, between, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { batches, centres, cities, sessions } from '../schema';

import type { NewSession, Session } from '../schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

interface ListRangeOpts {
  batch_id?: string;
  shikshak_user_id?: string;
  centre_id?: string;
  from?: string; // YYYY-MM-DD
  to?: string; // YYYY-MM-DD
  status?: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  limit?: number;
  offset?: number;
}

interface SessionWithScope {
  session: Session;
  centre_id: string;
  city_id: string;
  state_id: string;
}

@Injectable()
export class SessionsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string, tx?: Tx): Promise<Session | null> {
    const runner = (tx ?? this.drizzle.dbRead) as Tx;
    const rows = await runner.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Resolver helper used by SessionsService.checkIn — returns the session
   * plus the centre/city/state ids needed for scope checks + realtime emits.
   */
  async findWithScope(id: string): Promise<SessionWithScope | null> {
    const rows = await this.drizzle.dbRead
      .select({
        session: sessions,
        centre_id: batches.centre_id,
        city_id: centres.city_id,
        state_id: cities.state_id,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batch_id))
      .innerJoin(centres, eq(centres.id, batches.centre_id))
      .innerJoin(cities, eq(cities.id, centres.city_id))
      .where(eq(sessions.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByBatchAndDate(batchId: string, date: string): Promise<Session | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(sessions)
      .where(and(eq(sessions.batch_id, batchId), eq(sessions.scheduled_date, date)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Idempotent: returns the existing session for (batch, date) or creates one
   * with the batch's scheduled times. Caller passes `shikshak_user_id` from
   * the JWT; service-level scope check decides whether they're allowed to
   * resolve this batch in the first place.
   */
  async findOrCreateForToday(
    batchId: string,
    date: string,
    shikshakUserId: string,
  ): Promise<Session> {
    const existing = await this.findByBatchAndDate(batchId, date);
    if (existing) return existing;

    const [batch] = await this.drizzle.dbRead
      .select({ start_time: batches.start_time, end_time: batches.end_time })
      .from(batches)
      .where(eq(batches.id, batchId))
      .limit(1);
    if (!batch) throw new Error(`Batch ${batchId} not found`);

    // `scheduled_start_time` / `_end_time` are Postgres `time` columns —
    // Drizzle accepts 'HH:MM:SS' strings. Use the batch's stored times as-is.
    const [row] = await this.drizzle.db
      .insert(sessions)
      .values({
        batch_id: batchId,
        scheduled_date: date,
        scheduled_start_time: batch.start_time,
        scheduled_end_time: batch.end_time,
        shikshak_user_id: shikshakUserId,
        status: 'scheduled',
      } as NewSession)
      .onConflictDoNothing()
      .returning();

    if (row) return row;
    // Conflict raced — fetch the row that won.
    const winner = await this.findByBatchAndDate(batchId, date);
    if (!winner) throw new Error('[Sessions.findOrCreateForToday] race resolution failed');
    return winner;
  }

  async setCheckIn(
    id: string,
    patch: {
      check_in_at: Date;
      check_in_lat: string;
      check_in_lng: string;
      check_in_distance_m: number;
      gps_haversine_m: number;
      shikshak_user_id: string;
    },
    tx?: Tx,
  ): Promise<Session> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .update(sessions)
      .set({
        check_in_at: patch.check_in_at,
        check_in_lat: patch.check_in_lat,
        check_in_lng: patch.check_in_lng,
        check_in_distance_m: patch.check_in_distance_m,
        gps_haversine_m: patch.gps_haversine_m,
        shikshak_user_id: patch.shikshak_user_id,
        status: 'in_progress',
        updated_at: new Date(),
      })
      .where(eq(sessions.id, id))
      .returning();
    if (!row) throw new Error('[Sessions.setCheckIn] update returned no row');
    return row;
  }

  async setCheckOut(
    id: string,
    patch: {
      check_out_at: Date;
      check_out_lat: string;
      check_out_lng: string;
      duration_minutes: number;
    },
    tx?: Tx,
  ): Promise<Session> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .update(sessions)
      .set({
        check_out_at: patch.check_out_at,
        check_out_lat: patch.check_out_lat,
        check_out_lng: patch.check_out_lng,
        duration_minutes: patch.duration_minutes,
        status: 'completed',
        updated_at: new Date(),
      })
      .where(eq(sessions.id, id))
      .returning();
    if (!row) throw new Error('[Sessions.setCheckOut] update returned no row');
    return row;
  }

  async setCancelled(
    id: string,
    patch: { cancelled_at: Date; cancellation_reason: string; cancellation_by: string },
    tx?: Tx,
  ): Promise<Session> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .update(sessions)
      .set({
        cancelled_at: patch.cancelled_at,
        cancellation_reason: patch.cancellation_reason,
        cancellation_by: patch.cancellation_by,
        status: 'cancelled',
        updated_at: new Date(),
      })
      .where(eq(sessions.id, id))
      .returning();
    if (!row) throw new Error('[Sessions.setCancelled] update returned no row');
    return row;
  }

  /**
   * Today's batches + their session row (if any) for a shikshak. Returns one
   * row per batch the shikshak teaches; `session_id` is null when no session
   * has been opened yet today.
   */
  async listForShikshakToday(
    shikshakUserId: string,
    date: string,
  ): Promise<
    Array<{
      batch_id: string;
      batch_name: string;
      centre_id: string;
      centre_name: string;
      start_time: string;
      end_time: string;
      session_id: string | null;
      session_status: string | null;
      check_in_at: Date | null;
    }>
  > {
    return this.drizzle.dbRead
      .select({
        batch_id: batches.id,
        batch_name: batches.name,
        centre_id: centres.id,
        centre_name: centres.name,
        start_time: batches.start_time,
        end_time: batches.end_time,
        session_id: sessions.id,
        session_status: sessions.status,
        check_in_at: sessions.check_in_at,
      })
      .from(batches)
      .innerJoin(centres, eq(centres.id, batches.centre_id))
      .leftJoin(sessions, and(eq(sessions.batch_id, batches.id), eq(sessions.scheduled_date, date)))
      .where(and(eq(batches.shikshak_id, shikshakUserId), isNull(batches.deleted_at)))
      .orderBy(asc(batches.start_time));
  }

  async listInRange(opts: ListRangeOpts): Promise<Session[]> {
    const where = [] as ReturnType<typeof eq>[];
    if (opts.batch_id) where.push(eq(sessions.batch_id, opts.batch_id));
    if (opts.shikshak_user_id) where.push(eq(sessions.shikshak_user_id, opts.shikshak_user_id));
    if (opts.status) where.push(eq(sessions.status, opts.status));
    if (opts.from && opts.to) where.push(between(sessions.scheduled_date, opts.from, opts.to));
    else if (opts.from) where.push(gte(sessions.scheduled_date, opts.from));
    else if (opts.to) where.push(lte(sessions.scheduled_date, opts.to));

    const q = this.drizzle.dbRead.select().from(sessions);
    const filtered = where.length > 0 ? q.where(and(...where)) : q;
    return filtered
      .orderBy(desc(sessions.scheduled_date))
      .limit(Math.min(opts.limit ?? 100, 500))
      .offset(opts.offset ?? 0);
  }

  /**
   * Today's sessions across a list of centres (admin dashboard). The
   * controller passes the actor's scoped centre_ids; an empty list returns []
   * to avoid an accidental "all centres" query.
   */
  async listTodayForCentres(
    centreIds: string[],
    date: string,
  ): Promise<
    Array<{
      session: Session;
      batch_name: string;
      centre_id: string;
      centre_name: string;
      gps_radius_m: number;
      city_id: string;
    }>
  > {
    if (centreIds.length === 0) return [];
    return this.drizzle.dbRead
      .select({
        session: sessions,
        batch_name: batches.name,
        centre_id: centres.id,
        centre_name: centres.name,
        gps_radius_m: centres.gps_radius_m,
        city_id: centres.city_id,
      })
      .from(sessions)
      .innerJoin(batches, eq(batches.id, sessions.batch_id))
      .innerJoin(centres, eq(centres.id, batches.centre_id))
      .where(
        and(
          eq(sessions.scheduled_date, date),
          sql`${centres.id} IN ${centreIds}`,
          isNull(batches.deleted_at),
        ),
      )
      .orderBy(asc(batches.start_time));
  }
}
