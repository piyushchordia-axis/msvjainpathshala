import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamps } from "./_helpers";
import { examQuestionTypeEnum } from "./enums";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const online_exams = pgTable(
  "online_exams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    city_id: uuid("city_id")
      .notNull()
      .references(() => cities.id, { onDelete: "restrict" }),
    title_en: text("title_en").notNull(),
    title_hi: text("title_hi").notNull(),
    description_en: text("description_en"),
    description_hi: text("description_hi"),
    window_start: timestamp("window_start", { withTimezone: true }).notNull(),
    window_end: timestamp("window_end", { withTimezone: true }).notNull(),
    max_attempts: integer("max_attempts").notNull().default(1),
    total_marks: integer("total_marks").notNull().default(100),
    pass_mark: integer("pass_mark").notNull().default(40),
    exam_otp: text("exam_otp"),
    results_released: boolean("results_released").notNull().default(false),
    ...timestamps(),
  },
  (t) => ({
    city_idx: index("idx_online_exams_city").on(t.city_id),
  }),
);

export const exam_questions = pgTable(
  "exam_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exam_id: uuid("exam_id")
      .notNull()
      .references(() => online_exams.id, { onDelete: "cascade" }),
    question_en: text("question_en").notNull(),
    question_hi: text("question_hi"),
    question_type: examQuestionTypeEnum("question_type").notNull().default("single_choice"),
    marks: integer("marks").notNull().default(1),
    order_index: integer("order_index").notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    exam_idx: index("idx_exam_questions_exam").on(t.exam_id),
  }),
);

export const exam_question_options = pgTable(
  "exam_question_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    question_id: uuid("question_id")
      .notNull()
      .references(() => exam_questions.id, { onDelete: "cascade" }),
    option_en: text("option_en").notNull(),
    option_hi: text("option_hi"),
    is_correct: boolean("is_correct").notNull().default(false),
    order_index: integer("order_index").notNull().default(0),
    ...timestamps(),
  },
  (t) => ({
    question_idx: index("idx_exam_question_options_question").on(t.question_id),
  }),
);

export const exam_attempts = pgTable(
  "exam_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    exam_id: uuid("exam_id")
      .notNull()
      .references(() => online_exams.id, { onDelete: "cascade" }),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    started_at: timestamp("started_at", { withTimezone: true }).notNull(),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    score: integer("score"),
    // Split objective (auto) vs subjective (manual) scoring; needs_grading flips
    // false once all text answers are graded.
    auto_score: integer("auto_score"),
    manual_score: integer("manual_score"),
    needs_grading: boolean("needs_grading").notNull().default(false),
    status: text("status").notNull().default("in_progress"),
    graded_by: uuid("graded_by").references(() => users.id, { onDelete: "set null" }),
    graded_at: timestamp("graded_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    exam_idx: index("idx_exam_attempts_exam").on(t.exam_id),
    student_idx: index("idx_exam_attempts_student").on(t.student_id),
  }),
);

export const exam_answers = pgTable(
  "exam_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attempt_id: uuid("attempt_id")
      .notNull()
      .references(() => exam_attempts.id, { onDelete: "cascade" }),
    question_id: uuid("question_id")
      .notNull()
      .references(() => exam_questions.id, { onDelete: "cascade" }),
    // Objective answers reference chosen options; subjective answers use text_answer.
    selected_option_ids: uuid("selected_option_ids").array().notNull().default([]),
    text_answer: text("text_answer"),
    is_correct: boolean("is_correct"),
    marks_awarded: integer("marks_awarded"),
    ...timestamps(),
  },
  (t) => ({
    attempt_question_unique: uniqueIndex("exam_answers_attempt_question_unique").on(t.attempt_id, t.question_id),
    attempt_idx: index("idx_exam_answers_attempt").on(t.attempt_id),
  }),
);

export type OnlineExam = typeof online_exams.$inferSelect;
export type ExamQuestion = typeof exam_questions.$inferSelect;
export type NewExamQuestion = typeof exam_questions.$inferInsert;
export type ExamQuestionOption = typeof exam_question_options.$inferSelect;
export type ExamAttempt = typeof exam_attempts.$inferSelect;
export type ExamAnswer = typeof exam_answers.$inferSelect;
