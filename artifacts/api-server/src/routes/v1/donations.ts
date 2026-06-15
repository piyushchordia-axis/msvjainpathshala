/**
 * /v1/donations — public donation flow behind the pluggable payment provider.
 *
 * Per-route auth: every endpoint here is PUBLIC (no auth middleware). The flow is
 * order -> (client checkout) -> verify, with a webhook fallback and a mock-only
 * dev-capture convenience so the demo works without a real Razorpay account.
 *
 * Money is in paise. Captures are idempotent: re-verifying / re-webhooking an
 * already-captured donation does NOT double-increment a campaign's raised total.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, donations, donation_campaigns } from "@workspace/db";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { payments } from "../../lib/payments";

const router: IRouter = Router();
// NOTE: no router.use(requireAuth) — this surface is entirely public.

/** Indian financial year (Apr–Mar) for a given date, e.g. 2025 -> "2025-26". */
function financialYearFor(d: Date): string {
  const y = d.getFullYear();
  // FY starts in April; Jan–Mar belong to the previous year's FY.
  const startYear = d.getMonth() >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
}

/** Receipt number from the captured donation id + FY, e.g. "JP-2025-26-AB12CD34". */
function receiptNumberFor(donationId: string, fy: string): string {
  return `JP-${fy}-${donationId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/* GET /v1/donations/campaigns — public campaigns only */
router.get("/campaigns", async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      id: donation_campaigns.id,
      name: donation_campaigns.name,
      description: donation_campaigns.description,
      target_amount_paise: donation_campaigns.target_amount_paise,
      raised_amount_paise: donation_campaigns.raised_amount_paise,
      created_at: donation_campaigns.created_at,
    })
    .from(donation_campaigns)
    .where(eq(donation_campaigns.is_public, true))
    .orderBy(desc(donation_campaigns.created_at));
  const items = rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() }));
  ok(res, { items }, { count: items.length });
});

/* ---- POST /v1/donations/order — create a donation + payment order ---- */
const createOrderSchema = z.object({
  amount_paise: z.coerce.number().int().min(100).max(100_000_000),
  donor_name: z.string().min(1).max(200),
  donor_phone: z.string().min(4).max(15).optional(),
  donor_email: z.string().email().max(255).optional(),
  purpose: z.string().min(1).max(200).optional(),
  campaign_id: z.string().uuid().optional(),
});

router.post("/order", async (req: Request, res: Response) => {
  let body: z.infer<typeof createOrderSchema>;
  try {
    body = createOrderSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid donation data.");
    return;
  }

  // If a campaign was named, it must exist and be public (never trust the id).
  if (body.campaign_id) {
    const [camp] = await db
      .select({ id: donation_campaigns.id })
      .from(donation_campaigns)
      .where(
        and(
          eq(donation_campaigns.id, body.campaign_id),
          eq(donation_campaigns.is_public, true),
        ),
      )
      .limit(1);
    if (!camp) {
      fail(res, 404, "ERR_NOT_FOUND", "Campaign not found.");
      return;
    }
  }

  const [donation] = await db
    .insert(donations)
    .values({
      donor_name: body.donor_name,
      donor_phone: body.donor_phone ?? null,
      donor_email: body.donor_email ?? null,
      amount_paise: body.amount_paise,
      purpose: body.purpose ?? "general",
      campaign_id: body.campaign_id ?? null,
      frequency: "one_time",
      status: "created",
      payment_status: "created",
    })
    .returning({ id: donations.id });

  const order = await payments.createOrder({
    amount_paise: body.amount_paise,
    receipt: donation.id,
    notes: { donation_id: donation.id, purpose: body.purpose ?? "general" },
  });

  await db
    .update(donations)
    .set({ razorpay_order_id: order.order_id, payment_status: "pending" })
    .where(eq(donations.id, donation.id));

  ok(res, {
    donation_id: donation.id,
    order_id: order.order_id,
    key_id: order.key_id,
    amount_paise: order.amount_paise,
    currency: order.currency,
    provider: payments.name,
  });
});

/**
 * Mark a donation captured once. Idempotent: if it is already captured this is a
 * no-op that returns the existing receipt without re-incrementing the campaign.
 * Returns the receipt_number, or null if the donation row could not be found.
 */
async function captureDonation(
  donationId: string,
  paymentId: string | null,
  signature: string | null,
): Promise<string | null> {
  // Wrap the whole capture in one transaction. A per-donation advisory xact lock
  // serializes concurrent capturers (e.g. /verify racing /webhook) so the
  // conditional status flip and the campaign increment can never interleave.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${donationId}::text, 0))`);

    const [donation] = await tx
      .select({
        id: donations.id,
        amount_paise: donations.amount_paise,
        campaign_id: donations.campaign_id,
      })
      .from(donations)
      .where(eq(donations.id, donationId))
      .limit(1);
    if (!donation) return null;

    const now = new Date();
    const fy = financialYearFor(now);
    const receiptNumber = receiptNumberFor(donation.id, fy);

    // Conditional claim: only the caller that flips payment_status away from
    // "captured" gets a returned row and is responsible for the campaign credit.
    const claimed = await tx
      .update(donations)
      .set({
        payment_status: "captured",
        status: "captured",
        razorpay_payment_id: paymentId,
        razorpay_signature: signature,
        payment_captured_at: now,
        receipt_number: receiptNumber,
        financial_year: fy,
        eighty_g_eligible: true,
      })
      .where(and(eq(donations.id, donation.id), ne(donations.payment_status, "captured")))
      .returning({ receipt_number: donations.receipt_number });

    // Lost the race / already captured: idempotent success, return existing receipt.
    if (claimed.length === 0) {
      const [existing] = await tx
        .select({ receipt_number: donations.receipt_number })
        .from(donations)
        .where(eq(donations.id, donation.id))
        .limit(1);
      return existing?.receipt_number ?? null;
    }

    // We won the transition: credit the campaign exactly once.
    if (donation.campaign_id) {
      await tx
        .update(donation_campaigns)
        .set({
          raised_amount_paise: sql`${donation_campaigns.raised_amount_paise} + ${donation.amount_paise}`,
        })
        .where(eq(donation_campaigns.id, donation.campaign_id));
    }

    return claimed[0].receipt_number;
  });
}

