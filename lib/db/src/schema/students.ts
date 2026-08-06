import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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

export const students = pgTable(
  "students",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    parent_id: uuid("parent_id").references(() => users.id, { onDelete: "set null" }),
    /** City-scoped permanent ID — e.g. MUM-STU-00042 (does not change on Pathshala move). */
    student_code: varchar("student_code", { length: 32 }).notNull(),
    full_name: text("full_name").notNull(),
    gender: genderEnum("gender"),
    dob: date("dob"),
    age_group: ageGroupEnum("age_group").notNull(),
    /** ABO blood group for ID cards (e.g. A+, O−). */
    blood_group: varchar("blood_group", { length: 8 }),
    /** Relationship of parent_id to the student: father | mother | guardian. */
    guardian_relation: varchar("guardian_relation", { length: 20 }),
    /** Owner-uploaded headshot used on the digital ID card (signed /uploads URL). */
    photo_url: text("photo_url"),
    centre_id: uuid("centre_id").references(() => centres.id, { onDelete: "set null" }),
    batch_id: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
    msv_status: msvStatusEnum("msv_status").notNull().default("none"),
    /** Global MSV membership number (MSV00001) — set on first MSV approval; permanent. */
    msv_code: varchar("msv_code", { length: 16 }),
    status: studentStatusEnum("status").notNull().default("active"),
    /** Set when status → inactive; AT5 excludes sessions on/after this Kolkata date. */
    deactivated_at: timestamp("deactivated_at", { withTimezone: true }),
    /** Consecutive attended sessions streak (AT22); excused skips, absent resets. */
    attendance_streak: integer("attendance_streak").notNull().default(0),
    attendance_streak_updated_at: timestamp("attendance_streak_updated_at", { withTimezone: true }),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    student_code_uq: uniqueIndex("students_student_code_uq").on(t.student_code),
    msv_code_uq: uniqueIndex("students_msv_code_uq")
      .on(t.msv_code)
      .where(sql`${t.msv_code} is not null`),
    centre_idx: index("idx_students_centre").on(t.centre_id),
    user_idx: index("idx_students_user").on(t.user_id),
    parent_idx: index("idx_students_parent").on(t.parent_id),
    batch_idx: index("idx_students_batch").on(t.batch_id),
    // Keyset list order for GET /v1/admin/students (full_name, id).
    name_id_alive_idx: index("idx_students_name_id_alive")
      .on(t.full_name, t.id)
      .where(sql`${t.deleted_at} IS NULL`),
    // Expression index — EXTRACT(MONTH/DAY FROM dob). Declared in SQL migration
    // with the exact expressions; kept here so schema documents the intent.
    birthday_idx: index("idx_students_birthday")
      .using(
        "btree",
        sql`(EXTRACT(MONTH FROM ${t.dob}))`,
        sql`(EXTRACT(DAY FROM ${t.dob}))`,
      )
      .where(sql`${t.status} = 'active' AND ${t.deleted_at} IS NULL`),
  }),
);

export const enrolments = pgTable(
  "enrolments",
  {
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
  },
  (t) => ({
    student_idx: index("idx_enrolments_student").on(t.student_id),
    batch_idx: index("idx_enrolments_batch").on(t.requested_batch_id),
    centre_idx: index("idx_enrolments_centre").on(t.requested_centre_id),
    // One live enrolment per (student, batch): blocks duplicate requests while a
    // prior one is still pending/waitlisted/approved. Rejected enrolments are
    // terminal "no" decisions and are excluded so a student may re-apply later.
    // Defense-in-depth for the create race — the create path also re-checks.
    active_student_batch_uq: uniqueIndex("enrolments_student_batch_active_uq")
      .on(t.student_id, t.requested_batch_id)
      .where(sql`status <> 'rejected'`),
  }),
);

export const msv_enrolments = pgTable(
  "msv_enrolments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    status: msvStatusEnum("status").notNull().default("applied"),
    reason: text("reason"),
    decided_by: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    student_idx: index("idx_msv_enrolments_student").on(t.student_id),
  }),
);

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

/** Pastoral / system notes on a student (AT27 alerts use note_type='alert'). */
export const student_notes = pgTable(
  "student_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    author_user_id: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    note_type: text("note_type").notNull().default("general"),
    body_en: text("body_en").notNull(),
    body_hi: text("body_hi"),
    metadata: jsonb("metadata").notNull().default({}),
    ...timestamps(),
  },
  (t) => ({
    student_idx: index("idx_student_notes_student").on(t.student_id),
    type_idx: index("idx_student_notes_type").on(t.note_type),
  }),
);

export const consecutive_absence_alerts = pgTable(
  "consecutive_absence_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    end_session_id: uuid("end_session_id").notNull(),
    alerted_at: timestamp("alerted_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => ({
    student_end_uq: uniqueIndex("consecutive_absence_alerts_student_end_uq").on(
      t.student_id,
      t.end_session_id,
    ),
  }),
);

export type Student = typeof students.$inferSelect;
export type NewStudent = typeof students.$inferInsert;
export type Enrolment = typeof enrolments.$inferSelect;
export type NewEnrolment = typeof enrolments.$inferInsert;
export type StudentNote = typeof student_notes.$inferSelect;
