/**
 * Gallery items — derived from niyam submissions when the parent has
 * gallery_visibility_opt_in = true (CLAUDE.md Q6).
 */

import { boolean, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { softDelete } from './_helpers';
import { centres } from './centres';
import { cities } from './geography';
import { users } from './identity';
import { niyam_submissions, niyams } from './niyams';
import { students } from './students';

export const gallery_items = pgTable(
  'gallery_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    niyam_submission_id: uuid('niyam_submission_id')
      .notNull()
      .references(() => niyam_submissions.id, { onDelete: 'cascade' }),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    centre_id: uuid('centre_id')
      .notNull()
      .references(() => centres.id, { onDelete: 'restrict' }),
    city_id: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    niyam_id: uuid('niyam_id')
      .notNull()
      .references(() => niyams.id, { onDelete: 'restrict' }),
    // Broken cycle — no FK on asset_id.
    asset_id: uuid('asset_id').notNull(),
    is_featured: boolean('is_featured').notNull().default(false),
    featured_at: timestamp('featured_at', { withTimezone: true }),
    removed: boolean('removed').notNull().default(false),
    removed_by: uuid('removed_by').references(() => users.id, { onDelete: 'set null' }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ...softDelete(),
  },
  (t) => ({
    uniqueSubmission: uniqueIndex('gallery_items_submission_unique').on(t.niyam_submission_id),
  }),
);

export type GalleryItem = typeof gallery_items.$inferSelect;
export type NewGalleryItem = typeof gallery_items.$inferInsert;
