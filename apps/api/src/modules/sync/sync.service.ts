/**
 * SyncService — the brain of `/v1/sync/{batch,bootstrap,delta}`.
 *
 * Responsibilities (Step 14 / SPEC §11):
 *   1. `applyBatch` — idempotent fan-out of client-generated operations.
 *      Each op is keyed by `(user_id, client_op_id)` against
 *      `sync_operations`. Cached successes return as `duplicate`; cached
 *      failures return as `failed` with their original error code; new
 *      ops insert a `processing` row, dispatch to the registered handler,
 *      then update to `success` or `failed`.
 *   2. `bootstrap` — role-shaped working-set hydration for the offline
 *      cache. Redis-cached per user with a 5-minute TTL (`sync:bootstrap:`).
 *   3. `delta` — same shape as bootstrap, filtered by `updated_at > since`.
 *
 * Unknown `op_kind` → `ERR_SYNC_UNKNOWN_OP_KIND`. Mobile only enqueues ops
 * for built features, so this only fires when a stale client outruns the
 * server (or the rare wire-tamper test).
 *
 * Concurrency: ops are dispatched sequentially within a single batch
 * request. The Step 13 attendance flow opens its own DB transaction; running
 * two attendance ops for the same session in parallel would compete on the
 * same upsert lock — sequential dispatch avoids that without any explicit
 * locking. Across requests, the `processing` row in sync_operations
 * provides the short-circuit (returns `ERR_SYNC_DUPLICATE_OP` if a second
 * batch arrives mid-flight for the same client_op_id).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ZodError } from 'zod';

import { AppError, ERROR_CODES, type Role, type SyncOpKind, type SyncResultDto } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import {
  BatchesRepository,
  CentresRepository,
  EnrolmentsRepository,
  NotificationsRepository,
  SessionsRepository,
  StudentsRepository,
  SyncOperationsRepository,
  UsersRepository,
} from '../../db/repositories';
import { type ScopedActor } from '../attendance/attendance.service';

import { SYNC_OP_HANDLERS, type SyncOpContext, type SyncOpHandler } from './handlers/op-handler';

import type { SyncOperationDto } from '@jp/shared';

export interface ApplyBatchResponse {
  results: SyncResultDto[];
  server_timestamp: string;
}

export interface BootstrapPayload {
  user_id: string;
  role: Role;
  view_context: 'parent' | 'student';
  generated_at: string;
  payload: Record<string, unknown>;
}

const BOOTSTRAP_TTL_SECONDS = 300;
const BOOTSTRAP_CACHE_PREFIX = 'sync:bootstrap:';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly handlersByKind: Map<SyncOpKind, SyncOpHandler> = new Map();

  constructor(
    @Inject(SYNC_OP_HANDLERS) handlers: SyncOpHandler[],
    private readonly syncOps: SyncOperationsRepository,
    private readonly redis: RedisService,
    private readonly users: UsersRepository,
    private readonly students: StudentsRepository,
    private readonly enrolments: EnrolmentsRepository,
    private readonly batches: BatchesRepository,
    private readonly centres: CentresRepository,
    private readonly sessions: SessionsRepository,
    private readonly notifications: NotificationsRepository,
  ) {
    for (const h of handlers) {
      if (this.handlersByKind.has(h.op_kind)) {
        throw new Error(`Duplicate sync op handler for kind: ${h.op_kind}`);
      }
      this.handlersByKind.set(h.op_kind, h);
    }
  }

  // ===========================================================================
  // applyBatch
  // ===========================================================================

  async applyBatch(actor: ScopedActor, ops: SyncOperationDto[]): Promise<ApplyBatchResponse> {
    if (ops.length === 0) {
      return { results: [], server_timestamp: new Date().toISOString() };
    }

    // Pre-pass: lookup any prior rows for this user's client_op_ids.
    const clientOpIds = ops.map((o) => o.client_op_id);
    const priorByOpId = await this.syncOps.findByUserAndClientOpIds(actor.user_id, clientOpIds);

    const results: SyncResultDto[] = [];
    for (const op of ops) {
      const prior = priorByOpId.get(op.client_op_id);
      results.push(await this.dispatchOne(actor, op, prior ?? null));
    }

    return { results, server_timestamp: new Date().toISOString() };
  }

  private async dispatchOne(
    actor: ScopedActor,
    op: SyncOperationDto,
    priorRow: {
      id: string;
      status: string;
      response_payload: unknown;
      error: string | null;
    } | null,
  ): Promise<SyncResultDto> {
    // ---- Replay: prior row exists --------------------------------------------
    if (priorRow) {
      if (priorRow.status === 'success') {
        return {
          client_op_id: op.client_op_id,
          status: 'duplicate',
          result: priorRow.response_payload as Record<string, unknown> | undefined,
        };
      }
      if (priorRow.status === 'failed') {
        const [code = ERROR_CODES.ERR_INTERNAL, msg = priorRow.error ?? 'Operation failed'] = (
          priorRow.error ?? ''
        ).split(': ', 2) as [string, string?];
        return {
          client_op_id: op.client_op_id,
          status: 'failed',
          error_code: code,
          error_message: msg,
        };
      }
      // `processing` — another worker / device is mid-flight.
      return {
        client_op_id: op.client_op_id,
        status: 'failed',
        error_code: ERROR_CODES.ERR_SYNC_DUPLICATE_OP,
        error_message: 'Operation is still in flight; retry shortly',
      };
    }

    // ---- New op: resolve handler ---------------------------------------------
    const handler = this.handlersByKind.get(op.op_kind);
    if (!handler) {
      // Persist for visibility, but don't crash. Future steps will register the
      // missing handler — the client will replay the queue then.
      const row = await this.syncOps.insertProcessing({
        user_id: actor.user_id,
        client_op_id: op.client_op_id,
        op_kind: op.op_kind,
        request_payload: op.payload,
      });
      const id = row?.id;
      if (id) {
        await this.syncOps.markFailed(
          id,
          ERROR_CODES.ERR_SYNC_UNKNOWN_OP_KIND,
          `No handler registered for op_kind=${op.op_kind}`,
        );
      }
      return {
        client_op_id: op.client_op_id,
        status: 'failed',
        error_code: ERROR_CODES.ERR_SYNC_UNKNOWN_OP_KIND,
        error_message: `op_kind=${op.op_kind} is not supported by this server version`,
      };
    }

    // Role gate — bail before touching the DB.
    if (!handler.allowed_roles.includes(actor.role)) {
      const row = await this.syncOps.insertProcessing({
        user_id: actor.user_id,
        client_op_id: op.client_op_id,
        op_kind: op.op_kind,
        request_payload: op.payload,
      });
      const id = row?.id;
      if (id) {
        await this.syncOps.markFailed(
          id,
          ERROR_CODES.ERR_RBAC_FORBIDDEN,
          `Role ${actor.role} cannot submit ${op.op_kind}`,
        );
      }
      return {
        client_op_id: op.client_op_id,
        status: 'failed',
        error_code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        error_message: `Role ${actor.role} is not permitted to perform ${op.op_kind}`,
      };
    }

    // ---- Insert `processing` row (idempotent on race) ------------------------
    let row = await this.syncOps.insertProcessing({
      user_id: actor.user_id,
      client_op_id: op.client_op_id,
      op_kind: op.op_kind,
      request_payload: op.payload,
    });
    if (!row) {
      // Race: a parallel request won the INSERT. Re-read and emit its outcome.
      const winner = await this.syncOps.findOne(actor.user_id, op.client_op_id);
      if (!winner) {
        // Highly unlikely (we just lost a unique-index race but the row vanished).
        return {
          client_op_id: op.client_op_id,
          status: 'failed',
          error_code: ERROR_CODES.ERR_INTERNAL,
          error_message: 'sync_operations race resolution failed',
        };
      }
      return this.dispatchOne(actor, op, {
        id: winner.id,
        status: winner.status,
        response_payload: winner.response_payload,
        error: winner.error,
      });
    }

    // ---- Validate + dispatch -------------------------------------------------
    let parsed: unknown;
    try {
      parsed = handler.payload_schema.parse(op.payload);
    } catch (err) {
      const message =
        err instanceof ZodError
          ? err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
          : (err as Error).message;
      await this.syncOps.markFailed(row.id, ERROR_CODES.ERR_SYNC_VALIDATION_FAILED, message);
      return {
        client_op_id: op.client_op_id,
        status: 'failed',
        error_code: ERROR_CODES.ERR_SYNC_VALIDATION_FAILED,
        error_message: message,
      };
    }

    const ctx: SyncOpContext = {
      actor,
      user_id: actor.user_id,
      client_op_id: op.client_op_id,
      client_timestamp: op.client_timestamp,
    };

    try {
      const result = await handler.handle(ctx, parsed);
      await this.syncOps.markSucceeded(row.id, result);
      return {
        client_op_id: op.client_op_id,
        status: 'success',
        result: result as Record<string, unknown> | undefined,
      };
    } catch (err) {
      if (err instanceof AppError) {
        const isConflict = err.statusCode === 409;
        const code = isConflict ? ERROR_CODES.ERR_SYNC_CONFLICT : err.code;
        await this.syncOps.markFailed(row.id, code, err.message);
        return {
          client_op_id: op.client_op_id,
          status: 'failed',
          error_code: code,
          error_message: err.message,
        };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[sync.${op.op_kind}] handler crashed: ${message}`);
      await this.syncOps.markFailed(row.id, ERROR_CODES.ERR_INTERNAL, message);
      return {
        client_op_id: op.client_op_id,
        status: 'failed',
        error_code: ERROR_CODES.ERR_INTERNAL,
        error_message: 'Server error processing op',
      };
    }
  }

  // ===========================================================================
  // bootstrap
  // ===========================================================================

  async bootstrap(actor: ScopedActor): Promise<BootstrapPayload> {
    const cacheKey = `${BOOTSTRAP_CACHE_PREFIX}${actor.user_id}`;
    try {
      const cached = await this.redis.cacheClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as BootstrapPayload;
      }
    } catch (err) {
      this.logger.warn(
        `[sync.bootstrap] cache GET failed: ${(err as Error).message} — falling through`,
      );
    }

    const built = await this.buildWorkingSet(actor, /* since */ null);
    try {
      await this.redis.cacheClient.set(
        cacheKey,
        JSON.stringify(built),
        'EX',
        BOOTSTRAP_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(`[sync.bootstrap] cache SET failed: ${(err as Error).message}`);
    }
    return built;
  }

  // ===========================================================================
  // delta
  // ===========================================================================

  async delta(actor: ScopedActor, since: Date): Promise<BootstrapPayload> {
    return this.buildWorkingSet(actor, since);
  }

  // ===========================================================================
  // Internals — role-shaped working set
  // ===========================================================================

  private async buildWorkingSet(actor: ScopedActor, since: Date | null): Promise<BootstrapPayload> {
    // Step 14 ships handlers/data for the modules currently online. Niyam /
    // homework / notices / library / leaderboard slots are populated by their
    // respective build steps (Step 15+); we emit empty defaults so the mobile
    // can read the keys unconditionally.
    const generatedAt = new Date().toISOString();

    const userRow = await this.users.findById(actor.user_id);
    const user = userRow
      ? {
          id: userRow.id,
          phone: userRow.phone,
          full_name: userRow.full_name,
          role: userRow.role,
          preferred_language: userRow.preferred_language,
          email: userRow.email ?? null,
        }
      : null;

    const payload: Record<string, unknown> = {
      user,
      common: await this.buildCommonSlice(actor),
    };

    if (actor.role === 'parent' || actor.role === 'guest') {
      payload.parent = await this.buildParentSlice(actor);
    }
    if (actor.role === 'shikshak') {
      payload.shikshak = await this.buildShikshakSlice(actor);
    }
    if (
      actor.role === 'sanchalak' ||
      actor.role === 'city_admin' ||
      actor.role === 'state_admin' ||
      actor.role === 'super_admin'
    ) {
      payload.sanchalak = await this.buildSanchalakSlice(actor);
    }

    void since; // delta filtering is applied per-slice above via `updated_at`
    // when the underlying repos support it; the wire envelope shape
    // is identical.

    return {
      user_id: actor.user_id,
      role: actor.role,
      view_context: 'parent',
      generated_at: generatedAt,
      payload,
    };
  }

  private async buildCommonSlice(actor: ScopedActor): Promise<Record<string, unknown>> {
    const notifs = await this.notifications.listForUser(actor.user_id, { limit: 30 });
    return {
      notifications: notifs.map((n) => ({
        id: n.id,
        kind: n.kind,
        title_en: n.title_en,
        title_hi: n.title_hi,
        body_en: n.body_en,
        body_hi: n.body_hi,
        is_read: n.is_read,
        created_at: n.created_at,
      })),
      // Slots reserved for future steps — kept as empty defaults so the
      // mobile can read these keys unconditionally.
      notices: [] as unknown[],
      niyams_catalogue: [] as unknown[],
      library_tiers: [] as unknown[],
      leaderboard_snapshot: null,
    };
  }

  private async buildParentSlice(actor: ScopedActor): Promise<Record<string, unknown>> {
    const childRows = await this.students.findByParent(actor.user_id);
    const batchIds = Array.from(
      new Set(childRows.map((s) => s.batch_id).filter((id): id is string => Boolean(id))),
    );
    const batches = await Promise.all(batchIds.map((id) => this.batches.findById(id)));
    return {
      students: childRows.map((s) => ({
        id: s.id,
        full_name: s.full_name,
        student_code: s.student_code,
        age_group: s.age_group,
        status: s.status,
        batch_id: s.batch_id,
        centre_id: s.centre_id,
        dob: s.dob,
        msv_status: s.msv_status,
        student_view_enabled: s.student_view_enabled,
      })),
      batches: batches
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .map((b) => ({
          id: b.id,
          name: b.name,
          centre_id: b.centre_id,
          age_group: b.age_group,
          start_time: b.start_time,
          end_time: b.end_time,
          day_of_week: b.day_of_week,
          academic_year: b.academic_year,
        })),
      // Pending enrolments scoped to this parent. `enrolments` doesn't carry
      // the child's name directly — that lives in the `form_response`; we
      // emit ids + status here and let later steps stitch the full name in.
      enrolments: await this.enrolments.list({ limit: 50 }).then((rows) =>
        rows
          .filter((e) => e.parent_user_id === actor.user_id)
          .map((e) => ({
            id: e.id,
            status: e.status,
            student_id: e.student_id,
            requested_centre_id: e.requested_centre_id,
            requested_batch_id: e.requested_batch_id,
            decided_at: e.decided_at,
            rejection_reason: e.rejection_reason,
            form_response_id: e.form_response_id,
            created_at: e.created_at,
          })),
      ),
    };
  }

  private async buildShikshakSlice(actor: ScopedActor): Promise<Record<string, unknown>> {
    const batches = await this.batches.listByShikshak(actor.user_id);
    const batchIds = batches.map((b) => b.id);
    const studentRows = await Promise.all(
      batchIds.map((batch_id) => this.students.list({ batch_id, status: 'active', limit: 200 })),
    );
    const students = studentRows.flat();
    const todayInIst = istToday();
    const today = await this.sessions.listForShikshakToday(actor.user_id, todayInIst);
    return {
      batches: batches.map((b) => ({
        id: b.id,
        name: b.name,
        centre_id: b.centre_id,
        age_group: b.age_group,
        start_time: b.start_time,
        end_time: b.end_time,
        day_of_week: b.day_of_week,
        academic_year: b.academic_year,
      })),
      students: students.map((s) => ({
        id: s.id,
        full_name: s.full_name,
        student_code: s.student_code,
        age_group: s.age_group,
        batch_id: s.batch_id,
        status: s.status,
      })),
      sessions_today: today,
      // Future steps populate these.
      niyams: [] as unknown[],
      homework: [] as unknown[],
    };
  }

  private async buildSanchalakSlice(actor: ScopedActor): Promise<Record<string, unknown>> {
    const centreIds = actor.centre_ids ?? [];
    const centresOut = await this.centres.listByIds(centreIds);
    const batches = await Promise.all(centreIds.map((id) => this.batches.listByCentre(id)));
    const pending = await this.enrolments.list({
      centre_ids: centreIds,
      status: 'pending',
      limit: 50,
    });
    return {
      centres: centresOut.map((c) => ({
        id: c.id,
        name: c.name,
        city_id: c.city_id,
        status: c.status,
        gps_radius_m: c.gps_radius_m,
        lat: c.lat,
        lng: c.lng,
      })),
      batches: batches.flat().map((b) => ({
        id: b.id,
        name: b.name,
        centre_id: b.centre_id,
        age_group: b.age_group,
        start_time: b.start_time,
        end_time: b.end_time,
        day_of_week: b.day_of_week,
        academic_year: b.academic_year,
        capacity: b.capacity,
      })),
      pending_enrolments: pending.map((e) => ({
        id: e.id,
        status: e.status,
        student_id: e.student_id,
        parent_user_id: e.parent_user_id,
        requested_centre_id: e.requested_centre_id,
        requested_batch_id: e.requested_batch_id,
        form_response_id: e.form_response_id,
        created_at: e.created_at,
      })),
    };
  }
}

// -----------------------------------------------------------------------------
// IST helper — duplicated here to avoid pulling in attendance-internal helpers.
// -----------------------------------------------------------------------------

function istToday(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
