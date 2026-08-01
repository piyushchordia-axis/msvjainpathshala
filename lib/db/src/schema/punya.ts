import {
  AnyPgColumn,
  boolean,
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

export const punya_features = pgTable("punya_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  min_points: integer("min_points"),
  max_points: integer("max_points"),
  is_active: boolean("is_active").notNull().default(true),
  ...timestamps(),
});

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
  }),
);

/** Registry of uploaded storage keys → owning user (proof URL ownership). */
export const upload_objects = pgTable(
  "upload_objects",
  {
    key: text("key").primaryKey(),
    uploaded_by: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    student_id: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
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
    ...timestamps(),
  },
  (t) => ({
    student_idx: index("idx_punya_transactions_student").on(t.student_id),
    student_created_idx: index("idx_punya_transactions_student_created").on(t.student_id, t.created_at),
    feature_idx: index("idx_punya_transactions_feature").on(t.feature_key),
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
  ...timestamps(),
});

export type PunyaTransaction = typeof punya_transactions.$inferSelect;
export type NewPunyaTransaction = typeof punya_transactions.$inferInsert;
export type PunyaBalance = typeof punya_balances.$inferSelect;
export type NewPunyaBalance = typeof punya_balances.$inferInsert;
