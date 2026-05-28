/**
 * `SyncOpHandler<T>` — the per-`op_kind` dispatch interface used by
 * `SyncService`.
 *
 * Each domain registers exactly one handler in this module's providers
 * (Step 14 ships `attendance.mark` only; later steps add `shivir.scan`,
 * `niyam.submission`, `homework.submission`, `notice.acknowledge`,
 * `notification.read`). The handler owns:
 *
 *   - The Zod schema for its `payload` slice.
 *   - The translation from the wire payload to the underlying service call.
 *   - The result that gets cached in `sync_operations.response_payload` and
 *     re-emitted to subsequent replays.
 *
 * Throwing any `AppError` (4xx/409/422) is the expected failure mode — the
 * dispatcher records it as `failed` and surfaces the code to the client.
 * 5xx throws bubble up unchanged so the global filter logs them.
 */

import type { ScopedActor } from '../../attendance/attendance.service';
import type { Role, SyncOpKind } from '@jp/shared';
import type { ZodSchema } from 'zod';

export interface SyncOpContext {
  actor: ScopedActor;
  user_id: string;
  client_op_id: string;
  /** ISO-8601 timestamp from the client at op-creation time. Last-write-wins
   *  semantics for non-critical fields rely on this. */
  client_timestamp: string;
}

export interface SyncOpHandler<TPayload = unknown, TResult = unknown> {
  readonly op_kind: SyncOpKind;
  /** Roles that are allowed to submit this op. The service rejects ops from
   *  out-of-list roles before invoking `handle`. */
  readonly allowed_roles: readonly Role[];
  readonly payload_schema: ZodSchema<TPayload>;
  handle(ctx: SyncOpContext, payload: TPayload): Promise<TResult>;
}

export const SYNC_OP_HANDLERS = Symbol('SYNC_OP_HANDLERS');
