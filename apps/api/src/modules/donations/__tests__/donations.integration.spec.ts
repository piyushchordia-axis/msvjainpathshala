/**
 * Donations integration tests — Step 21.
 *
 * Coverage:
 *   1. createOrder() persists a `donations` row + binds the order id.
 *   2. PAN is encrypted at rest (raw value never lands in donor_pan).
 *   3. verifyAndCapture() flips status to 'captured' + sets a financial year.
 *   4. Webhook delivered twice → second is a no-op (idempotent on event_id).
 *   5. 80G cert is NOT enqueued when eighty_g_enabled=false (Q3 — disabled path).
 *   6. 80G cert IS enqueued when eighty_g_enabled=true + PAN present.
 *   7. PlatformSettings.update refuses to enable 80G without all prereqs.
 *
 * Razorpay live calls are bypassed via the stub mode (no RAZORPAY_KEY_ID
 * env in tests) — `RazorpayService` returns a deterministic stub order id
 * and accepts signature='stub'.
 */

import 'reflect-metadata';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DrizzleService } from '../../../core/database/drizzle.service';
import { bootTestApp, captureOtps } from '../../auth/__tests__/test-helpers';
import { DonationsService } from '../donations.service';
import { PanEncryptionService } from '../pan-encryption.service';
import { PlatformSettingsService } from '../platform-settings.service';

import type { INestApplication } from '@nestjs/common';

async function createSuperAdmin(app: INestApplication, marker: number): Promise<string> {
  const drizzle = app.get(DrizzleService);
  const phone = `+91900${(Date.now() % 100000).toString().padStart(5, '0')}${marker
    .toString()
    .padStart(2, '0')}`.slice(0, 13);
  const [row] = (await drizzle.db.execute(
    sql`INSERT INTO users(phone, role, full_name, preferred_language)
        VALUES (${phone}, 'super_admin', 'Step21 super', 'en') RETURNING id`,
  )) as unknown as Array<{ id: string }>;
  return row!.id;
}

