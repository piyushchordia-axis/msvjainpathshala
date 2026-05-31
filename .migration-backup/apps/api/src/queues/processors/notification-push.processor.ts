/**
 * `notifications.push` — FCM batched send via the configured PushProvider.
 *
 * Per-recipient job semantics:
 *   - Each fanout produces one push job per recipient with their device
 *     token list. The provider batches at ≤ 500 tokens per multicast
 *     internally (SPEC §17.4) — but a single user usually has 1–3
 *     devices so we get the batching benefit when many users are pushed
 *     simultaneously and the provider implementation aggregates across
 *     jobs in production (Step 13+ optimisation).
 *
 *   - Tokens FCM reports as unregistered/invalid are revoked from
 *     `device_tokens` so the next push doesn't waste work on them.
 *
 *   - Transient failures bubble up as `throw new Error(...)` so BullMQ's
 *     retry kicks in. After the final attempt BaseProcessor moves the
 *     job to `.dlq`.
 */

import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';
import { DeviceTokensRepository, NotificationsRepository } from '../../db/repositories';
import {
  PUSH_PROVIDER_TOKEN,
  type PushProvider,
} from '../../modules/notifications/providers/push-provider.interface';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { PushDeliveryPayload } from '../../modules/notifications/notifications.types';
import type { Job } from 'bullmq';

interface PushResult {
  success: number;
  invalidated: number;
  transient_failures: number;
}

@Injectable()
@Processor(QUEUES.NOTIFICATIONS_PUSH, { concurrency: 100 })
export class NotificationPushProcessor extends BaseProcessor<PushDeliveryPayload, PushResult> {
  constructor(
    redis: RedisService,
    @Inject(PUSH_PROVIDER_TOKEN) private readonly push: PushProvider,
    private readonly deviceTokens: DeviceTokensRepository,
    private readonly notifs: NotificationsRepository,
  ) {
    super(QUEUES.NOTIFICATIONS_PUSH, redis);
  }

  async handle(job: Job<PushDeliveryPayload, PushResult>): Promise<PushResult> {
    const { tokens, title, body, data, notification_id, user_id } = job.data;
    if (tokens.length === 0) {
      this.logger.warn(`job ${job.id} → user=${user_id} has no tokens, skipping`);
      return { success: 0, invalidated: 0, transient_failures: 0 };
    }

    // FCM data payload must be string-string. Stringify everything carried
    // through `data` so the platform doesn't reject the payload.
    const stringData: Record<string, string> = {};
    if (data) {
      for (const [k, v] of Object.entries(data)) {
        stringData[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
    }
    if (notification_id) stringData.notification_id = notification_id;

    const result = await this.push.send({
      tokens,
      title,
      body,
      ...(Object.keys(stringData).length > 0 ? { data: stringData } : {}),
    });

    // Revoke invalid tokens so the next fan-out doesn't include them.
    if (result.invalid_tokens.length > 0) {
      await this.deviceTokens.revokeManyByToken(result.invalid_tokens);
    }

    if (notification_id) {
      const status =
        result.success > 0 ? 'sent' : result.transient_failures.length > 0 ? 'pending' : 'failed';
      await this.notifs.updateStatus(notification_id, status).catch(() => undefined);
    }

    // If every token errored transiently, throw to trigger BullMQ retry.
    if (result.success === 0 && result.transient_failures.length > 0) {
      throw new Error(
        `push transient failure for user=${user_id} (tokens=${tokens.length}, transient=${result.transient_failures.length})`,
      );
    }

    return {
      success: result.success,
      invalidated: result.invalid_tokens.length,
      transient_failures: result.transient_failures.length,
    };
  }
}
