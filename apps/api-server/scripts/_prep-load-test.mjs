/**
 * Prep fixtures for attendance-burst-node load test.
 * Prints TOKEN= SESSION_ID= STUDENT_IDS= MARKED_AT=
 */
import pg from "pg";

const BASE = process.env.BASE_URL || "http://127.0.0.1:8080";
const PHONE = process.env.SHIKSHAK_PHONE || "+919800000005";

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

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const send = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ phase: "send", phone: PHONE }),
});
const sendBody = await send.json();
const otpToken = sendBody.data.otp_token;
const code = sendBody.data.dev_code ?? "123456";
const verify = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    phase: "verify",
    otp_token: otpToken,
    code,
    device_id: "load-test-prep",
  }),
});
const verifyBody = await verify.json();
if (!verify.ok) {
  console.error("login failed", verify.status, JSON.stringify(verifyBody));
  process.exit(1);
}
const token = verifyBody.data.tokens.access_token;
const userId = verifyBody.data.user.id;

const day = await pool.query(
  `select to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as d`,
);
const scheduledDate = day.rows[0].d;

const batch = await pool.query(
  `select b.id, b.centre_id from batches b
   join shikshak_batch_assignments sba on sba.batch_id = b.id
   where sba.user_id = $1 and b.deleted_at is null
   limit 1`,
  [userId],
);
if (!batch.rows[0]) {
  // fall back: any batch with students
  const any = await pool.query(
    `select b.id, b.centre_id from batches b
     join students s on s.batch_id = b.id and s.status='active'
     where b.deleted_at is null
     group by b.id, b.centre_id having count(*) >= 1
     order by count(*) desc limit 1`,
  );
  if (!any.rows[0]) {
    console.error("no batch");
    process.exit(1);
  }
  batch.rows[0] = any.rows[0];
}
const batchId = batch.rows[0].id;

const sess = await pool.query(
  `insert into sessions (batch_id, scheduled_date, scheduled_start_time, scheduled_end_time, status, topic, shikshak_user_id)
   values ($1, $2::date, '09:00', '11:00', 'in_progress', 'load-test-burst', $3)
   on conflict (batch_id, scheduled_date) do update
     set status = 'in_progress', topic = 'load-test-burst', cancelled_at = null, cancellation_reason = null
   returning id, scheduled_date`,
  [batchId, scheduledDate, userId],
);
const sessionId = sess.rows[0].id;

const students = await pool.query(
  `select id from students where batch_id = $1 and status = 'active' and deleted_at is null limit 40`,
  [batchId],
);
if (students.rows.length === 0) {
  console.error("no students");
  process.exit(1);
}

const markedAt = `${scheduledDate}T10:00:00.000+05:30`;
console.log(`TOKEN=${token}`);
console.log(`SESSION_ID=${sessionId}`);
console.log(`STUDENT_IDS=${students.rows.map((r) => r.id).join(",")}`);
console.log(`MARKED_AT=${markedAt}`);
await pool.end();
