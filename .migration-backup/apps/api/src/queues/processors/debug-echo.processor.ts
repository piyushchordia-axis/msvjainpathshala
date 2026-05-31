/**
 * `debug.echo` — smoke processor used to validate end-to-end queue wiring
 * from controller → BullMQ → worker → log line (Step 7 exit criteria).
 *
 * The companion HTTP endpoint `POST /v1/admin/debug/echo` (super_admin)
 * enqueues a job; this processor reads it, sleeps optionally, and logs
 * the payload. Concurrency intentionally low (it's diagnostic, not hot
 * path).
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface DebugEchoPayload {
  message: string;
  /** Optional delay (ms) before completing — handy to test queue depth. */
  delay_ms?: number;
  /** Set true to force a throw — exercises retry + DLQ path. */
  force_fail?: boolean;
}

export interface DebugEchoResult {
  echoed: string;
  processed_at: string;
}

@Injectable()
@Processor(QUEUES.DEBUG_ECHO, { concurrency: 5 })
export class DebugEchoProcessor extends BaseProcessor<DebugEchoPayload, DebugEchoResult> {
  constructor(redis: RedisService) {
    super(QUEUES.DEBUG_ECHO, redis);
  }

  async handle(job: Job<DebugEchoPayload, DebugEchoResult>): Promise<DebugEchoResult> {
    const { message, delay_ms, force_fail } = job.data;
    this.logger.log(`debug.echo payload: "${message}"`);
    if (delay_ms && delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay_ms));
    }
    if (force_fail) {
      throw new Error(`debug.echo force_fail for job ${job.id}`);
    }
    return { echoed: message, processed_at: new Date().toISOString() };
  }
}
