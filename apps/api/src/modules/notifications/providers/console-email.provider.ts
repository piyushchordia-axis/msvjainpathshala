/**
 * ConsoleEmailProvider — dev stub for transactional email.
 *
 * Logs `to`, subject, and a 200-char body excerpt so smoke runs can scrape
 * the dev server for delivery proof:
 *
 *   [EMAIL] to=foo@example.com subject="Donation receipt" excerpt="Dear Anjali, your…"
 */

import { Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';

import type { EmailProvider, EmailSendInput, EmailSendResult } from './email-provider.interface';

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger('ConsoleEmailProvider');

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const excerpt = input.text.replace(/\s+/g, ' ').slice(0, 200);
    this.logger.log(
      `[EMAIL] to=${input.to} subject=${JSON.stringify(input.subject)} excerpt=${JSON.stringify(
        excerpt,
      )}`,
    );
    return {
      provider_message_id: `dev-${ulid()}`,
      status: 'queued',
    };
  }
}
