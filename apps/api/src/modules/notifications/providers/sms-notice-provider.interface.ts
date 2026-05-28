/**
 * SmsNoticeProvider — abstraction for SMS *notice* sends (not OTP — that's
 * already abstracted in modules/auth/providers/sms-provider.interface.ts).
 *
 * The split keeps OTP sends — which use MSG91's strict OTP template flow
 * with a single 6-digit variable — separate from broadcast notice sends
 * which carry user-generated content under a DLT-approved notice template.
 *
 * Implementations:
 *   - `ConsoleSmsNoticeProvider` — dev stub, logs to stdout.
 *   - `Msg91SmsNoticeProvider`   — production, MSG91 REST API.
 */

export interface SmsNoticeSendInput {
  phone: string;
  body: string;
}

export interface SmsNoticeSendResult {
  provider_message_id?: string;
  status: 'queued' | 'failed';
  failure_reason?: string;
}

export interface SmsNoticeProvider {
  send(input: SmsNoticeSendInput): Promise<SmsNoticeSendResult>;
}

export const SMS_NOTICE_PROVIDER_TOKEN = Symbol.for('jp.sms.notice.provider');
