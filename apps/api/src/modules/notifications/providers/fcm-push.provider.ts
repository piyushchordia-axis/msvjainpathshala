/**
 * FcmPushProvider — production FCM integration via firebase-admin.
 *
 * Dependency note: `firebase-admin` is *not* listed in apps/api/package.json
 * yet. The provider therefore loads the SDK dynamically — `dyn-import` keeps
 * the module compiling in environments where firebase-admin isn't installed
 * (dev/test) and only blows up at call time if FCM is selected without the
 * SDK in node_modules. This mirrors the Puppeteer pattern in Step 11.
 *
 * Activation rule: the DI factory in `notifications.module.ts` picks this
 * provider only when `FCM_SERVICE_ACCOUNT_JSON` is non-empty AND parseable
 * as JSON. Otherwise the ConsolePushProvider is used. So a fresh checkout
 * never tries to dynamic-import firebase-admin.
 *
 * Batching: SPEC §17.4 — 500 tokens per `sendEachForMulticast`.
 */

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../../core/config/app-config.service';

import { FCM_BATCH_MAX } from './fcm-constants';

import type { PushProvider, PushSendInput, PushSendResult } from './push-provider.interface';

// Structural shape we use from firebase-admin without importing the package.
type FcmMessaging = {
  sendEachForMulticast: (msg: {
    tokens: string[];
    notification: { title: string; body: string };
    data?: Record<string, string>;
  }) => Promise<{
    responses: Array<{
      success: boolean;
      error?: { code?: string; message?: string };
    }>;
    successCount: number;
    failureCount: number;
  }>;
};

@Injectable()
export class FcmPushProvider implements PushProvider {
  private readonly logger = new Logger('FcmPushProvider');
  private messaging: FcmMessaging | null = null;

  constructor(private readonly config: AppConfigService) {}

  private async getMessaging(): Promise<FcmMessaging> {
    if (this.messaging) return this.messaging;
    const raw = this.config.notifications.fcm.serviceAccountJson;
    if (!raw) {
      throw new Error('FcmPushProvider: FCM_SERVICE_ACCOUNT_JSON is not configured');
    }
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `FcmPushProvider: FCM_SERVICE_ACCOUNT_JSON is not valid JSON (${(err as Error).message})`,
      );
    }
    // Lazy import so dev / test boots without firebase-admin installed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ 'firebase-admin' as string).catch(
      (e: Error) => {
        throw new Error(
          `FcmPushProvider: firebase-admin not installed (${e.message}). Install it before enabling FCM.`,
        );
      },
    );
    const app =
      mod.apps && mod.apps.length > 0
        ? mod.app()
        : mod.initializeApp({ credential: mod.credential.cert(credentials) });
    this.messaging = app.messaging() as FcmMessaging;
    return this.messaging;
  }

  async send(input: PushSendInput): Promise<PushSendResult> {
    const messaging = await this.getMessaging();
    const invalid: string[] = [];
    const transient: string[] = [];
    let success = 0;

    for (let i = 0; i < input.tokens.length; i += FCM_BATCH_MAX) {
      const slice = input.tokens.slice(i, i + FCM_BATCH_MAX);
      const resp = await messaging.sendEachForMulticast({
        tokens: slice,
        notification: { title: input.title, body: input.body },
        ...(input.data ? { data: input.data } : {}),
      });
      success += resp.successCount;
      resp.responses.forEach((r, idx) => {
        if (r.success) return;
        const code = r.error?.code ?? '';
        const token = slice[idx]!;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          invalid.push(token);
        } else {
          transient.push(token);
        }
      });
    }

    if (transient.length > 0) {
      this.logger.warn(
        `FCM transient failures: ${transient.length} of ${input.tokens.length} tokens`,
      );
    }

    return {
      attempted: input.tokens.length,
      success,
      invalid_tokens: invalid,
      transient_failures: transient,
    };
  }
}
