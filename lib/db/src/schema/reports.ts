import { index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import { timestamps } from "./_helpers";
import { centres } from "./centres";
import { users } from "./identity";

/** Aggregate centre monthly PDF reports (no student names — trustee-safe). */
export const centre_monthly_reports = pgTable(
  "centre_monthly_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centre_id: uuid("centre_id")
      .notNull()
      .references(() => centres.id, { onDelete: "cascade" }),
    /** YYYY-MM */
    month: varchar("month", { length: 7 }).notNull(),
    status: text("status").notNull().default("queued"),
    pdf_url: text("pdf_url"),
    error_message: text("error_message"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    generated_by: uuid("generated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => ({
    centre_month_uq: uniqueIndex("centre_monthly_reports_centre_month_uq").on(
      t.centre_id,
      t.month,
    ),
    centre_month_idx: index("idx_centre_monthly_reports_centre_month").on(
      t.centre_id,
      t.month,
      t.created_at,
    ),
  }),
);

export type CentreMonthlyReport = typeof centre_monthly_reports.$inferSelect;
export type NewCentreMonthlyReport = typeof centre_monthly_reports.$inferInsert;
