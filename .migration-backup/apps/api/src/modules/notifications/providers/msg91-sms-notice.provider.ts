/**
 * Msg91SmsNoticeProvider — production MSG91 notice integration.
 *
 * Different endpoint from the OTP template flow: we call
 * `POST https://control.msg91.com/api/v5/flow/` with the configured
 * `MSG91_NOTICE_TEMPLATE_ID` and a `var` carrying the rendered body.
 *
 * Step 12 ships this provider behind a configuration gate — it's selected
 * by the DI factory only when `MSG91_AUTH_KEY` AND
 * `MSG91_NOTICE_TEMPLATE_ID` are both set, otherwise the Console provider
 * keeps logging in dev. The factory in `notifications.module.ts` enforces
 * this.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../core/config/app-config.service';

import type {
  SmsNoticeProvider,
  SmsNoticeSendInput,
  SmsNoticeSendResult,
} from './sms-notice-provider.interface';

const MSG91_FLOW_URL = 'https://control.msg91.com/api/v5/flow/';

@Injectable()
export class Msg91SmsNoticeProvider implements SmsNoticeProvider {
  private readonly logger = new Logger('Msg91SmsNoticeProvider');

  constructor(private readonly config: AppConfigService) {}

  async send(input: SmsNoticeSendInput): Promise<SmsNoticeSendResult> {
    const sms = this.config.notifications.sms;
    if (!sms.authKey || !sms.noticeTemplateId) {
      throw new Error(
        'Msg91SmsNoticeProvider: MSG91_AUTH_KEY and MSG91_NOTICE_TEMPLATE_ID are both required',
      );
    }
    try {
      const res = await fetch(MSG91_FLOW_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authkey: sms.authKey,
        },
        body: JSON.stringify({
          template_id: sms.noticeTemplateId,
          sender: sms.senderId,
          short_url: '0',
          mobiles: input.phone.replace(/^\+/, ''),
          VAR1: input.body,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          failure_reason: `MSG91 ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const providerMessageId =
        typeof body['request_id'] === 'string'
          ? (body['request_id'] as string)
          : typeof body['data'] === 'object' && body['data'] !== null
            ? String((body['data'] as Record<string, unknown>)['id'] ?? '')
            : '';
      return {
        provider_message_id: providerMessageId || undefined,
        status: 'queued',
      };
    } catch (err) {
      this.logger.error(`MSG91 notice send failed: ${(err as Error).message}`);
      return { status: 'failed', failure_reason: (err as Error).message };
    }
  }
}