describe('Donations — integration (Step 21)', () => {
  let app: INestApplication;
  let drizzle: DrizzleService;
  let donations: DonationsService;
  let settings: PlatformSettingsService;
  let pan: PanEncryptionService;

  beforeAll(async () => {
    process.env.DONATION_PAN_ENCRYPTION_KEY_HEX = ''.padStart(64, '1');
    app = await bootTestApp();
    await captureOtps(app);
    drizzle = app.get(DrizzleService);
    donations = app.get(DonationsService);
    settings = app.get(PlatformSettingsService);
    pan = app.get(PanEncryptionService);

    // Reset to a known 80G state before the suite so test ordering doesn't
    // bleed assumptions.
    await drizzle.db.execute(sql`
      UPDATE platform_settings
         SET eighty_g_enabled = false,
             eighty_g_registration_number = NULL,
             eighty_g_trust_name = NULL,
             eighty_g_trust_address = NULL
       WHERE id = 'global'
    `);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  // -----------------------------------------------------------------
  it('1. createOrder persists row + binds order id; PAN is encrypted', async () => {
    const result = await donations.createOrder(
      {},
      {
        amount_paise: 50_100,
        currency: 'INR',
        purpose: 'general',
        donor: { name: 'Test Donor', email: 'test@example.com', pan: 'ABCDE1234F' },
      },
    );
    expect(result.donation.status).toBe('created');
    expect(result.donation.razorpay_order_id).toBeDefined();
    expect(result.razorpay_order_id).toBe(`order_stub_${result.donation.id}`);

    // PAN must be ciphertext on the row, plaintext recoverable via PanEnc.
    expect(result.donation.donor_pan).not.toBe('ABCDE1234F');
    expect(result.donation.donor_pan?.startsWith('v1:')).toBe(true);
    expect(pan.decryptPan(result.donation.donor_pan)).toBe('ABCDE1234F');
  });

  // -----------------------------------------------------------------
  it('2. verifyAndCapture flips status to captured + writes financial year', async () => {
    const created = await donations.createOrder(
      {},
      {
        amount_paise: 1_00_100,
        currency: 'INR',
        purpose: 'general',
        donor: { name: 'Verify Donor' },
      },
    );
    const captured = await donations.verifyAndCapture({
      order_id: created.razorpay_order_id,
      payment_id: 'pay_test_001',
      signature: 'stub',
    });
    expect(captured.status).toBe('captured');
    expect(captured.razorpay_payment_id).toBe('pay_test_001');
    expect(captured.financial_year).toMatch(/^\d{4}-\d{2}$/);
    expect(captured.receipt_number).toMatch(/^JP-\d{4}-\d{2}-/);

    // Second verify with the same payment_id is a no-op (already captured).
    const reCaptured = await donations.verifyAndCapture({
      order_id: created.razorpay_order_id,
      payment_id: 'pay_test_001',
      signature: 'stub',
    });
    expect(reCaptured.id).toBe(captured.id);
    expect(reCaptured.payment_captured_at).toEqual(captured.payment_captured_at);
  });

  // -----------------------------------------------------------------
  it('3. webhook delivered twice → second is a no-op (idempotent)', async () => {
    // Unique markers per run so the unique-on-event_id index doesn't bleed
    // state across re-runs.
    const runMarker = Date.now().toString(36);
    const eventId = `evt_test_${runMarker}`;
    const paymentId = `pay_test_webhook_${runMarker}`;
    const created = await donations.createOrder(
      {},
      {
        amount_paise: 51_100,
        currency: 'INR',
        purpose: 'shivir',
        donor: { name: 'Webhook Donor' },
      },
    );
    const payment = {
      id: paymentId,
      order_id: created.razorpay_order_id,
      amount: 51_100,
      created_at: Math.floor(Date.now() / 1000),
    };
    const body = {
      event: 'payment.captured',
      event_id: eventId,
      payload: { payment: { entity: payment } },
    };
    const rawBody = JSON.stringify(body);

    const first = await donations.handleWebhook(rawBody, 'stub', {
      event_id: body.event_id,
      event_type: body.event,
      payload: body.payload,
    });
    expect(first.duplicate).toBe(false);
    expect(first.donation_id).toBe(created.donation.id);

    const second = await donations.handleWebhook(rawBody, 'stub', {
      event_id: body.event_id,
      event_type: body.event,
      payload: body.payload,
    });
    expect(second.duplicate).toBe(true);

    // Only one donation_webhook_events row exists for this event_id.
    const events = (await drizzle.db.execute(
      sql`SELECT count(*)::int AS c FROM donation_webhook_events WHERE event_id = ${eventId}`,
    )) as unknown as Array<{ c: number }>;
    expect(events[0]!.c).toBe(1);
  });

  // -----------------------------------------------------------------
  it('4. 80G cert is NOT enqueued when eighty_g_enabled=false', async () => {
    const enqueueSpy = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eightyGQueue = (donations as any).eightyGQueue as { add: () => Promise<unknown> };
    const origAdd = eightyGQueue.add.bind(eightyGQueue);
    eightyGQueue.add = enqueueSpy;
    try {
      const created = await donations.createOrder(
        {},
        {
          amount_paise: 52_100,
          currency: 'INR',
          purpose: 'general',
          donor: { name: '80G off Donor', pan: 'XYZAB1111Z' },
        },
      );
      await donations.verifyAndCapture({
        order_id: created.razorpay_order_id,
        payment_id: 'pay_80g_off',
        signature: 'stub',
      });
      expect(enqueueSpy).not.toHaveBeenCalled();
    } finally {
      eightyGQueue.add = origAdd;
    }
  });

  // -----------------------------------------------------------------
  it('5. 80G cert IS enqueued when eighty_g_enabled=true + PAN set', async () => {
    const superId = await createSuperAdmin(app, 21);
    // Enable 80G with all prereqs.
    await settings.update(
      { user_id: superId, role: 'super_admin' },
      {
        eighty_g_enabled: true,
        eighty_g_registration_number: 'AABTM1234E',
        eighty_g_trust_name: 'Megh Sanskar Vatika Trust',
        eighty_g_trust_address: '12 Tirupati Marg, Surat 395004',
      },
    );

    const enqueueSpy = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eightyGQueue = (donations as any).eightyGQueue as {
      add: (...args: unknown[]) => Promise<unknown>;
    };
    const origAdd = eightyGQueue.add.bind(eightyGQueue);
    eightyGQueue.add = enqueueSpy;
    try {
      const created = await donations.createOrder(
        {},
        {
          amount_paise: 5_00_100,
          currency: 'INR',
          purpose: 'general',
          donor: { name: '80G on Donor', pan: 'XYZAB2222Z' },
        },
      );
      await donations.verifyAndCapture({
        order_id: created.razorpay_order_id,
        payment_id: 'pay_80g_on',
        signature: 'stub',
      });
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const args = enqueueSpy.mock.calls[0]!;
      expect(args[0]).toBe('donation.eightyg.cert');
      expect((args[1] as { donation_id: string }).donation_id).toBe(created.donation.id);
    } finally {
      eightyGQueue.add = origAdd;
    }
  });

  // -----------------------------------------------------------------
  it('6. PlatformSettings refuses to enable 80G without prereqs', async () => {
    const superId = await createSuperAdmin(app, 22);

    // Disable first so we're toggling from a clean off state.
    await drizzle.db.execute(sql`
      UPDATE platform_settings
         SET eighty_g_enabled = false,
             eighty_g_registration_number = NULL,
             eighty_g_trust_name = NULL,
             eighty_g_trust_address = NULL
       WHERE id = 'global'
    `);

    await expect(
      settings.update(
        { user_id: superId, role: 'super_admin' },
        { eighty_g_enabled: true }, // missing prereqs
      ),
    ).rejects.toMatchObject({ code: 'ERR_DONATION_80G_PREREQS_MISSING' });
  });
});
