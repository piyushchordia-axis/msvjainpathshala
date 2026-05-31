/**
 * Razorpay integration — order creation + signature verification.
 *
 * We talk to the Razorpay REST API via plain `axios` so the test suite can
 * stub it without bringing in the official SDK (and the official SDK ships
 * as CJS with awkward types). Two operations:
 *
 *   1. `createOrder()` — POST /v1/orders. Used by `/v1/donations/orders`.
 *   2. `verifyPaymentSignature()` — HMAC-SHA256 of `{order_id}|{payment_id}`
 *       with the key secret, compared timing-safe to the client-submitted
 *       signature.
 *   3. `verifyWebhookSignature()` — HMAC-SHA256 of the raw request body
 *       with the webhook secret, compared timing-safe to the
 *       `x-razorpay-signature` header.
 *
 * The HTTP-client convention for Jain Pathshala is axios across all
 * surfaces (see /Users/sumit/.claude/projects/.../feedback_http_client.md).
 *
 * When no `RAZORPAY_KEY_ID` is configured (dev / test without payment
 * setup), `createOrder()` returns a deterministic stub order id so the
 * rest of the pipeline keeps working.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import { AppConfigService } from '../../core/config/app-config.service';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

const RAZORPAY_BASE_URL = 'https://api.razorpay.com';

@Injectable()
export class RazorpayService {
  private readonly logger = new Logger(RazorpayService.name);
  private readonly http: AxiosInstance;

  constructor(private readonly cfg: AppConfigService) {
    this.http = axios.create({
      baseURL: RAZORPAY_BASE_URL,
      timeout: 10_000,
      // Basic auth: keyId : keySecret. Empty in dev is fine; we short-circuit
      // before calling the network in stub mode.
      auth: {
        username: cfg.razorpay.keyId,
        password: cfg.razorpay.keySecret,
      },
    });
  }

  get isLive(): boolean {
    return Boolean(this.cfg.razorpay.keyId && this.cfg.razorpay.keySecret);
  }

  /**
   * Create a Razorpay order. Returns a stub when not live.
   */
  async createOrder(input: {
    amount_paise: number;
    currency: string;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOrder> {
    if (!this.isLive) {
      const stub: RazorpayOrder = {
        id: `order_stub_${input.receipt}`,
        amount: input.amount_paise,
        currency: input.currency,
        receipt: input.receipt,
        status: 'created',
      };
      this.logger.warn(`razorpay stub mode — returning ${stub.id}`);
      return stub;
    }
    const res = await this.http.post<RazorpayOrder>('/v1/orders', {
      amount: input.amount_paise,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes ?? {},
    });
    return res.data;
  }

  /**
   * Verify the client-side payment signature.
   *
   * Razorpay's docs: `signature = HMAC_SHA256(secret, order_id + "|" + payment_id)`
   * (https://razorpay.com/docs/payments/server-integration/nodejs/integration-steps/#step-5-store-fields-in-database).
   *
   * Constant-time comparison protects against signature-leak timing oracles.
   */
  verifyPaymentSignature(input: {
    order_id: string;
    payment_id: string;
    signature: string;
  }): boolean {
    if (!this.cfg.razorpay.keySecret) {
      // In stub mode accept the literal token "stub" so the test suite has
      // a way through. Never allow this path in production — the env check
      // hits before this code can run.
      return input.signature === 'stub';
    }
    const expected = createHmac('sha256', this.cfg.razorpay.keySecret)
      .update(`${input.order_id}|${input.payment_id}`)
      .digest('hex');
    return this.constantTimeEquals(expected, input.signature);
  }

  /**
   * Verify a Razorpay webhook delivery. Signs the raw body with the
   * webhook secret (separate from the API secret), compares timing-safe.
   *
   * `rawBody` MUST be the unparsed bytes the webhook arrived with — the
   * controller uses a raw-body interceptor to capture this.
   */
  verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string): boolean {
    if (!this.cfg.razorpay.webhookSecret) {
      // Stub mode — accept a fixed dev token (matches verifyPaymentSignature).
      return signatureHeader === 'stub';
    }
    const expected = createHmac('sha256', this.cfg.razorpay.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return this.constantTimeEquals(expected, signatureHeader);
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    try {
      return timingSafeEqual(ab, bb);
    } catch {
      return false;
    }
  }
}
