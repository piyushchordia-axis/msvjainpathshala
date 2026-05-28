/**
 * Centres, batches, holidays, and the link tables that bind users to them
 * (SPEC §5.3 + §5.6 `centre_holidays`).
 *
 * Soft-delete (Decision 5): centres + batches + shivir-style entities all
 * carry `deleted_at` so service code can deactivate without losing history.
 *
 * The cyclic relationship with `users.centre_id_default` (sanchalak's
 * primary centre) is left without a FK on the users side — see identity.ts.
 */

import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { auditedBy, softDelete, timestamps } from './_helpers';
import { ageGroupEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';

// ---------------------------------------------------------------------------
// centres
// ---------------------------------------------------------------------------

export const centres = pgTable('centres', {
  id: uuid('id').primaryKey().defaultRandom(),
  city_id: uuid('city_id')
    .notNull()
    .references(() => cities.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  address_line: text('address_line'),
  locality: text('locality'),
  pincode: varchar('pincode', { length: 10 }),
  lat: numeric('lat', { precision: 10, scale: 7 }),
  lng: numeric('lng', { precision: 10, scale: 7 }),
  // GPS check-in radius (metres) — SPEC §8.2.
  // Default raised to 500 in migration 0006 per Step 6 prompt.
  gps_radius_m: integer('gps_radius_m').notNull().default(500),
  contact_phone: varchar('contact_phone', { length: 15 }),
  contact_email: varchar('contact_email', { length: 255 }),
  // 'active' | 'inactive' — plain text per spec (no enum required).
  status: text('status').notNull().default('active'),
  academic_year: text('academic_year'),
  ...softDelete(),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

// ---------------------------------------------------------------------------
// batches
// ---------------------------------------------------------------------------

export const batches = pgTable('batches', {
  id: uuid('id').primaryKey().defaultRandom(),
  centre_id: uuid('centre_id')
    .notNull()
    .references(() => centres.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  // ISO day numbers 1..7 (Mon..Sun) — Postgres int[].
  day_of_week: integer('day_of_week').array().notNull(),
  start_time: time('start_time').notNull(),
  end_time: time('end_time').notNull(),
  age_group: ageGroupEnum('age_group').notNull(),
  shikshak_id: uuid('shikshak_id').references(() => users.id, { onDelete: 'set null' }),
  academic_year: text('academic_year'),
  status: text('status').notNull().default('active'),
  capacity: integer('capacity').notNull().default(50),
  // Language hint from Step 6 prompt — 'hi' | 'en' | 'mixed' etc. (free-form
  // text so cities can introduce regional variants without a migration).
  language_preference: text('language_preference'),
  ...softDelete(),
  ...timestamps(),
  ...auditedBy(() => users.id),
});

// ---------------------------------------------------------------------------
// centre_holidays  (SPEC §5.6)
// ---------------------------------------------------------------------------

export const centre_holidays = pgTable('centre_holidays', {
  id: uuid('id').primaryKey().defaultRandom(),
  centre_id: uuid('centre_id')
    .notNull()
    .references(() => centres.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  start_date: date('start_date').notNull(),
  end_date: date('end_date').notNull(),
  created_by_user_id: uuid('created_by_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  notify_sent: boolean('notify_sent').notNull().default(false),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// sanchalak ↔ centre assignment (many-to-many; sanchalak may run multiple)
// ---------------------------------------------------------------------------

export const sanchalak_centre_assignments = pgTable('sanchalak_centre_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sanchalak_user_id: uuid('sanchalak_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  centre_id: uuid('centre_id')
    .notNull()
    .references(() => centres.id, { onDelete: 'cascade' }),
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// shikshak ↔ batch assignment (a shikshak may teach multiple batches)
// ---------------------------------------------------------------------------

export const shikshak_batch_assignments = pgTable('shikshak_batch_assignments', {
  id: uuid('id').primaryKey().defaultRandom(),
  shikshak_user_id: uuid('shikshak_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  batch_id: uuid('batch_id')
    .notNull()
    .references(() => batches.id, { onDelete: 'cascade' }),
  role_in_batch: text('role_in_batch').notNull(), // 'primary' | 'secondary'
  assigned_at: timestamp('assigned_at', { withTimezone: true }).notNull(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  ...timestamps(),
});
// Partial UNIQUE `(shikshak_user_id, batch_id) WHERE revoked_at IS NULL` is
// defined in 0002_indexes.sql per Decision 4 — Drizzle's partial index
// support across versions is uneven, and SQL is the readable source.

export type Centre = typeof centres.$inferSelect;
export type NewCentre = typeof centres.$inferInsert;
export type Batch = typeof batches.$inferSelect;
export type NewBatch = typeof batches.$inferInsert;
export type CentreHoliday = typeof centre_holidays.$inferSelect;
export type NewCentreHoliday = typeof centre_holidays.$inferInsert;
export type SanchalakCentreAssignment = typeof sanchalak_centre_assignments.$inferSelect;
export type ShikshakBatchAssignment = typeof shikshak_batch_assignments.$inferSelect;
