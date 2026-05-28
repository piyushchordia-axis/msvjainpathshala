/**
 * Platform settings — singleton row with `id = 'global'`.
 *
 * The CHECK constraint enforces the singleton property at the DB level.
 * `eighty_g_enabled` is the master toggle (CLAUDE.md Q3) — when flipped on,
 * `eighty_g_registration_number` AND `organization_pan` (here:
 * `eighty_g_trust_*`) must both be populated, validated at the service
 * layer (Step 19+).
 */

import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from './_helpers';
import { users } from './identity';

export const platform_settings = pgTable(
  'platform_settings',
  {
    // Singleton id — only 'global' is permitted.
    id: text('id').primaryKey(),
    eighty_g_enabled: boolean('eighty_g_enabled').notNull().default(false),
    eighty_g_registration_number: text('eighty_g_registration_number'),
    eighty_g_trust_name: text('eighty_g_trust_name'),
    eighty_g_trust_address: text('eighty_g_trust_address'),
    eighty_g_section: text('eighty_g_section').notNull().default('80G'),
    last_updated_by: uuid('last_updated_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    last_updated_at: timestamp('last_updated_at', { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    singleton: check('platform_settings_singleton', sql`${t.id} = 'global'`),
  }),
);

export type PlatformSettings = typeof platform_settings.$inferSelect;
export type NewPlatformSettings = typeof platform_settings.$inferInsert;
