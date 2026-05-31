/**
 * PunyaService — Step 16 (SPEC §5.7, §6.9, §8.5).
 *
 * Responsibilities:
 *
 *   1. `award()` — internal entrypoint used by any module that grants Punya
 *      (attendance, niyam, homework, etc). idempotency_key MANDATORY.
 *      Single-tx ledger insert + balance UPSERT + tier recompute. On a
 *      tier-up: emits a `punya.tier_upgrade` event (via fanout queue) so the
 *      celebration push + certificate job fire downstream.
 *      Also enqueues a debounced `punya.leaderboard.refresh` job per scope.
 *
 *   2. `manualAward()` — admin endpoint (sanchalak+). Validates the points
 *      are inside the catalogue / city-override envelope and the feature's
 *      `requires_reason` is honoured.
 *
 *   3. `reverseTransaction()` — admin endpoint that wraps the repository's
 *      reverseTransaction with the policy checks: source must exist + not
 *      already be a reversal, must be within 30 days (Q5/§8.5). Audit
 *      logged. Emits a tier-downgrade event so the certificate flow can
 *      withdraw a freshly-issued tier cert.
 *
 *   4. Reads: balance, paginated transactions, tier progress.
 *
 * The leaderboard read path lives in `LeaderboardService` — kept separate so
 * the Redis ZSET surface is easy to unit-test in isolation.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  AppError,
  ERROR_CODES,
  type Role,
  type Tier,
  TIER_THRESHOLDS,
  type TierProgress,
  tierForPoints,
  tierProgressFor,
} from '@jp/shared';

import {
  CentresRepository,
  PunyaFeaturesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';

import type { AwardResult, PunyaTierUpgradeEvent, ReverseResultDto } from './punya.types';
import type { NewPunyaTransaction, PunyaBalance, PunyaTransaction, Student } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
  view_context?: 'parent' | 'student';
  view_student_id?: string | undefined;
}

/** Internal callers pass this; manual-award builds it from the request body. */
export interface AwardInput {
  student_id: string;
  feature_key: string;
  /** Override points; if absent the catalogue default is used. */
  points?: number;
  reason?: string;
  awarded_by_user_id: string | null;
  source_entity_kind: string;
  source_entity_id: string;
  is_msv_track?: boolean;
  awarded_at?: Date;
  /** MANDATORY — even from internal callers. */
  idempotency_key: string;
}

export interface ManualAwardInput {
  student_id: string;
  feature_key: string;
  points: number;
  reason: string;
  /** Optional MSV-track flag — defaults to the student's MSV status. */
  is_msv_track?: boolean;
}

export interface ReverseInput {
  /** Ledger row to reverse. */
  source_id: string;
  reason: string;
  idempotency_key: string;
}

