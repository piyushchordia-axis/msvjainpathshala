# Runbook — DLQ replay

## 1. When this fires

- DLQ size for any queue > 100 — PagerDuty alert `dlq_growth`.
- Operator notices stale failed jobs in admin dashboard.

## 2. Severity

**sev2.** Background work is silently failing.

## 3. Detection

- Grafana → Queue Status → "DLQ depth per queue".
- Admin UI: `/admin/queues/dlq` lists every DLQ entry with payload + last error.

## 4. Procedure

1. **Triage the failure.** Click into the first DLQ entry and read the
   `last_error` field. Common shapes:
   - `ERR_VALIDATION_*` — bad payload from a producer bug; fix the
     producer and **discard** the DLQ entries.
   - `ECONNREFUSED` / 5xx — transient downstream issue; **replay**.
   - `ERR_RBAC_*` — actor's session has died since the job was queued;
     **discard** + notify the actor to re-enqueue manually.
2. **Replay a batch** of safe entries:
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     "$API/v1/admin/queues/${QUEUE_NAME}/dlq/replay" \
     -d '{"max":50}' -H "Content-Type: application/json"
   ```
   The endpoint:
   - Reads up to N jobs from the DLQ.
   - Re-enqueues each on the primary queue.
   - Marks the DLQ entries as `replayed_at`.
3. **Discard** unsafe entries:
   ```bash
   curl -X DELETE \
     -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
     "$API/v1/admin/queues/${QUEUE_NAME}/dlq/<job_id>" \
     -d '{"reason":"validation error — producer bug"}'
   ```
   Every discard writes an `audit_logs` entry.

## 5. Validation

- DLQ depth returns to 0 or stops growing.
- Replayed jobs complete successfully in the primary queue.
- No duplicate side effects (idempotency keys held).

## 6. Post-mortem checklist

- Identify the producer bug (if any) and file a follow-up.
- Note: never replay `auth.sms.otp.dlq` entries — OTPs have already expired
  by the time they hit DLQ; just discard.
