/**
 * `system_config` — runtime-configurable key/value store consumed by
 * `SystemConfigService` (apps/api/src/core/system-config/).
 *
 * Migration: `0005_system_config.sql` (hand-written; never regenerated).
 * Seeded with the Step-5 default knobs (otp.*, session.*, jwt.*,
 * impersonation.*, student_view.*, audit.async_enabled).
 *
 * `value` is JSONB so we can store numbers, booleans, strings, or small
 * structured objects (e.g. a future `rate_limits: { tier: 'staff', rpm: 600 }`)
 * without schema changes.
 */

import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './identity';

export const system_config = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updated_by: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

export type SystemConfig = typeof system_config.$inferSelect;
export type NewSystemConfig = typeof system_config.$inferInsert;
