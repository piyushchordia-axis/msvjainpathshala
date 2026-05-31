import { boolean, date, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
import {
  ageGroupEnum,
  enrolmentStatusEnum,
  genderEnum,
  msvStatusEnum,
  studentStatusEnum,
} from "./enums";
import { batches, centres } from "./centres";
import { users } from "./identity";

export const students = pgTable("students", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  parent_id: uuid("parent_id").references(() => users.id, { onDelete: "set null" }),
  student_code: varchar("student_code", { length: 20 }).notNull(),
  full_name: text("full_name").notNull(),
  gender: genderEnum("gender"),
  dob: date("dob"),
  age_group: ageGroupEnum("age_group").notNull(),
  centre_id: uuid("centre_id").references(() => centres.id, { onDelete: "set null" }),
  batch_id: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
  msv_status: msvStatusEnum("msv_status").notNull().default("none"),
  status: studentStatusEnum("status").notNull().default("active"),
  ...softDelete(),
  ...timestamps(),
});

export const enrolments = pgTable("enrolments", {
  id: uuid("id").primaryKey().defaultRandom(),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  requested_centre_id: uuid("requested_centre_id")
    .notNull()
    .references(() => centres.id, { onDelete: "cascade" }),
  requested_batch_id: uuid("requested_batch_id")
    .notNull()
    .references(() => batches.id, { onDelete: "cascade" }),
  status: enrolmentStatusEnum("status").notNull().default("pending"),
  reason: text("reason"),
  decided_by: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decided_at: timestamp("decided_at", { withTimezone: true }),
  ...timestamps(),
});

export const msv_enrolments = pgTable("msv_enrolments", {
  id: uuid("id").primaryKey().defaultRandom(),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  status: msvStatusEnum("status").notNull().default("applied"),
  reason: text("reason"),
  decided_by: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decided_at: timestamp("decided_at", { withTimezone: true }),
  ...timestamps(),
});

export const digital_id_cards = pgTable("digital_id_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  student_id: uuid("student_id")
    .notNull()
    .references(() => students.id, { onDelete: "cascade" }),
  qr_token: text("qr_token").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  ...timestamps(),
});

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type Enrolment = typeof enrolments.$inferSelect;
export type NewEnrolment = typeof enrolments.$inferInsert;
