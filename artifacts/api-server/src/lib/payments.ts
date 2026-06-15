/**
 * Pluggable payment provider for donations.
 * Activates the real Razorpay adapter when RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET
 * are present in env; otherwise falls back to a deterministic mock so the full
 * order -> pay -> verify -> webhook flow is testable with no external account.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CreateOrderInput {
  amount_paise: number;
  currency?: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface CreatedOrder {
  order_id: string;
  amount_paise: number;
  currency: string;
  /** Public key id the client needs to open checkout (mock value in mock mode). */
  key_id: string;
}

export interface PaymentProvider {
  readonly name: "razorpay" | "mock";
  createOrder(input: CreateOrderInput): Promise<CreatedOrder>;
  /** Verify the client-returned checkout signature (HMAC of `${order_id}|${payment_id}`). */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
  /** Verify a webhook payload signature against the raw request body. */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  /**
   * Mock-only helper to compute a valid checkout signature for an order/payment
   * so dev + tests can complete the flow. Undefined on the real adapter.
   */
  mockSignature?(orderId: string, paymentId: string): string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------
const MOCK_SECRET = "mock_razorpay_secret";
const MOCK_WEBHOOK_SECRET = "mock_webhook_secret";
const MOCK_KEY_ID = "rzp_test_mock0000000000";

class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const digest = createHmac("sha256", MOCK_SECRET).update(input.receipt).digest("hex").slice(0, 18);
    return {
      order_id: `order_${digest}`,
      amount_paise: input.amount_paise,
      currency: input.currency ?? "INR",
      key_id: MOCK_KEY_ID,
    };
  }

  mockSignature(orderId: string, paymentId: string): string {
    return createHmac("sha256", MOCK_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    return safeEqual(this.mockSignature(orderId, paymentId), signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const expected = createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  }
}

// ---------------------------------------------------------------------------
// Razorpay adapter
// ---------------------------------------------------------------------------
class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay" as const;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  // Lazily-constructed Razorpay client (dynamic import keeps it out of the hot path).
  private client: unknown;

  constructor(keyId: string, keySecret: string, webhookSecret: string) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.webhookSecret = webhookSecret;
  }

  private async getClient(): Promise<{ orders: { create(opts: Record<string, unknown>): Promise<{ id: string; amount: number; currency: string }> } }> {
    if (!this.client) {
      const mod = (await import("razorpay")) as unknown as { default: new (opts: { key_id: string; key_secret: string }) => unknown };
      const Ctor = mod.default;
      this.client = new Ctor({ key_id: this.keyId, key_secret: this.keySecret });
    }
    return this.client as { orders: { create(opts: Record<string, unknown>): Promise<{ id: string; amount: number; currency: string }> } };
  }

  async createOrder(input: CreateOrderInput): Promise<CreatedOrder> {
    const client = await this.getClient();
    const order = await client.orders.create({
      amount: input.amount_paise,
      currency: input.currency ?? "INR",
      receipt: input.receipt,
      notes: input.notes ?? {},
    });
    return {
      order_id: order.id,
      amount_paise: Number(order.amount),
      currency: order.currency,
      key_id: this.keyId,
    };
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = createHmac("sha256", this.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    return safeEqual(expected, signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!this.webhookSecret) return false;
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  }
}

// ---------------------------------------------------------------------------
// Factory (singleton)
// ---------------------------------------------------------------------------
function build(): PaymentProvider {
  const keyId = process.env["RAZORPAY_KEY_ID"];
  const keySecret = process.env["RAZORPAY_KEY_SECRET"];
  const webhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"] ?? "";
  if (keyId && keySecret) {
    return new RazorpayPaymentProvider(keyId, keySecret, webhookSecret);
  }
  // The mock provider's signing secrets are public constants in this file —
  // it must never serve a production deployment. Fail fast instead of silently
  // running an insecure, forgeable payment surface.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are required in production; refusing to start with the mock payment provider.",
    );
  }
  return new MockPaymentProvider();
}

export const payments: PaymentProvider = build();
