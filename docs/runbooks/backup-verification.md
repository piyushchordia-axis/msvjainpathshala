# Runbook — Monthly backup verification drill

## 1. When this fires

Scheduled — first Saturday of every month, 11:00 IST. Owned by the on-call
ops engineer. Not a reactive runbook.

## 2. Severity

Planned activity (not an incident). Skipping it weakens our DR posture.

## 3. Detection

Calendar reminder + a Slack `/op` bot ping on the day.

## 4. Procedure

1. **Pick the snapshot.** Open AWS Console → RDS → `jp-prod-postgres` →
   Snapshots tab. Choose the most recent automated snapshot.
2. **Restore into a sandbox instance**:
   ```bash
   aws rds restore-db-instance-from-db-snapshot \
     --db-instance-identifier jp-restore-test-$(date +%Y%m%d) \
     --db-snapshot-identifier <snapshot_arn> \
     --db-instance-class db.t4g.medium
   ```
3. **Run integrity checks** once `available`:
   ```bash
   psql "$RESTORE_URL" -c "SELECT count(*) FROM users;"
   psql "$RESTORE_URL" -c "SELECT count(*) FROM students;"
   psql "$RESTORE_URL" -c "SELECT count(*) FROM punya_transactions;"
   psql "$RESTORE_URL" -c "SELECT max(created_at) FROM audit_logs;"
   ```
   Compare against current prod within reasonable bounds (matched at the
   snapshot timestamp).
4. **Smoke test** by pointing a local API at the restore:
   ```bash
   DATABASE_URL="$RESTORE_URL" \
     pnpm --filter @jp/api dev &
   bash infra/smoke-tests/prod-smoke.sh http://localhost:3000
   ```
5. **Tear down** once verified:
   ```bash
   aws rds delete-db-instance \
     --db-instance-identifier jp-restore-test-$(date +%Y%m%d) \
     --skip-final-snapshot --delete-automated-backups
   ```

## 5. Validation

- Restore completed within 60 minutes.
- Row counts within ±0.1% of prod equivalents at the snapshot point.
- Smoke tests green.

## 6. Sign-off

- File the result in `docs/runbooks/drills/YYYY-MM-DD-restore-drill.md`.
- If the drill failed, escalate to sev2 — the next prod incident is
  effectively a coin flip until backups are validated.
