/**
 * shikshak-full-day.e2e.ts — shikshak end-to-end (Step 23).
 *
 * Login → batch list → 3 sequential check-ins → mark attendance with mid-flow
 * airplane mode toggle → niyam review → homework approve.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it } from '@jest/globals';

import { loginAsRole, toggleAirplaneMode } from './init';

declare const by: any;
declare const element: any;
declare const waitFor: any;

describe('Shikshak full day', () => {
  it('checks in to 3 batches, marks attendance offline, reviews niyam + homework', async () => {
    await loginAsRole('shikshak');

    await element(by.id('tab-batches')).tap();
    await waitFor(element(by.id('batch-card-0')))
      .toBeVisible()
      .withTimeout(15_000);

    for (let i = 0; i < 3; i++) {
      await element(by.id(`batch-card-${i}`)).tap();
      await element(by.id('btn-gps-checkin')).tap();
      await waitFor(element(by.text('Checked in')))
        .toBeVisible()
        .withTimeout(20_000);

      // Mark attendance — first 5 students online.
      for (let s = 0; s < 5; s++) {
        await element(by.id(`student-row-${s}`)).tap();
        await element(by.id(`status-present-${s}`)).tap();
      }

      // Toggle offline mid-flow for the next 5 students.
      await toggleAirplaneMode(true);
      for (let s = 5; s < 10; s++) {
        await element(by.id(`student-row-${s}`)).tap();
        await element(by.id(`status-present-${s}`)).tap();
      }
      await toggleAirplaneMode(false);

      // Submit attendance — sync engine flushes the queued marks.
      await element(by.id('btn-submit-attendance')).tap();
      await waitFor(element(by.text('Saved')))
        .toBeVisible()
        .withTimeout(30_000);

      await element(by.id('btn-back')).tap();
    }

    // Niyam review — reject the first submission in the pending queue.
    await element(by.id('tab-niyams')).tap();
    await element(by.id('niyam-pending-0')).tap();
    await element(by.id('btn-reject')).tap();
    await element(by.id('input-reject-reason')).typeText('Not a clear photo');
    await element(by.id('btn-confirm-reject')).tap();
    await waitFor(element(by.text('Reversal posted')))
      .toBeVisible()
      .withTimeout(15_000);

    // Homework approve — first 3 submissions.
    await element(by.id('tab-homework')).tap();
    for (let h = 0; h < 3; h++) {
      await element(by.id(`hw-submission-${h}`)).tap();
      await element(by.id('btn-approve')).tap();
      await waitFor(element(by.text('Approved')))
        .toBeVisible()
        .withTimeout(10_000);
      await element(by.id('btn-back')).tap();
    }
  });
});
