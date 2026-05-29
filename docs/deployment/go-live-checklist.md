# Go-live checklist

This is the canonical pre-deploy + deploy-time + post-deploy checklist for
**v1.0.0**. Tick every box before pushing the production tag.

## T-7 days — pre-deploy infrastructure

- [ ] AWS production account opened and Organizations OU configured
- [ ] `terraform apply` against `infra/terraform/envs/production` ran cleanly (run dry-run first)
- [ ] Route53 hosted zone `jainpathshala.org` exists and NS records propagated
- [ ] ACM certificates valid for at least 60 days in BOTH `us-east-1` (CloudFront) and `ap-south-1` (ALB)
- [ ] RDS PITR enabled with 30-day retention
- [ ] RDS snapshot taken manually and stored in cross-region replica bucket
- [ ] S3 buckets created with versioning + KMS SSE
- [ ] Secrets Manager populated:
  - [ ] `jp/prod/database/master`
  - [ ] `jp/prod/redis/master`
  - [ ] `jp/prod/jwt/keys` (RS256 keypair generated offline)
  - [ ] `jp/prod/integrations/razorpay` (LIVE keys; webhook secret matches Razorpay dashboard)
  - [ ] `jp/prod/integrations/msg91` (sender ID `JNPATH` approved by carrier)
  - [ ] `jp/prod/integrations/fcm` (service account JSON)
  - [ ] `jp/prod/integrations/resend`
  - [ ] `jp/prod/ai/openai`
  - [ ] `jp/prod/ai/hmac` (random 64-byte secret)
- [ ] FCM project + Android `google-services.json` + iOS `GoogleService-Info.plist` shipped in EAS production profile
- [ ] MSG91 sender ID `JNPATH` approved (DLT registration completed)
- [ ] Razorpay LIVE keys swapped from test mode
- [ ] 80G toggle pre-decision: `platform_settings.eighty_g_enabled` set, registration number recorded
- [ ] On-call rotation set up in PagerDuty; first two weeks scheduled
- [ ] Status page (Statuspage or BetterStack) configured with the seven runbook components

## T-2 days — staging verification

- [ ] Staging pipeline fully green for at least 24 hours
- [ ] Detox suite passes against staging-api (manual run — sim infra not wired in CI yet)
- [ ] Playwright suite passes against staging-admin (axe clean)
- [ ] k6 leaderboard-reads against staging hits SLO (`p95 < 200ms`)
- [ ] Weekly DAST scan completed with zero Medium-or-higher findings
- [ ] Backup restore drill executed within the last 30 days (see `docs/runbooks/backup-verification.md`)

## T-1 day — code freeze

- [ ] `main` branch frozen; only docs/runbook fixes allowed
- [ ] CHANGELOG / release notes drafted
- [ ] Manual VoiceOver + TalkBack walkthrough completed using `docs/accessibility/checklist.md`
- [ ] WCAG contrast audit reviewed (`docs/accessibility/wcag-contrast-audit.md`)

## Deploy day

- [ ] All on-call engineers paged into the deploy room
- [ ] Status page entry "Major deployment — Jain Pathshala v1.0 launching"
- [ ] Dispatch `deploy-production.yml` workflow with image SHA + release tag
- [ ] Migration **dry-run** approved by two reviewers (GitHub environment gate)
- [ ] Migration **apply** approved by two reviewers
- [ ] Blue/green deployment monitored at 10% / 50% / 100% — no error spike at each step
- [ ] `bash infra/smoke-tests/prod-smoke.sh https://api.jainpathshala.org` green
- [ ] Push test notification delivered to test devices
- [ ] Donation test `₹501` succeeds via real Razorpay LIVE flow (later refunded)
- [ ] Tag `v1.0.0` pushed to GitHub

## Post-deploy — week 1

- [ ] PagerDuty alerts armed; first 24 hours on alert-watch by on-call captain
- [ ] Slack `#deploys` notified
- [ ] Status page set back to "All systems operational"
- [ ] Watch the cost dashboard for unexpected spend spikes (especially R2 egress, OpenAI)
- [ ] Confirm Renovate / Snyk continue to flag new dependency advisories
- [ ] Schedule the first monthly backup-verification drill

## Rollback gates (each gate triggers rollback)

| Trigger                                                             | Action                                       |
| ------------------------------------------------------------------- | -------------------------------------------- |
| 5xx > 5% during 10/50/100% canary                                   | Halt + roll back to previous task definition |
| RDS unavailability for > 2 minutes                                  | Halt + execute `database-failover.md`        |
| Critical security finding within first 24h                          | Halt + execute `security-incident.md`        |
| Donation flow broken (any failed payment that wasn't customer-side) | Halt + execute `payment-gateway-outage.md`   |