/* ---- POST /v1/donations/verify — confirm checkout signature, capture ---- */
const verifySchema = z.object({
  donation_id: z.string().uuid(),
  razorpay_order_id: z.string().min(1).max(200),
  razorpay_payment_id: z.string().min(1).max(200),
  razorpay_signature: z.string().min(1).max(500),
});

router.post("/verify", async (req: Request, res: Response) => {
  let body: z.infer<typeof verifySchema>;
  try {
    body = verifySchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid verification data.");
    return;
  }

  const [donation] = await db
    .select({
      id: donations.id,
      razorpay_order_id: donations.razorpay_order_id,
      amount_paise: donations.amount_paise,
      payment_status: donations.payment_status,
      receipt_number: donations.receipt_number,
    })
    .from(donations)
    .where(eq(donations.id, body.donation_id))
    .limit(1);
  if (!donation) {
    fail(res, 404, "ERR_NOT_FOUND", "Donation not found.");
    return;
  }

  // The order id the client returns must match the one we stored for this donation.
  if (!donation.razorpay_order_id || donation.razorpay_order_id !== body.razorpay_order_id) {
    fail(res, 400, "ERR_ORDER_MISMATCH", "Order id does not match this donation.");
    return;
  }

  // Already captured (e.g. webhook beat the client): return existing receipt.
  if (donation.payment_status === "captured") {
    ok(res, { status: "captured", receipt_number: donation.receipt_number });
    return;
  }

  const valid = payments.verifyPaymentSignature(
    body.razorpay_order_id,
    body.razorpay_payment_id,
    body.razorpay_signature,
  );
  if (!valid) {
    fail(res, 401, "ERR_SIGNATURE_INVALID", "Payment signature is invalid.");
    return;
  }

  // Reconcile with the gateway before issuing a receipt: a valid signature only
  // proves the order/payment-id pair is authentic, NOT that the money was
  // captured at the recorded amount (it could be authorized-only/partial/
  // refunded). The real adapter implements fetchPayment; the mock omits it.
  if (payments.fetchPayment) {
    let gw;
    try {
      gw = await payments.fetchPayment(body.razorpay_payment_id);
    } catch {
      fail(res, 502, "ERR_GATEWAY", "Could not reach the payment gateway.");
      return;
    }
    if (
      gw.status !== "captured" ||
      gw.order_id !== donation.razorpay_order_id ||
      gw.amount_paise !== donation.amount_paise
    ) {
      fail(res, 402, "ERR_PAYMENT_NOT_CAPTURED", "Payment could not be reconciled with the gateway.");
      return;
    }
  }

  const receiptNumber = await captureDonation(
    donation.id,
    body.razorpay_payment_id,
    body.razorpay_signature,
  );
  ok(res, { status: "captured", receipt_number: receiptNumber });
});

