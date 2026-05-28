/**
 * PushProvider — abstraction over FCM (or any other push gateway).
 *
 * Implementations:
 *   - `ConsolePushProvider` — dev stub: logs to stdout, never calls FCM.
 *   - `FcmPushProvider`     — production: firebase-admin sendEachForMulticast
 *      (lands when credentials are configured; we ship a stub that fails
 *      loud if invoked without `FCM_SERVICE_ACCOUNT_JSON`).
 *
 * Result semantics:
 *   - `success`: tokens for which FCM returned a non-error.
 *   - `invalid_tokens`: tokens FCM said are unknown / unregistered —
 *      the worker revokes these from `device_tokens`.
 *   - `transient_failures`: tokens that errored but might succeed on
 *      retry. The worker bumps `attemptsMade` and BullMQ does its
 *      exponential backoff. After the final attempt, BaseProcessor
 *      moves the job to the DLQ.
 */

export interface PushSendInput {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface PushSendResult {
  attempted: number;
  success: number;
  invalid_tokens: string[];
  transient_failures: string[];
}

export interface PushProvider {
  /**
   * Send `title`/`body` to every token in batches of up to 500. The push
   * worker treats this method as best-effort and inspects the result for
   * cleanup.
   */
  send(input: PushSendInput): Promise<PushSendResult>;
}

export const PUSH_PROVIDER_TOKEN = Symbol.for('jp.push.provider');
