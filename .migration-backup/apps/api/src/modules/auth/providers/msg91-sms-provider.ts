/**
 * Msg91SmsProvider — production SMS gateway via MSG91.
 *
 * Step 5 ships the interface + a stub that throws on actual send. The full
 * REST integration (MSG91 OTP template flow) lands in Step 12 when the
 * notifications module wires SMS delivery end-to-end. Keeping the
 * provider abstraction now lets the auth module compile against the real
 * surface and switch over by changing the DI binding only.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../core/config/app-config.service';

import type { SmsProvider } from './sms-provider.interface';

@Injectable()
export class Msg91SmsProvider implements SmsProvider {
  private readonly logger = new Logger('Msg91SmsProvider');

  constructor(private readonly config: AppConfigService) {}

  async sendOtp(phone: string, _code: string): Promise<void> {
    // Step 12 implementation:
    //   1. POST to https://control.msg91.com/api/v5/flow/ with template id
    //   2. Map MSG91 error codes → ERR_AUTH_* envelope codes
    //   3. Persist provider_message_id into sms_logs (already in schema)
    this.logger.error(
      `Msg91SmsProvider.sendOtp called but real integration not implemented yet (Step 12). ` +
        `phone=${phone.slice(0, 3)}…${phone.slice(-2)} ` +
        `auth_key_present=${this.config.raw.MSG91_AUTH_KEY ? 'yes' : 'no'}`,
    );
    throw new Error('Msg91SmsProvider: real implementation lands in Step 12');
  }
}
