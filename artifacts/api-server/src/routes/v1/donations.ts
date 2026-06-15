/**
 * /v1/donations — public donation flow behind the pluggable payment provider.
 *
 * Per-route auth: the payment flow is PUBLIC (no auth middleware) — order ->
 * (client checkout) -> verify, with a webhook fallback and a mock-only
 * dev-capture convenience so the demo works without a real Razorpay account.
 * The one exception is GET /:id/receipt, which is authed (owner/admin-scoped).
 *
 * Money is in paise. Captures are idempotent: re-verifying / re-webhooking an
 * already-captured donation does NOT double-increment a campaign's raised total,
 * nor re-generate/re-send the 80G receipt (one-time side effects fire only on
 * the winning capture). On capture the 80G receipt PDF is rendered (lib/pdf),
 * stored (lib/storage), and emailed best-effort to the donor when a real email
 * provider is configured (lib/email); it is downloadable via /:id/receipt.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, donations, donation_campaigns } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { payments } from "../../lib/payments";
import { auditFromReq } from "../../lib/audit";
import { storage } from "../../lib/storage";
import { signUploadUrl } from "../../lib/file-tokens";
import { buildDonationReceiptPdf } from "../../lib/pdf";
import { getEmailProvider, hasRealEmailProvider } from "../../lib/email";
import { requireAuth } from "../../middlewares/auth";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
// NOTE: no blanket router.use(requireAuth) — most of this surface is PUBLIC
// (the order/verify/webhook flow). Only the receipt download is authed (see
// below), so requireAuth is applied per-route there.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stable storage key for a donation's 80G receipt PDF (deterministic by id). */
function receiptKey(donationId: string): string {
  return `receipts/${donationId}.pdf`;
}

/** Indian financial year (Apr–Mar) for a given date, e.g. 2025 -> "2025-26". */
function financialYearFor(d: Date): string {
  const y = d.getFullYear();
  // FY starts in April; Jan–Mar belong to the previous year's FY.
  const startYear = d.getMonth() >= 3 ? y : y - 1;
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endShort}`;
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
 * Result of a capture attempt. `won` is true only for the single transition that
 * actually flipped the donation to captured; idempotent replays return won=false
 * with the existing receipt_number. `null` means the donation row was missing.
 */
type CaptureResult = {
  won: boolean;
  receiptNumber: string | null;
} | null;

/**
 * Mark a donation captured once. Idempotent: if it is already captured this is a
 * no-op that returns the existing receipt without re-incrementing the campaign.
 * Returns { won, receiptNumber }, or null if the donation row could not be found.
 * Callers use `won` to fire one-time side effects (receipt PDF + email) exactly
 * once and skip them on duplicate /verify or /webhook deliveries.
 */
async function captureDonation(
  donationId: string,
  paymentId: string | null,
  signature: string | null,
): Promise<CaptureResult> {
  // Wrap the whole capture in one transaction. A per-donation advisory xact lock
  // serializes concurrent capturers (e.g. /verify racing /webhook) so the
  // conditional status flip and the campaign increment can never interleave.
  return db.transaction(async (tx): Promise<CaptureResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${donationId}::text, 0))`);

    const [donation] = await tx
      .select({
        id: donations.id,
        amount_paise: donations.amount_paise,
        campaign_id: donations.campaign_id,
        payment_status: donations.payment_status,
        receipt_number: donations.receipt_number,
      })
      .from(donations)
      .where(eq(donations.id, donationId))
      .limit(1);
    if (!donation) return null;
    // Already captured (e.g. /verify raced /webhook): idempotent success — keep
    // the existing receipt and do NOT consume a counter number or re-fire side
    // effects (won=false).
    if (donation.payment_status === "captured") {
      return { won: false, receiptNumber: donation.receipt_number ?? null };
    }

    const now = new Date();
    const fy = financialYearFor(now);
    // Gapless per-FY receipt number. We hold the per-donation advisory lock and
    // verified status != captured above, so exactly one number is consumed and
    // no two captures collide.
    const seqRes = await tx.execute(
      sql`insert into donation_receipt_counters (financial_year, last_no)
          values (${fy}, 1)
          on conflict (financial_year) do update
            set last_no = donation_receipt_counters.last_no + 1
          returning last_no`,
    );
    const seqRows = (seqRes as unknown as { rows?: Array<{ last_no: number }> }).rows ?? [];
    const receiptNumber = `JP/${fy}/${String(Number(seqRows[0]?.last_no ?? 1)).padStart(5, "0")}`;

    await tx
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
      .where(eq(donations.id, donation.id));

    // Winning transition: credit the campaign exactly once.
    if (donation.campaign_id) {
      await tx
        .update(donation_campaigns)
        .set({
          raised_amount_paise: sql`${donation_campaigns.raised_amount_paise} + ${donation.amount_paise}`,
        })
        .where(eq(donation_campaigns.id, donation.campaign_id));
    }

    return { won: true, receiptNumber };
  });
}

