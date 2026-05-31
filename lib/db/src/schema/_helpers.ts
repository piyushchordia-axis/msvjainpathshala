import { timestamp } from "drizzle-orm/pg-core";

export function timestamps() {
  return {
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

export function softDelete() {
  return {
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  };
}
