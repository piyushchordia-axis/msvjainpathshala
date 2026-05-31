/**
 * AdminQueuesService — reads / replays / deletes DLQ jobs and produces
 * cluster-wide queue stats for the super_admin /v1/admin/queues/* endpoints.
 *
 * The service holds one read-only Queue per known queue name (and per DLQ
 * pair) via the shared bullmqClient — same connection the producers and
 * workers use. We don't create a Worker here; this module never drains
 * jobs, only inspects and re-enqueues.
 *
 * "Replay" copies the original payload from a DLQ entry back onto its
 * primary queue with the standard per-queue default options (so it goes
 * through the normal retry policy again). The DLQ entry is removed only
 * after the replay enqueue succeeds.
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import {
  DLQ_SUFFIX,
  QUEUE_NAMES,
  assertKnownQueueName,
  dlqName,
  isDlqName,
  type QueueName,
} from '../../queues/queues.constants';
import { jobOptionsFor } from '../../queues/queues.module';

export interface DlqJobSummary {
  id: string | null;
  name: string;
  data: unknown;
  failed_reason: string | null;
  attempts_made: number;
  timestamp: number;
}

export interface QueueStatsRow {
  queue: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  dlq_size: number;
}

@Injectable()
export class AdminQueuesService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AdminQueuesService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly redis: RedisService) {}

  onApplicationBootstrap(): void {
    for (const name of QUEUE_NAMES) {
      this.queues.set(name, new Queue(name, { connection: this.redis.bullmqClient }));
      const dlq = dlqName(name);
      this.queues.set(dlq, new Queue(dlq, { connection: this.redis.bullmqClient }));
    }
    this.logger.log(`admin-queues ready (${this.queues.size} queue handles)`);
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    this.queues.clear();
  }

  /** Resolve a queue name from a path param. Throws ERR_RESOURCE_NOT_FOUND if unknown. */
  private resolveQueueName(raw: string): QueueName {
    try {
      return assertKnownQueueName(raw);
    } catch {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: `Unknown queue: ${raw}`,
        statusCode: 404,
      });
    }
  }

  private getQueueHandle(name: string): Queue {
    const q = this.queues.get(name);
    if (!q) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: `Queue not initialised: ${name}`,
        statusCode: 404,
      });
    }
    return q;
  }

  /**
   * GET /v1/admin/queues/:queueName/dlq
   * Returns up to `limit` (default 50) waiting/failed jobs from the DLQ.
   * `:queueName` may be either the primary name or the `.dlq` name — both
   * are accepted, the inspector always reads the DLQ.
   */
  async listDlqJobs(queueName: string, limit = 50, offset = 0): Promise<DlqJobSummary[]> {
    const primary = this.resolveQueueName(queueName);
    const dlq = this.getQueueHandle(dlqName(primary));

    // DLQ entries arrive via Queue.add — they sit in `waiting` until manually
    // processed; pulling `waiting` + `failed` covers both legacy paths.
    const jobs = await dlq.getJobs(['waiting', 'delayed', 'failed'], offset, offset + limit - 1);
    return jobs.map((j) => ({
      id: j.id ?? null,
      name: j.name,
      data: j.data,
      failed_reason: j.failedReason ?? null,
      attempts_made: j.attemptsMade,
      timestamp: j.timestamp,
    }));
  }

  /**
   * POST /v1/admin/queues/:queueName/dlq/:jobId/replay
   * Re-enqueues the original payload onto the primary queue, then removes
   * the DLQ entry. Returns the new primary-queue job id.
   */
  async replayDlqJob(queueName: string, jobId: string): Promise<{ replayed_job_id: string }> {
    const primary = this.resolveQueueName(queueName);
    const dlq = this.getQueueHandle(dlqName(primary));
    const primaryQ = this.getQueueHandle(primary);

    const job = await dlq.getJob(jobId);
    if (!job) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: `DLQ job not found: ${jobId}`,
        statusCode: 404,
      });
    }

    // DLQ payload format from BaseProcessor: { original_data, original_name, ... }
    const data = job.data as { original_data?: unknown; original_name?: string };
    const replayName =
      (typeof data?.original_name === 'string' && data.original_name) || job.name || 'replay';
    const replayPayload = data?.original_data ?? job.data;

    const newJob = await primaryQ.add(replayName, replayPayload, jobOptionsFor(primary));
    await job.remove();
    this.logger.log(
      `replayed dlq:${dlq.name} job=${jobId} → ${primary} new_id=${newJob.id ?? '?'}`,
    );
    return { replayed_job_id: String(newJob.id ?? '') };
  }

  /**
   * DELETE /v1/admin/queues/:queueName/dlq/:jobId
   * Permanently removes a DLQ entry without replay. Logged for audit.
   */
  async deleteDlqJob(queueName: string, jobId: string): Promise<{ deleted: boolean }> {
    const primary = this.resolveQueueName(queueName);
    const dlq = this.getQueueHandle(dlqName(primary));
    const job = await dlq.getJob(jobId);
    if (!job) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: `DLQ job not found: ${jobId}`,
        statusCode: 404,
      });
    }
    await job.remove();
    this.logger.warn(`deleted dlq:${dlq.name} job=${jobId}`);
    return { deleted: true };
  }

  /**
   * GET /v1/admin/queues/stats
   * Aggregate counts for every queue (and DLQ). Hot path for the admin UI;
   * runs ~60 Redis commands. Cheap enough at the operator-traffic scale.
   */
  async getStats(): Promise<{
    queues: QueueStatsRow[];
    totals: {
      queues: number;
      waiting: number;
      active: number;
      delayed: number;
      failed: number;
      dlq_size: number;
    };
  }> {
    const rows: QueueStatsRow[] = [];
    let waitingT = 0;
    let activeT = 0;
    let delayedT = 0;
    let failedT = 0;
    let dlqT = 0;

    for (const name of QUEUE_NAMES) {
      if (isDlqName(name)) continue;
      const primary = this.getQueueHandle(name);
      const dlq = this.getQueueHandle(dlqName(name));

      const pCounts = await primary.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
      );
      const dCounts = await dlq.getJobCounts('waiting', 'delayed', 'failed');
      const dlqSize = (dCounts.waiting ?? 0) + (dCounts.delayed ?? 0) + (dCounts.failed ?? 0);

      rows.push({
        queue: name,
        waiting: pCounts.waiting ?? 0,
        active: pCounts.active ?? 0,
        delayed: pCounts.delayed ?? 0,
        completed: pCounts.completed ?? 0,
        failed: pCounts.failed ?? 0,
        dlq_size: dlqSize,
      });

      waitingT += pCounts.waiting ?? 0;
      activeT += pCounts.active ?? 0;
      delayedT += pCounts.delayed ?? 0;
      failedT += pCounts.failed ?? 0;
      dlqT += dlqSize;
    }

    return {
      queues: rows,
      totals: {
        queues: rows.length,
        waiting: waitingT,
        active: activeT,
        delayed: delayedT,
        failed: failedT,
        dlq_size: dlqT,
      },
    };
  }

  /**
   * Producer used by POST /v1/admin/debug/echo to verify wiring end-to-end.
   * Returns the enqueued job id. We pass jobOptionsFor() explicitly because
   * this Queue handle is built directly with `new Queue(...)` and so
   * doesn't inherit the BullModule-registered defaults — same pattern as
   * replayDlqJob() above.
   */
  async enqueueDebugEcho(payload: {
    message: string;
    delay_ms?: number;
    force_fail?: boolean;
  }): Promise<{ job_id: string }> {
    const debug = this.getQueueHandle('debug.echo');
    const job = await debug.add('echo', payload, jobOptionsFor('debug.echo'));
    return { job_id: String(job.id ?? '') };
  }

  /**
   * Reserved for future direct producer enqueues from admin tooling. Not used
   * yet but keeps the suffix logic in one place.
   */
  static dlqSuffix(): string {
    return DLQ_SUFFIX;
  }
}
