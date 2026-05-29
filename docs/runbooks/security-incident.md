# Runbook — Security incident

## 1. When this fires

- Confirmed unauthorised access (DB query, S3 object download, JWT theft).
- Penetration-test finding rated critical.
- Bug bounty submission with PoC.
- Anomalous spikes in `/v1/auth/otp/verify` errors that look like
  credential stuffing.

## 2. Severity

**sev1 (always).** Begin incident response immediately.

## 3. Detection

- Sentry — security tag.
- Grafana → Platform Health → "5xx rate" + "Authentication failure rate".
- Manual escalation via #security Slack channel.

## 4. Mitigation

### Containment (first 15 minutes)

1. **Halt the bleeding** — if a specific user/IP is implicated:
   ```bash
   # Revoke every active session for an actor
   pnpm --filter @jp/api exec tsx scripts/admin-revoke-sessions.ts \
     --user-id <user_id> --reason "security_incident.YYYYMMDD"
   ```
2. **Rotate JWT keys immediately** (every existing token dies; users must re-login):
   ```bash
   aws lambda invoke \
     --function-name jp-rotate-jwt-keys \
     --payload '{"env":"prod","reason":"security incident"}' /tmp/out.json
   ```
3. **Rotate any third-party secret you suspect was leaked**:
   - Razorpay → rotate key + webhook secret in Razorpay dashboard.
   - MSG91 → rotate auth key.
   - OpenAI → revoke + create new.
     Update AWS Secrets Manager paths under `jp/prod/integrations/*`.
4. **Isolate the impacted ECS service** (set desired count to 0 while you investigate).

### Investigation (next 60 minutes)

1. Pull `audit_logs` for the impacted actor/window:
   ```sql
   SELECT * FROM audit_logs
   WHERE actor_user_id = '...' OR target_user_id = '...'
     AND created_at > now() - interval '7 days'
   ORDER BY created_at;
   ```
2. Check CloudFront + ALB access logs for the source IP.
3. Capture an RDS snapshot **immediately** so post-mortem analysis has a frozen state.
4. Engage CERT-In / PCI auditor if donor financial PII was exposed (Step 21 / SPEC §16.7).

## 5. Validation

- All revoked sessions stay revoked (verify a refresh attempt with the
  old token returns `ERR_AUTH_TOKEN_INVALID`).
- New JWT key has propagated to every ECS task
  (`kid` in tokens minted post-rotation matches the new public key thumbprint).
- No further unauthorized access in the next 30 min.

## 6. Post-mortem checklist

- Public disclosure timeline per Indian DPDP Act 2023 (72-hour notification
  if personal data was likely exposed).
- Write-up in `docs/security-incidents/YYYY-MM-DD-<slug>.md`.
- File issues for every preventative control we identify.
- Bounty payout (if applicable).
- Update SPEC.md §16 if a new threat model emerged.
