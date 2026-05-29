/**
 * Detox global helpers shared across every e2e spec.
 *
 * - `loginAsRole(role)` — uses the staging API's test-OTP shortcut to mint
 *   a session for a synthetic user. The shortcut endpoint is gated behind
 *   `LOAD_TEST_TOKENS_ENABLED=true` in env; the suite never runs against
 *   real production phone numbers.
 * - `toggleAirplaneMode(on)` — wraps Detox's `device.setNetworkSpeed`/
 *   `device.setURLBlacklist` for cross-platform offline simulation.
 *
 * Each spec imports the named helpers — keeping per-spec boilerplate small.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeAll, afterAll } from '@jest/globals';

declare const device: any;
declare const by: any;
declare const element: any;
declare const waitFor: any;

export type Role = 'parent' | 'shikshak' | 'sanchalak' | 'city_admin' | 'super_admin' | 'volunteer';

export const TEST_BASE_URL = process.env.JP_TEST_BASE_URL ?? 'http://10.0.2.2:3000';

beforeAll(async () => {
  await device.launchApp({
    permissions: { notifications: 'YES', camera: 'YES', location: 'always' },
    newInstance: true,
    delete: true,
    launchArgs: {
      JP_TEST_BASE_URL: TEST_BASE_URL,
      JP_E2E_DETOX: '1',
    },
  });
});

afterAll(async () => {
  await device.terminateApp();
});

/**
 * Bypass the OTP screens by injecting a deep link with a one-time token.
 * The mobile app honours the `jp://e2e/login?token=...` scheme only when
 * `JP_E2E_DETOX=1` is set on launch (see init code in app shell).
 */
export async function loginAsRole(role: Role): Promise<void> {
  const token = await mintE2eToken(role);
  await device.openURL({ url: `jp://e2e/login?token=${encodeURIComponent(token)}` });
  await waitFor(element(by.id('home-root')))
    .toBeVisible()
    .withTimeout(20_000);
}

async function mintE2eToken(role: Role): Promise<string> {
  const res = await fetch(`${TEST_BASE_URL}/v1/_e2e/mint-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error(`mint-token failed: ${res.status}`);
  const json = (await res.json()) as { data: { access_token: string } };
  return json.data.access_token;
}

export async function toggleAirplaneMode(on: boolean): Promise<void> {
  if (device.getPlatform() === 'ios') {
    if (on) await device.setURLBlacklist(['.*']);
    else await device.setURLBlacklist([]);
  } else {
    await device.setNetworkSpeed(on ? 'no-network' : 'wifi');
  }
}
