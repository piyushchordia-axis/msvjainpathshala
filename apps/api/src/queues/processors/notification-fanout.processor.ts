/**
 * `notifications.fanout` — resolves recipients, writes in-app rows, and
 * splits the work across the per-channel queues (push / sms / email).
 *
 * Per-recipient retry isolation matters here: SPEC §2.5 says we enqueue
 * one job per recipient per channel, so a transient FCM failure for one
 * device doesn't reset the whole fan-out.
 *
 * Concurrency: 20 (SPEC §9.2). FCM batching happens *inside* the push
 * worker — fanout enqueues one push job per recipient and the push
 * worker batches the 500-token multicast across all jobs it pulls.
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { inArray, isNull, and } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import { DeviceTokensRepository, NotificationsRepository } from '../../db/repositories';
import { users } from '../../db/schema';
import { RecipientResolver } from '../../modules/notifications/notifications.recipients';
import { pickContent, renderTemplate } from '../../modules/notifications/notifications.templates';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type {
  EmailDeliveryPayload,
  NotificationFanoutPayload,
  PushDeliveryPayload,
  SmsDeliveryPayload,
} from '../../modules/notifications/notifications.types';

type UserRow = {
  id: string;
  phone: string;
  email: string | null;
  preferred_language: 'en' | 'hi';
  notification_preferences: {
    push: boolean;
    sms: boolean;
    email: boolean;
    in_app: boolean;
  };
};

interface FanoutResult {
  total_recipients: number;
  in_app: number;
  push: number;
  sms: number;
  email: number;
}

@Injectable()
@Processor(QUEUES.NOTIFICATIONS_FANOUT, { concurrency: 20 })
export class NotificationFanoutProcessor extends BaseProcessor<
  NotificationFanoutPayload,
  FanoutResult
> {
  protected readonly fanoutLogger = new Logger('Worker:notifications.fanout');

  constructor(
    redis: RedisService,
    private readonly drizzle: DrizzleService,
    private readonly recipients: RecipientResolver,
    private readonly notifsRepo: NotificationsRepository,
    private readonly deviceTokensRepo: DeviceTokensRepository,
    @InjectQueue(QUEUES.NOTIFICATIONS_PUSH) private readonly pushQueue: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS_SMS) private readonly smsQueue: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS_EMAIL) private readonly emailQueue: Queue,
  ) {
    super(QUEUES.NOTIFICATIONS_FANOUT, redis);
  }

  async handle(job: Job<NotificationFanoutPayload, FanoutResult>): Promise<FanoutResult> {
    const payload = job.data;
    const userIds = await this.resolveRecipients(payload);
    if (userIds.length === 0) {
      this.logger.log(`event=${payload.event} produced 0 recipients`);
      return { total_recipients: 0, in_app: 0, push: 0, sms: 0, email: 0 };
    }

    const userRows = await this.fetchUsers(userIds);
    const content = renderTemplate(payload.event, payload.data ?? {});
    const isCritical = payload.is_critical === true;
    const sendSms = payload.send_sms === true || isCritical;

    // 1. Insert one in-app row per recipient whose `in_app` channel is on.
    const inAppRows = userRows
      .filter((u) => u.notification_preferences.in_app !== false)
      .map((u) => ({
        user_id: u.id,
        kind: payload.event,
        title_en: content.title_en,
        title_hi: content.title_hi,
        body_en: content.body_en,
        body_hi: content.body_hi,
        data: {
          ...(payload.data ?? {}),
          ...(payload.deep_link ? { deep_link: payload.deep_link } : {}),
        },
        is_read: false,
        channel: 'in_app' as const,
        status: 'delivered' as const,
        ...(payload.source
          ? { source_entity_kind: payload.source.kind, source_entity_id: payload.source.id }
          : {}),
      }));
    const inserted = await this.notifsRepo.insertMany(inAppRows);

    // 2. Enqueue push jobs for recipients with push channel ON.
    const pushUsers = userRows.filter((u) => u.notification_preferences.push !== false);
    let pushEnqueued = 0;
    if (pushUsers.length > 0) {
      const tokens = await this.deviceTokensRepo.listActiveForUsers(pushUsers.map((u) => u.id));
      const byUser = new Map<string, string[]>();
      for (const t of tokens) {
        if (!byUser.has(t.user_id)) byUser.set(t.user_id, []);
        byUser.get(t.user_id)!.push(t.token);
      }
      for (const u of pushUsers) {
        const userTokens = byUser.get(u.id) ?? [];
        if (userTokens.length === 0) continue;
        const c = pickContent(content, u.preferred_language);
        const matched = inserted.find((row) => row.user_id === u.id);
        const job: PushDeliveryPayload = {
          notification_id: matched?.id ?? '',
          user_id: u.id,
          tokens: userTokens,
          title: c.title,
          body: c.body,
          language: u.preferred_language,
          data: payload.data as Record<string, unknown> | undefined,
          ...(payload.deep_link ? { deep_link: payload.deep_link } : {}),
        };
        await this.pushQueue.add(payload.event, job);
        pushEnqueued += 1;
      }
    }

    // 3. SMS — only when sendSms is true AND the recipient opted in.
    let smsEnqueued = 0;
    if (sendSms) {
      const smsUsers = userRows.filter((u) => u.notification_preferences.sms !== false);
      for (const u of smsUsers) {
        const c = pickContent(content, u.preferred_language);
        const matched = inserted.find((row) => row.user_id === u.id);
        const smsPayload: SmsDeliveryPayload = {
          ...(matched?.id ? { notification_id: matched.id } : {}),
          user_id: u.id,
          phone: u.phone,
          // Compact body: prefer the body, fall back to title.
          body: c.body || c.title,
          language: u.preferred_language,
          ...(payload.source ? { source: payload.source } : {}),
        };
        await this.smsQueue.add(payload.event, smsPayload);
        smsEnqueued += 1;
      }
    }

    // 4. Email — only when channel ON and recipient has an email.
    let emailEnqueued = 0;
    const emailTemplate = this.pickEmailTemplate(payload.event);
    if (emailTemplate) {
      const emailUsers = userRows.filter(
        (u) => u.notification_preferences.email !== false && u.email,
      );
      for (const u of emailUsers) {
        const c = pickContent(content, u.preferred_language);
        const matched = inserted.find((row) => row.user_id === u.id);
        const emailPayload: EmailDeliveryPayload = {
          ...(matched?.id ? { notification_id: matched.id } : {}),
          user_id: u.id,
          to: u.email!,
          template: emailTemplate,
          subject: c.title,
          language: u.preferred_language,
          data: payload.data,
        };
        await this.emailQueue.add(payload.event, emailPayload);
        emailEnqueued += 1;
      }
    }

    this.logger.log(
      `event=${payload.event} recipients=${userIds.length} in_app=${inserted.length} push=${pushEnqueued} sms=${smsEnqueued} email=${emailEnqueued}`,
    );

    return {
      total_recipients: userIds.length,
      in_app: inserted.length,
      push: pushEnqueued,
      sms: smsEnqueued,
      email: emailEnqueued,
    };
  }

  private async resolveRecipients(payload: NotificationFanoutPayload): Promise<string[]> {
    if (payload.recipient_user_ids && payload.recipient_user_ids.length > 0) {
      return Array.from(new Set(payload.recipient_user_ids));
    }
    if (!payload.scope) return [];
    return this.recipients.resolve(payload.scope);
  }

  private async fetchUsers(userIds: string[]): Promise<UserRow[]> {
    const rows = await this.drizzle.dbRead
      .select({
        id: users.id,
        phone: users.phone,
        email: users.email,
        preferred_language: users.preferred_language,
        notification_preferences: users.notification_preferences,
      })
      .from(users)
      .where(and(inArray(users.id, userIds), isNull(users.deleted_at)));
    return rows.map((r) => ({
      id: r.id,
      phone: r.phone,
      email: r.email,
      preferred_language: r.preferred_language,
      notification_preferences: r.notification_preferences ?? {
        push: true,
        sms: true,
        email: true,
        in_app: true,
      },
    }));
  }

  private pickEmailTemplate(
    event: NotificationFanoutPayload['event'],
  ): EmailDeliveryPayload['template'] | null {
    switch (event) {
      case 'enrolment.approved':
        return 'enrolment-approved';
      case 'donation.receipt_ready':
        return 'donation-receipt';
      case 'idcard.ready':
        // No dedicated template — generic email keeps the user in the loop
        // but the main surface is push + in-app.
        return null;
      default:
        return null;
    }
  }
}

// Drizzle helper imports — kept at file bottom to keep the top of the file
// focused on the processor surface.

// Silence the "unused interface" lint when Inject isn't directly used.
void Inject;
