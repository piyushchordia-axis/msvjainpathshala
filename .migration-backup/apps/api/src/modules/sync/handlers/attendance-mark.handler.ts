/**
 * `attendance.mark` sync handler — wraps `AttendanceService.mark()`.
 *
 * Wire payload mirrors the per-op subset of `POST /v1/attendance/mark`:
 *   {
 *     session_id: uuid,
 *     student_id: uuid,
 *     status: 'present' | 'absent' | 'late' | 'excused',
 *     notes?: string,
 *     marked_at: ISO datetime    // client-side timestamp (last-write-wins)
 *   }
 *
 * Each op carries exactly one mark. The handler synthesises a singleton
 * `MarkBody` and lets `AttendanceService.mark` do the rest — preserving its
 * Step-13 idempotency on `attendance.client_op_id` (set to the inbound
 * `ctx.client_op_id`). Same-session, same-student replays at the sync layer
 * AND at the attendance layer both no-op, so the system is safe under
 * arbitrary retries.
 *
 * Note: the underlying service rejects out-of-scope sessions, cancelled
 * sessions, and inactive students with `AppError` — those map to wire-level
 * `failed` results with the appropriate code. State-machine conflicts
 * (cancelled session) come through as `ERR_ATTENDANCE_SESSION_CANCELLED`
 * (409), which the dispatcher tags with `ERR_SYNC_CONFLICT` for the
 * mobile's conflict modal trigger.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ATTENDANCE_STATUSES, type AttendanceStatus, type Role, type SyncOpKind } from '@jp/shared';

import { AttendanceService } from '../../attendance/attendance.service';

import type { SyncOpContext, SyncOpHandler } from './op-handler';

const attendanceMarkPayloadSchema = z.object({
  session_id: z.string().uuid(),
  student_id: z.string().uuid(),
  status: z.enum(ATTENDANCE_STATUSES as readonly [AttendanceStatus, ...AttendanceStatus[]]),
  notes: z.string().max(500).optional(),
  /** Client-side wall clock at op-creation time. Recorded by AttendanceService
   *  as `marked_at`; last-write-wins for same (session, student) by way of
   *  AttendanceService.mark's UPSERT semantics. */
  marked_at: z.string().datetime(),
});
export type AttendanceMarkPayload = z.infer<typeof attendanceMarkPayloadSchema>;

@Injectable()
export class AttendanceMarkSyncHandler implements SyncOpHandler<AttendanceMarkPayload, unknown> {
  readonly op_kind: SyncOpKind = 'attendance.mark';
  readonly allowed_roles: readonly Role[] = [
    'shikshak',
    'sanchalak',
    'city_admin',
    'state_admin',
    'super_admin',
  ];
  readonly payload_schema = attendanceMarkPayloadSchema;

  constructor(private readonly attendance: AttendanceService) {}

  async handle(ctx: SyncOpContext, payload: AttendanceMarkPayload): Promise<unknown> {
    const result = await this.attendance.mark(ctx.actor, {
      session_id: payload.session_id,
      marks: [
        {
          student_id: payload.student_id,
          status: payload.status,
          client_op_id: ctx.client_op_id,
          ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        },
      ],
    });
    // Slim down — the per-op result envelope shouldn't pull in the entire
    // session row (the mobile gets that from /v1/sync/delta).
    const item = result.items[0];
    return {
      attendance_id: item?.attendance_id,
      student_id: item?.student_id,
      status: item?.status,
      prior_status: item?.prior_status ?? null,
      punya_awarded: item?.punya_awarded ?? 0,
      session_id: result.session.id,
    };
  }
}
