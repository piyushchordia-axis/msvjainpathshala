# Runbook — Database failover

## 1. When this fires

- `/readyz` returns 503 with `postgres_write` unhealthy.
- RDS CloudWatch alarm: `DatabaseConnections` → 0 or `CPUUtilization` → 100%.
- API 5xx spike across every authenticated endpoint.

## 2. Severity

**sev1.** Full platform outage.

## 3. Detection

- AWS Console → RDS → `jp-prod-postgres` → Events tab.
- Grafana → Database → "Connections", "Replication lag".
- PagerDuty alert `db_pool_exhausted` or `api_down`.

## 4. Mitigation

### Path A — primary is up, just slow / connection-exhausted

1. Identify offending query: `SELECT pid, query, state, query_start FROM pg_stat_activity
WHERE state <> 'idle' ORDER BY query_start LIMIT 20;`
2. Kill it: `SELECT pg_cancel_backend(<pid>);` (try cancel first, terminate as last resort).
3. If connection pool exhausted, scale `jp-api-prod` out by 2 tasks
   (CloudWatch dashboard → ECS service → Auto-scaling).

### Path B — primary is dead — promote read replica

⚠️ Promotion is one-way; the old primary cannot reattach as a replica without a snapshot restore.

1. **Pause writes**: scale `jp-api-prod` to 0 tasks (no more INSERTs).
   ```bash
   aws ecs update-service --cluster jp-prod --service jp-api-prod \
     --desired-count 0
   ```
2. **Promote replica**:
   ```bash
   aws rds promote-read-replica \
     --db-instance-identifier jp-prod-postgres-read \
     --backup-retention-period 30
   ```
3. **Update Secrets Manager** to point write URL at promoted instance:
   ```bash
   aws secretsmanager update-secret \
     --secret-id jp/prod/database/master \
     --secret-string "$(jq '.url = "postgresql://...@jp-prod-postgres-read.../jainpathshala"' <<< "$(aws secretsmanager get-secret-value --secret-id jp/prod/database/master --query SecretString --output text)")"
   ```
4. **Recreate read replica** off the new primary (async; do this once writes are stable).
5. **Scale API back up**:
   ```bash
   aws ecs update-service --cluster jp-prod --service jp-api-prod \
     --desired-count 4 --force-new-deployment
   ```

## 5. Validation

- `/readyz` returns 200 across all API tasks.
- Smoke test: `bash infra/smoke-tests/prod-smoke.sh https://api.jainpathshala.org`.
- Audit log shows no missing entries during the window
  (`SELECT count(*) FROM audit_logs WHERE created_at BETWEEN ... ;` matches expectations).

## 6. Post-mortem checklist

- Confirm RPO actually met (target 15 min): check the last `created_at` in
  every domain table just before the outage versus after promotion.
- Document promotion timeline; RTO target is 30 min.
- File ticket to rebuild the read replica.
- Verify donor + 80G certificate state — no double receipts.
