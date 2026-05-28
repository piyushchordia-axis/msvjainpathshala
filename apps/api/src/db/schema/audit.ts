/**
 * Audit logs (APPEND-ONLY, enforced by Postgres role grants in 0003) and
 * the offline-sync idempotency table (SPEC §5.19, §16).
 *
 * The application's normal connection role does NOT have INSERT on audit_logs
 * directly; it must `SET ROLE audit_writer` (a dedicated role with INSERT-only
 * grant) before emitting an audit row. UPDATE / DELETE / TRUNCATE are revoked
 * from PUBLIC unconditionally.
 */

import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { auditActionEnum, roleEnum, syncOpStatusEnum } from './enums';
import { users } from './identity';

export const audit_logs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor_user_id: uuid('actor_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  actor_role: roleEnum('actor_role').notNull(),
  action: auditActionEnum('action').notNull(),
  entity_kind: text('entity_kind').notNull(),
  entity_id: uuid('entity_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: varchar('ip', { length: 45 }),
  user_agent: text('user_agent'),
  request_id: text('request_id'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sync_operations = pgTable(
  'sync_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    client_op_id: uuid('client_op_id').notNull(),
    op_kind: text('op_kind').notNull(),
    request_payload: jsonb('request_payload'),
    response_payload: jsonb('response_payload'),
    status: syncOpStatusEnum('status').notNull(),
    error: text('error'),
    applied_at: timestamp('applied_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueUserOp: uniqueIndex('sync_operations_user_op_unique').on(t.user_id, t.client_op_id),
  }),
);

export type AuditLog = typeof audit_logs.$inferSelect;
export type NewAuditLog = typeof audit_logs.$inferInsert;
export type SyncOperation = typeof sync_operations.$inferSelect;
export type NewSyncOperation = typeof sync_operations.$inferInsert;
