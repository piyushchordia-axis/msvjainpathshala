/**
 * EmailProvider — abstraction over Resend (or any other transactional
 * email gateway).
 *
 * The notification module's email worker hands a fully-rendered HTML body
 * + plain-text fallback to the provider. Template rendering happens
 * upstream in `email.templates.ts` so swapping the gateway doesn't drag
 * Resend's React Email API along with it.
 */

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional reply-to override; defaults to the configured RESEND_FROM. */
  reply_to?: string;
}

export interface EmailSendResult {
  provider_message_id?: string;
  status: 'queued' | 'failed';
  failure_reason?: string;
}

export interface EmailProvider {
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

export const EMAIL_PROVIDER_TOKEN = Symbol.for('jp.email.provider');
