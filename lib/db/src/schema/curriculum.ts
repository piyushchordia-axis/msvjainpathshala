import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_helpers";
import { curriculumLevelEnum } from "./enums";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const curricula = pgTable("curricula", {
  id: uuid("id").primaryKey().defaultRandom(),
  city_id: uuid("city_id").references(() => cities.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("standard"),
  academic_year: text("academic_year"),
  status: text("status").notNull().default("active"),
  ...timestamps(),
});

export const curriculum_sections = pgTable("curriculum_sections", {
  id: uuid("id").primaryKey().defaultRandom(),
  curriculum_id: uuid("curriculum_id")
    .notNull()
    .references(() => curricula.id, { onDelete: "cascade" }),
  title_en: text("title_en").notNull(),
  title_hi: text("title_hi").notNull(),
  order_index: integer("order_index").notNull().default(0),
  ...timestamps(),
});

export const curriculum_items = pgTable("curriculum_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  section_id: uuid("section_id")
    .notNull()
    .references(() => curriculum_sections.id, { onDelete: "cascade" }),
  title_en: text("title_en").notNull(),
  title_hi: text("title_hi").notNull(),
  description_en: text("description_en"),
  description_hi: text("description_hi"),
  order_index: integer("order_index").notNull().default(0),
  ...timestamps(),
});

// Per-student mastery of a curriculum item (set by shikshak).
export const student_curriculum_progress = pgTable(
  "student_curriculum_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    curriculum_item_id: uuid("curriculum_item_id")
      .notNull()
      .references(() => curriculum_items.id, { onDelete: "cascade" }),
    level: curriculumLevelEnum("level").notNull().default("not_started"),
    note: text("note"),
    updated_by: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    student_item_unique: uniqueIndex("student_curriculum_progress_student_item_unique").on(
      t.student_id,
      t.curriculum_item_id,
    ),
  }),
);

// Generated per-period progress report (PDF export + parent release).
export const progress_reports = pgTable(
  "progress_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
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
  }),
);
