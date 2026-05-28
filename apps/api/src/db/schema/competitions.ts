/** Competitions + per-student registrations (SPEC §5.12). */

import {
  date,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';

import { auditedBy, timestamps } from './_helpers';
import { ageGroupEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { punya_transactions } from './punya';
import { students } from './students';

export const competitions = pgTable('competitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  city_id: uuid('city_id')
    .notNull()
    .references(() => cities.id, { onDelete: 'restrict' }),
  name_en: text('name_en').notNull(),
  name_hi: text('name_hi').notNull(),
  description_en: text('description_en'),
  description_hi: text('description_hi'),
  category: text('category'),
  eligible_age_groups: ageGroupEnum('eligible_age_groups').array(),
  msv_only: boolean('msv_only').notNull().default(false),
  registration_window_start: timestamp('registration_window_start', { withTimezone: true }),
  registration_window_end: timestamp('registration_window_end', { withTimezone: true }),
  event_date: date('event_date'),
  winner_points: integer('winner_points').notNull().default(0),
  participant_points: integer('participant_points').notNull().default(0),
  // Optional capacity cap — nullable means "no cap". Enforced at registration time.
  max_participants: integer('max_participants'),
  // 'draft' | 'open' | 'closed' | 'results_published'
  status: text('status').notNull().default('draft'),
  /** Set on POST /v1/admin/competitions/:id/publish-results. */
  results_published_at: timestamp('results_published_at', { withTimezone: true }),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

export const competition_registrations = pgTable(
  'competition_registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    competition_id: uuid('competition_id')
      .notNull()
      .references(() => competitions.id, { onDelete: 'cascade' }),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    registered_at: timestamp('registered_at', { withTimezone: true }).notNull(),
    result_rank: integer('result_rank'),
    result_note: text('result_note'),
    punya_transaction_id: uuid('punya_transaction_id').references(() => punya_transactions.id, {
      onDelete: 'restrict',
    }),
    ...timestamps(),
  },
  (t) => ({
    uniqueCompetitionStudent: uniqueIndex('competition_registrations_unique').on(
      t.competition_id,
      t.student_id,
    ),
  }),
);

export type Competition = typeof competitions.$inferSelect;
export type NewCompetition = typeof competitions.$inferInsert;
export type CompetitionRegistration = typeof competition_registrations.$inferSelect;
export type NewCompetitionRegistration = typeof competition_registrations.$inferInsert;
