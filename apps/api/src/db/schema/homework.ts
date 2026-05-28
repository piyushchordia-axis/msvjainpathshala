/** Homework assignments + submissions (SPEC §5.9). */

import { boolean, date, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { batches } from './centres';
import { homeworkStatusEnum } from './enums';
import { users } from './identity';
import { punya_transactions } from './punya';
import { students } from './students';

export const homework_assignments = pgTable('homework_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  batch_id: uuid('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'restrict' }),
  title: text('title').notNull(),
  description: text('description'),
  due_date: date('due_date').notNull(),
  // Broken cycle — no FK on attachment_asset_id.
  attachment_asset_id: uuid('attachment_asset_id'),
  created_by_user_id: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  is_msv: boolean('is_msv').notNull().default(false),
  // NULL means "all students in batch"; non-null targets a subset.
  target_student_ids: uuid('target_student_ids').array(),
  ...softDelete(),
  ...timestamps(),
});

export const homework_submissions = pgTable(
  'homework_submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignment_id: uuid('assignment_id')
      .notNull()
      .references(() => homework_assignments.id, { onDelete: 'cascade' }),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    status: homeworkStatusEnum('status').notNull(),
    submission_asset_id: uuid('submission_asset_id'),
    feedback_note: text('feedback_note'),
    marked_by_user_id: uuid('marked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    marked_at: timestamp('marked_at', { withTimezone: true }),
    late: boolean('late').notNull().default(false),
    punya_transaction_id: uuid('punya_transaction_id').references(() => punya_transactions.id, {
      onDelete: 'restrict',
    }),
    ...timestamps(),
  },
  (t) => ({
    uniqueAssignmentStudent: uniqueIndex('homework_submissions_assignment_student_unique').on(
      t.assignment_id,
      t.student_id,
    ),
  }),
);

export type HomeworkAssignment = typeof homework_assignments.$inferSelect;
export type NewHomeworkAssignment = typeof homework_assignments.$inferInsert;
export type HomeworkSubmission = typeof homework_submissions.$inferSelect;
export type NewHomeworkSubmission = typeof homework_submissions.$inferInsert;
