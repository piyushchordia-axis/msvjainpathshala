# Runbook — Data correction protocol

## 1. When this fires

A confirmed bad data write (wrong donation amount, mis-credited Punya,
incorrect enrolment status) needs to be corrected. The fix MUST preserve
the audit trail.

## 2. Severity

Variable. Most cases are sev3; financial PII (donations, 80G certs) is sev2.

## 3. Core rule

> **Never UPDATE or DELETE history.** Always make a forward correction.

`audit_logs` has `GRANT INSERT ONLY` for the app role; the same discipline
applies to `donations`, `punya_transactions`, `attendance_records`,
`niyam_submissions`, etc. — every domain table records the truth at the
time of write and is corrected by appending a reversing event.

## 4. Procedure

### Punya / Niyam wrong-credit

```sql
-- never: UPDATE punya_transactions SET amount=-x WHERE id=...
-- always:
INSERT INTO punya_transactions(student_id, feature_key, amount, source_kind,
                               source_id, idempotency_key, reversal_of,
                               created_by, reason)
VALUES (...,
        - (SELECT amount FROM punya_transactions WHERE id = $1),
        'correction',
        $1,
        'correction-' || $1,
        $1,
        '<super_admin_id>',
        'manual correction — ticket JP-XXXX');
```

Then re-run `punya.reconcile` to recompute balances + leaderboards.

### Donation / 80G certificate

- Issue a manual refund via Razorpay if money moved.
- Set `donations.status = 'reversed'` via the admin API endpoint
  (which inserts a reversal row, not a hard UPDATE).
- The 80G certificate is NEVER deleted; instead, a "cancellation note"
  PDF is generated and stored under `donation_certificate_revocations`.

### Enrolment / Student status

- Use the existing `POST /v1/students/:id/deactivate` endpoint.
- Re-activation goes through `POST /v1/students/:id/reactivate`.
- Never UPDATE `students.status` directly.

## 5. Validation

- Re-read the impacted row and confirm the user-facing view shows the
  corrected number.
- `audit_logs` shows the correction entry with actor + reason.
- For Punya: rerun reconcile; expect 0 drift.

## 6. Post-mortem checklist

- File a regression test that recreates the original bad write.
- Confirm the operator who pushed the correction was authenticated as
  `super_admin` (no one else may run these scripts).
