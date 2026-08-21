import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { softDelete, timestamps } from "./_helpers";
import { ULID_RE } from "./attendance";
import { ageGroupEnum, courseStatusEnum, curriculumLevelEnum } from "./enums";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

/**
 * Super_admin masters (CU7). Deriving a course snapshots sections/subsections;
 * later template edits never touch derived courses.
 */
export const course_templates = pgTable(
  "course_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name_en: text("name_en").notNull(),
    /** Nullable until authored — no English→Devanagari backfill (CU5). */
    name_hi: text("name_hi"),
    kind: text("kind").notNull().default("standard"),
    /** Authoring metadata only — never copied onto derived courses (CU3/CU7). */
    age_group: ageGroupEnum("age_group"),
    created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    kind_idx: index("idx_course_templates_kind").on(t.kind),
  }),
);

export const course_template_sections = pgTable(
  "course_template_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    template_id: uuid("template_id")
      .notNull()
      .references(() => course_templates.id, { onDelete: "restrict" }),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi").notNull(),
    order_index: integer("order_index").notNull().default(0),
    /** Authored points; CU22 bounds 0–1000. */
    punya_points: integer("punya_points").notNull().default(0),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    template_idx: index("idx_course_template_sections_template").on(t.template_id),
    punya_points_check: check(
      "course_template_sections_punya_points_check",
      sql`${t.punya_points} >= 0 AND ${t.punya_points} <= 1000`,
    ),
  }),
);

export const course_template_subsections = pgTable(
  "course_template_subsections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    section_id: uuid("section_id")
      .notNull()
      .references(() => course_template_sections.id, { onDelete: "restrict" }),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi").notNull(),
    description_en: text("description_en"),
    description_hi: text("description_hi"),
    order_index: integer("order_index").notNull().default(0),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    section_idx: index("idx_course_template_subsections_section").on(t.section_id),
  }),
);

/** CU1 rename of curricula. Never assigned to a batch/centre (CU2). */
export const courses = pgTable(
  "courses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
    name_en: text("name_en").notNull(),
    /** Nullable until authored — publish gate requires it (CU4/CU5). */
    name_hi: text("name_hi"),
    kind: text("kind").notNull().default("standard"),
    academic_year: text("academic_year"),
    status: courseStatusEnum("status").notNull().default("draft"),
    /** Provenance only — snapshot independence (CU7). */
    template_id: uuid("template_id").references(() => course_templates.id, {
      onDelete: "set null",
    }),
    /** Course-completion milestone award base (CU21/CU22); 0 = certificate only. */
    punya_points: integer("punya_points").notNull().default(0),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_courses_city").on(t.city_id),
    status_idx: index("idx_courses_status").on(t.status),
    punya_points_check: check(
      "courses_punya_points_check",
      sql`${t.punya_points} >= 0 AND ${t.punya_points} <= 2000`,
    ),
  }),
);

export const course_sections = pgTable(
  "course_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi").notNull(),
    order_index: integer("order_index").notNull().default(0),
    /** Authored section-certification award base (CU21/CU22). */
    punya_points: integer("punya_points").notNull().default(0),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    course_idx: index("idx_course_sections_course").on(t.course_id),
    punya_points_check: check(
      "course_sections_punya_points_check",
      sql`${t.punya_points} >= 0 AND ${t.punya_points} <= 1000`,
    ),
  }),
);

export const course_subsections = pgTable(
  "course_subsections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    section_id: uuid("section_id")
      .notNull()
      .references(() => course_sections.id, { onDelete: "restrict" }),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi").notNull(),
    description_en: text("description_en"),
    description_hi: text("description_hi"),
    order_index: integer("order_index").notNull().default(0),
    ...softDelete(),
    ...timestamps(),
  },
  (t) => ({
    section_idx: index("idx_course_subsections_section").on(t.section_id),
  }),
);

/**
 * One progress row per (student, node) — section XOR subsection (CU9).
 * Certification is orthogonal to status (CU17).
 */
