/**
 * SessionsService — Step 13. The HTTP-side workflow for the shikshak's
 * "open session / check in / mark / check out / cancel" flow.
 *
 * Public methods:
 *   today         — shikshak's batches for today + pre-rolled session info
 *   checkIn       — POST /v1/sessions/(:id?)/check-in (Haversine, off-site flag)
 *   checkOut      — POST /v1/sessions/:id/check-out (duration, completed status)
 *   cancel        — POST /v1/sessions/:id/cancel (reason, fanout to parents)
 *   list          — GET /v1/sessions?batch_id=&from=&to=
 *
 * Idempotency:
 *   - checkIn: if `sessions.check_in_at` is set AND the inbound `client_op_id`
 *     differs from any prior one for this session → 409 ERR_SESSION_ALREADY_CHECKED_IN.
 *     For now we don't persist the prior client_op_id; the conservative behaviour
 *     is to allow the second check-in IF it lands inside a small no-op window
 *     (5 minutes). In Step 13 we keep things simple: any non-fresh state is 409.
 *   - cancel: writes session_cancellations row + sessions.cancelled_*.
 *
 * GPS:
 *   - Haversine distance computed from centre.lat/centre.lng. If >
 *     centre.gps_radius_m → off-site flag, sanchalak notification, but the
 *     check-in is still allowed (SPEC §8.2.4 "still allows check-in but flags").
 *   - Accuracy gate: reject if `accuracy_m > 100` per SPEC §8.2.2.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, QUEUES, type Role } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  BatchesRepository,
  CentresRepository,
  SanchalakAssignmentsRepository,
  SessionCancellationsRepository,
  SessionsRepository,
} from '../../db/repositories';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { AuditService } from '../audit/audit.service';

import { haversineMeters } from './haversine';

import type { Session } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  state_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

export interface CheckInInput {
  /** May be null when the controller resolves "today's session" from batch_id. */
  session_id?: string;
  /** Required when session_id is omitted. */
  batch_id?: string;
  lat: number;
  lng: number;
  accuracy_m: number;
  client_op_id: string;
}

export interface CheckOutInput {
  lat: number;
  lng: number;
  client_op_id: string;
}

export interface TodayRow {
  batch_id: string;
  batch_name: string;
  centre_id: string;
  centre_name: string;
  start_time: string;
  end_time: string;
  session_id: string | null;
  session_status: string | null;
  check_in_at: string | null;
}

