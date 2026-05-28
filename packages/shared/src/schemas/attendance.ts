/** Attendance + session DTOs (SPEC §5.6, §6.8, §8.2, §8.3). */

import { z } from 'zod';

import { ATTENDANCE_STATUSES, SESSION_STATUSES } from '../enums/attendance-status.js';

import { idempotencyKey, isoDatetime, latitude, longitude, uuid } from './common.js';

export const sessionSchema = z.object({
  id: uuid,
  batch_id: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(SESSION_STATUSES),
  started_at: isoDatetime.nullable(),
  ended_at: isoDatetime.nullable(),
  cancelled_reason: z.string().nullable(),
});
export type SessionDto = z.infer<typeof sessionSchema>;

export const startSessionSchema = z.object({
  batch_id: uuid,
  /** Optional override of the scheduled date for makeup sessions. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type StartSessionDto = z.infer<typeof startSessionSchema>;

export const cancelSessionSchema = z.object({
  session_id: uuid,
  reason: z.string().min(1).max(500),
});
export type CancelSessionDto = z.infer<typeof cancelSessionSchema>;

// ---------------------------------------------------------------------------
// Mark attendance — single + bulk
// ---------------------------------------------------------------------------

export const markAttendanceSchema = z.object({
  session_id: uuid,
  student_id: uuid,
  status: z.enum(ATTENDANCE_STATUSES),
  /** Client-generated for offline-safe replay (SPEC §8.10). */
  client_op_id: idempotencyKey,
  client_timestamp: isoDatetime,
  /** GPS proof captured at mark time (SPEC §8.2). */
  gps: z
    .object({
      lat: latitude,
      lon: longitude,
      accuracy_m: z.number().nonnegative().optional(),
    })
    .optional(),
});
export type MarkAttendanceDto = z.infer<typeof markAttendanceSchema>;

export const markAttendanceBulkSchema = z.object({
  session_id: uuid,
  marks: z
    .array(
      z.object({
        student_id: uuid,
        status: z.enum(ATTENDANCE_STATUSES),
        client_op_id: idempotencyKey,
      }),
    )
    .min(1)
    .max(200),
  client_timestamp: isoDatetime,
});
export type MarkAttendanceBulkDto = z.infer<typeof markAttendanceBulkSchema>;

export const attendanceRecordSchema = z.object({
  id: uuid,
  session_id: uuid,
  student_id: uuid,
  status: z.enum(ATTENDANCE_STATUSES),
  marked_by_user_id: uuid,
  marked_at: isoDatetime,
});
export type AttendanceRecordDto = z.infer<typeof attendanceRecordSchema>;
