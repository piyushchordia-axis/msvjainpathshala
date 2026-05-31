/**
 * `shivir.scan` sync handler — wraps `ShivirsService.scan()`.
 *
 * Wire payload (mirrors the `/v1/shivirs/:id/scan` POST body, plus the
 * `shivir_event_id` the URL would carry):
 *   {
 *     shivir_event_id: uuid,
 *     shivir_session_id: uuid,
 *     student_qr_code: string,
 *     scanned_at: ISO datetime,
 *     force?: boolean
 *   }
 *
 * Replay safety mirrors the HTTP path: `ShivirsService.scan()` looks up the
 * scan by `client_op_id` BEFORE applying the state machine, so a duplicate
 * arriving via the sync engine returns the cached row as `duplicate=true`.
 * The sync layer then surfaces that as `status='duplicate'`.
 *
 * State-machine conflicts (`ERR_SHIVIR_SCAN_OUT_OF_ORDER`,
 * `ERR_SHIVIR_SCAN_DUPLICATE_PRESENT`, `ERR_SHIVIR_NOT_REGISTERED`) come
 * out of the service as 409 AppErrors — the dispatcher tags them as
 * `ERR_SYNC_CONFLICT` so the mobile's conflict modal triggers.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ShivirsService } from '../shivirs.service';

import type { SyncOpContext, SyncOpHandler } from '../../sync/handlers/op-handler';
import type { Role, SyncOpKind } from '@jp/shared';

const shivirScanPayloadSchema = z.object({
  shivir_event_id: z.string().uuid(),
  shivir_session_id: z.string().uuid(),
  student_qr_code: z.string().min(1).max(2048),
  scanned_at: z.string().datetime(),
  force: z.boolean().optional(),
});
export type ShivirScanPayload = z.infer<typeof shivirScanPayloadSchema>;

@Injectable()
export class ShivirScanSyncHandler implements SyncOpHandler<ShivirScanPayload, unknown> {
  readonly op_kind: SyncOpKind = 'shivir.scan';
  /**
   * Volunteers can be ANY authenticated role (the per-event volunteer table
   * gates per-event access in the service). We allow shikshak/parent at the
   * sync-layer too, then defer to the per-event check in `scan()`.
   */
  readonly allowed_roles: readonly Role[] = [
    'super_admin',
    'state_admin',
    'city_admin',
    'sanchalak',
    'shikshak',
    'parent',
  ];
  readonly payload_schema = shivirScanPayloadSchema;

  constructor(private readonly shivirs: ShivirsService) {}

  async handle(ctx: SyncOpContext, payload: ShivirScanPayload): Promise<unknown> {
    const result = await this.shivirs.scan(ctx.actor, payload.shivir_event_id, {
      shivir_session_id: payload.shivir_session_id,
      student_qr_code: payload.student_qr_code,
      client_op_id: ctx.client_op_id,
      scanned_at: payload.scanned_at,
      device_offline: true, // by definition: ops that arrive via the sync engine were queued offline
      ...(payload.force !== undefined ? { force: payload.force } : {}),
    });
    return {
      scan_id: result.scan_id,
      shivir_event_id: result.shivir_event_id,
      shivir_session_id: result.shivir_session_id,
      student_id: result.student_id,
      scan_kind: result.scan_kind,
      scanned_at: result.scanned_at,
      duplicate: result.duplicate,
    };
  }
}
