import { boolean, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { tierEnum } from "./enums";
import { students } from "./students";
import { users } from "./identity";

export const punya_features = pgTable("punya_features", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  ...timestamps(),
});

export const punya_configs = pgTable("punya_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  feature_key: text("feature_key").notNull(),
  points: integer("points").notNull().default(0),
  is_active: boolean("is_active").notNull().default(true),
  ...timestamps(),
});

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
    ...timestamps(),
  },
  (t) => ({
    student_idx: index("idx_punya_transactions_student").on(t.student_id),
    student_created_idx: index("idx_punya_transactions_student_created").on(t.student_id, t.created_at),
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
