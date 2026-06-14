import { boolean, date, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

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

export const digital_id_cards = pgTable(
  "digital_id_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    qr_token: text("qr_token").notNull(),
    // Human-readable card number, signed QR payload, and rendered artefacts.
    card_number: text("card_number"),
    qr_payload: text("qr_payload"),
    qr_signature: text("qr_signature"),
    png_url: text("png_url"),
    svg_payload: text("svg_payload"),
    msv_badge: boolean("msv_badge").notNull().default(false),
    version_no: integer("version_no").notNull().default(1),
    generated_at: timestamp("generated_at", { withTimezone: true }),
    last_regenerated_at: timestamp("last_regenerated_at", { withTimezone: true }),
    is_active: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => ({
    student_unique: uniqueIndex("digital_id_cards_student_unique").on(t.student_id),
  }),
);

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type Enrolment = typeof enrolments.$inferSelect;
export type NewEnrolment = typeof enrolments.$inferInsert;
