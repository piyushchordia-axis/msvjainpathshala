/**
 * `homework.submission` sync handler — drains the mobile's offline
 * `jp.queue.homework_submissions` MMKV queue via `/v1/sync/batch`.
 *
 * Wire payload mirrors `POST /v1/homework/:id/mark-done`:
 *   {
 *     assignment_id: uuid,
 *     student_id: uuid,
 *     submission_asset_id?: uuid
 *   }
 *
 * Replay safety: `HomeworkService.markDone()` is idempotent on the
 * (assignment, student) unique index — replays return the existing row.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { HomeworkService } from '../homework.service';

import type { SyncOpContext, SyncOpHandler } from '../../sync/handlers/op-handler';
import type { Role, SyncOpKind } from '@jp/shared';

const homeworkSubmissionPayloadSchema = z.object({
  assignment_id: z.string().uuid(),
  student_id: z.string().uuid(),
  submission_asset_id: z.string().uuid().optional(),
});
export type HomeworkSubmissionPayload = z.infer<typeof homeworkSubmissionPayloadSchema>;

@Injectable()
export class HomeworkSubmissionSyncHandler implements SyncOpHandler<
  HomeworkSubmissionPayload,
  unknown
> {
  readonly op_kind: SyncOpKind = 'homework.submission';
  readonly allowed_roles: readonly Role[] = ['parent'];
  readonly payload_schema = homeworkSubmissionPayloadSchema;

  constructor(private readonly homework: HomeworkService) {}

  async handle(ctx: SyncOpContext, payload: HomeworkSubmissionPayload): Promise<unknown> {
    const result = await this.homework.markDone(ctx.actor, payload.assignment_id, {
      student_id: payload.student_id,
      submission_asset_id: payload.submission_asset_id ?? null,
    });
    return {
      submission_id: result.submission.id,
      status: result.submission.status,
      assignment_id: payload.assignment_id,
      student_id: payload.student_id,
    };
  }
}
