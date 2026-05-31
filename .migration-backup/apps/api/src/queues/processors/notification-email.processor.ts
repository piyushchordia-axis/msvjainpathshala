/**
 * `notifications.email` — Resend (or ConsoleEmailProvider in dev) per-
 * recipient send. Templates live in `notifications/email.templates.ts`.
 *
 * Worker:
 *   1. Render `{subject, html, text}` from the requested template.
 *   2. Send via the configured EmailProvider.
 *   3. Update `notifications.status` to sent/failed.
 */

import { Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';

import { RedisService } from '../../core/redis/redis.service';
import { NotificationsRepository } from '../../db/repositories';
import { renderEmail } from '../../modules/notifications/email.templates';
import {
  EMAIL_PROVIDER_TOKEN,
  type EmailProvider,
} from '../../modules/notifications/providers/email-provider.interface';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { EmailDeliveryPayload } from '../../modules/notifications/notifications.types';
import type { Job } from 'bullmq';

interface EmailResult {
  status: 'sent' | 'failed';
  provider_message_id?: string;
}

@Injectable()
@Processor(QUEUES.NOTIFICATIONS_EMAIL, { concurrency: 20 })
export class NotificationEmailProcessor extends BaseProcessor<EmailDeliveryPayload, EmailResult> {
  constructor(
    redis: RedisService,
    @Inject(EMAIL_PROVIDER_TOKEN) private readonly email: EmailProvider,
    private readonly notifs: NotificationsRepository,
  ) {
    super(QUEUES.NOTIFICATIONS_EMAIL, redis);
  }

  async handle(job: Job<EmailDeliveryPayload, EmailResult>): Promise<EmailResult> {
    const { to, template, language, data = {}, notification_id } = job.data;
    const rendered = renderEmail(template, language, data);
    const res = await this.email.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    const ok = res.status === 'queued';
    if (notification_id) {
      await this.notifs
        .updateStatus(notification_id, ok ? 'sent' : 'failed')
        .catch(() => undefined);
    }
    if (!ok) {
      throw new Error(`email send failed (provider=${res.failure_reason ?? 'unknown'})`);
    }
    return res.provider_message_id
      ? { status: 'sent', provider_message_id: res.provider_message_id }
      : { status: 'sent' };
  }
}
