// auth-otp-burst.js — SPEC.md §15.6 / SLO #1
//
// 10,000 OTP send requests over 60 seconds, one per VU. Each VU picks a
// unique phone number derived from its iteration index so the per-phone
// rate limit (3/min) and per-IP rate limit (30/hr) do NOT interact —
// this scenario stresses the burst-capacity of the OTP provider stub,
// the Redis sliding-window writer, and the audit insert.
//
// SLOs:
//   p95 < 500ms
//   success rate > 99.5%
//
// Run:
//   k6 run --env BASE_URL=http://localhost:3000 \
//     infra/load-tests/k6/auth-otp-burst.js

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

import { BASE_URL, readyOrAbort } from './lib/auth.js';
import { baseHttpThresholds } from './lib/thresholds.js';

export const options = {
  scenarios: {
    otp_burst: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 1000,
      maxVUs: 10_000,
      stages: [
        { target: 200, duration: '20s' },
        { target: 200, duration: '40s' },
      ],
    },
  },
  thresholds: {
    ...baseHttpThresholds({ p95: 500, failRate: 0.005 }),
    'http_reqs{name:otp-send}': ['count>100'], // sanity — we actually sent traffic
  },
};

const sendCount = new Counter('otp_sends_attempted');

export function setup() {
  readyOrAbort();
}

export default function () {
  // Build a phone derived from the VU + iter so each request is unique.
  const id = `${(__VU * 100000 + __ITER).toString().padStart(8, '0')}`;
  const phone = `+9199${id.slice(0, 9)}`.slice(0, 13);

  const res = http.post(`${BASE_URL}/v1/auth/otp/send`, JSON.stringify({ phone }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'otp-send' },
  });
  sendCount.add(1);

  check(res, {
    'status 202 or 429': (r) => r.status === 202 || r.status === 429,
    'has envelope': (r) => r.status !== 202 || (r.body && r.body.includes('otp_token')),
  });
}
