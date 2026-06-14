import { jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { auditActionEnum, roleEnum } from "./enums";
import { users } from "./identity";

/**
 * Append-only audit trail. Written via lib/audit.ts writeAudit() on sensitive
 * mutations (approvals, rejections, awards, config changes, etc.). No
 * updated_at — rows are never modified.
 */
export const audit_logs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor_user_id: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actor_role: roleEnum("actor_role"),
  action: auditActionEnum("action").notNull(),
  entity_kind: text("entity_kind").notNull(),
  entity_id: uuid("entity_id"),
  summary: text("summary"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  ip: varchar("ip", { length: 45 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof audit_logs.$inferSelect;
export type NewAuditLog = typeof audit_logs.$inferInsert;
