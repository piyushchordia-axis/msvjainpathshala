# Runbook — Push notification outage

## 1. When this fires

- FCM rejection rate > 50% for 10 minutes (`notification_push_failure_rate`).
- Sustained DLQ growth on `notifications.push.dlq`.

## 2. Severity

**sev2.** Customer-facing degradation but not a hard outage — in-app feed still works; SMS fallback handles critical notices.

## 3. Detection

- Grafana → Queue Status → `notifications.push waiting / failed`.
- FCM console error tab.
- Loki: `{service="api",msg="notifications.push.fail"}`

## 4. Mitigation

1. Check FCM status: <https://status.firebase.google.com>.
2. If FCM is degraded, **pause** `notifications.push`:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/admin-pause-queue.ts notifications.push
   ```
   This keeps the worker from burning retry budget while FCM recovers.
3. Notifications fan-out keeps writing to the `notifications` table → in-app feed continues to function.
4. For critical notices already enqueued, escalate via SMS:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/admin-resend-critical-via-sms.ts \
     --since 'last 30 minutes'
   ```
5. When FCM is back, resume the queue:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/admin-resume-queue.ts notifications.push
   ```

## 5. Validation

- DLQ growth stops.
- Test push from `super_admin` → "Send test push" reaches the dev device within 5s.

## 6. Post-mortem checklist

- Identify whether the bad-token cleanup ran (prune of FCM-reported-invalid tokens).
- Confirm we did not exhaust SMS monthly cap as a side effect.
- Review whether DLQ replay backed up the worker (consider scaling out `jp-worker-notifications` temporarily).
