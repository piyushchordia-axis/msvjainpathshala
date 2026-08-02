import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { shivirAttendanceModeEnum, shivirScanKindEnum } from "./enums";
import { cities, states } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const shivir_events = pgTable(
  "shivir_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    state_id: uuid("state_id").references(() => states.id, { onDelete: "set null" }),
    city_id: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    start_date: date("start_date").notNull(),
    end_date: date("end_date").notNull(),
    location_text: text("location_text"),
    capacity: integer("capacity"),
    contact_info: text("contact_info"),
    attendance_mode: shivirAttendanceModeEnum("attendance_mode").notNull().default("present_only"),
    msv_only: boolean("msv_only").notNull().default(false),
    is_published: boolean("is_published").notNull().default(true),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_shivir_events_city").on(t.city_id),
    state_idx: index("idx_shivir_events_state").on(t.state_id),
  }),
);

export const shivir_registrations = pgTable(
  "shivir_registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shivir_id: uuid("shivir_id")
      .notNull()
      .references(() => shivir_events.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    ...timestamps(),
  },
  (t) => ({
    shivir_idx: index("idx_shivir_registrations_shivir").on(t.shivir_id),
    student_idx: index("idx_shivir_registrations_student").on(t.student_id),
  }),
);

export const shivir_volunteers = pgTable(
  "shivir_volunteers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shivir_id: uuid("shivir_id")
      .notNull()
      .references(() => shivir_events.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role_label: text("role_label"),
    ...timestamps(),
  },
  (t) => ({
    shivir_idx: index("idx_shivir_volunteers_shivir").on(t.shivir_id),
    user_idx: index("idx_shivir_volunteers_user").on(t.user_id),
  }),
);

// A timed session within a shivir (volunteers scan attendance against it).
export const shivir_sessions = pgTable(
  "shivir_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shivir_id: uuid("shivir_id")
      .notNull()
      .references(() => shivir_events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    session_date: date("session_date").notNull(),
    attendance_mode: shivirAttendanceModeEnum("attendance_mode").notNull().default("present_only"),
    ...timestamps(),
  },
  (t) => ({
    shivir_idx: index("idx_shivir_sessions_shivir").on(t.shivir_id),
  }),
);

// One QR scan event (check_in / check_out / present) by a volunteer.
/**
 * AT28 — Shivir scans are isolated from Pathshala attendance.
 * Do not join this table into attendance_percentage, streak recompute, or
 * automatic attendance Punya awards.
 */
export const shivir_attendance_scans = pgTable(
  "shivir_attendance_scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shivir_session_id: uuid("shivir_session_id")
      .notNull()
      .references(() => shivir_sessions.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    volunteer_user_id: uuid("volunteer_user_id").references(() => users.id, { onDelete: "set null" }),
    scan_kind: shivirScanKindEnum("scan_kind").notNull().default("present"),
    scanned_at: timestamp("scanned_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => ({
    session_idx: index("idx_shivir_attendance_scans_session").on(t.shivir_session_id),
    student_idx: index("idx_shivir_attendance_scans_student").on(t.student_id),
    // Idempotency: at most one scan per (session, student, kind). A re-scan of the
    // same kind is a no-op via onConflictDoNothing in the scan endpoint, so
    // duplicate scans can no longer inflate the live counts. The kind is part of
    // the key on purpose so an in_out session can still hold both a check_in and a
    // check_out row for the same student.
    session_student_kind_unique: uniqueIndex("shivir_attendance_scans_session_student_kind_unique").on(
      t.shivir_session_id,
      t.student_id,
      t.scan_kind,
    ),
  }),
);

export type ShivirEvent = typeof shivir_events.$inferSelect;
export type NewShivirEvent = typeof shivir_events.$inferInsert;
export type ShivirSession = typeof shivir_sessions.$inferSelect;
export type ShivirAttendanceScan = typeof shivir_attendance_scans.$inferSelect;
