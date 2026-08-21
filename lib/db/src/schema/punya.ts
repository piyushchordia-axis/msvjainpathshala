import {
  AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { timestamps } from "./_helpers";
import { tierEnum } from "./enums";
import { cities } from "./geography";
import { students } from "./students";
import { users } from "./identity";

export const punya_features = pgTable(
  "punya_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    min_points: integer("min_points"),
    max_points: integer("max_points"),
    /**
     * SPEC 5.7 (M3). Resolvers used to fall back to `max_points` — a
     * feature's CEILING used as its normal value. Backfilled from
     * max_points in 0091, so the numbers did not move; it merely became
     * possible to express a default that differs from the maximum.
     */
    default_points: integer("default_points"),
    /** Granted by a human through the manual-award surface, not by an event. */
    is_manual: boolean("is_manual").notNull().default(false),
    /** BRD 7.2 — amount AND reason mandatory for some manual categories. */
    requires_reason: boolean("requires_reason").notNull().default(false),
    /** Reserved for per-scope catalogues; 'global' everywhere today. */
    scope: text("scope").notNull().default("global"),
    is_active: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => ({
    /** Bounds are read by `where key = … limit 1`; duplicates made that arbitrary. */
    key_uq: uniqueIndex("punya_features_key_uq").on(t.key),
  }),
);

export const punya_configs = pgTable(
  "punya_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feature_key: text("feature_key").notNull(),
    points: integer("points").notNull().default(0),
    /** Null = global/default config; set for a city-level override. */
    city_id: uuid("city_id").references(() => cities.id, { onDelete: "cascade" }),
    is_active: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => ({
    feature_city_idx: index("idx_punya_configs_feature_city").on(t.feature_key, t.city_id),
    /**
     * One ACTIVE value per (feature, city). Two partial indexes because
     * Postgres treats NULLs as distinct, so a single UNIQUE (feature_key,
     * city_id) would still allow unlimited global rows — the case that
     * re-prices every city at once. See 0081.
     */
    feature_city_active_uq: uniqueIndex("punya_configs_feature_city_active_uq")
      .on(t.feature_key, t.city_id)
      .where(sql`${t.city_id} is not null and ${t.is_active} = true`),
    feature_global_active_uq: uniqueIndex("punya_configs_feature_global_active_uq")
      .on(t.feature_key)
      .where(sql`${t.city_id} is null and ${t.is_active} = true`),
  }),
);

/**
 * Per-role ceilings for POST /v1/admin/punya/award (manual_award).
 * Tunable without a deploy — max_points_per_day NULL = unlimited.
 */
export const punya_award_limits = pgTable(
  "punya_award_limits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    role: text("role").notNull().unique(),
    max_points_per_award: integer("max_points_per_award").notNull(),
    /** Null = no daily cap for this role. */
    max_points_per_day: integer("max_points_per_day"),
    is_active: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
);

/** Registry of uploaded storage keys → owning user (proof URL ownership). */
export const upload_objects = pgTable(
  "upload_objects",
  {
    key: text("key").primaryKey(),
    uploaded_by: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Canonical MIME at upload time — audit / media-kind; not used on the serve path. */
    content_type: text("content_type"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uploaded_by_idx: index("idx_upload_objects_uploaded_by").on(t.uploaded_by),
  }),
);

export const punya_transactions = pgTable(
  "punya_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // L15 / Q11 — never CASCADE on a student: students are deactivated, never
    // hard-deleted, so a cascading delete here assumes a delete that must
    // never happen (migration 0100/0101).
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "restrict" }),
    feature_key: text("feature_key").notNull(),
    points: integer("points").notNull(),
    note: text("note"),
    awarded_by: uuid("awarded_by").references(() => users.id, { onDelete: "set null" }),
    idempotency_key: text("idempotency_key"),
    reversal_of: uuid("reversal_of").references((): AnyPgColumn => punya_transactions.id, {
      onDelete: "set null",
    }),
    source_entity_kind: text("source_entity_kind"),
    source_entity_id: uuid("source_entity_id"),
    /** Attendance / streak ledger revision — orders reversals deterministically. */
    source_revision: integer("source_revision"),
    /**
     * SPEC 5.7 (M1) — geography denormalised for leaderboard reads, and a
     * SNAPSHOT rather than a live join: a child who transfers centres keeps
     * old rows pointing where they were when they earned them, which is what
     * a per-centre leaderboard for a past month has to mean.
     */
    city_id: uuid("city_id"),
    centre_id: uuid("centre_id"),
    batch_id: uuid("batch_id"),
    /** The parallel MSV leaderboard (BRD 7.6). */
    is_msv_track: boolean("is_msv_track").notNull().default(false),
    /**
     * When the child EARNED it, as distinct from when the row was written.
     * An offline sync or a catch-up job writes long after the fact.
     */
    awarded_at: timestamp("awarded_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => ({
    student_created_idx: index("idx_punya_transactions_student_created").on(t.student_id, t.created_at),
    // Global created_at range (admin analytics). INCLUDE lives in the SQL
    // migration — drizzle-orm has no .include() in this version.
    created_at_idx: index("idx_punya_transactions_created").on(t.created_at),
    feature_idx: index("idx_punya_transactions_feature").on(t.feature_key),
    source_revision_idx: index("idx_punya_tx_source_revision").on(
      t.student_id,
      t.source_entity_kind,
      t.source_entity_id,
      t.source_revision,
    ),
    // Leaderboard reads are "this scope, this month", so the range leads.
    city_created_idx: index("idx_punya_tx_city_created").on(t.city_id, t.created_at),
    centre_created_idx: index("idx_punya_tx_centre_created").on(t.centre_id, t.created_at),
    batch_created_idx: index("idx_punya_tx_batch_created").on(t.batch_id, t.created_at),
    idempotency_uq: uniqueIndex("punya_transactions_idempotency_key_uq")
      .on(t.idempotency_key)
      .where(sql`${t.idempotency_key} is not null`),
    reversal_idx: index("idx_punya_transactions_reversal")
      .on(t.reversal_of)
      .where(sql`${t.reversal_of} is not null`),
  }),
);

