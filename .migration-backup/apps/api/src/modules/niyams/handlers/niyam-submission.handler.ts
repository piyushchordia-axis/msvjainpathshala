/**
 * `niyam.submission` sync handler — drains the mobile's offline
 * `jp.queue.niyam_submissions` MMKV queue via `/v1/sync/batch`.
 *
 * Wire payload (mirrors the `POST /v1/niyams/:id/submissions` body, plus
 * the `niyam_id` the URL would carry):
 *   {
 *     niyam_id: uuid,
 *     student_id: uuid,
 *     proof_asset_id: uuid
 *   }
 *
 * Replay safety: `NiyamsService.submit()` is idempotent on the
 * `idempotency_key='niyam_sub:{submission_id}'` already + on the daily-
 * duplicate guard, so a replay returns the cached submission with
 * `duplicate=true`.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { NiyamsService } from '../niyams.service';

import type { SyncOpContext, SyncOpHandler } from '../../sync/handlers/op-handler';
import type { Role, SyncOpKind } from '@jp/shared';

const niyamSubmissionPayloadSchema = z.object({
  niyam_id: z.string().uuid(),
  student_id: z.string().uuid(),
  proof_asset_id: z.string().uuid(),
});
export type NiyamSubmissionPayload = z.infer<typeof niyamSubmissionPayloadSchema>;

@Injectable()
export class NiyamSubmissionSyncHandler implements SyncOpHandler<NiyamSubmissionPayload, unknown> {
  readonly op_kind: SyncOpKind = 'niyam.submission';
  readonly allowed_roles: readonly Role[] = ['parent'];
  readonly payload_schema = niyamSubmissionPayloadSchema;

  constructor(private readonly niyams: NiyamsService) {}

  async handle(ctx: SyncOpContext, payload: NiyamSubmissionPayload): Promise<unknown> {
    const result = await this.niyams.submit(ctx.actor, payload.niyam_id, {
      student_id: payload.student_id,
      proof_asset_id: payload.proof_asset_id,
      client_op_id: ctx.client_op_id,
    });
    return {
      submission_id: result.submission_id,
      punya_transaction_id: result.punya_transaction_id,
      points_awarded: result.points_awarded,
      duplicate: result.duplicate,
      gallery_item_id: result.gallery_item_id,
    };
  }
}
