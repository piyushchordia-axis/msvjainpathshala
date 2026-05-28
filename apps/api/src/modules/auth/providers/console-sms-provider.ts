/**
 * ConsoleSmsProvider — dev-only stub that prints the OTP to stdout so
 * curl-driven workflows can scrape it from the API log.
 *
 * Output format is intentionally machine-greppable:
 *   [OTP] +919876543210 → 123456
 */

import { Injectable, Logger } from '@nestjs/common';

import type { SmsProvider } from './sms-provider.interface';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger('ConsoleSmsProvider');

  async sendOtp(phone: string, code: string): Promise<void> {
    // Single-line, structured for the dev workflow + integration tests.
    this.logger.log(`[OTP] ${phone} → ${code}`);
  }
}
