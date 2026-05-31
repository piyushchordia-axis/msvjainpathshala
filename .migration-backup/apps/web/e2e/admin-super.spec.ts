/**
 * admin-super.spec.ts — super_admin impersonation audit (Step 23).
 *
 * super_admin → start impersonation of a target user → action under the
 * impersonated identity → stop impersonation → audit log shows BOTH the
 * start and stop entries with impersonator + target ids (SPEC §7).
 */

import { test, expect } from './fixtures';

test.describe('Super admin impersonation', () => {
  test('start → act → stop → both audit entries present', async ({ page, axe, loginAs }) => {
    await loginAs('super_admin');
    await page.goto('/admin/users?role=parent');
    await axe.checkA11y();

    // Open the first parent user's actions panel.
    const firstRow = page.locator('tr[data-testid^="user-row-"]').first();
    const targetUserId = await firstRow.getAttribute('data-user-id');
    expect(targetUserId).toBeTruthy();

    await firstRow.getByRole('button', { name: /Impersonate/i }).click();
    await page.getByLabel(/Reason/i).fill('Step-23 e2e impersonation audit check');
    await page.getByRole('button', { name: /Confirm/i }).click();

    // Persistent banner must be present.
    await expect(page.locator('[data-testid="impersonation-banner"]')).toBeVisible();

    // Act under impersonation — visit the impersonated user's profile.
    await page.goto('/admin/me');
    await axe.checkA11y();
    await expect(page.locator('[data-testid="impersonation-banner"]')).toBeVisible();

    // Stop impersonation.
    await page
      .locator('[data-testid="impersonation-banner"]')
      .getByRole('button', {
        name: /Stop/i,
      })
      .click();
    await expect(page.locator('[data-testid="impersonation-banner"]')).toHaveCount(0);

    // Audit log shows both impersonation.started and impersonation.stopped.
    await page.goto('/admin/audit?action=impersonation');
    await axe.checkA11y();
    await expect(
      page.locator('tr', { hasText: 'impersonation.started' }).filter({
        hasText: targetUserId!,
      }),
    ).toBeVisible();
    await expect(
      page.locator('tr', { hasText: 'impersonation.stopped' }).filter({
        hasText: targetUserId!,
      }),
    ).toBeVisible();
  });
});
