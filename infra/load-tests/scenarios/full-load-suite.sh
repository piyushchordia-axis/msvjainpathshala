#!/usr/bin/env bash
# full-load-suite.sh — runs all 5 k6 scripts serially and renders a
# markdown report under infra/load-tests/results/REPORT.md.
#
# Usage:
#   bash infra/load-tests/scenarios/full-load-suite.sh [--dry-run] [--base-url URL]
#
# Examples:
#   bash infra/load-tests/scenarios/full-load-suite.sh
#   bash infra/load-tests/scenarios/full-load-suite.sh --base-url https://staging-api.jainpathshala.org

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
K6_DIR="${REPO_ROOT}/infra/load-tests/k6"
RESULTS_DIR="${REPO_ROOT}/infra/load-tests/results"
BASE_URL="${BASE_URL:-http://localhost:3000}"
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    -h|--help) sed -n '1,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v k6 >/dev/null 2>&1 || {
  echo "ERROR: k6 not found on PATH. Install via https://k6.io/docs/get-started/installation/" >&2
  exit 127
}

mkdir -p "${RESULTS_DIR}"
rm -f "${RESULTS_DIR}"/*.json "${RESULTS_DIR}"/REPORT.md || true

echo "→ Pre-flight: ${BASE_URL}/readyz"
if [[ "${DRY_RUN}" -eq 0 ]]; then
  curl -fsS --max-time 5 "${BASE_URL}/readyz" >/dev/null || {
    echo "ERROR: readiness probe failed. Is the API running?" >&2
    exit 1
  }
fi

SCRIPTS=(
  "auth-otp-burst"
  "attendance-burst"
  "leaderboard-reads"
  "notification-fanout"
  "sync-batch"
)

declare -a STATUSES
for name in "${SCRIPTS[@]}"; do
  echo
  echo "▶ Running ${name}.js"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "  (dry-run — skipping)"
    STATUSES+=("${name}: DRY_RUN")
    continue
  fi
  if BASE_URL="${BASE_URL}" k6 run \
       --summary-export="${RESULTS_DIR}/${name}.json" \
       "${K6_DIR}/${name}.js"; then
    STATUSES+=("${name}: PASS")
  else
    STATUSES+=("${name}: FAIL (SLO breach)")
  fi
done

# ---------------------------------------------------------------------------
# Build REPORT.md
# ---------------------------------------------------------------------------
{
  echo "# Load test report"
  echo
  echo "- Generated: $(date -u +%FT%TZ)"
  echo "- Target: \`${BASE_URL}\`"
  echo "- Mode: $([[ ${DRY_RUN} -eq 1 ]] && echo dry-run || echo full)"
  echo
  echo "| Script | Status | p95 (ms) | success rate |"
  echo "|---|---|---|---|"
  for i in "${!SCRIPTS[@]}"; do
    name="${SCRIPTS[$i]}"
    status="${STATUSES[$i]}"
    file="${RESULTS_DIR}/${name}.json"
    p95="—"
    succ="—"
    if [[ -s "${file}" ]] && command -v jq >/dev/null 2>&1; then
      p95="$(jq -r '.metrics.http_req_duration["p(95)"] // "—"' "${file}" 2>/dev/null || echo "—")"
      fail_rate="$(jq -r '.metrics.http_req_failed.rate // 0' "${file}" 2>/dev/null || echo 0)"
      succ="$(awk -v f="${fail_rate}" 'BEGIN{ printf "%.4f", (1-f)*100 }')%"
    fi
    echo "| \`${name}\` | ${status} | ${p95} | ${succ} |"
  done
  echo
  echo "Raw summaries: \`infra/load-tests/results/<script>.json\`"
} > "${RESULTS_DIR}/REPORT.md"

echo
echo "→ Report written to ${RESULTS_DIR}/REPORT.md"
echo
cat "${RESULTS_DIR}/REPORT.md"

# Final exit status: non-zero if any script failed.
for s in "${STATUSES[@]}"; do
  case "$s" in
    *FAIL*) exit 1 ;;
  esac
done
