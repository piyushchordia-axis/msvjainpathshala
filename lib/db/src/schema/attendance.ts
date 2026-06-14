import { boolean, date, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { attendanceStatusEnum, attendanceMethodEnum, sessionStatusEnum } from "./enums";
import { batches } from "./centres";
import { students } from "./students";
import { users } from "./identity";

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  batch_id: uuid("batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" }),
  session_date: date("session_date").notNull(),
  status: sessionStatusEnum("status").notNull().default("scheduled"),
  topic: text("topic"),
  // When true, attendance marking requires the marker to be within the centre geofence.
  gps_required: boolean("gps_required").notNull().default(false),
  conducted_by: uuid("conducted_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

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
    marked_by: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    marked_at: timestamp("marked_at", { withTimezone: true }).notNull().defaultNow(),
    // How the row was recorded + (for gps) the marker's captured position.
    marked_method: attendanceMethodEnum("marked_method").notNull().default("manual"),
    marked_lat: numeric("marked_lat", { precision: 10, scale: 7 }),
    marked_lng: numeric("marked_lng", { precision: 10, scale: 7 }),
    marked_distance_m: integer("marked_distance_m"),
    ...timestamps(),
  },
  (t) => ({
    session_student_unique: uniqueIndex("attendance_session_student_unique").on(t.session_id, t.student_id),
  }),
);

export const session_cancellations = pgTable("session_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  session_id: uuid("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  reason: text("reason"),
  cancelled_by: uuid("cancelled_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;
