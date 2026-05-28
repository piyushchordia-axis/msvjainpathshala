/**
 * `sync_op_status_enum` (SPEC §5.1).
 *
 * `op_kind` on `sync_operations` is stored as TEXT in SPEC §5.19, not a PG
 * enum — different op kinds have different payload schemas and adding new
 * kinds shouldn't require a migration. `SYNC_OP_KINDS` here is a TypeScript
 * registry of the kinds currently known to the backend; the offline mutation
 * priority order matches CLAUDE.md "Offline sync rules → MMKV queue priority".
 */

export const SYNC_OP_STATUSES = ['success', 'duplicate', 'failed'] as const;
export type SyncOpStatus = (typeof SYNC_OP_STATUSES)[number];

export const SYNC_OP_KINDS = [
  'attendance.mark',
  'shivir.scan',
  'niyam.submission',
  'homework.submission',
  'notice.acknowledge',
] as const;
export type SyncOpKind = (typeof SYNC_OP_KINDS)[number];
