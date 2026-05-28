/**
 * ResendEmailProvider — production Resend integration.
 *
 * Dependency note: the official Resend SDK is *not* in apps/api/package.json
 * yet. We hit the REST API directly so the provider compiles in any
 * environment. When the SDK is added later, we can swap the fetch call
 * without touching consumers.
 *
 * Selected via the DI factory only when `RESEND_API_KEY` is set; otherwise
 * the Console provider is used (the dev path).
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../core/config/app-config.service';

import type { EmailProvider, EmailSendInput, EmailSendResult } from './email-provider.interface';

const RESEND_URL = 'https://api.resend.com/emails';

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger('ResendEmailProvider');

  constructor(private readonly config: AppConfigService) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const cfg = this.config.notifications.email;
    if (!cfg.apiKey) {
      throw new Error('ResendEmailProvider: RESEND_API_KEY is not configured');
    }
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          from: cfg.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          ...(input.reply_to ? { reply_to: input.reply_to } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          failure_reason: `Resend ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const id = typeof body['id'] === 'string' ? (body['id'] as string) : undefined;
      return id ? { provider_message_id: id, status: 'queued' } : { status: 'queued' };
    } catch (err) {
      this.logger.error(`Resend send failed: ${(err as Error).message}`);
      return { status: 'failed', failure_reason: (err as Error).message };
    }
  }
}
