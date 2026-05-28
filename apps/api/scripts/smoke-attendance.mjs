#!/usr/bin/env node
/**
 * Step 13 smoke — exercise the GPS check-in + bulk mark + Punya idempotency
 * end-to-end via HTTP. Verifies the prompt's "actual command output" exit
 * criteria.
 *
 * Run with the API up (`pnpm --filter @jp/api dev > /tmp/api.log 2>&1 &`).
 * Pass the log path via API_LOG=/tmp/api.log so the script can scrape the
 * OTP printed by ConsoleSmsProvider.
 */

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const API = process.env.API ?? 'http://localhost:3000';
const API_LOG = process.env.API_LOG ?? '/tmp/api-step13.log';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sumit@localhost:5432/jainpathshala';

const CENTRE_LAT = 23.0225;
const CENTRE_LNG = 72.5714;

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });

function header(label) {
  console.log('\n=== ' + label + ' ===');
}

async function postJson(path, body, headers = {}) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  let json;
  try {
    json = JSON.parse(txt);
  } catch {
    json = { raw: txt };
  }
  return { status: res.status, body: json };
}

async function readOtpFromLog(phone) {
  // Wait up to 3s for the OTP to land in the log.
  const deadline = Date.now() + 3000;
  let lastOtp = null;
  while (Date.now() < deadline) {
    try {
      const log = await readFile(API_LOG, 'utf8');
      const lines = log.split('\n').reverse();
      for (const ln of lines) {
        const m = ln.match(/\[OTP\]\s+(\+\d+)\s+(?:→|->)\s+(\d{4,6})/);
        if (m && m[1] === phone) {
          lastOtp = m[2];
          break;
        }
      }
      if (lastOtp) return lastOtp;
    } catch {
      // log not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('OTP not found in ' + API_LOG + ' for ' + phone);
}

async function mintShikshakAccess(tag) {
  const [state] =
    await sql`INSERT INTO states(name, code) VALUES (${'ST-' + tag}, ${tag.slice(-3).toUpperCase()}) RETURNING id`;
  const [city] =
    await sql`INSERT INTO cities(state_id, name, code) VALUES (${state.id}, ${'CITY-' + tag}, ${'C' + tag.slice(-2)}) RETURNING id`;
  const [centre] =
    await sql`INSERT INTO centres(city_id, name, status, gps_radius_m, lat, lng) VALUES (${city.id}, ${'Centre-' + tag}, 'active', 500, ${CENTRE_LAT}, ${CENTRE_LNG}) RETURNING id`;

  const phone = '+91999' + tag.slice(-7).padStart(7, '0');
  // Pre-INSERT the user with role=shikshak so /v1/auth/otp/verify finds
  // them via findByPhone and signs the JWT with role=shikshak. (The verify
  // path falls back to createGuest only when findByPhone returns null.)
  await sql`INSERT INTO users(phone, role, full_name, preferred_language, is_active, city_id)
    VALUES (${phone}, 'shikshak', 'Smoke Shikshak', 'en', true, ${city.id})`;
  const send = await postJson('/v1/auth/otp/send', { phone });
  if (send.status < 200 || send.status >= 300)
    throw new Error('otp/send failed: ' + JSON.stringify(send));
  const code = await readOtpFromLog(phone);
  const verify = await postJson('/v1/auth/otp/verify', {
    otp_token: send.body.data.otp_token,
    code,
    device: { device_id: 'smoke-' + tag, platform: 'ios' },
  });
  if (verify.status < 200 || verify.status >= 300)
    throw new Error('otp/verify failed: ' + JSON.stringify(verify));
  const userId = verify.body.data.user.id;
  const access = verify.body.data.tokens.access_token;

  const [batch] =
    await sql`INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status, shikshak_id)
    VALUES (${centre.id}, ${'Bal-' + tag}, 'bal', '{0,1,2,3,4,5,6}', '09:00', '11:00', 30, 'active', ${userId}) RETURNING id`;
  const parentPhone = '+91999' + tag.slice(-7).padStart(7, '2');
  const [parent] =
    await sql`INSERT INTO users(phone, role, full_name, preferred_language, is_active, city_id)
    VALUES (${parentPhone}, 'parent', 'Smoke Parent', 'en', true, ${city.id}) RETURNING id`;
  const studentIds = [];
  for (let i = 0; i < 5; i += 1) {
    const [stu] =
      await sql`INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id, batch_id, student_code, status, enrolled_at)
      VALUES (${parent.id}, ${'Smoke-' + tag + '-' + i}, '2017-04-12', 'bal', ${centre.id}, ${batch.id}, ${'MSV-SM-' + tag + '-' + i}, 'active', now()) RETURNING id`;
    studentIds.push(stu.id);
  }
  return { access, userId, batchId: batch.id, studentIds, centreId: centre.id };
}

async function punyaCount() {
  const [row] =
    await sql`SELECT COUNT(*)::int AS c FROM punya_transactions WHERE idempotency_key LIKE 'attendance:%'`;
  return row.c;
}

async function balances(ids) {
  const rows = [];
  for (const id of ids) {
    const [r] =
      await sql`SELECT student_id, total_points FROM punya_balances WHERE student_id = ${id}::uuid`;
    if (r) rows.push(r);
  }
  return rows;
}

async function main() {
  const tag = Date.now().toString().slice(-6);
  header('1. Mint shikshak + seed org tree');
  const ctx = await mintShikshakAccess(tag);
  console.log('  shikshak userId:', ctx.userId);
  console.log('  batchId:', ctx.batchId);
  console.log('  students:', ctx.studentIds.length);

  header('2. POST /v1/sessions/check-in (in-radius)');
  const checkIn = await postJson(
    '/v1/sessions/check-in',
    {
      batch_id: ctx.batchId,
      lat: CENTRE_LAT + 0.0001,
      lng: CENTRE_LNG,
      accuracy_m: 15,
      client_op_id: randomUUID(),
    },
    { authorization: 'Bearer ' + ctx.access },
  );
  console.log('  status:', checkIn.status);
  console.log(
    '  session:',
    JSON.stringify({
      id: checkIn.body?.data?.session?.id,
      status: checkIn.body?.data?.session?.status,
      distance_m: checkIn.body?.data?.session?.check_in_distance_m,
    }),
  );
  const sessionId = checkIn.body?.data?.session?.id;
  if (!sessionId) throw new Error('No session id returned: ' + JSON.stringify(checkIn));

  header('3. POST /v1/attendance/mark (5 students)');
  const marksBody = {
    session_id: sessionId,
    marks: ctx.studentIds.map((sid) => ({
      student_id: sid,
      status: 'present',
      client_op_id: randomUUID(),
    })),
  };
  const mark1 = await postJson('/v1/attendance/mark', marksBody, {
    authorization: 'Bearer ' + ctx.access,
  });
  console.log('  status:', mark1.status);
  console.log('  items:', mark1.body?.data?.items?.length);

  // Give the post_process processor a moment if a worker is running.
  await new Promise((r) => setTimeout(r, 300));
  const punyaBefore = await punyaCount();
  console.log('  punya_transactions where idempotency_key LIKE attendance:%  →', punyaBefore);

  header('4. Re-POST identical mark — idempotency check');
  const mark2 = await postJson('/v1/attendance/mark', marksBody, {
    authorization: 'Bearer ' + ctx.access,
  });
  console.log('  status:', mark2.status);
  const punyaAfter = await punyaCount();
  console.log('  punya_transactions count after replay  →', punyaAfter);
  console.log('  unchanged?', punyaBefore === punyaAfter);

  header('5. punya_balances for the 5 students');
  const bals = await balances(ctx.studentIds);
  for (const b of bals) {
    console.log('  ', b.student_id, '→', b.total_points, 'pts');
  }

  header('6. POST /v1/sessions/:id/check-out');
  const out = await postJson(
    '/v1/sessions/' + sessionId + '/check-out',
    {
      lat: CENTRE_LAT,
      lng: CENTRE_LNG,
      client_op_id: randomUUID(),
    },
    { authorization: 'Bearer ' + ctx.access },
  );
  console.log('  status:', out.status);
  console.log(
    '  session:',
    JSON.stringify({
      status: out.body?.data?.session?.status,
      duration_minutes: out.body?.data?.session?.duration_minutes,
    }),
  );

  await sql.end({ timeout: 5 });
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('smoke failed:', err);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  });
