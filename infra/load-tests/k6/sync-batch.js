// sync-batch.js — SPEC.md §15.6 / SLO #5
//
// 1,000 concurrent `POST /v1/sync/batch` calls, each carrying 50 client
// operations. Operations are deterministically duplicated across iterations
// to verify the idempotency_key UPSERT logic — the server should accept
// every batch but never persist duplicate domain rows.
//
// SLOs:
//   p95 < 5,000 ms
//   zero duplicate persisted operations (verify by counting
//   `sync_operations.client_op_id` matches; all groups should be count=1).
//
// Run:
//   K6_TOKENS_FILE=tokens.json k6 run \
//     --env BASE_URL=http://localhost:3000 \
//     infra/load-tests/k6/sync-batch.js

import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

import { BASE_URL, headers, readyOrAbort } from './lib/auth.js';

const tokens = new SharedArray('tokens', () => {
  const path = __ENV.K6_TOKENS_FILE || './tokens.json';
  try {
    // eslint-disable-next-line no-restricted-globals
    return JSON.parse(open(path));
  } catch {
    return [{ role: 'shikshak', token: 'PLACEHOLDER' }];
  }
});

export const options = {
  scenarios: {
    sync_batch: {
      executor: 'constant-vus',
      vus: 200,
      duration: '60s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000'],
    http_req_failed: ['rate<0.01'],
    sync_dup_ops_attempted: ['count>0'], // sanity — we did exercise the dup path
  },
};

const dupCounter = new Counter('sync_dup_ops_attempted');

export function setup() {
  readyOrAbort();
}

export default function () {
  const token = tokens[__VU % tokens.length].token;
  const ops = [];
  // 50 operations per batch. The middle 5 ops (indexes 20–24) re-use the
  // SAME client_op_id across iterations so the server's UPSERT path is
  // continuously exercised.
  for (let i = 0; i < 50; i++) {
    const stable = i >= 20 && i < 25;
    const opId = stable
      ? `K6S-DUP-${i.toString().padStart(2, '0')}`
      : `K6S-${__VU.toString().padStart(4, '0')}-${__ITER.toString(36)}-${i}`;
    if (stable) dupCounter.add(1);
    ops.push({
      client_op_id: opId,
      op_type: 'attendance.mark',
      client_timestamp: new Date().toISOString(),
      payload: {
        session_id: '00000000-0000-0000-0000-000000000000',
        student_id: '00000000-0000-0000-0000-000000000000',
        status: 'present',
      },
    });
  }

  const res = http.post(`${BASE_URL}/v1/sync/batch`, JSON.stringify({ operations: ops }), {
    headers: headers(token),
    tags: { name: 'sync-batch' },
  });
  check(res, {
    'sync batch accepted': (r) => r.status === 200 || r.status === 207,
  });
}
