/**
 * Playwright configuration — Step 23.
 *
 * The e2e suite covers public site, city_admin, and super_admin flows
 * and runs axe-playwright a11y checks after every navigation. The web
 * dev server is auto-started when `BASE_URL` is not set; CI / staging
 * runs target deployed URLs.
 *
 * Run:
 *   pnpm --filter @jp/web exec playwright install --with-deps
 *   pnpm --filter @jp/web exec playwright test
 */

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm dev',
        url: BASE_URL,
        reuseExistingServer: !IS_CI,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 120_000,
      },
});