/** Full donation row used to render an 80G receipt PDF, with its campaign name. */
async function fetchDonationForReceipt(donationId: string) {
  const [row] = await db
    .select({
      id: donations.id,
      donor_user_id: donations.donor_user_id,
      donor_name: donations.donor_name,
      donor_email: donations.donor_email,
      donor_phone: donations.donor_phone,
      amount_paise: donations.amount_paise,
      purpose: donations.purpose,
      payment_status: donations.payment_status,
      payment_captured_at: donations.payment_captured_at,
      receipt_number: donations.receipt_number,
      financial_year: donations.financial_year,
      razorpay_payment_id: donations.razorpay_payment_id,
      campaign_name: donation_campaigns.name,
      campaign_city_id: donation_campaigns.city_id,
    })
    .from(donations)
    .leftJoin(donation_campaigns, eq(donation_campaigns.id, donations.campaign_id))
    .where(eq(donations.id, donationId))
    .limit(1);
  return row ?? null;
}

type ReceiptDonation = NonNullable<Awaited<ReturnType<typeof fetchDonationForReceipt>>>;

/**
 * Render the 80G receipt PDF for a captured donation and persist it under its
 * deterministic storage key. Returns the stored URL (unsigned) plus the rendered
 * bytes (so a caller can attach them without re-reading storage). Idempotent: the
 * key is derived from the donation id, so a regenerate overwrites in place.
 */
async function generateAndStoreReceipt(
  donation: ReceiptDonation,
): Promise<{ url: string; pdf: Buffer }> {
  const pdf = await buildDonationReceiptPdf({
    receipt_number: donation.receipt_number ?? "—",
    financial_year: donation.financial_year ?? financialYearFor(donation.payment_captured_at ?? new Date()),
    captured_at: (donation.payment_captured_at ?? new Date()).toISOString(),
    donor_name: donation.donor_name,
    donor_email: donation.donor_email,
    donor_phone: donation.donor_phone,
    amount_paise: donation.amount_paise,
    purpose: donation.purpose,
    campaign_name: donation.campaign_name,
    razorpay_payment_id: donation.razorpay_payment_id,
  });
  const stored = await storage.put(receiptKey(donation.id), pdf, "application/pdf");
  return { url: stored.url, pdf };
}

/**
 * One-time post-capture side effects: render + store the 80G receipt PDF, then
 * email it to the donor best-effort. Called ONLY on the winning capture. Never
 * throws — receipt delivery must not roll back a successful payment capture.
 * The receipt email is gated on a real (non-mock) email provider so dev/test
 * stay silent and the 7 donations tests are unaffected.
 */
