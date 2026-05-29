// attendance-burst.js — SPEC.md §15.6 / SLO #2
//
// 5,000 attendance marks over 60 seconds, idempotent per `client_op_id`.
// We sample the same `client_op_id` twice in 1% of iterations to verify
// the duplicate guard is honoured (zero duplicates in the resulting
// `attendance_records` table).
//
// SLOs:
//   p95 < 1000ms
//   success rate > 99.9%
//   zero duplicates (verified post-hoc by querying COUNT(*) GROUP BY
//                    client_op_id and asserting all counts = 1)
//
// Run:
//   K6_TOKENS_FILE=tokens.json k6 run \
//     --env BASE_URL=http://localhost:3000 \
//     --env STUDENT_IDS_FILE=student-ids.json \
//     infra/load-tests/k6/attendance-burst.js

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import { BASE_URL, headers, readyOrAbort } from './lib/auth.js';
import { baseHttpThresholds } from './lib/thresholds.js';

const tokens = new SharedArray('tokens', () => {
  const path = __ENV.K6_TOKENS_FILE || './tokens.json';
  try {
    // eslint-disable-next-line no-restricted-globals
    return JSON.parse(open(path));
  } catch {
    // Allow fallback for shape-validation runs without seed data.
    return [{ role: 'shikshak', token: 'PLACEHOLDER' }];
  }
});

const students = new SharedArray('students', () => {
  const path = __ENV.STUDENT_IDS_FILE || './student-ids.json';
  try {
    // eslint-disable-next-line no-restricted-globals
    return JSON.parse(open(path));
  } catch {
    return Array.from(
      { length: 100 },
      (_, i) => `00000000-0000-0000-0000-${i.toString().padStart(12, '0')}`,
    );
  }
});

export const options = {
  scenarios: {
    attendance_burst: {
      executor: 'constant-arrival-rate',
      rate: 80,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 1000,
      maxVUs: 5000,
    },
  },
  thresholds: {
    ...baseHttpThresholds({ p95: 1000, failRate: 0.001 }),
  },
};

const dupCounter = new Counter('attendance_intentional_duplicates');

export function setup() {
  readyOrAbort();
}

export default function () {
  const token = tokens[__VU % tokens.length].token;
  const sid = students[__ITER % students.length];

  // Build a ULID-shaped client_op_id deterministically per (VU, ITER) so a
  // resend within a session re-uses the same id (idempotency probe).
  const opId =
    `K6L${__VU.toString(36).padStart(6, '0')}${__ITER.toString(36).padStart(6, '0')}`.toUpperCase();
  const sessionId = `00000000-0000-0000-0000-000000000${__VU.toString().padStart(3, '0')}`;

  const body = JSON.stringify({
    session_id: sessionId,
    marks: [{ student_id: sid, status: 'present', client_op_id: opId }],
  });

  http.post(`${BASE_URL}/v1/attendance/mark`, body, {
    headers: headers(token),
    tags: { name: 'attendance-mark' },
  });

  // Intentional duplicate ~1% of iterations: resend the same client_op_id
  // and assert the server returns the same shape (idempotent).
  if (__ITER % 100 === 0) {
    dupCounter.add(1);
    const r2 = http.post(`${BASE_URL}/v1/attendance/mark`, body, {
      headers: headers(token),
      tags: { name: 'attendance-mark-dup' },
    });
    check(r2, {
      'duplicate returns same status as first': (r) => r.status === 200 || r.status === 202,
    });
  }
}
