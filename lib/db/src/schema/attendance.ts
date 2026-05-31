import { date, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { attendanceStatusEnum, sessionStatusEnum } from "./enums";
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
  conducted_by: uuid("conducted_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps(),
});

export const attendance = pgTable("attendance", {
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
  ...timestamps(),
});

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
