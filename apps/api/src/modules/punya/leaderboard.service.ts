/**
 * LeaderboardService — Redis ZSET surface for the Punya leaderboard
 * (SPEC §5.7, §6.9, §17.5).
 *
 * Scopes (all per-month, key = `lb:<scope>:<scope_id>:<YYYY-MM>`):
 *   - lb:batch:{batch_id}:{YYYY-MM}
 *   - lb:centre:{centre_id}:{YYYY-MM}
 *   - lb:city:{city_id}:{YYYY-MM}
 *   - lb:national:{YYYY-MM}            (single global key per month)
 *   - lb:msv:{city_id}:{YYYY-MM}       (MSV students only, per city)
 *
 * Read flow:
 *   1. ZREVRANGE … WITHSCORES — top N member ids + scores
 *   2. Hydrate names / centres / age-groups from Postgres (one IN() query)
 *   3. ZREVRANK for the calling user's own student_id → `self_rank`
 *   4. 60s edge-cache via `Cache-Control: public, max-age=60` on the
 *      response (set in the controller — service stays HTTP-agnostic).
 *
 * Refresh flow lives in `LeaderboardRefreshProcessor`. The service exposes
 * `rebuildScope()` so the processor can call it directly and so the admin
 * "rebuild leaderboard now" button has a code-path.
 *
 * Monthly reset: `snapshotMonthlyAndReset()` is called by the
 * `leaderboard-monthly-reset` cron — snapshots the prior month's top N
 * into `leaderboard_snapshots` then DELs the ZSET.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  CentresRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { leaderboard_snapshots } from '../../db/schema';

import type { ScopedActor } from './punya.service';
import type { LeaderboardEntry, LeaderboardResult, LeaderboardScope } from './punya.types';
import type { Redis } from 'ioredis';

interface ReadOptions {
  actor: ScopedActor;
  scope: LeaderboardScope;
  /** Required for batch / centre / city / msv. national has no scope_id. */
  scope_id?: string | undefined;
  /** YYYY-MM — defaults to the current month in UTC. */
  period?: string | undefined;
  limit?: number | undefined;
  /** Explicit student for which to return `self_rank`. */
  for_student_id?: string | undefined;
}

