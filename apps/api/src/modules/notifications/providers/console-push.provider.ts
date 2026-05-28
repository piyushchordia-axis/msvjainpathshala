/**
 * ConsolePushProvider — dev-only stub.
 *
 * Logs every push as a machine-greppable line so smoke scripts can
 * scrape the dev server output to verify the fanout pipeline:
 *
 *   [PUSH] tokens=2 title="Enrolment approved" body="…"
 *
 * Always treats every token as a successful send and returns no
 * invalid tokens — that way the dev worker can confirm the happy
 * path without external services.
 */

import { Injectable, Logger } from '@nestjs/common';

import { FCM_BATCH_MAX } from './fcm-constants';

import type { PushProvider, PushSendInput, PushSendResult } from './push-provider.interface';

@Injectable()
export class ConsolePushProvider implements PushProvider {
  private readonly logger = new Logger('ConsolePushProvider');

  async send(input: PushSendInput): Promise<PushSendResult> {
    let total = 0;
    for (let i = 0; i < input.tokens.length; i += FCM_BATCH_MAX) {
      const slice = input.tokens.slice(i, i + FCM_BATCH_MAX);
      this.logger.log(
        `[PUSH] tokens=${slice.length} title=${JSON.stringify(input.title)} body=${JSON.stringify(
          input.body,
        )}`,
      );
      total += slice.length;
    }
    return {
      attempted: input.tokens.length,
      success: total,
      invalid_tokens: [],
      transient_failures: [],
    };
  }
}
