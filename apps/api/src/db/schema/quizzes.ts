/** Quiz bank + scheduled quiz events + push (live) quizzes (SPEC §5.14). */

import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { auditedBy, timestamps } from './_helpers';
import { batches, centres } from './centres';
import { ageGroupEnum, quizScopeEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { students } from './students';

// Quiz bank — reusable questions.
export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: text('scope').notNull(), // 'national' | 'state' | 'city'
  city_id: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
  question_en: text('question_en').notNull(),
  question_hi: text('question_hi').notNull(),
  options: jsonb('options').notNull(),
  correct_indices: integer('correct_indices').array().notNull(),
  difficulty: text('difficulty'),
  age_groups: ageGroupEnum('age_groups').array(),
  topic: text('topic'),
  source: text('source').notNull().default('manual'), // 'manual' | 'ai'
  ai_generation_id: uuid('ai_generation_id'),
  reviewed: text('reviewed'),
  reviewed_by: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps(),
});

// Scheduled quiz events (multi-question, time-windowed).
export const quiz_events = pgTable('quiz_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  scope: quizScopeEnum('scope').notNull(),
  city_id: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
  centre_id: uuid('centre_id').references(() => centres.id, { onDelete: 'restrict' }),
  batch_id: uuid('batch_id').references(() => batches.id, { onDelete: 'restrict' }),
  title_en: text('title_en').notNull(),
  title_hi: text('title_hi').notNull(),
  start_at: timestamp('start_at', { withTimezone: true }).notNull(),
  end_at: timestamp('end_at', { withTimezone: true }).notNull(),
  participation_points: integer('participation_points').notNull().default(0),
  win_points: integer('win_points').notNull().default(0),
  target_age_groups: ageGroupEnum('target_age_groups').array(),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

export const quiz_event_questions = pgTable('quiz_event_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  quiz_event_id: uuid('quiz_event_id')
    .notNull()
    .references(() => quiz_events.id, { onDelete: 'cascade' }),
  question_id: uuid('question_id')
    .notNull()
    .references(() => questions.id, { onDelete: 'restrict' }),
  order_index: integer('order_index').notNull(),
  ...timestamps(),
});

export const quiz_attempts = pgTable('quiz_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  quiz_event_id: uuid('quiz_event_id')
    .notNull()
    .references(() => quiz_events.id, { onDelete: 'cascade' }),
  student_id: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'restrict' }),
  started_at: timestamp('started_at', { withTimezone: true }).notNull(),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  score: integer('score'),
  correct_count: integer('correct_count'),
  total_count: integer('total_count'),
  ...timestamps(),
});

// Push (live) quizzes — shikshak-initiated, Socket.IO broadcast.
export const push_quizzes = pgTable('push_quizzes', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_id: uuid('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  shikshak_user_id: uuid('shikshak_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  started_at: timestamp('started_at', { withTimezone: true }).notNull(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  completion_points: integer('completion_points').notNull().default(0),
  ...timestamps(),
});

export const push_quiz_questions = pgTable('push_quiz_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  push_quiz_id: uuid('push_quiz_id')
    .notNull()
    .references(() => push_quizzes.id, { onDelete: 'cascade' }),
  question_en: text('question_en').notNull(),
  question_hi: text('question_hi').notNull(),
  options: jsonb('options').notNull(),
  correct_indices: integer('correct_indices').array().notNull(),
  order_index: integer('order_index').notNull(),
  ...timestamps(),
});

export const push_quiz_attempts = pgTable('push_quiz_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  push_quiz_id: uuid('push_quiz_id')
    .notNull()
    .references(() => push_quizzes.id, { onDelete: 'cascade' }),
  student_id: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'restrict' }),
  answers: jsonb('answers'),
  score: integer('score'),
  submitted_at: timestamp('submitted_at', { withTimezone: true }),
  ...timestamps(),
});

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type QuizEvent = typeof quiz_events.$inferSelect;
export type NewQuizEvent = typeof quiz_events.$inferInsert;
export type QuizEventQuestion = typeof quiz_event_questions.$inferSelect;
export type NewQuizEventQuestion = typeof quiz_event_questions.$inferInsert;
export type QuizAttempt = typeof quiz_attempts.$inferSelect;
export type NewQuizAttempt = typeof quiz_attempts.$inferInsert;
export type PushQuiz = typeof push_quizzes.$inferSelect;
export type NewPushQuiz = typeof push_quizzes.$inferInsert;
export type PushQuizQuestion = typeof push_quiz_questions.$inferSelect;
export type NewPushQuizQuestion = typeof push_quiz_questions.$inferInsert;
export type PushQuizAttempt = typeof push_quiz_attempts.$inferSelect;
export type NewPushQuizAttempt = typeof push_quiz_attempts.$inferInsert;