/* ---- POST /v1/donations/webhook — provider-driven capture (idempotent) ---- */
/**
 * Razorpay webhook. We verify the HMAC over the RAW body, then on a capture-style
 * event mark the matching donation captured. We always return 200 {received:true}
 * for a valid signature (even if the donation was already processed) so the
 * provider stops retrying; only a bad/missing signature yields 400.
 */
router.post("/webhook", async (req: Request, res: Response) => {
  const signature = req.header("x-razorpay-signature") ?? "";
  // Verify the EXACT bytes that were signed. Reconstructing the body via
  // JSON.stringify would defeat the signature (key ordering/whitespace) and is
  // a forgeable surface, so fail closed if the raw bytes weren't captured.
  const rawBody = req.rawBody;
  if (!rawBody) {
    fail(res, 400, "ERR_SIGNATURE_INVALID", "Invalid webhook payload.");
    return;
  }

  if (!signature || !payments.verifyWebhookSignature(rawBody, signature)) {
    fail(res, 400, "ERR_SIGNATURE_INVALID", "Invalid webhook signature.");
    return;
  }

  // Parse the event defensively — a verified-but-unexpected shape is still a 200.
  const event = (req.body ?? {}) as {
    event?: string;
    payload?: {
      payment?: {
        entity?: { order_id?: string; id?: string; amount?: number; status?: string };
      };
    };
  };

  if (event.event === "payment.captured") {
    const entity = event.payload?.payment?.entity;
    const orderId = entity?.order_id;
    const paymentId = entity?.id ?? null;
    if (orderId) {
      const [donation] = await db
        .select({ id: donations.id, amount_paise: donations.amount_paise })
        .from(donations)
        .where(eq(donations.razorpay_order_id, orderId))
        .limit(1);
      // The webhook body is HMAC-verified, so the entity is authentic — but
      // still assert the captured amount/status before crediting a receipt.
      if (
        donation &&
        entity?.status === "captured" &&
        Number(entity?.amount) === donation.amount_paise
      ) {
        // Idempotent inside captureDonation (guards on payment_status).
        await captureDonation(donation.id, paymentId, null);
      }
    }
  }

  ok(res, { received: true });
});

/* ---- POST /v1/donations/:id/dev-capture — MOCK-ONLY demo convenience ---- */
/**
 * Marks a created donation captured without a real checkout. Returns 404 on the
 * real Razorpay adapter so it can never be used in production.
 */
router.post("/:id/dev-capture", async (req: Request, res: Response) => {
  // Defense in depth: this fabricates a captured donation with no payment, so
  // it must be impossible to reach in production regardless of provider state.
  if (process.env.NODE_ENV === "production" || payments.name !== "mock") {
    fail(res, 404, "ERR_NOT_FOUND", "Not found.");
    return;
  }
  const id = String(req.params.id);
  const [donation] = await db
    .select({ id: donations.id })
    .from(donations)
    .where(eq(donations.id, id))
    .limit(1);
  if (!donation) {
    fail(res, 404, "ERR_NOT_FOUND", "Donation not found.");
    return;
  }
  const receiptNumber = await captureDonation(donation.id, `pay_dev_${id.slice(0, 8)}`, null);
  ok(res, { status: "captured", receipt_number: receiptNumber });
});

export default router;
