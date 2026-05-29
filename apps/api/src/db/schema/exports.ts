/**
 * export_jobs — async PDF / ZIP export tracking (SPEC §12.5, §12.6).
 *
 * The HTTP POST /v1/admin/exports/* endpoints insert a row here with
 * status='pending', enqueue the worker job, and return the id immediately.
 * The worker flips status → running → ready (or failed) and sets
 * asset_id once the file lands in the exports bucket. The polling endpoint
 * GET /v1/admin/exports/:id reads off this table — never scrapes BullMQ.
 */

import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './identity';

export const export_jobs = pgTable('export_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  requested_by_user_id: uuid('requested_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  kind: text('kind').notNull(), // 'student_pdf' | 'centre_bulk_zip'
  scope_entity_kind: text('scope_entity_kind').notNull(), // 'student' | 'centre'
  scope_entity_id: uuid('scope_entity_id').notNull(),
  status: text('status').notNull().default('pending'), // pending|running|ready|failed
  asset_id: uuid('asset_id'),
  error: text('error'),
  started_at: timestamp('started_at', { withTimezone: true }),
  completed_at: timestamp('completed_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ExportJob = typeof export_jobs.$inferSelect;
export type NewExportJob = typeof export_jobs.$inferInsert;
