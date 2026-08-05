import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { ageGroupEnum, quizScopeEnum } from "./enums";
import { batches, centres } from "./centres";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

/** A quiz option: { text_en, text_hi? }. correct_indices are 0-based into options. */
export interface QuizOption {
  text_en: string;
  text_hi?: string;
}

// --- Question bank -----------------------------------------------------------
export const questions = pgTable(
  "questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: quizScopeEnum("scope").notNull().default("national"),
    /** Multi-select targets for the chosen scope (empty when national). */
    state_ids: uuid("state_ids").array().notNull().default([]),
    city_ids: uuid("city_ids").array().notNull().default([]),
    centre_ids: uuid("centre_ids").array().notNull().default([]),
    batch_ids: uuid("batch_ids").array().notNull().default([]),
    /** Legacy single city FK kept for listing filters; prefer city_ids. */
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "set null" }),
    question_en: text("question_en").notNull(),
    question_hi: text("question_hi"),
    options: jsonb("options").$type<QuizOption[]>().notNull().default([]),
    correct_indices: integer("correct_indices").array().notNull().default([]),
    difficulty: text("difficulty").notNull().default("medium"),
    age_groups: ageGroupEnum("age_groups").array().notNull().default([]),
    topic: text("topic"),
    source: text("source").notNull().default("manual"),
    is_active: boolean("is_active").notNull().default(true),
    created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_questions_city").on(t.city_id),
  }),
);

// --- Scheduled quiz events ---------------------------------------------------
export const quiz_events = pgTable(
  "quiz_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: quizScopeEnum("scope").notNull().default("city"),
    state_ids: uuid("state_ids").array().notNull().default([]),
    city_ids: uuid("city_ids").array().notNull().default([]),
    centre_ids: uuid("centre_ids").array().notNull().default([]),
    batch_ids: uuid("batch_ids").array().notNull().default([]),
    /** Legacy single FKs (first of multi-select) for older filters. */
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "set null" }),
    centre_id: uuid("centre_id").references(() => centres.id, { onDelete: "set null" }),
    batch_id: uuid("batch_id").references(() => batches.id, { onDelete: "set null" }),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi"),
    start_at: timestamp("start_at", { withTimezone: true }).notNull(),
    end_at: timestamp("end_at", { withTimezone: true }).notNull(),
    // SPEC §5.14 / AT21 — null = use punya_features default; 0 disables.
    participation_points: integer("participation_points"),
    win_points: integer("win_points"),
    age_groups: ageGroupEnum("age_groups").array().notNull().default([]),
    created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_quiz_events_city").on(t.city_id),
    centre_idx: index("idx_quiz_events_centre").on(t.centre_id),
    batch_idx: index("idx_quiz_events_batch").on(t.batch_id),
  }),
);

export const quiz_event_questions = pgTable(
  "quiz_event_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quiz_event_id: uuid("quiz_event_id")
      .notNull()
      .references(() => quiz_events.id, { onDelete: "cascade" }),
    question_id: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    order_index: integer("order_index").notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    event_question_unique: uniqueIndex("quiz_event_questions_event_question_unique").on(t.quiz_event_id, t.question_id),
    event_idx: index("idx_quiz_event_questions_event").on(t.quiz_event_id),
  }),
);

export const quiz_attempts = pgTable(
  "quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quiz_event_id: uuid("quiz_event_id")
      .notNull()
      .references(() => quiz_events.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    score: integer("score"),
    correct_count: integer("correct_count"),
    total_count: integer("total_count"),
    answers: jsonb("answers").$type<Record<string, number[]>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => ({
    event_student_unique: uniqueIndex("quiz_attempts_event_student_unique").on(t.quiz_event_id, t.student_id),
    event_idx: index("idx_quiz_attempts_event").on(t.quiz_event_id),
    student_idx: index("idx_quiz_attempts_student").on(t.student_id),
  }),
);

// --- Live push quizzes (shikshak-initiated, inline questions) -----------------
export const push_quizzes = pgTable(
  "push_quizzes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: quizScopeEnum("scope").notNull().default("batch"),
    state_ids: uuid("state_ids").array().notNull().default([]),
    city_ids: uuid("city_ids").array().notNull().default([]),
    centre_ids: uuid("centre_ids").array().notNull().default([]),
    batch_ids: uuid("batch_ids").array().notNull().default([]),
    /** Legacy primary batch (first of batch_ids when scope=batch); null for broader scopes. */
    batch_id: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),
    shikshak_user_id: uuid("shikshak_user_id").references(() => users.id, { onDelete: "set null" }),
    started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    // SPEC §5.14 / AT21 — null = use punya_features default; 0 disables.
    completion_points: integer("completion_points"),
    ...timestamps(),
  },
  (t) => ({
    batch_idx: index("idx_push_quizzes_batch").on(t.batch_id),
  }),
);

export const push_quiz_questions = pgTable(
  "push_quiz_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    push_quiz_id: uuid("push_quiz_id")
      .notNull()
      .references(() => push_quizzes.id, { onDelete: "cascade" }),
    question_en: text("question_en").notNull(),
    question_hi: text("question_hi"),
    options: jsonb("options").$type<QuizOption[]>().notNull().default([]),
    correct_indices: integer("correct_indices").array().notNull().default([]),
    order_index: integer("order_index").notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    push_quiz_idx: index("idx_push_quiz_questions_push_quiz").on(t.push_quiz_id),
  }),
);

export const push_quiz_attempts = pgTable(
  "push_quiz_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    push_quiz_id: uuid("push_quiz_id")
      .notNull()
      .references(() => push_quizzes.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    answers: jsonb("answers").$type<Record<string, number[]>>().notNull().default({}),
    score: integer("score"),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    pushquiz_student_unique: uniqueIndex("push_quiz_attempts_pushquiz_student_unique").on(t.push_quiz_id, t.student_id),
    push_quiz_idx: index("idx_push_quiz_attempts_push_quiz").on(t.push_quiz_id),
    student_idx: index("idx_push_quiz_attempts_student").on(t.student_id),
  }),
);

export type Question = typeof questions.$inferSelect;
export type QuizEvent = typeof quiz_events.$inferSelect;
export type QuizAttempt = typeof quiz_attempts.$inferSelect;
export type PushQuiz = typeof push_quizzes.$inferSelect;
