import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import {
  attendanceStatusEnum,
  attendanceMethodEnum,
  sessionStatusEnum,
  syncOpStatusEnum,
} from "./enums";
import { batches } from "./centres";
import { students } from "./students";
import { users } from "./identity";

/** Crockford Base32 ULID (26 chars). Not uuid — see CLAUDE.md Offline sync / AT19. */
const ULID_RE = "^[0-9A-HJKMNP-TV-Z]{26}$";

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batch_id: uuid("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    /** Calendar date of the class (AT7 unique with batch_id). Formerly session_date. */
    scheduled_date: date("scheduled_date").notNull(),
    scheduled_start_time: time("scheduled_start_time"),
    scheduled_end_time: time("scheduled_end_time"),
    status: sessionStatusEnum("status").notNull().default("scheduled"),
    topic: text("topic"),
    // When true, attendance marking requires the marker to be within the centre geofence.
    gps_required: boolean("gps_required").notNull().default(false),
    gps_flagged: boolean("gps_flagged").notNull().default(false),
    gps_unverified: boolean("gps_unverified").notNull().default(false),
    unscheduled: boolean("unscheduled").notNull().default(false),
    auto_checked_out: boolean("auto_checked_out").notNull().default(false),
    no_show_flagged_at: timestamp("no_show_flagged_at", { withTimezone: true }),
    shikshak_user_id: uuid("shikshak_user_id").references(() => users.id, { onDelete: "set null" }),
    check_in_at: timestamp("check_in_at", { withTimezone: true }),
    check_in_lat: numeric("check_in_lat", { precision: 10, scale: 7 }),
    check_in_lng: numeric("check_in_lng", { precision: 10, scale: 7 }),
    check_in_distance_m: integer("check_in_distance_m"),
    check_in_accuracy_m: integer("check_in_accuracy_m"),
    check_out_at: timestamp("check_out_at", { withTimezone: true }),
    check_out_lat: numeric("check_out_lat", { precision: 10, scale: 7 }),
    check_out_lng: numeric("check_out_lng", { precision: 10, scale: 7 }),
    check_out_distance_m: integer("check_out_distance_m"),
    check_out_accuracy_m: integer("check_out_accuracy_m"),
    /** Check-in→check-out haversine (informational only; not a compliance signal). */
    gps_haversine_m: integer("gps_haversine_m"),
    duration_minutes: integer("duration_minutes"),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
    cancellation_reason: text("cancellation_reason"),
    cancellation_by: uuid("cancellation_by").references(() => users.id, { onDelete: "set null" }),
    /** Check-in idempotency (AT16) — ULID char(26). */
    submission_op_id: char("submission_op_id", { length: 26 }),
    conducted_by: uuid("conducted_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    batch_idx: index("idx_sessions_batch").on(t.batch_id),
    batch_scheduled_unique: uniqueIndex("sessions_batch_id_scheduled_date_unique").on(
      t.batch_id,
      t.scheduled_date,
    ),
    shikshak_date_idx: index("idx_sessions_shikshak_date").on(t.shikshak_user_id, t.scheduled_date),
    date_status_idx: index("idx_sessions_date_status").on(t.scheduled_date, t.status),
    submission_op_ulid_check: check(
      "sessions_submission_op_id_ulid_check",
      sql`${t.submission_op_id} is null or ${t.submission_op_id} ~ ${sql.raw(`'${ULID_RE}'`)}`,
    ),
  }),
);

export const attendance = pgTable(
  "attendance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    session_id: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    status: attendanceStatusEnum("status").notNull().default("present"),
    /** Bumped on award-worthiness / value changes (AT17). */
    revision: integer("revision").notNull().default(1),
    /** Denormalised from sessions.scheduled_date for consecutive-absence index (AT). */
    session_date: date("session_date").notNull(),
    notes: text("notes"),
    marked_by: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    marked_at: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    marked_method: attendanceMethodEnum("marked_method").notNull().default("manual"),
    marked_lat: numeric("marked_lat", { precision: 10, scale: 7 }),
    marked_lng: numeric("marked_lng", { precision: 10, scale: 7 }),
    marked_distance_m: integer("marked_distance_m"),
    /** Per-item offline repair id (AT19) — ULID char(26), not uuid. */
    client_op_id: char("client_op_id", { length: 26 }),
    ...timestamps(),
  },
  (t) => ({
    session_student_unique: uniqueIndex("attendance_session_student_unique").on(
      t.session_id,
      t.student_id,
    ),
    client_op_unique: uniqueIndex("attendance_client_op_id_unique")
      .on(t.client_op_id)
      .where(sql`${t.client_op_id} is not null`),
    student_idx: index("idx_attendance_student").on(t.student_id),
    session_idx: index("idx_attendance_session").on(t.session_id),
    absent_by_date_idx: index("idx_attendance_student_absent_by_date")
      .on(t.student_id, t.session_date)
      .where(sql`${t.status} = 'absent'`),
    client_op_ulid_check: check(
      "attendance_client_op_id_ulid_check",
      sql`${t.client_op_id} is null or ${t.client_op_id} ~ ${sql.raw(`'${ULID_RE}'`)}`,
    ),
  }),
);

export const absence_notifications = pgTable(
  "absence_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    parent_user_id: uuid("parent_user_id").references(() => users.id, { onDelete: "set null" }),
    start_date: date("start_date").notNull(),
    end_date: date("end_date").notNull(),
    reason: text("reason"),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    student_range_unique: uniqueIndex("absence_notifications_student_range_unique").on(
      t.student_id,
      t.start_date,
      t.end_date,
    ),
    student_idx: index("idx_absence_notifications_student").on(t.student_id),
    range_check: check(
      "absence_notifications_end_gte_start",
      sql`${t.end_date} >= ${t.start_date}`,
    ),
  }),
);

/** Offline batch replay ledger (AT19 / Offline sync canonical model). */
export const sync_operations = pgTable(
  "sync_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submission_op_id: char("submission_op_id", { length: 26 }).notNull(),
    op_kind: text("op_kind").notNull(),
    request_payload: jsonb("request_payload").notNull().default({}),
    response_payload: jsonb("response_payload"),
    status: syncOpStatusEnum("status").notNull().default("success"),
    error: text("error"),
    applied_at: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => ({
    user_submission_unique: uniqueIndex("sync_operations_user_submission_unique").on(
      t.user_id,
      t.submission_op_id,
    ),
    submission_ulid_check: check(
      "sync_operations_submission_op_id_ulid_check",
      sql`${t.submission_op_id} ~ ${sql.raw(`'${ULID_RE}'`)}`,
    ),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
export type AbsenceNotification = typeof absence_notifications.$inferSelect;
export type SyncOperation = typeof sync_operations.$inferSelect;
