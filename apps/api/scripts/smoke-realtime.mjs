#!/usr/bin/env node
/**
 * Step 12 realtime smoke — verify the Socket.IO gateway:
 *
 *   1. Hit `/v1/auth/otp/send` + `verify` with the dev master OTP to mint
 *      a super_admin token.
 *   2. Connect to `/admin-dashboard/<city>` with `auth: { token }`.
 *   3. Print the connect event + the `activity` event that the API emits
 *      when an enrolment is approved.
 *
 * Bare-bones — emits success / failure with simple log lines so smoke
 * tests can grep for them.
 */

import { randomUUID } from 'node:crypto';

import { io } from 'socket.io-client';

const API = process.env.JP_API ?? 'http://localhost:3000';
const PHONE = process.env.JP_PHONE ?? '+919999988888';
const MASTER_OTP = process.env.JP_DEV_MASTER_OTP ?? '424242';
const DEVICE_ID = randomUUID();

async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return json.data ?? json;
}

async function getJson(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return json.data ?? json;
}

async function main() {
  console.log('1. /v1/auth/otp/send');
  const sent = await postJson('/v1/auth/otp/send', { phone: PHONE });
  console.log(`   otp_token=${sent.otp_token.slice(0, 12)}…`);

  console.log('2. /v1/auth/otp/verify (master OTP)');
  const verified = await postJson('/v1/auth/otp/verify', {
    otp_token: sent.otp_token,
    code: MASTER_OTP,
    device: { device_id: DEVICE_ID, platform: 'web' },
  });
  const token = verified.tokens.access_token;
  console.log(`   role=${verified.user.role} sub=${verified.user.id.slice(0, 8)}…`);

  console.log('3. /v1/auth/me to grab city_id');
  const me = await getJson('/v1/auth/me', token);
  const cityId = me.scope?.city_id ?? null;
  console.log(`   me.role=${me.role} city_id=${cityId ?? '(none)'}`);
  if (!cityId) {
    console.log(
      'NOTE: this account has no city scope; using a synthetic id so the socket connect path is still exercised',
    );
  }

  const cid = cityId ?? randomUUID();
  console.log(`4. Socket.IO connect → /admin-dashboard/${cid}`);
  const socket = io(`${API}/admin-dashboard/${cid}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });

  const result = await new Promise((resolve) => {
    let resolved = false;
    socket.on('connect', () => {
      console.log(`   ✓ connected sid=${socket.id} ns=${socket.nsp}`);
      if (!resolved) {
        resolved = true;
        resolve({ ok: true });
      }
    });
    socket.on('connect_error', (err) => {
      console.log(`   ✗ connect_error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, reason: err.message });
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ ok: false, reason: 'timeout' });
      }
    }, 5_000);
  });

  if (result.ok) {
    console.log('   listening for activity (3s)…');
    socket.on('activity', (env) => {
      console.log(`   ← activity ${env.data.event}: ${env.data.summary_en}`);
    });
    await new Promise((r) => setTimeout(r, 3_000));
  }

  socket.disconnect();
  console.log(result.ok ? '\nSMOKE OK' : `\nSMOKE FAILED: ${result.reason}`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message);
  process.exit(1);
});