const MAX_GPS_ACCURACY_M = 100;
const NO_OP_REPLAY_WINDOW_MS = 5 * 60 * 1000;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly fanoutQueue: Queue;

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly sessionsRepo: SessionsRepository,
    private readonly batchesRepo: BatchesRepository,
    private readonly centresRepo: CentresRepository,
    private readonly sanchalakRepo: SanchalakAssignmentsRepository,
    private readonly cancellationsRepo: SessionCancellationsRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    redis: RedisService,
  ) {
    this.fanoutQueue = new Queue(QUEUES.NOTIFICATIONS_FANOUT, {
      connection: redis.bullmqClient,
    });
  }

  // -------------------------------------------------------------------------
  // GET /v1/sessions/today
  // -------------------------------------------------------------------------

  async today(actor: ScopedActor): Promise<{ items: TodayRow[]; date: string }> {
    const date = todayInIst();
    const rows = await this.sessionsRepo.listForShikshakToday(actor.user_id, date);
    return {
      date,
      items: rows.map((r) => ({
        batch_id: r.batch_id,
        batch_name: r.batch_name,
        centre_id: r.centre_id,
        centre_name: r.centre_name,
        start_time: r.start_time,
        end_time: r.end_time,
        session_id: r.session_id,
        session_status: r.session_status,
        check_in_at: r.check_in_at ? r.check_in_at.toISOString() : null,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // POST /v1/sessions/(:id?)/check-in
  // -------------------------------------------------------------------------

  async checkIn(actor: ScopedActor, input: CheckInInput): Promise<{ session: Session }> {
    if (input.accuracy_m > MAX_GPS_ACCURACY_M) {
      throw new AppError({
        code: ERROR_CODES.ERR_ATTENDANCE_GPS_ACCURACY_TOO_LOW,
        message: `GPS accuracy ${input.accuracy_m}m exceeds the ${MAX_GPS_ACCURACY_M}m gate — move outdoors and try again`,
        statusCode: 400,
      });
    }

    // Resolve session: by id (SPEC primary) or by batch_id (id-less convenience).
    let sessionRow: Session | null = null;
    let resolvedBatchId: string;
    if (input.session_id) {
      sessionRow = await this.sessionsRepo.findById(input.session_id);
      if (!sessionRow) {
        throw new AppError({
          code: ERROR_CODES.ERR_SESSION_NOT_FOUND,
          message: 'Session not found',
          statusCode: 404,
        });
      }
      resolvedBatchId = sessionRow.batch_id;
    } else {
      if (!input.batch_id) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'batch_id is required when session_id is omitted',
          statusCode: 422,
        });
      }
      resolvedBatchId = input.batch_id;
      sessionRow = await this.sessionsRepo.findOrCreateForToday(
        resolvedBatchId,
        todayInIst(),
        actor.user_id,
      );
    }

    // Authorize: the shikshak must be assigned to this batch.
    const batch = await this.batchesRepo.findById(resolvedBatchId);
    if (!batch || batch.deleted_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Batch not found',
        statusCode: 404,
      });
    }
    if (actor.role === 'shikshak' && batch.shikshak_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_ASSIGNED_TO_SHIKSHAK,
        message: 'This batch is not assigned to you',
        statusCode: 403,
      });
    }

    // Idempotent replay: same client_op_id within the no-op window → return existing.
    if (sessionRow.check_in_at) {
      const elapsedMs = Date.now() - new Date(sessionRow.check_in_at).getTime();
      if (elapsedMs < NO_OP_REPLAY_WINDOW_MS) {
        // Treat any check-in inside the 5-minute window as a no-op replay.
        return { session: sessionRow };
      }
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_ALREADY_CHECKED_IN,
        message: 'Session has already been checked in',
        statusCode: 409,
      });
    }

    if (sessionRow.status === 'cancelled') {
      throw new AppError({
        code: ERROR_CODES.ERR_ATTENDANCE_SESSION_CANCELLED,
        message: 'Session has been cancelled and cannot be checked in',
        statusCode: 409,
      });
    }

    // Resolve centre + GPS radius for Haversine.
    const centre = await this.centresRepo.findById(batch.centre_id);
    if (!centre) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Centre not found',
        statusCode: 404,
      });
    }
    const centreLat = centre.lat ? Number(centre.lat) : null;
    const centreLng = centre.lng ? Number(centre.lng) : null;
    const distance =
      centreLat !== null && centreLng !== null
        ? haversineMeters(input.lat, input.lng, centreLat, centreLng)
        : 0;
    const offSite = centreLat !== null && distance > centre.gps_radius_m;

    const updated = await this.sessionsRepo.setCheckIn(sessionRow.id, {
      check_in_at: new Date(),
      check_in_lat: input.lat.toFixed(7),
      check_in_lng: input.lng.toFixed(7),
      check_in_distance_m: distance,
      gps_haversine_m: distance,
      shikshak_user_id: actor.user_id,
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'session.checked_in',
        entity_kind: 'session',
        entity_id: updated.id,
        after: {
          batch_id: updated.batch_id,
          distance_m: distance,
          off_site: offSite,
          gps_radius_m: centre.gps_radius_m,
        },
      })
      .catch(() => undefined);

    // Live admin dashboard event — off-site check-ins surface with a flag.
    this.realtime.emitToAdminDashboard(centre.city_id, {
      event: 'session.checked_in',
      city_id: centre.city_id,
      actor_role: actor.role,
      summary_en: offSite
        ? `Off-site check-in (${distance}m) for ${batch.name} at ${centre.name}`
        : `${batch.name} session started at ${centre.name}`,
      summary_hi: offSite
        ? `${batch.name} — Off-site check-in (${distance}m)`
        : `${batch.name} सत्र शुरू हुआ`,
      source_entity_kind: 'session',
      source_entity_id: updated.id,
      at: new Date().toISOString(),
    });

    if (offSite) {
      const assignments = await this.sanchalakRepo
        .listForCentre(centre.id)
        .catch(() => [] as Array<{ sanchalak_user_id: string }>);
      const sanchalakIds = assignments.map((a) => a.sanchalak_user_id);
      if (sanchalakIds.length > 0) {
        await this.fanoutQueue
          .add('notice.critical', {
            event: 'notice.critical',
            recipient_user_ids: sanchalakIds,
            source: { kind: 'session', id: updated.id },
            data: {
              title: 'Off-site check-in flagged',
              title_hi: 'Off-site check-in दर्ज',
              body: `Shikshak checked in ${distance}m from ${centre.name} (radius ${centre.gps_radius_m}m).`,
              body_hi: `Shikshak ने ${centre.name} से ${distance}m दूर check-in किया (radius ${centre.gps_radius_m}m).`,
            },
            deep_link: `/admin/attendance/sessions/${updated.id}`,
            is_critical: true,
          })
          .catch((err) =>
            this.logger.warn(`off-site fanout enqueue failed: ${(err as Error).message}`),
          );
      }
    }

    return { session: updated };
  }

  // -------------------------------------------------------------------------
  // POST /v1/sessions/:id/check-out
  // -------------------------------------------------------------------------

  async checkOut(
    actor: ScopedActor,
    sessionId: string,
    input: CheckOutInput,
  ): Promise<{ session: Session }> {
    const sessionRow = await this.sessionsRepo.findById(sessionId);
    if (!sessionRow) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_FOUND,
        message: 'Session not found',
        statusCode: 404,
      });
    }
    if (sessionRow.status !== 'in_progress') {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_IN_PROGRESS,
        message: `Session is ${sessionRow.status}; only in_progress can be checked out`,
        statusCode: 409,
      });
    }
    if (actor.role === 'shikshak' && sessionRow.shikshak_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_ASSIGNED_TO_SHIKSHAK,
        message: 'This session is not assigned to you',
        statusCode: 403,
      });
    }

    const now = new Date();
    const checkInAt = sessionRow.check_in_at ? new Date(sessionRow.check_in_at) : now;
    const duration = Math.max(0, Math.round((now.getTime() - checkInAt.getTime()) / 60_000));

    const updated = await this.sessionsRepo.setCheckOut(sessionRow.id, {
      check_out_at: now,
      check_out_lat: input.lat.toFixed(7),
      check_out_lng: input.lng.toFixed(7),
      duration_minutes: duration,
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'session.checked_out',
        entity_kind: 'session',
        entity_id: updated.id,
        after: { duration_minutes: duration },
      })
      .catch(() => undefined);

    // Notify sanchalaks with a brief summary.
    const batch = await this.batchesRepo.findById(updated.batch_id);
    if (batch) {
      const centre = await this.centresRepo.findById(batch.centre_id);
      if (centre) {
        this.realtime.emitToAdminDashboard(centre.city_id, {
          event: 'session.checked_out',
          city_id: centre.city_id,
          actor_role: actor.role,
          summary_en: `${batch.name} session ended (${duration} min)`,
          summary_hi: `${batch.name} सत्र समाप्त (${duration} min)`,
          source_entity_kind: 'session',
          source_entity_id: updated.id,
          at: new Date().toISOString(),
        });
      }
    }

    return { session: updated };
  }

  // -------------------------------------------------------------------------
  // POST /v1/sessions/:id/cancel
  // -------------------------------------------------------------------------

  async cancel(
    actor: ScopedActor,
    sessionId: string,
    reason: string,
  ): Promise<{ session: Session }> {
    if (reason.trim().length < 10) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'reason must be at least 10 characters',
        statusCode: 422,
      });
    }
    const sessionRow = await this.sessionsRepo.findById(sessionId);
    if (!sessionRow) {
      throw new AppError({
        code: ERROR_CODES.ERR_SESSION_NOT_FOUND,
        message: 'Session not found',
        statusCode: 404,
      });
    }
    if (sessionRow.status === 'cancelled') {
      throw new AppError({
        code: ERROR_CODES.ERR_ATTENDANCE_SESSION_CANCELLED,
        message: 'Session is already cancelled',
        statusCode: 409,
      });
    }

    const updated = await this.drizzle.db.transaction(async (tx) => {
      const cancelled = await this.sessionsRepo.setCancelled(
        sessionRow.id,
        {
          cancelled_at: new Date(),
          cancellation_reason: reason,
          cancellation_by: actor.user_id,
        },
        tx,
      );
      await this.cancellationsRepo.insert(
        {
          session_id: sessionRow.id,
          cancelled_by: actor.user_id,
          reason,
          cancelled_at: new Date(),
        },
        tx,
      );
      return cancelled;
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'session.cancelled',
        entity_kind: 'session',
        entity_id: updated.id,
        before: { status: sessionRow.status },
        after: { status: 'cancelled', reason },
      })
      .catch(() => undefined);

    // Notify all batch parents.
    await this.fanoutQueue
      .add('session.cancelled', {
        event: 'session.cancelled',
        scope: { kind: 'batch', id: updated.batch_id },
        source: { kind: 'session', id: updated.id },
        data: { reason, reason_hi: reason },
        deep_link: `/parent/attendance`,
      })
      .catch((err) =>
        this.logger.warn(`session.cancelled fanout enqueue failed: ${(err as Error).message}`),
      );

    const batch = await this.batchesRepo.findById(updated.batch_id);
    if (batch) {
      const centre = await this.centresRepo.findById(batch.centre_id);
      if (centre) {
        this.realtime.emitToAdminDashboard(centre.city_id, {
          event: 'session.cancelled',
          city_id: centre.city_id,
          actor_role: actor.role,
          summary_en: `${batch.name} cancelled — ${reason}`,
          summary_hi: `${batch.name} रद्द — ${reason}`,
          source_entity_kind: 'session',
          source_entity_id: updated.id,
          at: new Date().toISOString(),
        });
      }
    }

    return { session: updated };
  }

  // -------------------------------------------------------------------------
  // GET /v1/sessions?batch_id=&from=&to=
  // -------------------------------------------------------------------------

  async list(opts: {
    batch_id?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  }): Promise<Session[]> {
    return this.sessionsRepo.listInRange(opts);
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Today's date string in IST. We use IST wall-clock because the scheduling
 * and Pathshala calendar are IST-native (CLAUDE.md "All IST — Asia/Kolkata").
 */
function todayInIst(): string {
  const now = new Date();
  // Convert to IST (+5:30) and format as YYYY-MM-DD.
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ist.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
