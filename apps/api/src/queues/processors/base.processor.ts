/**
 * BaseProcessor — abstract `WorkerHost` every queue consumer extends.
 *
 * Adds three things to a plain `WorkerHost.process()`:
 *
 *   1. **Structured logging.** Start / finish / fail are logged with the
 *      queue name, job id, attempt number, and elapsed ms — Pino auto-
 *      enriches with trace_id/span_id from the active OTel span (see
 *      `core/logger/pino.config.ts`).
 *
 *   2. **OTel span per job.** Every `process(job)` runs inside a span named
 *      `bullmq.process queue=<name>`. Attributes follow the semantic-
 *      convention-ish naming (`messaging.system=bullmq`,
 *      `messaging.destination=<queue>`, `messaging.message_id=<jobId>`).
 *      A failure marks the span ERROR + records the exception.
 *
 *   3. **Dead-letter on final failure.** When the job has exhausted its
 *      retry budget (`attemptsMade + 1 >= attempts`), the failed payload
 *      is copied into the queue's `.dlq` pair before the failure
 *      propagates. The original failure is re-thrown so BullMQ records it
 *      and any per-worker `failed` event fires as normal.
 *
 * Subclasses only implement `handle(job)`. Anything thrown bubbles to the
 * BaseProcessor.process pipeline and runs the DLQ path on the final attempt.
 */

import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { Queue, type Job } from 'bullmq';

import { RedisService } from '../../core/redis/redis.service';
import { dlqName, type QueueName } from '../queues.constants';

export abstract class BaseProcessor<TData = unknown, TResult = unknown> extends WorkerHost {
  protected readonly logger: Logger;
  private dlq: Queue | null = null;

  /**
   * @param queueName       Queue this processor consumes. Used for logging,
   *                        OTel attrs, and to locate the paired DLQ.
   * @param redis           Inject RedisService — DLQ uses bullmqClient.
   * @param dlqLazyInit     Allow tests to disable DLQ wiring (defaults true).
   */
  constructor(
    protected readonly queueName: QueueName,
    private readonly redis: RedisService,
    private readonly dlqLazyInit = true,
  ) {
    super();
    this.logger = new Logger(`Worker:${queueName}`);
  }

  /**
   * Subclass entry point. Throw on failure — BaseProcessor handles retry +
   * DLQ wiring above.
   */
  abstract handle(job: Job<TData, TResult>): Promise<TResult>;

  async process(job: Job<TData, TResult>, _token?: string): Promise<TResult> {
    const tracer = trace.getTracer('jp.bullmq');
    const startMs = Date.now();
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts?.attempts ?? 1;

    return tracer.startActiveSpan(
      `bullmq.process ${this.queueName}`,
      {
        attributes: {
          'messaging.system': 'bullmq',
          'messaging.destination': this.queueName,
          'messaging.message_id': String(job.id ?? ''),
          'bullmq.attempt': attempt,
          'bullmq.max_attempts': maxAttempts,
        },
      },
      async (span) => {
        this.logger.log(`job ${job.id} started (attempt ${attempt}/${maxAttempts})`);

        try {
          const result = await this.handle(job);
          const elapsed = Date.now() - startMs;
          this.logger.log(`job ${job.id} ok in ${elapsed}ms`);
          span.setStatus({ code: SpanStatusCode.OK });
          span.setAttribute('bullmq.elapsed_ms', elapsed);
          return result;
        } catch (err) {
          const elapsed = Date.now() - startMs;
          const message = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          this.logger.error(
            `job ${job.id} FAILED in ${elapsed}ms (attempt ${attempt}/${maxAttempts}): ${message}`,
            stack,
          );
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR, message });
          span.setAttribute('bullmq.elapsed_ms', elapsed);

          // Final attempt → move to DLQ. We do this BEFORE re-throwing so
          // the DLQ entry exists by the time BullMQ records the failure;
          // if DLQ enqueue itself fails, we log loudly but still surface
          // the original error.
          if (attempt >= maxAttempts) {
            await this.moveToDlq(job, err).catch((dlqErr: unknown) => {
              this.logger.error(
                `DLQ enqueue FAILED for job ${job.id}: ${
                  dlqErr instanceof Error ? dlqErr.message : String(dlqErr)
                }`,
              );
            });
          }

          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  private getDlq(): Queue {
    if (!this.dlq) {
      this.dlq = new Queue(dlqName(this.queueName), {
        connection: this.redis.bullmqClient,
      });
    }
    return this.dlq;
  }

  private async moveToDlq(job: Job<TData, TResult>, err: unknown): Promise<void> {
    if (!this.dlqLazyInit) return;
    const dlq = this.getDlq();
    const failedAt = new Date().toISOString();
    await dlq.add(
      job.name ?? 'failed',
      {
        original_queue: this.queueName,
        original_job_id: job.id,
        original_name: job.name,
        original_data: job.data,
        failed_at: failedAt,
        failure_reason: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        attempts_made: job.attemptsMade + 1,
      },
      {
        attempts: 1,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );
    this.logger.warn(`job ${job.id} moved to ${dlqName(this.queueName)}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dlq) {
      await this.dlq.close().catch(() => undefined);
      this.dlq = null;
    }
  }
}
