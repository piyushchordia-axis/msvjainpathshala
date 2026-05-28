/**
 * `notifications.sms` — MSG91 per-recipient notice send with Devanagari
 * segment math and a monthly spend cap (SPEC §8.7).
 *
 *   1. Compute segments + paise cost from the rendered body.
 *   2. If `bypass_cap` is false, check the current-month spend against the
 *      configured INR cap; reject (and skip retry) when over.
 *   3. Hand the body to the configured `SmsNoticeProvider`.
 *   4. Persist an `sms_logs` row regardless of success/failure so the cap
 *      math sees both.
 *   5. Update `notifications.status` accordingly.
 */

import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';

import { AppConfigService } from '../../core/config/app-config.service';
import { RedisService } from '../../core/redis/redis.service';
import { NotificationsRepository, SmsLogsRepository } from '../../db/repositories';
import {
  SMS_NOTICE_PROVIDER_TOKEN,
  type SmsNoticeProvider,
} from '../../modules/notifications/providers/sms-notice-provider.interface';
import { computeCostPaise, computeSegments } from '../../modules/notifications/sms-segments';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { SmsDeliveryPayload } from '../../modules/notifications/notifications.types';
import type { Job } from 'bullmq';

interface SmsResult {
  status: 'sent' | 'failed' | 'skipped_cap';
  segments: number;
  cost_paise: number;
}

@Injectable()
@Processor(QUEUES.NOTIFICATIONS_SMS, { concurrency: 30 })
export class NotificationSmsProcessor extends BaseProcessor<SmsDeliveryPayload, SmsResult> {
  constructor(
    redis: RedisService,
    @Inject(SMS_NOTICE_PROVIDER_TOKEN) private readonly provider: SmsNoticeProvider,
    private readonly smsLogs: SmsLogsRepository,
    private readonly notifs: NotificationsRepository,
    private readonly config: AppConfigService,
  ) {
    super(QUEUES.NOTIFICATIONS_SMS, redis);
  }

  async handle(job: Job<SmsDeliveryPayload, SmsResult>): Promise<SmsResult> {
    const payload = job.data;
    const segMath = computeSegments(payload.body);
    const cfg = this.config.notifications.sms;
    const costPaise = computeCostPaise(payload.body, cfg.costPerSegmentPaise);

    // Monthly cap check. OTP SMSes flow through `auth.sms.otp` so they
    // never hit this processor; bypass_cap is for critical-ops notices
    // such as "platform down" super_admin broadcasts.
    if (!payload.bypass_cap && cfg.monthlyCapInr > 0) {
      const spentInr = await this.smsLogs.currentMonthSpendInr();
      const projectedInr = spentInr + Math.ceil(costPaise / 100);
      if (projectedInr > cfg.monthlyCapInr) {
        this.logger.warn(
          `monthly SMS cap (${cfg.monthlyCapInr} INR) reached — skipping job ${job.id} (spent=${spentInr}, projected=${projectedInr})`,
        );
        const skipRow = {
          phone: payload.phone,
          body: payload.body,
          status: 'skipped_cap' as const,
          cost_paise: 0,
          sent_at: new Date(),
        };
        try {
          await this.smsLogs.insert({
            ...skipRow,
            ...(payload.source?.kind === 'notice' ? { notice_id: payload.source.id } : {}),
          });
        } catch (err) {
          if (err instanceof Error && err.message.includes('sms_logs_notice_id_notices_id_fk')) {
            await this.smsLogs.insert(skipRow);
          } else {
            throw err;
          }
        }
        if (payload.notification_id) {
          await this.notifs.updateStatus(payload.notification_id, 'failed').catch(() => undefined);
        }
        return { status: 'skipped_cap', segments: segMath.segments, cost_paise: 0 };
      }
    }

    const sendResult = await this.provider.send({ phone: payload.phone, body: payload.body });
    const ok = sendResult.status === 'queued';
    const insertCommon = {
      phone: payload.phone,
      body: payload.body,
      status: ok ? ('queued' as const) : ('failed' as const),
      cost_paise: ok ? costPaise : 0,
      provider_message_id: sendResult.provider_message_id ?? null,
      sent_at: new Date(),
    };
    // sms_logs.notice_id has a FK to notices. If the source isn't a valid
    // notice (e.g. a synthetic id from a smoke test or a deleted notice
    // mid-flight), drop the FK and persist the row anyway — the cap
    // bookkeeping is the important invariant.
    try {
      await this.smsLogs.insert({
        ...insertCommon,
        ...(payload.source?.kind === 'notice' ? { notice_id: payload.source.id } : {}),
      });
    } catch (err) {
      if (err instanceof Error && err.message.includes('sms_logs_notice_id_notices_id_fk')) {
        await this.smsLogs.insert(insertCommon);
      } else {
        throw err;
      }
    }

    if (payload.notification_id) {
      await this.notifs
        .updateStatus(payload.notification_id, ok ? 'sent' : 'failed')
        .catch(() => undefined);
    }
    if (!ok) {
      throw new Error(`sms send failed (provider=${sendResult.failure_reason ?? 'unknown'})`);
    }
    return {
      status: 'sent',
      segments: segMath.segments,
      cost_paise: costPaise,
    };
  }
}