interface RefreshOptions {
  scope: LeaderboardScope;
  scope_id?: string | null;
  /** YYYY-MM */
  period?: string;
  /** When this many days back are summed into the leaderboard. Default 30. */
  windowDays?: number;
}

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  /** ZSET TTL — slightly longer than two months so a stale processor doesn't
   *  evict the current period mid-read. Snapshot cron preserves history. */
  private static readonly ZSET_TTL_SECONDS = 70 * 24 * 60 * 60;
  /** Top N hydrated by default. */
  private static readonly DEFAULT_LIMIT = 50;

  constructor(
    private readonly redis: RedisService,
    private readonly drizzle: DrizzleService,
    private readonly transactions: PunyaTransactionsRepository,
    private readonly students: StudentsRepository,
    private readonly centres: CentresRepository,
  ) {}

  private get client(): Redis {
    return this.redis.cacheClient;
  }

  // ===========================================================================
  // Read
  // ===========================================================================

  async read(opts: ReadOptions): Promise<LeaderboardResult> {
    const period = opts.period ?? thisPeriod();
    const limit = Math.min(Math.max(opts.limit ?? LeaderboardService.DEFAULT_LIMIT, 1), 100);

    // Resolve scope_id from the actor / target student when the client omits
    // it. Mobile city/MSV tabs deliberately omit scope_id and rely on this
    // fallback (a parent's child resolves the city/centre/batch).
    const scopeId = await this.resolveScopeId(opts);

    // RBAC: callers ask for /national or /msv freely; for scoped reads we
    // verify the actor has visibility into the scope_id. For Step 16 we keep
    // this lightweight — any authenticated user can read any leaderboard.
    // assertScopeId must run BEFORE leaderboardKey so a missing scope_id
    // returns a 422 (not a raw 500 from the key builder).
    this.assertScopeId(opts.scope, scopeId);
    const key = leaderboardKey(opts.scope, scopeId, period);

    // ZREVRANGE … WITHSCORES — top N.
    const raw = (await this.client.zrevrange(key, 0, limit - 1, 'WITHSCORES')) as string[];
    const memberPoints: Array<{ student_id: string; points: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      memberPoints.push({
        student_id: raw[i]!,
        points: Number(raw[i + 1] ?? 0),
      });
    }

    let entries: LeaderboardEntry[] = [];
    if (memberPoints.length > 0) {
      const hydrated = await this.hydrate(memberPoints.map((m) => m.student_id));
      entries = memberPoints.map((m, i) => ({
        rank: i + 1,
        student_id: m.student_id,
        full_name: hydrated.get(m.student_id)?.full_name ?? 'Unknown',
        student_code: hydrated.get(m.student_id)?.student_code ?? '',
        age_group: hydrated.get(m.student_id)?.age_group ?? '',
        centre_id: hydrated.get(m.student_id)?.centre_id ?? null,
        centre_name: hydrated.get(m.student_id)?.centre_name ?? null,
        total_points: m.points,
      }));
    }

    // self_rank: explicit override or, for a parent, their first child.
    let selfStudentId: string | null = opts.for_student_id ?? null;
    if (!selfStudentId && opts.actor.role === 'parent') {
      const kids = await this.students.findByParent(opts.actor.user_id);
      selfStudentId = kids[0]?.id ?? null;
    }
    let selfRank: number | null = null;
    if (selfStudentId) {
      const r = await this.client.zrevrank(key, selfStudentId);
      selfRank = r === null ? null : r + 1;
    }

    return {
      scope: opts.scope,
      scope_id: scopeId,
      period,
      entries,
      self_rank: selfRank,
    };
  }

  /**
   * Resolve an effective scope_id when the client omits it. national needs
   * none; city/msv fall back to the actor's city (resolved via the target
   * child for parents); centre/batch resolve from the target student.
   */
  private async resolveScopeId(opts: ReadOptions): Promise<string | null> {
    if (opts.scope_id) return opts.scope_id;
    if (opts.scope === 'national') return null;

    const targetStudent = async () => {
      if (opts.for_student_id) return this.students.findById(opts.for_student_id);
      if (opts.actor.role === 'parent') {
        const kids = await this.students.findByParent(opts.actor.user_id);
        return kids.find((k) => k.status === 'active') ?? kids[0] ?? null;
      }
      return null;
    };

    if (opts.scope === 'city' || opts.scope === 'msv') {
      if (opts.actor.city_id) return opts.actor.city_id;
      const st = await targetStudent();
      if (st) {
        const centre = await this.centres.findById(st.centre_id);
        return centre?.city_id ?? null;
      }
      return null;
    }
    if (opts.scope === 'centre') {
      const st = await targetStudent();
      return st?.centre_id ?? opts.actor.centre_ids?.[0] ?? null;
    }
    if (opts.scope === 'batch') {
      const st = await targetStudent();
      return st?.batch_id ?? opts.actor.batch_ids?.[0] ?? null;
    }
    return null;
  }

  // ===========================================================================
  // Refresh (called by the punya.leaderboard.refresh processor)
  // ===========================================================================

  /**
   * Rebuild one ZSET from the ledger. Sums the last `windowDays` of
   * transactions filtered to the given scope, then ZADDs en masse and sets
   * the TTL.
   *
   * Idempotent: a re-run produces the same final state because we use
   * UNLINK before ZADD (atomic via a pipeline). We deliberately rebuild
   * rather than incrementally update so the projection stays consistent
   * even if some upstream ZINCRBYs were missed.
   */
  async rebuildScope(opts: RefreshOptions): Promise<{ key: string; member_count: number }> {
    const scope = opts.scope;
    const scopeId = opts.scope_id ?? null;
    const period = opts.period ?? thisPeriod();
    const windowDays = opts.windowDays ?? 30;
    const key = leaderboardKey(scope, scopeId, period);
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const filter: { batch_id?: string; centre_id?: string; city_id?: string; msv_only?: boolean } =
      {};
    if (scope === 'batch') filter.batch_id = mustScope(scope, scopeId);
    if (scope === 'centre') filter.centre_id = mustScope(scope, scopeId);
    if (scope === 'city') filter.city_id = mustScope(scope, scopeId);
    if (scope === 'msv') {
      filter.city_id = mustScope(scope, scopeId);
      filter.msv_only = true;
    }
    // national: no filter — all rows.

    const totals = await this.transactions.sumByStudentSince({ since, filter });

    const pipe = this.client.pipeline();
    pipe.unlink(key);
    let added = 0;
    for (const row of totals) {
      if (row.points <= 0) continue; // negative/zero balances shouldn't display
      pipe.zadd(key, row.points, row.student_id);
      added += 1;
    }
    pipe.expire(key, LeaderboardService.ZSET_TTL_SECONDS);
    await pipe.exec();

    this.logger.log(
      `rebuilt leaderboard key=${key} members=${added} window=${windowDays}d period=${period}`,
    );
    return { key, member_count: added };
  }

  /**
   * Snapshot a single ZSET's current state into `leaderboard_snapshots`
   * then DELETE the key. Called by the monthly reset cron.
   */
  async snapshotAndReset(opts: {
    scope: LeaderboardScope;
    scope_id: string | null;
    period: string;
    top_n?: number;
  }): Promise<{ snapshotId: string | null; member_count: number }> {
    const topN = opts.top_n ?? 100;
    const key = leaderboardKey(opts.scope, opts.scope_id, opts.period);
    const raw = (await this.client.zrevrange(key, 0, topN - 1, 'WITHSCORES')) as string[];
    if (raw.length === 0) {
      await this.client.unlink(key);
      return { snapshotId: null, member_count: 0 };
    }
    const snapshot: Array<{ student_id: string; points: number; rank: number }> = [];
    for (let i = 0; i < raw.length; i += 2) {
      snapshot.push({
        student_id: raw[i]!,
        points: Number(raw[i + 1]!),
        rank: snapshot.length + 1,
      });
    }

    // Persist the snapshot.
    const inserted = await this.drizzle.db
      .insert(leaderboard_snapshots)
      .values({
        scope: opts.scope,
        scope_id: opts.scope_id ?? '00000000-0000-0000-0000-000000000000',
        period: opts.period,
        snapshot,
        captured_at: new Date(),
      })
      .onConflictDoNothing({
        target: [
          leaderboard_snapshots.scope,
          leaderboard_snapshots.scope_id,
          leaderboard_snapshots.period,
        ],
      })
      .returning();

    await this.client.unlink(key);
    return {
      snapshotId: inserted[0]?.id ?? null,
      member_count: snapshot.length,
    };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private assertScopeId(scope: LeaderboardScope, scopeId?: string | null): void {
    if (scope === 'national') return;
    if (!scopeId) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: `Leaderboard scope '${scope}' requires scope_id`,
        statusCode: 422,
      });
    }
  }

  private async hydrate(studentIds: string[]): Promise<
    Map<
      string,
      {
        full_name: string;
        student_code: string;
        age_group: string;
        centre_id: string;
        centre_name: string | null;
      }
    >
  > {
    if (studentIds.length === 0) return new Map();
    const rows = (await this.drizzle.dbRead.execute(
      sql`SELECT s.id, s.full_name, s.student_code, s.age_group, s.centre_id, c.name AS centre_name
            FROM students s
            LEFT JOIN centres c ON c.id = s.centre_id
           WHERE s.id = ANY(${sql.raw(`ARRAY['${studentIds.join("','")}']::uuid[]`)})`,
    )) as unknown as Array<{
      id: string;
      full_name: string;
      student_code: string;
      age_group: string;
      centre_id: string;
      centre_name: string | null;
    }>;
    const out = new Map<
      string,
      {
        full_name: string;
        student_code: string;
        age_group: string;
        centre_id: string;
        centre_name: string | null;
      }
    >();
    for (const r of rows) {
      out.set(r.id, {
        full_name: r.full_name,
        student_code: r.student_code,
        age_group: r.age_group,
        centre_id: r.centre_id,
        centre_name: r.centre_name,
      });
    }
    return out;
  }

  /** Visible for testing — quick reach into the underlying client. */
  testGetClient(): Redis {
    return this.client;
  }

  /** Exposed for the `/leaderboards/:scope` controller to silence unused. */

  private touchActor(_actor: ScopedActor, _role?: Role): void {
    /* placeholder for future scope tightening */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function leaderboardKey(
  scope: LeaderboardScope,
  scopeId: string | null,
  period: string,
): string {
  if (scope === 'national') return `lb:national:${period}`;
  if (!scopeId) throw new Error(`leaderboardKey requires scope_id for scope=${scope}`);
  return `lb:${scope}:${scopeId}:${period}`;
}

export function thisPeriod(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function mustScope(scope: LeaderboardScope, scopeId: string | null): string {
  if (!scopeId) {
    throw new Error(`scope_id required for scope=${scope}`);
  }
  return scopeId;
}
