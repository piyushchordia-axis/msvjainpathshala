/**
 * ConsoleSmsNoticeProvider — dev stub for SMS notice sends.
 *
 * Output format (machine-greppable for smoke tests):
 *
 *   [SMS-NOTICE] +9198…21 "Holiday tomorrow — Mahavir Jayanti…"
 *
 * Phone is partially redacted so the log isn't a PII firehose.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';

import type {
  SmsNoticeProvider,
  SmsNoticeSendInput,
  SmsNoticeSendResult,
} from './sms-notice-provider.interface';

@Injectable()
export class ConsoleSmsNoticeProvider implements SmsNoticeProvider {
  private readonly logger = new Logger('ConsoleSmsNoticeProvider');

  async send(input: SmsNoticeSendInput): Promise<SmsNoticeSendResult> {
    const redacted =
      input.phone.length > 5 ? `${input.phone.slice(0, 3)}…${input.phone.slice(-2)}` : input.phone;
    this.logger.log(`[SMS-NOTICE] ${redacted} ${JSON.stringify(input.body)}`);
    return {
      provider_message_id: `dev-${ulid()}`,
      status: 'queued',
    };
  }
}
