/**
 * Node fallback when k6 is unavailable — 5,000 concurrent marks over ~60s.
 * Reports p95, success rate, and SQL checks for duplicate Punya / balance drift.
 *
 * Usage (PowerShell):
 *   $env:BASE_URL="http://127.0.0.1:8080"
 *   $env:TOKEN="..."
 *   $env:SESSION_ID="..."
 *   $env:STUDENT_IDS="uuid1,uuid2,..."
 *   $env:DATABASE_URL="postgres://..."
 *   node infra/load-tests/attendance-burst-node.mjs
 */
import pg from "pg";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:8080";
const TOKEN = process.env.TOKEN || "";
const SESSION_ID = process.env.SESSION_ID || "";
const STUDENT_IDS = (process.env.STUDENT_IDS || "").split(",").filter(Boolean);
const TOTAL = Number(process.env.TOTAL || 5000);
const WINDOW_MS = Number(process.env.WINDOW_MS || 60_000);
const MARKED_AT = process.env.MARKED_AT || new Date().toISOString();

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now = Date.now()) {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[(Math.random() * 32) | 0];
  return (time + rand).slice(0, 26);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

async function oneMark(studentId) {
  const started = performance.now();
  const res = await fetch(`${BASE_URL}/v1/sessions/${SESSION_ID}/attendance`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      submission_op_id: ulid(),
      marked_at: MARKED_AT,
      marks: [{ student_id: studentId, status: "present", client_op_id: ulid() }],
    }),
  });
  const ms = performance.now() - started;
  return { ok: res.status === 200, status: res.status, ms };
}

async function main() {
  if (!TOKEN || !SESSION_ID || STUDENT_IDS.length === 0) {
    console.error("TOKEN, SESSION_ID, STUDENT_IDS required");
    process.exit(2);
  }

  const latencies = [];
  let success = 0;
  let fail = 0;
  const started = Date.now();
  const inFlight = new Set();
  let launched = 0;

  await new Promise((resolve) => {
    const tick = () => {
      const elapsed = Date.now() - started;
      if (launched >= TOTAL || elapsed >= WINDOW_MS + 5_000) {
        if (inFlight.size === 0) return resolve();
        return setTimeout(tick, 50);
      }
      const target = Math.floor((elapsed / WINDOW_MS) * TOTAL);
      while (launched < target && launched < TOTAL) {
        const sid = STUDENT_IDS[launched % STUDENT_IDS.length];
        const p = oneMark(sid).then((r) => {
          latencies.push(r.ms);
          if (r.ok) success++;
          else fail++;
          inFlight.delete(p);
        });
        inFlight.add(p);
        launched++;
      }
      setTimeout(tick, 5);
    };
    tick();
  });

  latencies.sort((a, b) => a - b);
  const p95 = percentile(latencies, 95);
  const rate = success / (success + fail || 1);

  console.log("=== attendance-burst-node ===");
  console.log(`launched:     ${launched}`);
  console.log(`success:      ${success}`);
  console.log(`fail:         ${fail}`);
  console.log(`success rate: ${(rate * 100).toFixed(4)}%`);
  console.log(`p95 ms:       ${p95?.toFixed(1)}`);

  let duplicateKeys = null;
  let balanceDrift = null;
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const dup = await pool.query(`
        select idempotency_key, count(*)::int as c
        from punya_transactions
        where idempotency_key is not null
          and source_entity_id = $1::uuid
          and source_entity_kind = 'attendance'
        group by idempotency_key
        having count(*) > 1
      `, [SESSION_ID]);
      duplicateKeys = dup.rows.length;

      const drift = await pool.query(`
        select b.student_id
        from punya_balances b
        join (
          select student_id, coalesce(sum(points),0)::int as s
          from punya_transactions
          group by student_id
        ) t on t.student_id = b.student_id
        where b.total_points <> t.s
        limit 20
      `);
      balanceDrift = drift.rows.length;
      console.log(`duplicate idempotency keys (session): ${duplicateKeys}`);
      console.log(`balance drift rows: ${balanceDrift}`);
      if (duplicateKeys > 0 || balanceDrift > 0) {
        console.error("FAIL: idempotency/balance invariant broken — do not paper over.");
        process.exit(1);
      }
    } finally {
      await pool.end();
    }
  }

  if (p95 == null || p95 >= 1000 || rate <= 0.999) {
    console.error("FAIL: SLO not met (p95 < 1s, success > 99.9%).");
    process.exit(1);
  }
  console.log("SLO OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
