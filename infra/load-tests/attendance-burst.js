/**
 * k6 load test — 5,000 attendance marks over 60s.
 *
 * SLO: p95 < 1s, success > 99.9%, ZERO duplicate Punya txns / balance drift.
 *
 * Usage:
 *   BASE_URL=http://localhost:8080 \
 *   TOKEN=<shikshak JWT> \
 *   SESSION_ID=<uuid> \
 *   STUDENT_IDS=<comma-separated uuids> \
 *   k6 run infra/load-tests/attendance-burst.js
 *
 * If duplicates appear, stop and fix AT17/AT20 idempotency — do not raise SLO thresholds.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { ulid } from "./ulid-stub.js";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:8080";
const TOKEN = __ENV.TOKEN || "";
const SESSION_ID = __ENV.SESSION_ID || "";
const STUDENT_IDS = (__ENV.STUDENT_IDS || "").split(",").filter(Boolean);

const markLatency = new Trend("attendance_mark_latency", true);
const markSuccess = new Rate("attendance_mark_success");
const markFail = new Counter("attendance_mark_fail");

export const options = {
  scenarios: {
    burst: {
      executor: "constant-arrival-rate",
      rate: 84, // ~5,000 / 60s
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 100,
      maxVUs: 400,
    },
  },
  thresholds: {
    attendance_mark_latency: ["p(95)<1000"],
    attendance_mark_success: ["rate>0.999"],
    http_req_failed: ["rate<0.001"],
  },
};

function todayMarkedAt() {
  // Asia/Kolkata-ish ISO; override MARKED_AT for fixed session dates.
  return __ENV.MARKED_AT || new Date().toISOString();
}

export default function () {
  if (!TOKEN || !SESSION_ID || STUDENT_IDS.length === 0) {
    markFail.add(1);
    markSuccess.add(false);
    return;
  }

  const studentId = STUDENT_IDS[Math.floor(Math.random() * STUDENT_IDS.length)];
  const body = JSON.stringify({
    submission_op_id: ulid(),
    marked_at: todayMarkedAt(),
    marks: [
      {
        student_id: studentId,
        status: "present",
        client_op_id: ulid(),
      },
    ],
  });

  const res = http.post(`${BASE_URL}/v1/sessions/${SESSION_ID}/attendance`, body, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    tags: { name: "mark_attendance" },
  });

  markLatency.add(res.timings.duration);
  const ok = check(res, {
    "status 200": (r) => r.status === 200,
  });
  markSuccess.add(ok);
  if (!ok) markFail.add(1);

  sleep(0.01);
}

export function handleSummary(data) {
  const p95 = data.metrics.attendance_mark_latency?.values?.["p(95)"];
  const success = data.metrics.attendance_mark_success?.values?.rate;
  const fails = data.metrics.attendance_mark_fail?.values?.count ?? 0;
  console.log("\n=== attendance-burst summary ===");
  console.log(`p95 latency ms: ${p95}`);
  console.log(`success rate:   ${success}`);
  console.log(`failures:       ${fails}`);
  console.log(
    "Post-run: query punya_transactions for duplicate idempotency_key and balance != sum(points).",
  );
  return {
    stdout: textSummary(data, { indent: " ", enableColors: true }),
  };
}

function textSummary(data, _opts) {
  return JSON.stringify(
    {
      p95_ms: data.metrics.attendance_mark_latency?.values?.["p(95)"],
      success_rate: data.metrics.attendance_mark_success?.values?.rate,
      http_reqs: data.metrics.http_reqs?.values?.count,
    },
    null,
    2,
  );
}
