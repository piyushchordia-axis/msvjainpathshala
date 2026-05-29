/**
 * volunteer-shivir.e2e.ts — Shivir scanner end-to-end (Step 23).
 *
 * Login as volunteer → open scanner → 30 IN scans + 30 OUT scans across
 * 2 sessions, with intermittent airplane-mode toggles to verify queue +
 * sync resilience (SPEC §15.5).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it } from '@jest/globals';

import { loginAsRole, toggleAirplaneMode } from './init';

declare const by: any;
declare const element: any;
declare const waitFor: any;

const FAKE_QR_PREFIX = 'JP:STU:';

function fakeQr(seq: number): string {
  return `${FAKE_QR_PREFIX}${seq.toString().padStart(6, '0')}`;
}

describe('Volunteer Shivir scanning', () => {
  it('completes 30 in + 30 out scans across 2 sessions with offline toggles', async () => {
    await loginAsRole('volunteer');

    await element(by.id('tab-shivirs')).tap();
    await waitFor(element(by.id('shivir-card-active')))
      .toBeVisible()
      .withTimeout(15_000);
    await element(by.id('shivir-card-active')).tap();

    // SESSION 1 — IN scans.
    await element(by.id('btn-open-scanner')).tap();
    await element(by.id('picker-mode')).tap();
    await element(by.text('Check in')).tap();

    for (let i = 0; i < 30; i++) {
      // Toggle airplane mode at i=10 and back online at i=20.
      if (i === 10) await toggleAirplaneMode(true);
      if (i === 20) await toggleAirplaneMode(false);

      await element(by.id('btn-mock-scan')).typeText(fakeQr(i));
      await waitFor(element(by.text('Queued')))
        .toBeVisible()
        .withTimeout(5_000);
    }

    await element(by.id('btn-end-session')).tap();
    await waitFor(element(by.text('Synced')))
      .toBeVisible()
      .withTimeout(30_000);

    // SESSION 2 — OUT scans.
    await element(by.id('btn-start-session-2')).tap();
    await element(by.id('btn-open-scanner')).tap();
    await element(by.id('picker-mode')).tap();
    await element(by.text('Check out')).tap();

    for (let i = 0; i < 30; i++) {
      if (i === 15) await toggleAirplaneMode(true);
      if (i === 25) await toggleAirplaneMode(false);
      await element(by.id('btn-mock-scan')).typeText(fakeQr(i));
      await waitFor(element(by.text('Queued')))
        .toBeVisible()
        .withTimeout(5_000);
    }

    await element(by.id('btn-end-session')).tap();
    await waitFor(element(by.text('Synced')))
      .toBeVisible()
      .withTimeout(30_000);

    // Live dashboard check — exactly 30 in, 30 out.
    await element(by.id('btn-view-dashboard')).tap();
    await waitFor(element(by.id('count-in-30')))
      .toBeVisible()
      .withTimeout(15_000);
    await waitFor(element(by.id('count-out-30')))
      .toBeVisible()
      .withTimeout(15_000);
  });
});
