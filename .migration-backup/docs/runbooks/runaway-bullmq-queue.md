# Runbook — Runaway BullMQ queue

## 1. When this fires

- Any queue's waiting count > 10,000 for 5 minutes.
- Worker CPU > 90% sustained.
- DLQ growth on the same queue.

## 2. Severity

**sev2.** Background jobs are backing up; user-facing endpoints unaffected
but eventual consistency (notifications, ID cards, reports) is degraded.

## 3. Detection

- Grafana → Queue Status dashboard → "Waiting per queue" panel.
- `pnpm --filter @jp/api exec tsx scripts/queue-stats.ts` (admin CLI).
- PagerDuty alert `queue_backlog`.

## 4. Mitigation

1. **Identify the offending queue**:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/queue-stats.ts --top 5
   ```
2. **Scale out the matching worker service** in ECS:
   ```bash
   aws ecs update-service --cluster jp-prod \
     --service jp-worker-${QUEUE_GROUP} \
     --desired-count 6
   ```
3. **Throttle the producer** (if the burst is from an admin action):
   - Pause the queue:
     ```bash
     pnpm --filter @jp/api exec tsx scripts/admin-pause-queue.ts ${QUEUE_NAME}
     ```
   - Communicate to the admin who triggered it (likely a bulk export
     or critical notice) — wait for queue depth to drop before resuming.
4. **Inspect the slow job**:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/queue-inspect.ts \
     ${QUEUE_NAME} --state active --limit 5
   ```
   Look for stuck jobs > 5 min; consider killing them so retries can fire.

## 5. Validation

- Waiting count drops to < 1,000.
- DLQ growth halts.

## 6. Post-mortem checklist

- Identify whether the issue was producer-side (burst) or consumer-side
  (slow processor) and file a perf ticket if the latter.
- Update auto-scaling thresholds if the trigger fired too slowly.
- Confirm no duplicates were produced as a result of pause-then-resume.
