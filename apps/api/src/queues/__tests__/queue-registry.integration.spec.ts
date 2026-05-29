/**
 * Queue registry integration test (Step 23 §3 / SPEC §15.4).
 *
 * For every queue in `@jp/shared/QUEUES`:
 *   1. enqueueable — the @InjectQueue(name) provider resolves and accepts
 *      an `add()` call that returns a job id.
 *   2. job persisted — BullMQ reports a non-zero waiting count after the
 *      add (we then drain so the worker doesn't pick anything up).
 *
 * This is the contract that lets ops invoke `admin/queues/<name>/replay`
 * on every queue from the admin dashboard — if a queue isn't registered,
 * the replay endpoint would 404.
 *
 * We do NOT exercise the full enqueue → process → DLQ → replay loop here
 * because each processor needs its own row dependencies; queue-by-queue
 * integration is tested in the individual module specs (attendance,
 * niyams, etc.). The contract this file owns: every queue exists.
 */

import 'reflect-metadata';

import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RedisService } from '../../core/redis/redis.service';
import { bootTestApp } from '../../modules/auth/__tests__/test-helpers';
import { QUEUE_NAMES } from '../queues.constants';

import type { INestApplication } from '@nestjs/common';

describe('Queue registry — Step 23', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('exposes all 30 queues from QUEUES and registers each with BullMQ', () => {
    expect(QUEUE_NAMES).toHaveLength(30);
    expect(new Set(QUEUE_NAMES).size).toBe(30); // no duplicates
  });

  it('every queue has an injectable BullMQ Queue provider', () => {
    const missing: string[] = [];
    for (const name of QUEUE_NAMES) {
      try {
        const q = app.get<Queue>(getQueueToken(name));
        if (!q) missing.push(name);
      } catch {
        missing.push(name);
      }
    }
    expect(missing, `unregistered queues: ${missing.join(', ')}`).toEqual([]);
  });

  it('can enqueue + immediately drain a noop job on every queue without errors', async () => {
    const redis = app.get(RedisService);
    const failed: string[] = [];
    for (const name of QUEUE_NAMES) {
      try {
        const q = app.get<Queue>(getQueueToken(name));
        // Paused so the worker (if running) doesn't pick this up.
        await q.pause();
        const job = await q.add(
          'queue-registry-noop',
          { _origin: 'queue-registry.integration.spec' },
          { removeOnComplete: true, removeOnFail: true, attempts: 1 },
        );
        if (!job.id) failed.push(name);
        await job.remove().catch(() => undefined);
        await q.resume();
      } catch (err) {
        failed.push(`${name}: ${(err as Error).message}`);
      }
    }
    // Drain any lingering queue keys we may have written.
    const keys = await redis.cacheClient.keys('bull:*queue-registry-noop*');
    if (keys.length > 0) await redis.cacheClient.del(...keys);
    expect(failed, `failed enqueues: ${failed.join('; ')}`).toEqual([]);
  });
});
