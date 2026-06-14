import { boolean, date, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { shivirAttendanceModeEnum, shivirScanKindEnum } from "./enums";
import { cities, states } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const shivir_events = pgTable("shivir_events", {
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
});

export const shivir_registrations = pgTable("shivir_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  shivir_id: uuid("shivir_id")
    .notNull()
    .references(() => shivir_events.id, { onDelete: "cascade" }),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  ...timestamps(),
});

export const shivir_volunteers = pgTable("shivir_volunteers", {
  id: uuid("id").primaryKey().defaultRandom(),
  shivir_id: uuid("shivir_id")
    .notNull()
    .references(() => shivir_events.id, { onDelete: "cascade" }),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role_label: text("role_label"),
  ...timestamps(),
});

// A timed session within a shivir (volunteers scan attendance against it).
export const shivir_sessions = pgTable("shivir_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  shivir_id: uuid("shivir_id")
    .notNull()
    .references(() => shivir_events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  session_date: date("session_date").notNull(),
  attendance_mode: shivirAttendanceModeEnum("attendance_mode").notNull().default("present_only"),
  ...timestamps(),
});

// One QR scan event (check_in / check_out / present) by a volunteer.
export const shivir_attendance_scans = pgTable("shivir_attendance_scans", {
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
});

export type ShivirEvent = typeof shivir_events.$inferSelect;
export type NewShivirEvent = typeof shivir_events.$inferInsert;
export type ShivirSession = typeof shivir_sessions.$inferSelect;
export type ShivirAttendanceScan = typeof shivir_attendance_scans.$inferSelect;