async function deliverReceipt(donationId: string): Promise<void> {
  try {
    const donation = await fetchDonationForReceipt(donationId);
    if (!donation) return;
    const { pdf } = await generateAndStoreReceipt(donation);

    // Email is best-effort and only attempted with a real provider configured,
    // so the dev/test mock never sends and stays silent.
    if (donation.donor_email && hasRealEmailProvider()) {
      const amountRupees = (donation.amount_paise / 100).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      await getEmailProvider().send({
        to: donation.donor_email,
        subject: `Your 80G donation receipt ${donation.receipt_number ?? ""}`.trim(),
        text:
          `Dear ${donation.donor_name},\n\n` +
          `Thank you for your donation of INR ${amountRupees} to Jain Pathshala.\n` +
          `Your 80G receipt (${donation.receipt_number ?? "—"}) is attached.\n\n` +
          `You can also download it any time from your account.\n\n` +
          `With gratitude,\nJain Pathshala`,
        attachments: [
          {
            filename: `80G-receipt-${(donation.receipt_number ?? donationId).replace(/[^a-z0-9-]/gi, "_")}.pdf`,
            content: pdf,
            content_type: "application/pdf",
          },
        ],
      });
    }
  } catch (err) {
    // Best-effort: a failed receipt render/email must never fail the capture.
    logger.warn({ err, donationId }, "donation receipt delivery failed (best-effort)");
  }
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

  const result = await captureDonation(
    donation.id,
    body.razorpay_payment_id,
    body.razorpay_signature,
  );
  const receiptNumber = result?.receiptNumber ?? null;

  // One-time side effects (receipt PDF + email) only on the winning capture.
  if (result?.won) await deliverReceipt(donation.id);

  await auditFromReq(req, {
    action: "update",
    entityKind: "donation",
    entityId: donation.id,
    summary: `Donation captured via verify (${receiptNumber ?? "no receipt"}).`,
    metadata: {
      source: "verify",
      amount_paise: donation.amount_paise,
      receipt_number: receiptNumber,
      razorpay_payment_id: body.razorpay_payment_id,
    },
  });

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
        // Idempotent inside captureDonation (guards on payment_status). Only the
        // winning transition fires the one-time receipt PDF + email; a duplicate
        // webhook delivery returns won=false and skips re-generating/re-sending.
        const result = await captureDonation(donation.id, paymentId, null);
        const receiptNumber = result?.receiptNumber ?? null;
        if (result?.won) await deliverReceipt(donation.id);

        await auditFromReq(req, {
          action: "update",
          entityKind: "donation",
          entityId: donation.id,
          summary: `Donation captured via webhook (${receiptNumber ?? "no receipt"}).`,
          metadata: {
            source: "webhook",
            amount_paise: donation.amount_paise,
            receipt_number: receiptNumber,
            razorpay_payment_id: paymentId,
          },
        });
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
  const result = await captureDonation(donation.id, `pay_dev_${id.slice(0, 8)}`, null);
  if (result?.won) await deliverReceipt(donation.id);
  ok(res, { status: "captured", receipt_number: result?.receiptNumber ?? null });
});

/* ---- GET /v1/donations/:id/receipt — owner/admin-scoped 80G receipt ---- */
/**
 * Returns a short-lived signed URL to the donation's 80G receipt PDF. Authed:
 * the donor (donor_user_id === caller) OR an admin-panel user (city-scoped to
 * the donation's campaign city, or unscoped at super/state level). The PDF is
 * generated at capture; if it is somehow missing (older donation, transient
 * storage failure) it is regenerated on demand here. Only captured donations
 * with a receipt number are eligible.
 */
router.get("/:id/receipt", requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Donation not found.");
    return;
  }

  const donation = await fetchDonationForReceipt(id);
  if (!donation) {
    fail(res, 404, "ERR_NOT_FOUND", "Donation not found.");
    return;
  }

  // A receipt only exists for a captured, 80G-numbered donation.
  if (donation.payment_status !== "captured" || !donation.receipt_number) {
    fail(res, 404, "ERR_NOT_FOUND", "Receipt not available for this donation.");
    return;
  }

  // Authorization. The owning donor always sees their own receipt. For admins,
  // donations have no centre (the AdminScope primitive is centre-based and does
  // not map), so we scope on the donation's CAMPAIGN city instead:
  //  - super_admin / state_admin: org/state-wide finance & 80G compliance — allow.
  //  - city_admin: only when the campaign's city matches the admin's city.
  //  - sanchalak / shikshak: no donation visibility (not a finance role).
  // A 404 (not 403) keeps the existence of others' donations opaque.
  const user = req.authUser!;
  const isOwner = donation.donor_user_id !== null && donation.donor_user_id === user.id;
  let isAdmin = false;
  if (user.role === "super_admin" || user.role === "state_admin") {
    isAdmin = true;
  } else if (user.role === "city_admin") {
    isAdmin =
      donation.campaign_city_id !== null && donation.campaign_city_id === user.city_id;
  }
  if (!isOwner && !isAdmin) {
    fail(res, 404, "ERR_NOT_FOUND", "Donation not found.");
    return;
  }

  // Ensure the PDF exists; regenerate on demand if the stored object is gone.
  const key = receiptKey(donation.id);
  let url = storage.url(key);
  try {
    await streamExists(key);
  } catch {
    ({ url } = await generateAndStoreReceipt(donation));
  }

  ok(res, {
    donation_id: donation.id,
    receipt_number: donation.receipt_number,
    financial_year: donation.financial_year,
    receipt_url: signUploadUrl(url),
  });
});

/** Resolve when the stored object can be read; reject if missing/unreadable. */
function streamExists(key: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const stream = storage.getStream(key);
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      stream.destroy();
      fn();
    };
    stream.on("data", () => done(resolve));
    stream.on("end", () => done(resolve));
    stream.on("error", (err: Error) => done(() => reject(err)));
  });
}

export default router;
