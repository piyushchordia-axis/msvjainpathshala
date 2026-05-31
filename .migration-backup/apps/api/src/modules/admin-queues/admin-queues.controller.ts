/**
 * AdminQueuesController — super_admin-only DLQ inspection / replay / delete
 * plus aggregate stats, plus the `POST /v1/admin/debug/echo` smoke endpoint.
 *
 * Routes (all gated by JwtAuthGuard + RolesGuard via the global APP_GUARDs):
 *
 *   GET    /v1/admin/queues/stats
 *   GET    /v1/admin/queues/:queueName/dlq?limit=&offset=
 *   POST   /v1/admin/queues/:queueName/dlq/:jobId/replay
 *   DELETE /v1/admin/queues/:queueName/dlq/:jobId
 *   POST   /v1/admin/debug/echo
 *
 * Auditing: replays + deletes are logged via the AuditService so super_admin
 * activity on production DLQs is recoverable. The debug echo route doesn't
 * audit (operational tooling only).
 */

import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { AdminQueuesService } from './admin-queues.service';

const listDlqQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const debugEchoSchema = z.object({
  message: z.string().min(1).max(500),
  delay_ms: z.number().int().min(0).max(10_000).optional(),
  force_fail: z.boolean().optional(),
});

@Controller('/v1/admin')
@Roles('super_admin')
export class AdminQueuesController {
  constructor(
    private readonly admin: AdminQueuesService,
    private readonly audit: AuditService,
  ) {}

  // ---- Stats -----------------------------------------------------------

  @Get('/queues/stats')
  async stats() {
    return this.admin.getStats();
  }

  // ---- DLQ inspection / replay / delete --------------------------------

  @Get('/queues/:queueName/dlq')
  async listDlq(
    @Param('queueName') queueName: string,
    @Query(new ZodValidationPipe(listDlqQuerySchema)) query: z.infer<typeof listDlqQuerySchema>,
  ) {
    const items = await this.admin.listDlqJobs(queueName, query.limit ?? 50, query.offset ?? 0);
    return { items, page_size: items.length };
  }

  @Post('/queues/:queueName/dlq/:jobId/replay')
  @HttpCode(200)
  async replay(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    const result = await this.admin.replayDlqJob(queueName, jobId);
    if (user) {
      await this.audit
        .emit({
          actor_user_id: user.sub,
          actor_role: user.role,
          action: 'queue.dlq.replay',
          entity_kind: 'queue.dlq',
          entity_id: `${queueName}/${jobId}`,
          after: { replayed_job_id: result.replayed_job_id },
          request_id: null,
        })
        .catch(() => undefined);
    }
    return result;
  }

  @Delete('/queues/:queueName/dlq/:jobId')
  @HttpCode(200)
  async deleteDlq(
    @Param('queueName') queueName: string,
    @Param('jobId') jobId: string,
    @CurrentUser() user: CurrentUserPayload | undefined,
  ) {
    const result = await this.admin.deleteDlqJob(queueName, jobId);
    if (user) {
      await this.audit
        .emit({
          actor_user_id: user.sub,
          actor_role: user.role,
          action: 'queue.dlq.delete',
          entity_kind: 'queue.dlq',
          entity_id: `${queueName}/${jobId}`,
          request_id: null,
        })
        .catch(() => undefined);
    }
    return result;
  }

  // ---- Smoke debug echo ------------------------------------------------

  @Post('/debug/echo')
  @HttpCode(202)
  async debugEcho(
    @Body(new ZodValidationPipe(debugEchoSchema)) body: z.infer<typeof debugEchoSchema>,
  ) {
    return this.admin.enqueueDebugEcho(body);
  }
}
