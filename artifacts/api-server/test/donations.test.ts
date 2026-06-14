import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { db, donation_campaigns, pool } from "@workspace/db";
import { payments } from "../src/lib/payments";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/** Read a campaign's current raised total straight from the DB. */
async function campaignRaised(campaignId: string): Promise<number> {
  const [row] = await db
    .select({ raised: donation_campaigns.raised_amount_paise })
    .from(donation_campaigns)
    .where(eq(donation_campaigns.id, campaignId))
    .limit(1);
  return row?.raised ?? 0;
}

/**
 * Self-creating + rerun-safe: every test mints its own donation via the public
 * /order endpoint (no seed dependency), then drives it through the mock payment
 * flow. Tests assume the default mock provider (no RAZORPAY_* env in test).
 */
describe("donations — public payment flow", () => {
  it("lists public campaigns", async () => {
    const res = await request(app).get("/v1/donations/campaigns");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("creates an order then captures it via verify with a valid mock signature", async () => {
    const order = await request(app)
      .post("/v1/donations/order")
      .send({
        amount_paise: 25_000,
        donor_name: "Test Donor",
        donor_phone: "+919999999999",
        donor_email: "donor@example.com",
        purpose: "general",
      });
    expect(order.status).toBe(200);
    const { donation_id, order_id, provider } = order.body.data;
    expect(typeof donation_id).toBe("string");
    expect(typeof order_id).toBe("string");
    expect(provider).toBe("mock");

    // Compute a valid mock checkout signature for this order + a fake payment id.
    const paymentId = "pay_test_1";
    const sig = payments.mockSignature!(order_id, paymentId);

    const verify = await request(app)
      .post("/v1/donations/verify")
      .send({
        donation_id,
        razorpay_order_id: order_id,
        razorpay_payment_id: paymentId,
        razorpay_signature: sig,
      });
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe("captured");
    expect(typeof verify.body.data.receipt_number).toBe("string");
    expect(verify.body.data.receipt_number).toMatch(/^JP-/);

    // Re-verifying is idempotent: same receipt, still 200.
    const reverify = await request(app)
      .post("/v1/donations/verify")
      .send({
        donation_id,
        razorpay_order_id: order_id,
        razorpay_payment_id: paymentId,
        razorpay_signature: sig,
      });
    expect(reverify.status).toBe(200);
    expect(reverify.body.data.receipt_number).toBe(verify.body.data.receipt_number);
  });

  it("rejects verify with an invalid signature (401)", async () => {
    const order = await request(app)
      .post("/v1/donations/order")
      .send({ amount_paise: 10_000, donor_name: "Bad Sig Donor" });
    expect(order.status).toBe(200);
    const { donation_id, order_id } = order.body.data;

    const verify = await request(app)
      .post("/v1/donations/verify")
      .send({
        donation_id,
        razorpay_order_id: order_id,
        razorpay_payment_id: "pay_test_bad",
        razorpay_signature: "deadbeef_not_a_real_signature",
      });
    expect(verify.status).toBe(401);
    expect(verify.body.error.code).toBe("ERR_SIGNATURE_INVALID");
  });

  it("rejects verify when the order id does not match (400)", async () => {
    const order = await request(app)
      .post("/v1/donations/order")
      .send({ amount_paise: 10_000, donor_name: "Mismatch Donor" });
    const { donation_id, order_id } = order.body.data;
    const sig = payments.mockSignature!("order_other", "pay_x");

    const verify = await request(app)
      .post("/v1/donations/verify")
      .send({
        donation_id,
        razorpay_order_id: "order_other",
        razorpay_payment_id: "pay_x",
        razorpay_signature: sig,
      });
    // order_id from the donation differs from "order_other" -> mismatch.
    expect(order_id).not.toBe("order_other");
    expect(verify.status).toBe(400);
    expect(verify.body.error.code).toBe("ERR_ORDER_MISMATCH");
  });

  it("captures via the mock-only dev-capture path", async () => {
    expect(payments.name).toBe("mock");
    const order = await request(app)
      .post("/v1/donations/order")
      .send({ amount_paise: 15_000, donor_name: "Dev Capture Donor" });
    expect(order.status).toBe(200);
    const { donation_id } = order.body.data;

    const cap = await request(app).post(`/v1/donations/${donation_id}/dev-capture`).send({});
    expect(cap.status).toBe(200);
    expect(cap.body.data.status).toBe("captured");
    expect(typeof cap.body.data.receipt_number).toBe("string");

    // Idempotent: second dev-capture returns the same receipt.
    const cap2 = await request(app).post(`/v1/donations/${donation_id}/dev-capture`).send({});
    expect(cap2.status).toBe(200);
    expect(cap2.body.data.receipt_number).toBe(cap.body.data.receipt_number);
  });

  it("validates the order body (422 on too-small amount)", async () => {
    const res = await request(app)
      .post("/v1/donations/order")
      .send({ amount_paise: 50, donor_name: "Too Small" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("credits a campaign's raised total exactly once across repeated /verify (idempotent capture)", async () => {
    // Self-create a public campaign so /order will accept the campaign_id.
    const [campaign] = await db
      .insert(donation_campaigns)
      .values({
        name: `Idempotency Campaign ${Date.now()}`,
        is_public: true,
        raised_amount_paise: 0,
      })
      .returning({ id: donation_campaigns.id });

    const amount = 25_000;
    const before = await campaignRaised(campaign.id);

    const order = await request(app)
      .post("/v1/donations/order")
      .send({
        amount_paise: amount,
        donor_name: "Idempotent Donor",
        campaign_id: campaign.id,
      });
    expect(order.status).toBe(200);
    const { donation_id, order_id } = order.body.data;

    const paymentId = "pay_idem_1";
    const sig = payments.mockSignature!(order_id, paymentId);
    const verifyBody = {
      donation_id,
      razorpay_order_id: order_id,
      razorpay_payment_id: paymentId,
      razorpay_signature: sig,
    };

    // First verify: captures and credits the campaign once.
    const verify1 = await request(app).post("/v1/donations/verify").send(verifyBody);
    expect(verify1.status).toBe(200);
    expect(verify1.body.data.status).toBe("captured");

    // Second verify with the SAME valid signature: still 200, no re-credit.
    const verify2 = await request(app).post("/v1/donations/verify").send(verifyBody);
    expect(verify2.status).toBe(200);
    expect(verify2.body.data.receipt_number).toBe(verify1.body.data.receipt_number);

    // The campaign raised total increased by the amount exactly ONCE.
    const after = await campaignRaised(campaign.id);
    expect(after - before).toBe(amount);
  });
});
