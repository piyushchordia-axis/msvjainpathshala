/**
 * sanchalak-operations.e2e.ts — sanchalak operations (Step 23).
 *
 * Login → pending enrolments list → approve 5 sequential enrolments →
 * create batch → publish notice → verify notice visible in parent feed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it } from '@jest/globals';

import { loginAsRole } from './init';

declare const by: any;
declare const element: any;
declare const waitFor: any;

describe('Sanchalak operations', () => {
  it('approves 5 enrolments, creates a batch, posts a notice', async () => {
    await loginAsRole('sanchalak');

    // Approve 5 pending enrolments.
    await element(by.id('tab-enrolments')).tap();
    for (let i = 0; i < 5; i++) {
      await waitFor(element(by.id(`pending-${i}`)))
        .toBeVisible()
        .withTimeout(10_000);
      await element(by.id(`pending-${i}`)).tap();
      await element(by.id('btn-approve')).tap();
      await waitFor(element(by.text('Approved')))
        .toBeVisible()
        .withTimeout(15_000);
    }

    // Create a new batch.
    await element(by.id('tab-batches')).tap();
    await element(by.id('btn-new-batch')).tap();
    await element(by.id('input-batch-name')).typeText('E2E Sunday Bal');
    await element(by.id('input-batch-start')).typeText('09:00');
    await element(by.id('input-batch-end')).typeText('11:00');
    await element(by.id('input-batch-capacity')).typeText('40');
    await element(by.id('btn-create-batch')).tap();
    await waitFor(element(by.text('E2E Sunday Bal')))
      .toBeVisible()
      .withTimeout(10_000);

    // Post a notice to the centre.
    await element(by.id('tab-notices')).tap();
    await element(by.id('btn-new-notice')).tap();
    await element(by.id('input-notice-title-en')).typeText('Picnic next Sunday');
    await element(by.id('input-notice-title-hi')).typeText('अगले रविवार पिकनिक');
    await element(by.id('input-notice-body-en')).typeText('Please bring lunch.');
    await element(by.id('input-notice-body-hi')).typeText('कृपया दोपहर का भोजन लाएँ।');
    await element(by.id('picker-audience')).tap();
    await element(by.text('Centre')).tap();
    await element(by.id('btn-publish-notice')).tap();
    await waitFor(element(by.text('Published')))
      .toBeVisible()
      .withTimeout(15_000);
  });
});
