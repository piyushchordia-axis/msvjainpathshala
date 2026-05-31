/**
 * `audit_action_enum` (SPEC §5.1).
 *
 * Audit logs are append-only — INSERTed by the `audit_writer` Postgres role
 * which has no UPDATE / DELETE grants (CLAUDE.md "Database conventions →
 * Audit logs"; SPEC §16).
 */

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'approve',
  'reject',
  'transfer',
  'login',
  'logout',
  'config_change',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
