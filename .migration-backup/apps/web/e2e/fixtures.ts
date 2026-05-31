/**
 * Playwright shared fixtures — Step 23.
 *
 * Adds:
 *   • `axe` — injects axe-core into the page and exposes `checkA11y()`.
 *   • `loginAs(role)` — performs OTP login by talking to the API's
 *     test shortcut (gated behind a feature flag) and persists the
 *     session cookie.
 */
import { test as base } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

import type { Page } from '@playwright/test';

type Role = 'parent' | 'shikshak' | 'sanchalak' | 'city_admin' | 'super_admin';

interface JpFixtures {
  axe: { checkA11y: (selector?: string | null) => Promise<void> };
  loginAs: (role: Role) => Promise<void>;
}

export const test = base.extend<JpFixtures>({
  axe: async ({ page }: { page: Page }, use) => {
    await page.goto('/');
    await injectAxe(page);
    await use({
      checkA11y: async (selector?: string | null) =>
        checkA11y(page, selector ?? null, {
          detailedReport: true,
          axeOptions: { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } },
        }),
    });
  },
  loginAs: async ({ page }: { page: Page }, use) => {
    await use(async (role: Role) => {
      // Hit the API test shortcut to mint a session, then drop the cookie.
      const apiBase = process.env.JP_API_BASE_URL ?? 'http://localhost:3000';
      const res = await page.request.post(`${apiBase}/v1/_e2e/mint-session`, {
        data: { role },
      });
      if (!res.ok()) throw new Error(`mint-session failed: ${res.status()}`);
      const { data } = (await res.json()) as {
        data: { session_cookie: string; access_token: string };
      };
      await page.context().addCookies([
        {
          name: 'jp_session',
          value: data.session_cookie,
          domain: new URL(apiBase).hostname,
          path: '/',
          httpOnly: true,
          sameSite: 'Lax',
        },
      ]);
      // Persist access token in localStorage for client-side use.
      await page.addInitScript((token: string) => {
        window.localStorage.setItem('jp_access_token', token);
      }, data.access_token);
    });
  },
});

export { expect } from '@playwright/test';
