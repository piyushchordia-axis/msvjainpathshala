/**
 * Sessions + attendance + absence notifications + session cancellations
 * (SPEC §5.6).
 *
 * `attendance.client_op_id` is the offline-sync idempotency key
 * (CLAUDE.md "Offline sync rules"). UNIQUE so a duplicate POST from a
 * patchy connection is a no-op.
 */

import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { batches } from './centres';
import { attendanceStatusEnum, sessionStatusEnum } from './enums';
import { users } from './identity';
import { students } from './students';

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_id: uuid('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  scheduled_date: date('scheduled_date').notNull(),
  scheduled_start_time: time('scheduled_start_time').notNull(),
  scheduled_end_time: time('scheduled_end_time').notNull(),
  status: sessionStatusEnum('status').notNull().default('scheduled'),
  shikshak_user_id: uuid('shikshak_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  check_in_at: timestamp('check_in_at', { withTimezone: true }),
  check_in_lat: numeric('check_in_lat', { precision: 10, scale: 7 }),
  check_in_lng: numeric('check_in_lng', { precision: 10, scale: 7 }),
  check_in_distance_m: integer('check_in_distance_m'),
  check_out_at: timestamp('check_out_at', { withTimezone: true }),
  check_out_lat: numeric('check_out_lat', { precision: 10, scale: 7 }),
  check_out_lng: numeric('check_out_lng', { precision: 10, scale: 7 }),
  duration_minutes: integer('duration_minutes'),
  gps_haversine_m: integer('gps_haversine_m'),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }),
  cancellation_reason: text('cancellation_reason'),
  cancellation_by: uuid('cancellation_by').references(() => users.id, {
    onDelete: 'set null',
  }),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// attendance
// ---------------------------------------------------------------------------

export const attendance = pgTable(
  'attendance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    session_id: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    status: attendanceStatusEnum('status').notNull(),
    marked_at: timestamp('marked_at', { withTimezone: true }).notNull(),
    marked_by: uuid('marked_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** ULID/UUID — sortable client-side; backend treats as opaque string.
     *  See migration 0009 for the text widening from the original uuid. */
    client_op_id: text('client_op_id'),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => ({
    uniqueSessionStudent: uniqueIndex('attendance_session_student_unique').on(
      t.session_id,
      t.student_id,
    ),
    uniqueClientOp: uniqueIndex('attendance_client_op_unique').on(t.client_op_id),
  }),
);

// ---------------------------------------------------------------------------
// absence_notifications
// ---------------------------------------------------------------------------

export const absence_notifications = pgTable('absence_notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  student_id: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'cascade' }),
  parent_user_id: uuid('parent_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expected_session_id: uuid('expected_session_id').references(() => sessions.id, {
    onDelete: 'set null',
  }),
  expected_date: date('expected_date').notNull(),
  reason: text('reason'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// session_cancellations  (audit trail — separate from sessions.cancelled_*)
// ---------------------------------------------------------------------------

export const session_cancellations = pgTable('session_cancellations', {
  id: uuid('id').primaryKey().defaultRandom(),
  session_id: uuid('session_id')
    .notNull()
    .references(() => sessions.id, { onDelete: 'cascade' }),
  cancelled_by: uuid('cancelled_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  cancelled_at: timestamp('cancelled_at', { withTimezone: true }).notNull(),
  ...timestamps(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type AbsenceNotification = typeof absence_notifications.$inferSelect;
export type NewAbsenceNotification = typeof absence_notifications.$inferInsert;
export type SessionCancellation = typeof session_cancellations.$inferSelect;
export type NewSessionCancellation = typeof session_cancellations.$inferInsert;
