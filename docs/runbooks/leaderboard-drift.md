# Runbook — Punya leaderboard drift

## 1. When this fires

- Nightly `punya.reconcile` job flagged more than 10 students whose
  `punya_balances` projection disagrees with the ledger's running sum.
- Alert `punya_drift` in PagerDuty.

## 2. Severity

**sev2.** Trust-and-safety risk — a parent sees the wrong Punya number
on their child's screen.

## 3. Detection

- Grafana → Business Metrics → "Reconcile drift count (last run)" panel.
- Loki: `{service="api",msg="punya.reconcile.drift"}`.

## 4. Mitigation

1. **Confirm scope** — view the drift report:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/punya-drift-report.ts \
     --since "yesterday 03:00 IST"
   ```
   The report lists `(student_id, ledger_sum, balance_sum, delta)`.
2. **Run a forced rebuild** on the affected students:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/punya-rebuild-balance.ts \
     --student-id <id> --student-id <id> ...
   ```
   The script reads every `punya_transactions` row for the student and
   overwrites `punya_balances` inside a single transaction. Idempotent.
3. **Rebuild the Redis ZSET leaderboard** for any impacted scope:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/punya-rebuild-leaderboard.ts \
     --scope batch --scope-id <batch_id>
   ```
4. **Root-cause hunt** — drift usually comes from one of:
   - A processor crash mid-transaction (rare; transactions should be atomic).
   - A manual SQL write that skipped the service.
   - An idempotency_key collision between two concurrent producers.

## 5. Validation

- Re-run `punya.reconcile` ad-hoc:
  ```bash
  pnpm --filter @jp/api exec tsx scripts/punya-reconcile.ts --dry-run
  ```
  Expected: 0 students drifted.

## 6. Post-mortem checklist

- Capture which feature(s) produced the drift (homework/niyam/attendance).
- If a code path is at fault, write a regression test that locks the
  idempotency guarantee.
- Audit log entries should show the rebuild action with the actor
  (super_admin) and reason (`punya.drift.repair`).
