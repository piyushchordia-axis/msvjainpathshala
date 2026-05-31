#!/usr/bin/env node
/**
 * Step 12 smoke — exercise the notification fan-out + SMS segment math
 * directly against Redis + Postgres.
 *
 * What it does:
 *   1. Inserts (or finds) a synthetic parent user with a Hindi preference
 *      so the SMS path picks the UCS-2 segment count.
 *   2. Enqueues three fanout jobs on `notifications.fanout`:
 *      a. enrolment.approved → push + in-app to the parent
 *      b. notice.critical    → push + SMS + in-app
 *      c. notice.published with user.sms=false → SMS job NOT enqueued
 *   3. Polls BullMQ queue stats for ~5s after each enqueue so the
 *      verification reads the live counts.
 *
 * Run with the API worker started in another terminal
 * (`pnpm --filter @jp/api dev:worker`).
 */

import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import postgres from 'postgres';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sumit@localhost:5432/jainpathshala';

const QUEUES_TO_REPORT = [
  'notifications.fanout',
  'notifications.push',
  'notifications.sms',
  'notifications.email',
];

const sql = postgres(DATABASE_URL, { max: 1, prepare: false });
const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

function header(label) {
  console.log('\n=== ' + label + ' ===');
}

async function queueStats() {
  const out = {};
  for (const name of QUEUES_TO_REPORT) {
    const q = new Queue(name, { connection: { host: 'localhost', port: 6379 } });
    const counts = await q.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    out[name] = counts;
    await q.close();
  }
  return out;
}

async function diffStats(before, after) {
  const out = {};
  for (const name of QUEUES_TO_REPORT) {
    const b = before[name];
    const a = after[name];
    out[name] = {
      waiting: (a.waiting ?? 0) - (b.waiting ?? 0),
      active: (a.active ?? 0) - (b.active ?? 0),
      completed: (a.completed ?? 0) - (b.completed ?? 0),
      failed: (a.failed ?? 0) - (b.failed ?? 0),
    };
  }
  return out;
}

async function getOrCreateUser({ phone, language, prefs }) {
  const existing = await sql`SELECT id FROM users WHERE phone = ${phone} LIMIT 1`;
  if (existing.length > 0) {
    await sql`UPDATE users SET notification_preferences = ${sql.json(prefs)}, preferred_language = ${language} WHERE id = ${existing[0].id}`;
    return existing[0].id;
  }
  const inserted = await sql`
    INSERT INTO users (phone, role, full_name, preferred_language, is_active, notification_preferences)
    VALUES (${phone}, 'parent', 'Smoke User', ${language}, true, ${sql.json(prefs)})
    RETURNING id
  `;
  return inserted[0].id;
}

async function enqueueFanout(payload) {
  const q = new Queue('notifications.fanout', {
    connection: { host: 'localhost', port: 6379 },
  });
  const job = await q.add(payload.event, payload);
  await q.close();
  return job.id;
}

async function waitForJobsToDrain() {
  // Poll for ~6s to give the worker a window to process.
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main() {
  header('queue stats — baseline');
  const baseline = await queueStats();
  console.log(JSON.stringify(baseline, null, 2));

  // 1. Parent A — all channels ON, Hindi locale.
  const parentA = await getOrCreateUser({
    phone: '+91' + Math.floor(7000000000 + Math.random() * 9999999).toString(),
    language: 'hi',
    prefs: { push: true, sms: true, email: true, in_app: true },
  });
  // 2. Parent B — SMS toggled OFF.
  const parentB = await getOrCreateUser({
    phone: '+91' + Math.floor(7000000000 + Math.random() * 9999999).toString(),
    language: 'en',
    prefs: { push: true, sms: false, email: true, in_app: true },
  });
  console.log(`parentA=${parentA} (hi, all on)`);
  console.log(`parentB=${parentB} (en, sms off)`);

  // ----- Scenario 1: enrolment.approved (push + in-app + email, no SMS) -----
  header('scenario 1 — enrolment.approved → parentA');
  const beforeA = await queueStats();
  const jobA = await enqueueFanout({
    event: 'enrolment.approved',
    recipient_user_ids: [parentA],
    source: { kind: 'enrolment', id: '00000000-0000-0000-0000-000000000001' },
    data: { full_name: 'Aarav Mehta', student_code: 'JP-PUN-0501' },
  });
  console.log(`enqueued fanout job ${jobA}`);
  await waitForJobsToDrain();
  console.log('delta:', JSON.stringify(await diffStats(beforeA, await queueStats()), null, 2));

  // ----- Scenario 2: notice.critical (push + SMS + in-app) -----
  header('scenario 2 — notice.critical → parentA + parentB');
  const beforeB = await queueStats();
  const jobB = await enqueueFanout({
    event: 'notice.critical',
    recipient_user_ids: [parentA, parentB],
    source: { kind: 'notice', id: '00000000-0000-0000-0000-000000000002' },
    data: {
      title: 'Holiday tomorrow — Mahavir Jayanti',
      title_hi: 'कल अवकाश — महावीर जयंती',
      body: 'No classes Friday. Resume Saturday at usual time.',
      body_hi: 'शुक्रवार को कोई कक्षा नहीं। शनिवार को सामान्य समय पर पुनः प्रारंभ।',
    },
    send_sms: true,
    is_critical: true,
  });
  console.log(`enqueued fanout job ${jobB}`);
  await waitForJobsToDrain();
  const deltaB = await diffStats(beforeB, await queueStats());
  console.log('delta:', JSON.stringify(deltaB, null, 2));

  // ----- Scenario 3: notice.published → parentB only (sms=false honoured) -----
  header('scenario 3 — notice.published → parentB (sms preference OFF)');
  const beforeC = await queueStats();
  const jobC = await enqueueFanout({
    event: 'notice.published',
    recipient_user_ids: [parentB],
    source: { kind: 'notice', id: '00000000-0000-0000-0000-000000000003' },
    data: {
      title: 'Regular notice',
      title_hi: 'सामान्य सूचना',
      body: 'No SMS for this one.',
      body_hi: 'इस सूचना के लिए SMS नहीं।',
    },
    send_sms: true,
  });
  console.log(`enqueued fanout job ${jobC}`);
  await waitForJobsToDrain();
  const deltaC = await diffStats(beforeC, await queueStats());
  console.log('delta:', JSON.stringify(deltaC, null, 2));

  header('expectations summary');
  console.log('Scenario 1: push.completed=1 (parentA), sms.completed=0');
  console.log(
    'Scenario 2: push.completed=2 (parentA+B), sms.completed=1 (parentA only — parentB has sms=false)',
  );
  console.log('Scenario 3: push.completed=1 (parentB), sms.completed=0 (parentB sms=false)');
  console.log('observed sms total across 1+2+3 ≤ 1');

  // Check sms_logs (durable record).
  const smsCount =
    await sql`SELECT COUNT(*)::int AS c FROM sms_logs WHERE phone IN (SELECT phone FROM users WHERE id = ${parentA})`;
  console.log(`sms_logs rows for parentA: ${smsCount[0].c}`);

  await sql.end({ timeout: 2 });
  await redis.quit().catch(() => undefined);
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e);
  process.exit(1);
});