export const student_course_progress = pgTable(
  "student_course_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    section_id: uuid("section_id").references(() => course_sections.id, { onDelete: "restrict" }),
    subsection_id: uuid("subsection_id").references(() => course_subsections.id, {
      onDelete: "restrict",
    }),
    status: curriculumLevelEnum("status").notNull().default("not_started"),
    note: text("note"),
    started_at: timestamp("started_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    certified_at: timestamp("certified_at", { withTimezone: true }),
    certified_by: uuid("certified_by").references(() => users.id, { onDelete: "restrict" }),
    certification_note: text("certification_note"),
    revision: integer("revision").notNull().default(0),
    updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updated_by_role: text("updated_by_role").notNull(),
    client_op_id: char("client_op_id", { length: 26 }),
    /** Client clock — CU31 conflict compares this, never server receipt (AT26 pattern). */
    client_marked_at: timestamp("client_marked_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    one_node: check(
      "student_course_progress_one_node",
      sql`num_nonnulls(${t.section_id}, ${t.subsection_id}) = 1`,
    ),
    certified_pair: check(
      "student_course_progress_certified_pair",
      sql`num_nonnulls(${t.certified_at}, ${t.certified_by}) IN (0, 2)`,
    ),
    certified_requires_completed: check(
      "student_course_progress_certified_requires_completed",
      sql`${t.certified_at} IS NULL OR ${t.status} = 'completed'`,
    ),
    client_op_id_format: check(
      "student_course_progress_client_op_id_format",
      sql`${t.client_op_id} IS NULL OR ${t.client_op_id} ~ ${sql.raw(`'${ULID_RE}'`)}`,
    ),
    // Partial uniques — Postgres treats NULLs as distinct, so a single composite
    // unique on (student, subsection) would not constrain section rows (CU9).
    subsection_unique: uniqueIndex("student_course_progress_subsection_unique")
      .on(t.student_id, t.subsection_id)
      .where(sql`${t.subsection_id} IS NOT NULL`),
    section_unique: uniqueIndex("student_course_progress_section_unique")
      .on(t.student_id, t.section_id)
      .where(sql`${t.section_id} IS NOT NULL`),
    client_op_id_unique: uniqueIndex("student_course_progress_client_op_id_unique")
      .on(t.client_op_id)
      .where(sql`${t.client_op_id} IS NOT NULL`),
    student_idx: index("idx_student_course_progress_student").on(t.student_id),
    subsection_idx: index("idx_student_course_progress_subsection").on(t.subsection_id),
    section_idx: index("idx_student_course_progress_section").on(t.section_id),
  }),
);

/** CU24 — section or course certificates; voided rows retained for CU27 verify. */
export const course_certificates = pgTable(
  "course_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    course_id: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "restrict" }),
    section_id: uuid("section_id").references(() => course_sections.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    verification_code: char("verification_code", { length: 12 }).notNull(),
    scope_snapshot: jsonb("scope_snapshot").$type<Record<string, unknown>>().notNull(),
    issued_at: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    voided_at: timestamp("voided_at", { withTimezone: true }),
    voided_by: uuid("voided_by").references(() => users.id, { onDelete: "restrict" }),
    storage_key: text("storage_key"),
    ...timestamps(),
  },
  (t) => ({
    kind_section_pair: check(
      "course_certificates_kind_section_pair",
      sql`(${t.kind} = 'section' AND ${t.section_id} IS NOT NULL) OR (${t.kind} = 'course' AND ${t.section_id} IS NULL)`,
    ),
    kind_values: check(
      "course_certificates_kind_check",
      sql`${t.kind} IN ('section', 'course')`,
    ),
    section_unique: uniqueIndex("course_certificates_section_unique")
      .on(t.student_id, t.section_id)
      .where(sql`${t.section_id} IS NOT NULL`),
    course_unique: uniqueIndex("course_certificates_course_unique")
      .on(t.student_id, t.course_id)
      .where(sql`${t.section_id} IS NULL`),
    code_unique: uniqueIndex("course_certificates_code_unique").on(t.verification_code),
  }),
);

// Generated per-period progress report (PDF export + parent release).
export const progress_reports = pgTable(
  "progress_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // L15 / Q11 — never CASCADE on a student: students are deactivated, never
    // hard-deleted, so a cascading delete here assumes a delete that must
    // never happen (migration 0100/0101).
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    period_kind: text("period_kind").notNull(), // 'monthly' | 'termly'
    period_label: text("period_label").notNull(), // e.g. '2026-06', 'term-1'
    generated_at: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    pdf_url: text("pdf_url"),
    shikshak_comment: text("shikshak_comment"),
    released_to_parent: boolean("released_to_parent").notNull().default(false),
    released_at: timestamp("released_at", { withTimezone: true }),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    ...timestamps(),
  },
  (t) => ({
    student_period_unique: uniqueIndex("progress_reports_student_period_unique").on(
      t.student_id,
      t.period_kind,
      t.period_label,
    ),
    student_idx: index("idx_progress_reports_student").on(t.student_id),
  }),
);
