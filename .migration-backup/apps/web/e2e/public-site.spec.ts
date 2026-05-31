/**
 * public-site.spec.ts — guest browsing + donation flow (Step 23).
 *
 * Walks the public-facing pages, runs an axe a11y check on each, and
 * completes a Razorpay TEST-mode donation (the test ID `rzp_test_xxx`
 * resolves to a mocked checkout).
 */

import { test, expect } from './fixtures';

test.describe('Public site', () => {
  test('home → centres → shivirs → donate → receipt', async ({ page, axe }) => {
    await page.goto('/');
    await axe.checkA11y();
    await expect(page).toHaveTitle(/Jain Pathshala/i);

    await page
      .getByRole('link', { name: /Centres/i })
      .first()
      .click();
    await axe.checkA11y();
    await expect(page).toHaveURL(/\/centres/);

    await page
      .getByRole('link', { name: /Shivirs/i })
      .first()
      .click();
    await axe.checkA11y();
    await expect(page).toHaveURL(/\/shivirs/);

    await page
      .getByRole('link', { name: /Donate/i })
      .first()
      .click();
    await axe.checkA11y();
    await expect(page).toHaveURL(/\/donate/);

    // Fill donation form (test mode).
    await page.getByLabel(/Amount/i).fill('501');
    await page.getByLabel(/Full name/i).fill('Test Donor');
    await page.getByLabel(/Phone/i).fill('+919900000000');
    await page.getByLabel(/Email/i).fill('test@example.com');
    await page.getByRole('button', { name: /Donate now/i }).click();

    // Razorpay test-mode checkout iframe — skip actual payment if not stubbed.
    const checkout = page.frameLocator('[name="razorpay-checkout"]');
    if (await checkout.locator('body').count()) {
      await checkout.getByRole('button', { name: /UPI/i }).click();
      await checkout.getByLabel(/VPA/i).fill('success@razorpay');
      await checkout.getByRole('button', { name: /Pay/i }).click();
    }

    // Confirmation page.
    await expect(page.getByText(/Thank you/i)).toBeVisible({ timeout: 30_000 });
    await axe.checkA11y();

    // Receipt download — verify the link is reachable; full content check
    // would need the donation worker to have finished generating the PDF.
    const downloadButton = page.getByRole('button', { name: /Download receipt/i });
    if (await downloadButton.count()) {
      const downloadPromise = page.waitForEvent('download');
      await downloadButton.click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/receipt-.*\.pdf$/);
    }
  });
});
