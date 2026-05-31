/**
 * admin-city.spec.ts — city_admin admin workflow (Step 23).
 *
 * Approve enrolment → create batch → post critical notice →
 * inspect analytics dashboard. axe a11y check after each navigation.
 */

import { test, expect } from './fixtures';

test.describe('City admin workflow', () => {
  test('approves enrolment, creates batch, posts critical notice, checks analytics', async ({
    page,
    axe,
    loginAs,
  }) => {
    await loginAs('city_admin');
    await page.goto('/admin/enrolments?status=pending');
    await axe.checkA11y();

    const firstRow = page.locator('tr[data-testid^="enrolment-row-"]').first();
    await firstRow.getByRole('button', { name: /Approve/i }).click();
    await expect(page.getByText(/Approved/)).toBeVisible({ timeout: 15_000 });

    // Create a batch.
    await page.goto('/admin/batches');
    await axe.checkA11y();
    await page.getByRole('button', { name: /New batch/i }).click();
    await page.getByLabel(/Name/i).fill('E2E Sunday Bal');
    await page.getByLabel(/Age group/i).selectOption('bal');
    await page.getByLabel(/Day of week/i).selectOption('7');
    await page.getByLabel(/Start time/i).fill('09:00');
    await page.getByLabel(/End time/i).fill('11:00');
    await page.getByLabel(/Capacity/i).fill('40');
    await page.getByRole('button', { name: /Create/i }).click();
    await expect(page.getByText(/E2E Sunday Bal/)).toBeVisible();

    // Critical notice.
    await page.goto('/admin/notices/new');
    await axe.checkA11y();
    await page.getByLabel(/Title \(EN\)/i).fill('Holiday tomorrow');
    await page.getByLabel(/Title \(HI\)/i).fill('कल छुट्टी');
    await page.getByLabel(/Body \(EN\)/i).fill('Pathshala closed tomorrow.');
    await page.getByLabel(/Body \(HI\)/i).fill('कल पाठशाला बंद रहेगी।');
    await page.getByLabel(/Audience/i).selectOption('city');
    await page.getByLabel(/Critical/i).check();
    await page.getByRole('button', { name: /Publish/i }).click();
    await expect(page.getByText(/Published/)).toBeVisible({ timeout: 15_000 });

    // Analytics.
    await page.goto('/admin/analytics');
    await axe.checkA11y();
    await expect(page.getByText(/Active students/i)).toBeVisible();
    await expect(page.getByText(/Attendance rate/i)).toBeVisible();
  });
});
