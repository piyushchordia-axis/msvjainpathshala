#!/usr/bin/env node
/* eslint-disable no-console -- CLI smoke script; console.log is the output channel. */
/**
 * Auth round-trip smoke. Exercises the same API the mobile app calls so
 * Step 8 can prove the wire format (envelope, token shape, PATCH /me)
 * matches what the client expects.
 *
 * Steps:
 *   1. POST /v1/auth/otp/send  → 202 + otp_token
 *   2. Scrape the OTP from the API stdout/stderr log file passed via
 *      `JP_API_LOG` (default: /tmp/api.log). The dev server's
 *      ConsoleSmsProvider prints `[OTP] +91… → ######`.
 *   3. POST /v1/auth/otp/verify → 200 + { user, tokens, … }
 *   4. GET  /v1/auth/me with the access token → 200 + user shape
 *   5. PATCH /v1/auth/me { preferred_language: 'hi' } → 200 + persisted
 *   6. GET  /v1/auth/me again → confirms preferred_language === 'hi'
 *
 * Defaults can be overridden with env vars:
 *   JP_API_BASE_URL  default http://localhost:3000
 *   JP_API_LOG       default /tmp/api.log
 *   JP_TEST_PHONE    default +919000654321 (any E.164 — new phones are
 *                    auto-created as `guest` per Step 5)
 *
 * Exits 0 on full success, non-zero on first failure.
 */

import { readFileSync } from 'node:fs';

const BASE = process.env.JP_API_BASE_URL ?? 'http://localhost:3000';
const LOG_PATH = process.env.JP_API_LOG ?? '/tmp/api.log';
const PHONE = process.env.JP_TEST_PHONE ?? '+919000654321';

function log(msg) {
  console.log(`[smoke-auth] ${msg}`);
}
function fail(msg) {
  console.error(`[smoke-auth] FAIL: ${msg}`);
  process.exit(1);
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  return { status: res.status, body };
}

function scrapeLatestOtp(phone) {
  let raw;
  try {
    raw = readFileSync(LOG_PATH, 'utf8');
  } catch (err) {
    fail(`could not read ${LOG_PATH}: ${err.message}`);
  }
  // Strip ANSI escapes. Using fromCharCode to dodge the no-control-regex lint
  // rule — pino-pretty wraps the OTP log line in color codes.
  const esc = String.fromCharCode(27);
  const clean = raw.replace(new RegExp(`${esc}\\[[0-9;]*m`, 'g'), '');
  const re = new RegExp(`\\[OTP\\] ${phone.replace('+', '\\+')} → (\\d{6})`, 'g');
  let last = null;
  for (const m of clean.matchAll(re)) {
    last = m[1];
  }
  return last;
}

(async () => {
  log(`base=${BASE} phone=${PHONE} log=${LOG_PATH}`);

  // 1) Send OTP
  const send = await fetchJson(`${BASE}/v1/auth/otp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE }),
  });
  if (send.status !== 202)
    fail(`otp/send expected 202, got ${send.status}: ${JSON.stringify(send.body)}`);
  if (!send.body?.data?.otp_token) fail('otp/send missing otp_token');
  log(`  ✓ otp/send 202 otp_token=${send.body.data.otp_token.slice(0, 12)}…`);

  // 2) Scrape OTP. Pino-pretty buffers stdout so the new OTP line may not
  //    show up in the log file for a few hundred ms after the response.
  //    We poll for an OTP newer than the one we already saw (if any).
  const before = scrapeLatestOtp(PHONE);
  let otp = null;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const seen = scrapeLatestOtp(PHONE);
    if (seen && seen !== before) {
      otp = seen;
      break;
    }
  }
  if (!otp) fail(`could not find fresh OTP for ${PHONE} in ${LOG_PATH} after 5s`);
  log(`  ✓ scraped OTP from log: ${otp}`);

  // 3) Verify
  const verify = await fetchJson(`${BASE}/v1/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: PHONE,
      code: otp,
      device: { device_id: 'smoke-test', platform: 'web' },
    }),
  });
  if (verify.status !== 200)
    fail(`otp/verify expected 200, got ${verify.status}: ${JSON.stringify(verify.body)}`);
  const access = verify.body?.data?.tokens?.access_token;
  const user = verify.body?.data?.user;
  if (!access) fail('otp/verify missing tokens.access_token');
  if (!user?.id || !user?.role) fail('otp/verify missing user.id / user.role');
  log(`  ✓ otp/verify 200 role=${user.role} user_id=${user.id}`);

  // 4) GET /me
  const me1 = await fetchJson(`${BASE}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (me1.status !== 200)
    fail(`GET /me expected 200, got ${me1.status}: ${JSON.stringify(me1.body)}`);
  log(`  ✓ GET /me 200 preferred_language=${me1.body.data.preferred_language}`);

  // 5) PATCH /me { preferred_language: 'hi' }
  const targetLang = me1.body.data.preferred_language === 'hi' ? 'en' : 'hi';
  const patch = await fetchJson(`${BASE}/v1/auth/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${access}`,
    },
    body: JSON.stringify({ preferred_language: targetLang }),
  });
  if (patch.status !== 200)
    fail(`PATCH /me expected 200, got ${patch.status}: ${JSON.stringify(patch.body)}`);
  if (patch.body?.data?.user?.preferred_language !== targetLang) {
    fail(`PATCH /me did not persist language (got ${patch.body?.data?.user?.preferred_language})`);
  }
  log(`  ✓ PATCH /me 200 preferred_language=${targetLang}`);

  // 6) GET /me again → confirm
  const me2 = await fetchJson(`${BASE}/v1/auth/me`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  if (me2.status !== 200) fail(`final GET /me expected 200, got ${me2.status}`);
  if (me2.body.data.preferred_language !== targetLang) {
    fail(`final GET /me showed ${me2.body.data.preferred_language}, expected ${targetLang}`);
  }
  log(`  ✓ final GET /me confirms preferred_language=${targetLang}`);

  log('ALL OK');
  process.exit(0);
})().catch((err) => {
  console.error('[smoke-auth] uncaught:', err);
  process.exit(1);
});
