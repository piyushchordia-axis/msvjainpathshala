/**
 * parent-full-journey.e2e.ts — parent end-to-end (Step 23).
 *
 * Signup → enrolment submit → wait for approval → niyam upload → exam attempt
 * → reports view. Each waitFor uses testID conventions defined in
 * `apps/mobile/src/screens/**` (`testID="..."` props).
 *
 * Run:
 *   pnpm --filter @jp/mobile e2e:android   (after `detox build`)
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it } from '@jest/globals';

import { loginAsRole } from './init';

declare const by: any;
declare const element: any;
declare const waitFor: any;

describe('Parent full journey', () => {
  it('signs up, enrols, submits niyam, takes exam, sees reports', async () => {
    // 1. Signup → guest navigates to "Sign up" CTA on the landing screen.
    await waitFor(element(by.id('cta-signup')))
      .toBeVisible()
      .withTimeout(10_000);
    await element(by.id('cta-signup')).tap();

    // Phone + OTP — we use a deterministic seeded user via loginAsRole.
    await loginAsRole('parent');

    // 2. Submit enrolment.
    await element(by.id('tab-children')).tap();
    await element(by.id('btn-add-child')).tap();
    await element(by.id('input-child-full-name')).typeText('Aarav Demo');
    await element(by.id('input-child-dob')).typeText('2017-04-12');
    await element(by.id('picker-age-group')).tap();
    await element(by.text('Bal')).tap();
    await element(by.id('btn-submit-enrolment')).tap();
    await waitFor(element(by.text('Submitted')))
      .toBeVisible()
      .withTimeout(15_000);

    // 3. Wait for approval — the seed user has an auto-approved child
    //    bound to the e2e fixture; we just navigate to the child detail.
    await element(by.id('tab-children')).tap();
    await waitFor(element(by.id('child-card-0')))
      .toBeVisible()
      .withTimeout(15_000);
    await element(by.id('child-card-0')).tap();

    // 4. Niyam upload — photo proof via the mocked camera fixture.
    await element(by.id('tab-niyams')).tap();
    await element(by.id('niyam-card-0')).tap();
    await element(by.id('btn-upload-photo')).tap();
    await waitFor(element(by.text('Photo received')))
      .toBeVisible()
      .withTimeout(15_000);

    // 5. Exam attempt — pick the seeded "demo" exam.
    await element(by.id('tab-exams')).tap();
    await element(by.id('exam-card-demo')).tap();
    await element(by.id('btn-start-exam')).tap();
    await element(by.id('input-exam-otp')).typeText('123456');
    await element(by.id('btn-submit-otp')).tap();
    // Answer two MCQ questions and submit.
    await element(by.id('option-0-correct')).tap();
    await element(by.id('btn-next')).tap();
    await element(by.id('option-1-correct')).tap();
    await element(by.id('btn-submit-exam')).tap();
    await waitFor(element(by.text('Submitted for grading')))
      .toBeVisible()
      .withTimeout(20_000);

    // 6. Reports — open the monthly report (pre-generated for seed user).
    await element(by.id('tab-reports')).tap();
    await waitFor(element(by.id('report-card-0')))
      .toBeVisible()
      .withTimeout(15_000);
    await element(by.id('report-card-0')).tap();
    await waitFor(element(by.id('report-preview')))
      .toBeVisible()
      .withTimeout(20_000);
  });
});
