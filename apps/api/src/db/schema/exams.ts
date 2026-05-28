/** Online exams + questions + options + attempts + answers (SPEC §5.14). */

import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditedBy, timestamps } from './_helpers';
import { examQuestionTypeEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { students } from './students';

export const online_exams = pgTable('online_exams', {
  id: uuid('id').primaryKey().defaultRandom(),
  city_id: uuid('city_id')
    .notNull()
    .references(() => cities.id, { onDelete: 'restrict' }),
  title_en: text('title_en').notNull(),
  title_hi: text('title_hi').notNull(),
  description_en: text('description_en'),
  description_hi: text('description_hi'),
  target_audience: jsonb('target_audience'),
  window_start: timestamp('window_start', { withTimezone: true }).notNull(),
  window_end: timestamp('window_end', { withTimezone: true }).notNull(),
  max_attempts: integer('max_attempts').notNull().default(1),
  total_marks: integer('total_marks').notNull(),
  pass_mark: integer('pass_mark').notNull(),
  exam_otp: text('exam_otp'),
  completion_points: integer('completion_points').notNull().default(0),
  top_score_points: integer('top_score_points').notNull().default(0),
  results_released: boolean('results_released').notNull().default(false),
  show_rank: boolean('show_rank').notNull().default(false),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

export const exam_questions = pgTable('exam_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  exam_id: uuid('exam_id')
    .notNull()
    .references(() => online_exams.id, { onDelete: 'cascade' }),
  question_type: examQuestionTypeEnum('question_type').notNull(),
  question_en: text('question_en').notNull(),
  question_hi: text('question_hi').notNull(),
  marks: integer('marks').notNull(),
  image_asset_id: uuid('image_asset_id'),
  order_index: integer('order_index').notNull(),
  ...timestamps(),
});

export const exam_question_options = pgTable('exam_question_options', {
  id: uuid('id').primaryKey().defaultRandom(),
  question_id: uuid('question_id')
    .notNull()
    .references(() => exam_questions.id, { onDelete: 'cascade' }),
  label_en: text('label_en').notNull(),
  label_hi: text('label_hi').notNull(),
  is_correct: boolean('is_correct').notNull(),
  order_index: integer('order_index').notNull(),
  ...timestamps(),
});

export const exam_attempts = pgTable('exam_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  exam_id: uuid('exam_id')
    .notNull()
    .references(() => online_exams.id, { onDelete: 'cascade' }),
  student_id: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'restrict' }),
  started_at: timestamp('started_at', { withTimezone: true }).notNull(),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  score: integer('score'),
  auto_score: integer('auto_score'),
  manual_score: integer('manual_score'),
  // 'in_progress' | 'submitted' | 'graded'
  status: text('status').notNull().default('in_progress'),
  otp_verified_at: timestamp('otp_verified_at', { withTimezone: true }),
  ...timestamps(),
});

export const exam_answers = pgTable('exam_answers', {
  id: uuid('id').primaryKey().defaultRandom(),
  attempt_id: uuid('attempt_id')
    .notNull()
    .references(() => exam_attempts.id, { onDelete: 'cascade' }),
  question_id: uuid('question_id')
    .notNull()
    .references(() => exam_questions.id, { onDelete: 'restrict' }),
  selected_option_ids: uuid('selected_option_ids').array(),
  short_text_answer: text('short_text_answer'),
  auto_score: integer('auto_score'),
  manual_score: integer('manual_score'),
  admin_comment: text('admin_comment'),
  graded_by_user_id: uuid('graded_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  ...timestamps(),
});

export type OnlineExam = typeof online_exams.$inferSelect;
export type NewOnlineExam = typeof online_exams.$inferInsert;
export type ExamQuestion = typeof exam_questions.$inferSelect;
export type NewExamQuestion = typeof exam_questions.$inferInsert;
export type ExamQuestionOption = typeof exam_question_options.$inferSelect;
export type NewExamQuestionOption = typeof exam_question_options.$inferInsert;
export type ExamAttempt = typeof exam_attempts.$inferSelect;
export type NewExamAttempt = typeof exam_attempts.$inferInsert;
export type ExamAnswer = typeof exam_answers.$inferSelect;
export type NewExamAnswer = typeof exam_answers.$inferInsert;
