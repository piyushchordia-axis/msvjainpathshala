/**
 * SmsProvider — abstraction over the SMS gateway.
 *
 * Implementations:
 *   - `ConsoleSmsProvider` — dev / test (logs to stdout)
 *   - `Msg91SmsProvider`   — prod (stubbed in Step 5; real call lands in Step 12)
 *
 * DI selection (see auth.module.ts): if `MSG91_AUTH_KEY` is set we use the
 * Msg91 provider; otherwise the Console provider.
 */

export interface SmsProvider {
  /**
   * Send an OTP to the given phone. Implementations should be tolerant of
   * downstream failures (queue + retry) — the caller (OtpService) does not
   * expect a particular delivery guarantee.
   */
  sendOtp(phone: string, code: string): Promise<void>;
}

export const SMS_PROVIDER_TOKEN = Symbol.for('jp.sms.provider');
