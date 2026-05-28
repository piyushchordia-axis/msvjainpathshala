/**
 * Shikshak-only student notes + monthly / termly progress reports
 * (SPEC §5.20). Notes are NEVER shown to parent/student.
 */

import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDelete, timestamps } from './_helpers';
import { users } from './identity';
import { students } from './students';

export const student_notes = pgTable('student_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  student_id: uuid('student_id')
    .notNull()
    .references(() => students.id, { onDelete: 'restrict' }),
  author_user_id: uuid('author_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  note: text('note').notNull(),
  ...softDelete(),
  ...timestamps(),
});

export const progress_reports = pgTable(
  'progress_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    period_kind: text('period_kind').notNull(), // 'monthly' | 'termly'
    period_label: text('period_label').notNull(), // '2026-01' | 'Term 1 2025-26'
    generated_at: timestamp('generated_at', { withTimezone: true }).notNull(),
    pdf_asset_id: uuid('pdf_asset_id'),
    shikshak_comment: text('shikshak_comment'),
    released_to_parent: boolean('released_to_parent').notNull().default(false),
    released_at: timestamp('released_at', { withTimezone: true }),
    // Full payload for archival — shape tightened by DTO when Step 13 lands.
    snapshot: jsonb('snapshot').notNull(),
    ...timestamps(),
  },
  (t) => ({
    uniquePeriod: uniqueIndex('progress_reports_period_unique').on(
      t.student_id,
      t.period_kind,
      t.period_label,
    ),
  }),
);

export type StudentNote = typeof student_notes.$inferSelect;
export type NewStudentNote = typeof student_notes.$inferInsert;
export type ProgressReport = typeof progress_reports.$inferSelect;
export type NewProgressReport = typeof progress_reports.$inferInsert;
