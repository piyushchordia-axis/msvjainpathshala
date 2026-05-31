/**
 * Punya — features catalogue, per-city overrides, the append-only ledger,
 * the maintained balances projection, and leaderboard archive snapshots
 * (SPEC §5.7).
 *
 * `punya_transactions` is APPEND-ONLY. Reversals are NEW rows with signed
 * negative `points` and a `reversal_of` pointer. `idempotency_key` UNIQUE
 * is the linchpin — see CLAUDE.md "Common pitfalls → Awarding Punya
 * without idempotency_key".
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
import { batches, centres } from './centres';
import { tierEnum } from './enums';
import { cities } from './geography';
import { users } from './identity';
import { students } from './students';

import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// punya_features — global catalogue (seeded in 0004)
// ---------------------------------------------------------------------------

export const punya_features = pgTable(
  'punya_features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    default_points: integer('default_points').notNull(),
    is_manual: boolean('is_manual').notNull().default(false),
    requires_reason: boolean('requires_reason').notNull().default(false),
    scope: text('scope').notNull().default('global'), // 'global' | 'city'
    min_points: integer('min_points'),
    max_points: integer('max_points'),
    ...timestamps(),
    ...auditedBy(() => users.id),
  },
  (t) => ({
    uniqueKey: uniqueIndex('punya_features_key_unique').on(t.key),
  }),
);

// ---------------------------------------------------------------------------
// punya_configs — per-city overrides of default_points
// ---------------------------------------------------------------------------

export const punya_configs = pgTable(
  'punya_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    city_id: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    feature_id: uuid('feature_id')
      .notNull()
      .references(() => punya_features.id, { onDelete: 'cascade' }),
    points_override: integer('points_override').notNull(),
    min_points: integer('min_points'),
    max_points: integer('max_points'),
    ...timestamps(),
  },
  (t) => ({
    uniqueCityFeature: uniqueIndex('punya_configs_city_feature_unique').on(t.city_id, t.feature_id),
  }),
);

// ---------------------------------------------------------------------------
// punya_transactions — financial-grade APPEND-ONLY ledger
// ---------------------------------------------------------------------------

export const punya_transactions = pgTable(
  'punya_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    student_id: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'restrict' }),
    feature_key: text('feature_key').notNull(),
    // Signed — negative values are reversals.
    points: integer('points').notNull(),
    reason: text('reason'),
    awarded_by_user_id: uuid('awarded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    source_entity_kind: text('source_entity_kind').notNull(),
    source_entity_id: uuid('source_entity_id').notNull(),
    reversal_of: uuid('reversal_of').references((): AnyPgColumn => punya_transactions.id, {
      onDelete: 'restrict',
    }),
    is_msv_track: boolean('is_msv_track').notNull().default(false),
    awarded_at: timestamp('awarded_at', { withTimezone: true }).notNull(),
    city_id: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    centre_id: uuid('centre_id').references(() => centres.id, { onDelete: 'set null' }),
    batch_id: uuid('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    idempotency_key: text('idempotency_key').notNull(),
    ...timestamps(),
  },
  (t) => ({
    uniqueIdempotency: uniqueIndex('punya_transactions_idempotency_key_unique').on(
      t.idempotency_key,
    ),
  }),
);

// ---------------------------------------------------------------------------
// punya_balances — maintained projection (single source of truth for "current")
// ---------------------------------------------------------------------------

export const punya_balances = pgTable('punya_balances', {
  // PK is the student id (one row per student).
  student_id: uuid('student_id')
    .primaryKey()
    .references(() => students.id, { onDelete: 'restrict' }),
  total_points: integer('total_points').notNull().default(0),
  msv_points: integer('msv_points').notNull().default(0),
  current_tier: tierEnum('current_tier').notNull().default('jigyasu'),
  tier_reached_at: timestamp('tier_reached_at', { withTimezone: true }),
  last_updated_at: timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps(),
});

// ---------------------------------------------------------------------------
// leaderboard_snapshots — archive of monthly leaderboard states (Decision 7)
// ---------------------------------------------------------------------------

export const leaderboard_snapshots = pgTable(
  'leaderboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: text('scope').notNull(), // 'batch' | 'centre' | 'city' | 'msv'
    scope_id: uuid('scope_id').notNull(),
    period: text('period').notNull(), // e.g. '2026-01'
    snapshot: jsonb('snapshot').notNull(), // top-N rows captured by the monthly reset cron
    captured_at: timestamp('captured_at', { withTimezone: true }).notNull(),
    ...timestamps(),
  },
  (t) => ({
    uniquePeriod: uniqueIndex('leaderboard_snapshots_period_unique').on(
      t.scope,
      t.scope_id,
      t.period,
    ),
  }),
);

export type PunyaFeature = typeof punya_features.$inferSelect;
export type NewPunyaFeature = typeof punya_features.$inferInsert;
export type PunyaConfig = typeof punya_configs.$inferSelect;
export type NewPunyaConfig = typeof punya_configs.$inferInsert;
export type PunyaTransaction = typeof punya_transactions.$inferSelect;
export type NewPunyaTransaction = typeof punya_transactions.$inferInsert;
export type PunyaBalance = typeof punya_balances.$inferSelect;
export type NewPunyaBalance = typeof punya_balances.$inferInsert;
export type LeaderboardSnapshot = typeof leaderboard_snapshots.$inferSelect;
export type NewLeaderboardSnapshot = typeof leaderboard_snapshots.$inferInsert;
