/**
 * Dynamic registration form configs + per-user responses (SPEC §5.4).
 *
 * Spec deviation (documented in the approved plan, Decisions):
 *   `city_id` is NULLABLE here. NULL means "global default" — used by the
 *   five seed rows (student / parent / shikshak / sanchalak / city_admin).
 *   Cities override by inserting a row with their own city_id; the unique
 *   index `(city_id, form_kind, version_no)` keeps both spaces clean
 *   (Postgres treats NULL as distinct in UNIQUE constraints, so the global
 *   row coexists with city-specific rows).
 */

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { auditedBy, timestamps } from './_helpers';
import { cities } from './geography';
import { users } from './identity';

export const registration_form_configs = pgTable(
  'registration_form_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // NULLABLE — NULL = global default; cities override with non-NULL.
    city_id: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
    // 'student' | 'shikshak' | 'sanchalak' | 'parent' | 'city_admin'.
    // Plain text per spec (no enum) — Decision 1 widens the value set.
    form_kind: text('form_kind').notNull(),
    is_active: boolean('is_active').notNull().default(true),
    version_no: integer('version_no').notNull(),
    base_field_overrides: jsonb('base_field_overrides'),
    custom_fields: jsonb('custom_fields'),
    published_at: timestamp('published_at', { withTimezone: true }),
    published_by: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    ...auditedBy(() => users.id),
  },
  (t) => ({
    uniqueVersion: uniqueIndex('registration_form_configs_version_unique').on(
      t.city_id,
      t.form_kind,
      t.version_no,
    ),
  }),
);

export const registration_form_responses = pgTable('registration_form_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  form_config_id: uuid('form_config_id')
    .notNull()
    .references(() => registration_form_configs.id, { onDelete: 'restrict' }),
  user_id: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  responses: jsonb('responses').notNull(),
  submitted_at: timestamp('submitted_at', { withTimezone: true }).notNull(),
  ...timestamps(),
});

export type RegistrationFormConfig = typeof registration_form_configs.$inferSelect;
export type NewRegistrationFormConfig = typeof registration_form_configs.$inferInsert;
export type RegistrationFormResponse = typeof registration_form_responses.$inferSelect;
export type NewRegistrationFormResponse = typeof registration_form_responses.$inferInsert;
