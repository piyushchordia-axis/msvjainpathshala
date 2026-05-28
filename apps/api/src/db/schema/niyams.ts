/**
 * Niyams (vows / tasks) + submissions + per-student-per-niyam streaks
 * (SPEC §5.8).
 *
 * `niyam_submissions.status` is `auto_approved` by default — submissions
 * auto-award Punya at insertion. Rejection within 30 days reverses Punya
 * (CLAUDE.md Q5) — enforced at the service layer.
 */

import {
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { niyamSubmissionStatusEnum, niyamTypeEnum, proofTypeEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { punya_transactions } from './punya';
import { students } from './students';

export const niyams = pgTable('niyams', {
  id: uuid('id').primaryKey().defaultRandom(),
  title_en: text('title_en').notNull(),
  title_hi: text('title_hi').notNull(),
  description_en: text('description_en'),
  description_hi: text('description_hi'),
  type: niyamTypeEnum('type').notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date'),
  // 'all' | 'msv_only' | 'age_group' | 'batch' | 'centre' | 'city'.
  audience_kind: text('audience_kind').notNull().default('all'),
  audience_filters: jsonb('audience_filters'),
  proof_type: proofTypeEnum('proof_type').notNull(),
  points_value: integer('points_value').notNull(),
  // No FK — see media.ts file-level note about cycles.
  reference_asset_id: uuid('reference_asset_id'),
  created_by_user_id: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  city_id: uuid('city_id')
    .notNull()
    .references(() => cities.id, { onDelete: 'restrict' }),
  msv_only: boolean('msv_only').notNull().default(false),
  ...softDelete(),
  ...timestamps(),
});

export const niyam_submissions = pgTable('niyam_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  niyam_id: uuid('niyam_id')
    .notNull()
    .references(() => niyams.id, { onDelete: 'restrict' }),
  student_id: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'restrict' }),
  parent_user_id: uuid('parent_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  // No FK — broken cycle (media side carries the constraint).
  proof_asset_id: uuid('proof_asset_id').notNull(),
  status: niyamSubmissionStatusEnum('status').notNull().default('auto_approved'),
  auto_approved_at: timestamp('auto_approved_at', { withTimezone: true }).notNull().defaultNow(),
  rejected_at: timestamp('rejected_at', { withTimezone: true }),
  rejected_by_user_id: uuid('rejected_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  rejection_reason: text('rejection_reason'),
  punya_transaction_id: uuid('punya_transaction_id')
    .notNull()
    .references(() => punya_transactions.id, { onDelete: 'restrict' }),
  reversal_transaction_id: uuid('reversal_transaction_id').references(() => punya_transactions.id, {
    onDelete: 'restrict',
  }),
  submitted_at: timestamp('submitted_at', { withTimezone: true }).notNull(),
  // Denormalised for streak math.
  submission_date: date('submission_date').notNull(),
  ...timestamps(),
});

export const niyam_streaks = pgTable(
  'niyam_streaks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    niyam_id: uuid('niyam_id')
      .notNull()
      .references(() => niyams.id, { onDelete: 'cascade' }),
    current_streak: integer('current_streak').notNull().default(0),
    longest_streak: integer('longest_streak').notNull().default(0),
    last_completion_date: date('last_completion_date'),
    badge_awarded: boolean('badge_awarded').notNull().default(false),
    badge_kind: text('badge_kind'),
    ...timestamps(),
  },
  (t) => ({
    uniqueStudentNiyam: uniqueIndex('niyam_streaks_student_niyam_unique').on(
      t.student_id,
      t.niyam_id,
    ),
  }),
);

export type Niyam = typeof niyams.$inferSelect;
export type NewNiyam = typeof niyams.$inferInsert;
export type NiyamSubmission = typeof niyam_submissions.$inferSelect;
export type NewNiyamSubmission = typeof niyam_submissions.$inferInsert;
export type NiyamStreak = typeof niyam_streaks.$inferSelect;
export type NewNiyamStreak = typeof niyam_streaks.$inferInsert;
