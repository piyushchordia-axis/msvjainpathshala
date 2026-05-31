#!/usr/bin/env bash
# prod-smoke.sh — post-deploy smoke test.
#
# Exits non-zero on any failure so the calling pipeline can gate on it.
#
# Usage:
#   bash infra/smoke-tests/prod-smoke.sh [BASE_URL]
#   bash infra/smoke-tests/prod-smoke.sh http://localhost:3000
#   bash infra/smoke-tests/prod-smoke.sh https://api.jainpathshala.org

set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
PASS_COUNT=0
FAIL_COUNT=0
FAIL_LINES=()

check() {
  local label="$1"
  shift
  echo -n "→ ${label} … "
  if "$@"; then
    echo "PASS"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL"
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAIL_LINES+=("${label}")
  fi
}

# 1. /healthz returns 200 quickly.
liveness() {
  local code
  code=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 5 "${BASE_URL}/healthz")
  [[ "${code}" == "200" ]]
}

# 2. /readyz returns 200 (all dependencies green).
readiness() {
  local body code
  body=$(curl -fsS --max-time 10 "${BASE_URL}/readyz" 2>/dev/null) || return 1
  code=$(echo "${body}" | head -1)
  echo "${body}" | grep -q '"status":"ok"' || return 1
}

# 3. OTP rate-limited but accepts a test phone (202 expected).
otp_send_works() {
  local code
  code=$(curl -fsS -o /dev/null -w "%{http_code}" \
    -X POST "${BASE_URL}/v1/auth/otp/send" \
    -H 'Content-Type: application/json' \
    -d '{"phone":"+919999000000"}' \
    --max-time 10)
  [[ "${code}" == "202" || "${code}" == "429" ]]
}

# 4. Unauthenticated GET on a protected route returns 401.
auth_enforced() {
  local code
  code=$(curl -fsS -o /dev/null -w "%{http_code}" \
    "${BASE_URL}/v1/auth/me" --max-time 5)
  [[ "${code}" == "401" ]]
}

# 5. /metrics returns text/plain Prometheus exposition (loopback only — skip if not local).
metrics_endpoint() {
  if [[ "${BASE_URL}" == "http://localhost:3000" || "${BASE_URL}" == "http://127.0.0.1:3000" ]]; then
    local body
    body=$(curl -fsS --max-time 5 "${BASE_URL}/metrics") || return 1
    echo "${body}" | head -5 | grep -q '^# ' || return 1
  fi
  return 0
}

# 6. CORS rejected for unrelated origin (we expect no ACAO on a foreign Origin).
cors_locked_down() {
  local headers
  headers=$(curl -fsS -I --max-time 5 -H 'Origin: https://evil.example.com' \
    "${BASE_URL}/healthz" 2>/dev/null || true)
  if [[ "${BASE_URL}" == http://localhost* ]]; then
    return 0
  fi
  ! echo "${headers}" | grep -i '^access-control-allow-origin: https://evil.example.com' >/dev/null
}

# 7. Helmet security headers present (HSTS + Frame DENY).
security_headers_present() {
  if [[ "${BASE_URL}" == http://localhost* ]]; then
    return 0
  fi
  local headers
  headers=$(curl -fsS -I --max-time 5 "${BASE_URL}/healthz" 2>/dev/null || true)
  echo "${headers}" | grep -i '^strict-transport-security' >/dev/null && \
    echo "${headers}" | grep -i '^x-frame-options: DENY' >/dev/null
}

echo "Smoke-testing ${BASE_URL}"
echo "---"
check "liveness   (/healthz 200)"      liveness
check "readiness  (/readyz dependencies)" readiness
check "otp/send accepts test phone"     otp_send_works
check "auth enforced on /v1/auth/me"    auth_enforced
check "/metrics exposition (loopback)"  metrics_endpoint
check "CORS locked down"                cors_locked_down
check "Security headers present"        security_headers_present

echo "---"
echo "${PASS_COUNT} passed, ${FAIL_COUNT} failed"
if (( FAIL_COUNT > 0 )); then
  printf "Failed checks:\n"
  for l in "${FAIL_LINES[@]}"; do echo "  • ${l}"; done
  exit 1
fi
exit 0
