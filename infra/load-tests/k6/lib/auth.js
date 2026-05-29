// OTP login helper — mints a JWT for a synthetic phone using the dev SMS
// provider (ConsoleSmsProvider in `apps/api/src/modules/auth/providers`).
// The provider logs the OTP code; for tests we either:
//   (a) hit a debug endpoint to fetch the OTP for a phone, or
//   (b) pre-seed users with a known role via `pnpm db:seed:dev` and use
//       a synthetic JWT minted via a helper endpoint (only enabled when
//       JP_LOAD_TEST_TOKEN_ENDPOINT=true in env).
//
// For SLO runs we DO NOT loop login per VU — instead, the runner script
// seeds tokens up-front and reads them from `K6_TOKENS_FILE` (JSON array
// of {role, token} entries). This keeps OTP load out of the unrelated
// scenarios.

import http from 'k6/http';
import { check, fail } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export function readyOrAbort() {
  const r = http.get(`${BASE_URL}/readyz`, { tags: { name: 'readyz' } });
  if (!check(r, { 'readyz 200': (res) => res.status === 200 })) {
    fail(`API readiness probe returned ${r.status}; aborting load test.`);
  }
}

export const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-Requested-With': 'jp-load-test',
});

export { BASE_URL };