/** SPEC §8.5: 30-day reversal window after the original award. */
export const PUNYA_REVERSAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class PunyaService {
  private readonly logger = new Logger(PunyaService.name);

  /**
   * In-process debounce table for the leaderboard refresh queue:
   *   scope-key → last enqueued at (ms).
   * Why in-process: each NestJS worker pod handles its own award traffic;
   * the leaderboard processor itself is single-concurrency so the same
   * `jobId` collapses across pods anyway. This table just avoids enqueuing
   * 100 jobs for 100 awards inside the same 5s window from one pod.
   */
  private readonly leaderboardDebounce = new Map<string, number>();
  /** 5-second debounce — SPEC says "5s debounce key per scope". */
  private static readonly LB_DEBOUNCE_MS = 5_000;

  constructor(
    private readonly transactions: PunyaTransactionsRepository,
    private readonly features: PunyaFeaturesRepository,
    private readonly students: StudentsRepository,
    private readonly centres: CentresRepository,
    private readonly audit: AuditService,
    @Optional()
    @Inject(`BullQueue_${QUEUES.PUNYA_LEADERBOARD_REFRESH}`)
    private readonly leaderboardQueue: Queue | null,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT)
    private readonly fanoutQueue: Queue,
  ) {}

  // ===========================================================================
  // Award (internal)
  // ===========================================================================

  /**
   * Award Punya. Internal callers (attendance, niyam, homework, ...) MUST
   * pass `idempotency_key` and `source_entity_*`. Idempotent — a duplicate
   * call returns the cached transaction with `duplicate: true`.
   */
  async award(input: AwardInput): Promise<AwardResult> {
    if (!input.idempotency_key) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_IDEMPOTENCY_REQUIRED,
        message: 'idempotency_key is required for every Punya award',
        statusCode: 422,
      });
    }
    const resolved = await this.features.resolveFeature({
      feature_key: input.feature_key,
    });
    if (!resolved) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_INVALID_FEATURE,
        message: `Unknown Punya feature: ${input.feature_key}`,
        statusCode: 422,
      });
    }
    const student = await this.requireStudent(input.student_id);
    const points = input.points ?? resolved.effective_points;

    const row: NewPunyaTransaction = {
      student_id: input.student_id,
      feature_key: input.feature_key,
      points,
      reason: input.reason ?? null,
      awarded_by_user_id: input.awarded_by_user_id,
      source_entity_kind: input.source_entity_kind,
      source_entity_id: input.source_entity_id,
      is_msv_track: input.is_msv_track ?? false,
      awarded_at: input.awarded_at ?? new Date(),
      city_id: await this.resolveCityId(student),
      centre_id: student.centre_id,
      batch_id: student.batch_id,
      idempotency_key: input.idempotency_key,
    };

    const result = await this.transactions.insertWithBalanceUpdate(row);

    if (!result.duplicate) {
      // Fire-and-forget side effects.
      void this.scheduleLeaderboardRefresh(student);
      if (result.tier_upgraded && result.new_tier && result.previous_tier && result.balance) {
        await this.emitTierUpgrade({
          student,
          previous_tier: result.previous_tier,
          new_tier: result.new_tier,
          total_points: result.balance.total_points,
          triggered_by_transaction_id: result.transaction.id,
        }).catch((err) => {
          this.logger.warn(`tier upgrade emit failed: ${(err as Error).message}`);
        });
      }
    }

    return {
      transaction: result.transaction,
      balance: result.balance,
      duplicate: result.duplicate,
      previous_tier: result.previous_tier,
      new_tier: result.new_tier,
      tier_upgraded: result.tier_upgraded,
    };
  }

  // ===========================================================================
  // Manual award (POST /v1/admin/punya/manual-award + POST /v1/punya/award)
  // ===========================================================================

  async manualAward(actor: ScopedActor, input: ManualAwardInput): Promise<AwardResult> {
    this.assertCanManuallyAward(actor);
    const student = await this.requireStudent(input.student_id);
    await this.assertCanReachStudent(actor, student);

    const cityId = await this.resolveCityId(student);
    const resolved = await this.features.resolveFeature({
      feature_key: input.feature_key,
      city_id: cityId,
    });
    if (!resolved) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_INVALID_FEATURE,
        message: `Unknown Punya feature: ${input.feature_key}`,
        statusCode: 422,
      });
    }
    if (resolved.feature.requires_reason && (!input.reason || input.reason.trim().length < 3)) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_REASON_REQUIRED,
        message: 'A reason of at least 3 characters is required for this feature',
        statusCode: 422,
      });
    }
    if (input.points < resolved.effective_min || input.points > resolved.effective_max) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_AMOUNT_OUT_OF_BOUNDS,
        message: `Points ${input.points} outside [${resolved.effective_min}..${resolved.effective_max}] for feature '${resolved.feature.key}'`,
        statusCode: 422,
      });
    }

    // Manual idempotency: actor + student + feature + day + truncated reason
    // collapses accidental double-clicks within a day. Admin can intentionally
    // re-award by waiting until tomorrow (or via a new key in the body for
    // unit tests).
    const reasonSlug = (input.reason ?? '').slice(0, 24).replace(/\s+/g, '_');
    const dayKey = new Date().toISOString().slice(0, 10);
    const idempotency_key = `manual:${actor.user_id}:${student.id}:${input.feature_key}:${dayKey}:${reasonSlug}`;

    const result = await this.award({
      student_id: student.id,
      feature_key: input.feature_key,
      points: input.points,
      reason: input.reason,
      awarded_by_user_id: actor.user_id,
      source_entity_kind: 'manual',
      source_entity_id: student.id,
      is_msv_track: input.is_msv_track ?? false,
      idempotency_key,
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'punya_transaction',
        entity_id: result.transaction.id,
        after: {
          student_id: student.id,
          feature_key: input.feature_key,
          points: input.points,
          reason: input.reason,
          duplicate: result.duplicate,
        },
      })
      .catch(() => undefined);
    return result;
  }

  // ===========================================================================
  // Reversal (POST /v1/punya/reverse)
  // ===========================================================================

  async reverseTransaction(actor: ScopedActor, input: ReverseInput): Promise<ReverseResultDto> {
    this.assertCanManuallyAward(actor);
    const source = await this.transactions.findById(input.source_id);
    if (!source) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_TRANSACTION_NOT_FOUND,
        message: 'Punya transaction not found',
        statusCode: 404,
      });
    }
    if (source.reversal_of !== null) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_ALREADY_REVERSED,
        message: 'This transaction is itself a reversal',
        statusCode: 409,
      });
    }
    // No double-reverse: check for an existing reversal pointing at source.
    const existing = await this.transactions
      .findByIdempotencyKey(`reverse:${source.id}`)
      .catch(() => null);
    if (existing) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_ALREADY_REVERSED,
        message: 'This transaction has already been reversed',
        statusCode: 409,
      });
    }
    const ageMs = Date.now() - source.awarded_at.getTime();
    if (ageMs > PUNYA_REVERSAL_WINDOW_MS) {
      throw new AppError({
        code: ERROR_CODES.ERR_PUNYA_REVERSAL_WINDOW_EXPIRED,
        message: 'Reversal window (30 days) has expired',
        statusCode: 409,
      });
    }
    const student = await this.requireStudent(source.student_id);
    await this.assertCanReachStudent(actor, student);

    const idempotency_key = input.idempotency_key || `reverse:${source.id}`;
    const result = await this.transactions.reverseTransaction({
      source_id: source.id,
      reversed_by_user_id: actor.user_id,
      reason: input.reason,
      awarded_at: new Date(),
      idempotency_key,
    });

    // Side effects.
    void this.scheduleLeaderboardRefresh(student);

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'reverse',
        entity_kind: 'punya_transaction',
        entity_id: result.reversal.id,
        before: { source_id: source.id, points: source.points, tier: result.previous_tier },
        after: { points: result.reversal.points, tier: result.new_tier, reason: input.reason },
      })
      .catch(() => undefined);

    if (result.tier_downgraded) {
      await this.fanoutQueue
        .add('punya.tier_downgrade', {
          event: 'punya.tier_downgrade',
          recipient_user_ids: [student.parent_user_id],
          source: { kind: 'punya_transaction', id: result.reversal.id },
          data: {
            student_full_name: student.full_name,
            previous_tier: result.previous_tier,
            new_tier: result.new_tier,
            total_points: result.balance.total_points,
          },
          deep_link: `/students/${student.id}/punya`,
        })
        .catch(() => undefined);
    }

    return {
      reversal_id: result.reversal.id,
      source_id: source.id,
      balance: result.balance,
      previous_tier: result.previous_tier,
      new_tier: result.new_tier,
      tier_downgraded: result.tier_downgraded,
    };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async getBalance(
    actor: ScopedActor,
    studentId: string,
  ): Promise<{ balance: PunyaBalance | null; progress: TierProgress }> {
    const student = await this.requireStudent(studentId);
    await this.assertCanReachStudent(actor, student);
    const balance = await this.transactions.balanceFor(studentId);
    const progress = tierProgressFor(balance?.total_points ?? 0);
    return { balance, progress };
  }

  async getTransactions(
    actor: ScopedActor,
    studentId: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<{
    items: PunyaTransaction[];
    next_cursor: string | null;
  }> {
    const student = await this.requireStudent(studentId);
    await this.assertCanReachStudent(actor, student);
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const before = opts.before ? new Date(opts.before) : undefined;
    const rows = await this.transactions.paginatedByStudent(studentId, {
      limit,
      ...(before ? { before } : {}),
    });
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const next_cursor = hasMore ? items[items.length - 1]!.awarded_at.toISOString() : null;
    return { items, next_cursor };
  }

  async getTierProgress(actor: ScopedActor, studentId: string): Promise<TierProgress> {
    const { progress } = await this.getBalance(actor, studentId);
    return progress;
  }

  // ===========================================================================
  // RBAC helpers
  // ===========================================================================

  /**
   * sanchalak+ for manual awards (per SPEC §6.9 — shikshak gets a narrower
   * "own batch only" surface, enforced by reach check below). We accept
   * shikshak too and let assertCanReachStudent gate the per-student write.
   */
  private assertCanManuallyAward(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only sanchalak+ (and shikshak for own batch) can award Punya manually',
        statusCode: 403,
      });
    }
  }

  /**
   * Can `actor` see / write the Punya of `student`? Parents see their own
   * children; admins see anyone within their scope; shikshak sees only
   * students in their assigned batches.
   */
  private async assertCanReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'parent') {
      if (student.parent_user_id !== actor.user_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not yours',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.role === 'shikshak') {
      const batches = actor.batch_ids ?? [];
      if (!student.batch_id || !batches.includes(student.batch_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your batch',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.role === 'sanchalak') {
      const centres = actor.centre_ids ?? [];
      if (!centres.includes(student.centre_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your centre',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.role === 'city_admin') {
      const city = await this.resolveCityId(student);
      if (!actor.city_id || actor.city_id !== city) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is outside your city',
          statusCode: 403,
        });
      }
      return;
    }
    // Other roles (guest/student) shouldn't reach this method but be defensive.
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
      message: 'Role cannot access Punya endpoints',
      statusCode: 403,
    });
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async requireStudent(studentId: string): Promise<Student> {
    const student = await this.students.findById(studentId);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    return student;
  }

  /**
   * Read the student's city from the centres table. Students have centre_id;
   * centres carry city_id. Cached per request via the centres repo's own
   * read pool (no additional caching here — the repo lookup is one indexed
   * row).
   */
  private async resolveCityId(student: Student): Promise<string> {
    const centre = await this.centres.findById(student.centre_id);
    if (!centre) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: `Centre ${student.centre_id} not found`,
        statusCode: 500,
      });
    }
    return centre.city_id;
  }

  /**
   * Debounced enqueue of `punya.leaderboard.refresh` jobs. We refresh all 5
   * scopes for the student — the worker decides which keys actually need
   * recomputing based on the job payload.
   */
  private async scheduleLeaderboardRefresh(student: Student): Promise<void> {
    if (!this.leaderboardQueue) return;
    const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const cityId = await this.resolveCityId(student);
    const scopes: Array<{ scope: string; scope_id: string | null }> = [
      ...(student.batch_id ? [{ scope: 'batch', scope_id: student.batch_id }] : []),
      { scope: 'centre', scope_id: student.centre_id },
      { scope: 'city', scope_id: cityId },
      { scope: 'national', scope_id: null },
      { scope: 'msv', scope_id: cityId },
    ];
    const now = Date.now();
    for (const s of scopes) {
      const key = `${s.scope}:${s.scope_id ?? 'national'}:${period}`;
      const lastAt = this.leaderboardDebounce.get(key) ?? 0;
      if (now - lastAt < PunyaService.LB_DEBOUNCE_MS) continue;
      this.leaderboardDebounce.set(key, now);
      await this.leaderboardQueue
        .add(
          'leaderboard.refresh',
          { scope: s.scope, scope_id: s.scope_id, period },
          { jobId: `lb:${key}`, removeOnComplete: true, removeOnFail: false },
        )
        .catch(() => undefined);
    }
  }

  /**
   * Emit a `punya.tier_upgrade` event onto the notifications fanout queue —
   * the existing fanout worker handles the push notification path; the
   * dedicated worker for the certificate PDF lives under
   * `report.generation` and is fired from the same payload by the fanout
   * processor.
   */
  private async emitTierUpgrade(opts: {
    student: Student;
    previous_tier: Tier;
    new_tier: Tier;
    total_points: number;
    triggered_by_transaction_id: string;
  }): Promise<void> {
    const payload: PunyaTierUpgradeEvent = {
      student_id: opts.student.id,
      parent_user_id: opts.student.parent_user_id,
      previous_tier: opts.previous_tier,
      new_tier: opts.new_tier,
      total_points: opts.total_points,
      triggered_by_transaction_id: opts.triggered_by_transaction_id,
    };
    await this.fanoutQueue.add('punya.tier_upgrade', {
      event: 'punya.tier_upgrade',
      recipient_user_ids: [opts.student.parent_user_id],
      source: { kind: 'punya_transaction', id: opts.triggered_by_transaction_id },
      data: {
        student_full_name: opts.student.full_name,
        previous_tier: opts.previous_tier,
        new_tier: opts.new_tier,
        total_points: opts.total_points,
        threshold: TIER_THRESHOLDS[opts.new_tier],
        celebration: true,
      },
      deep_link: `/students/${opts.student.id}/punya`,
      // Embed the typed event for any downstream worker that wants it
      // verbatim (certificate generator, analytics).
      tier_upgrade: payload,
    });
  }
}

/**
 * Re-export so consumers can `import { tierForPoints } from '../punya/punya.service'`
 * without dragging in the whole shared barrel — keeps the service file the
 * canonical "everything Punya" surface.
 */
export { tierForPoints };
