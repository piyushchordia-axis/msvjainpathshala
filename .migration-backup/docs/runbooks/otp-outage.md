# Runbook — OTP outage

## 1. When this fires

- MSG91 returning 5xx > 50% for 5 minutes (Grafana alert `otp_send_failure_rate`).
- Customer support tickets spike with "I'm not receiving the OTP".
- App logs show `OtpService` `ERR_SMS_PROVIDER_UNREACHABLE` repeatedly.

## 2. Severity

**sev1.** Login is fully blocked — no user can authenticate. Treat as a customer-facing outage and post a status-page update within 10 minutes.

## 3. Detection

- Grafana → Platform Health → "OTP send success rate (5m)" panel.
- Loki query: `{service="api"} |= "ERR_SMS_PROVIDER" | line_format "{{.msg}}"`
- MSG91 status page: <https://status.msg91.com>

## 4. Mitigation

1. **Confirm MSG91 vs us.** From a workstation run:

   ```bash
   curl -fsS -X POST "https://api.msg91.com/api/v5/otp" \
     -H "authkey: $(aws secretsmanager get-secret-value \
        --secret-id jp/prod/integrations/msg91 \
        --query 'SecretString' --output text | jq -r '.auth_key')" \
     -d '{"mobile":"919999999999","sender":"JNPATH","otp":"123456"}'
   ```

   If 5xx, MSG91 is down. If 200, the regression is on our side.

2. **Flip the fallback toggle.** In `super_admin` → Platform settings →
   "SMS provider", switch from `msg91` to `resend-sms` (Resend ships an SMS
   product that we keep configured as a hot-standby). Effective within 30s.

3. **Mass-notify in-app.** Post a critical notice via
   `POST /v1/notices { audience: 'national', is_critical: true,
title_en: 'SMS delays', body_en: 'OTP delivery is slow; please retry in a
minute.' }` — the in-app notification keeps users informed even when SMS
   is failing.

4. ⚠️ **Last resort — admin OTP issuance.** If escalations come from a
   high-priority user (sanchalak with attendance to mark RIGHT NOW), a
   super_admin can run:
   ```bash
   pnpm --filter @jp/api exec tsx scripts/admin-issue-otp.ts \
     --phone "+919XXXXXXXXX" --reason "msg91 outage"
   ```
   The script writes an `audit_logs` entry with `action='auth.otp.issued_manually'`.

## 5. Validation

- Send a fresh OTP to a test phone and verify it arrives within 30s.
- Grafana `otp_send_success_rate` recovers to > 99%.
- Status page updated to "Resolved".

## 6. Post-mortem checklist

- Capture the MSG91 incident URL and our timeline (alert fire → fallback flip → resolved).
- Verify Resend cost delta did not exceed the daily cap (`SMS_MONTHLY_CAP_INR`).
- File a follow-up ticket if the fallback toggle took > 30s to propagate; investigate the cache TTL.
- Confirm no `phone` or `otp` values appear in any captured logs (PII redactor health check).