export const punya_balances = pgTable("punya_balances", {
  id: uuid("id").primaryKey().defaultRandom(),
  // UNIQUE: exactly one balance row per student — required for the atomic
  // upsert in awardPunya() and to prevent duplicate balance rows under races.
  student_id: uuid("student_id")
    .notNull()
    .unique()
    .references(() => students.id, { onDelete: "cascade" }),
  total_points: integer("total_points").notNull().default(0),
  tier: tierEnum("tier").notNull().default("jigyasu"),
  /** SPEC 5.7 (M2) — the MSV parallel track's running total. */
  msv_points: integer("msv_points").notNull().default(0),
  /**
   * When the current tier was reached (M2). BRD 7.5's celebration needs to
   * know WHEN, not just what — and without it a transition is unrecoverable
   * after the fact.
   */
  tier_reached_at: timestamp("tier_reached_at", { withTimezone: true }),
  ...timestamps(),
});

/**
 * End-of-month Punya leaderboard snapshot (replaces mv_monthly_leaderboard_city).
 * Written by punya.leaderboard.refresh for the month just ended; history is retained.
 */
export const monthly_leaderboard_snapshots = pgTable(
  "monthly_leaderboard_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    city_id: uuid("city_id").notNull(),
    month: date("month").notNull(),
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    full_name: text("full_name").notNull(),
    total_points: integer("total_points").notNull(),
    tier: tierEnum("tier").notNull(),
    rank: integer("rank").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    city_month_student_uq: uniqueIndex("monthly_leaderboard_snapshots_city_month_student_uq").on(
      t.city_id,
      t.month,
      t.student_id,
    ),
    month_idx: index("idx_monthly_leaderboard_snapshots_month").on(t.month),
  }),
);

/**
 * AT23 — the tier ladder as CONFIGURATION, adjustable without a deploy.
 *
 * It was TIER_THRESHOLDS in enums.ts, and the same numbers were re-inlined
 * into three SQL CASE ladders with nothing asserting they agreed.
 */
export const punya_tier_thresholds = pgTable("punya_tier_thresholds", {
  tier: tierEnum("tier").primaryKey(),
  min_points: integer("min_points").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PunyaTierThreshold = typeof punya_tier_thresholds.$inferSelect;

export type PunyaTransaction = typeof punya_transactions.$inferSelect;
export type NewPunyaTransaction = typeof punya_transactions.$inferInsert;
export type PunyaBalance = typeof punya_balances.$inferSelect;
export type NewPunyaBalance = typeof punya_balances.$inferInsert;
export type MonthlyLeaderboardSnapshot = typeof monthly_leaderboard_snapshots.$inferSelect;
export type PunyaAwardLimit = typeof punya_award_limits.$inferSelect;
export type NewPunyaAwardLimit = typeof punya_award_limits.$inferInsert;
