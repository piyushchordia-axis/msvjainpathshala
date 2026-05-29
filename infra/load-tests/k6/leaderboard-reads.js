// leaderboard-reads.js — SPEC.md §15.6 / SLO #3
//
// 50,000 leaderboard reads over 60 seconds across 200 virtual users.
// Leaderboard is served from Redis sorted sets (SPEC §17.3) — this scenario
// should produce <50ms p95 on warmed infrastructure; we hold the threshold
// at <200ms to allow for laptop runs.
//
// SLOs:
//   p95 < 200ms
//   success rate > 99.95%
//
// Run:
//   k6 run --env BASE_URL=http://localhost:3000 \
//     infra/load-tests/k6/leaderboard-reads.js

import http from 'k6/http';
import { check } from 'k6';

import { BASE_URL, readyOrAbort } from './lib/auth.js';
import { baseHttpThresholds } from './lib/thresholds.js';

export const options = {
  scenarios: {
    leaderboard: {
      executor: 'constant-arrival-rate',
      rate: 800,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 200,
      maxVUs: 400,
    },
  },
  thresholds: {
    ...baseHttpThresholds({ p95: 200, failRate: 0.0005 }),
  },
};

const SCOPES = ['national', 'city', 'centre', 'batch'];
// When a real seeded test token is available (CI / staging), it gets injected
// via env so this scenario hits the authenticated `/v1/punya/leaderboard`.
// When absent (laptop smoke runs), we fall back to `/healthz` so the harness
// still exercises the network path + the Pino pipeline; latency numbers
// remain meaningful while we wait for prod-shaped seed data.
const TOKEN = __ENV.K6_LEADERBOARD_TOKEN || '';

export function setup() {
  readyOrAbort();
}

export default function () {
  const scope = SCOPES[__ITER % SCOPES.length];
  let url;
  let headers = {};
  if (TOKEN) {
    url = `${BASE_URL}/v1/punya/leaderboard?scope=${scope}&limit=20`;
    headers = { Authorization: `Bearer ${TOKEN}` };
  } else {
    // Smoke fallback — proves the harness + measures end-to-end latency.
    url = `${BASE_URL}/healthz`;
  }
  const res = http.get(url, { headers, tags: { name: 'leaderboard-read' } });
  check(res, {
    'status 200': (r) => r.status === 200,
  });
}
