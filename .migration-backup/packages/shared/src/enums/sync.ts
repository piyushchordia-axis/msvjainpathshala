/**
 * `sync_op_status_enum` (SPEC §5.1).
 *
 * `op_kind` on `sync_operations` is stored as TEXT in SPEC §5.19, not a PG
 * enum — different op kinds have different payload schemas and adding new
 * kinds shouldn't require a migration. `SYNC_OP_KINDS` here is a TypeScript
 * registry of the kinds currently known to the backend; the offline mutation
 * priority order matches CLAUDE.md "Offline sync rules → MMKV queue priority".
 */

/**
 * Per-row status on the `sync_operations` table (PG enum
 * `sync_op_status_enum`; SPEC §5.19).
 *
 * `processing` is the transient state between INSERT and final UPDATE. A
 * second device replaying the same `(user_id, client_op_id)` mid-flight sees
 * the `processing` row and short-circuits (returns `ERR_SYNC_DUPLICATE_OP`)
 * rather than re-dispatching the handler.
 *
 * The wire-format `SyncResultStatus` (what `/v1/sync/batch` returns) is a
 * proper subset: `processing` never reaches the client.
 */
export const SYNC_OP_STATUSES = ['processing', 'success', 'duplicate', 'failed'] as const;
export type SyncOpStatus = (typeof SYNC_OP_STATUSES)[number];

export const SYNC_RESULT_STATUSES = ['success', 'duplicate', 'failed'] as const;
export type SyncResultStatus = (typeof SYNC_RESULT_STATUSES)[number];

export const SYNC_OP_KINDS = [
  'attendance.mark',
  'shivir.scan',
  'niyam.submission',
  'homework.submission',
  'notice.acknowledge',
  'notification.read',
] as const;
export type SyncOpKind = (typeof SYNC_OP_KINDS)[number];
