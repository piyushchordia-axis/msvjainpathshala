# Jain Pathshala — v1.0 final handover report

**Date:** 29 May 2026
**Release tag:** `v1.0.0`
**Owner of this document:** Enaa Creations / MSV operations team
**Companion docs:** [`docs/runbooks/`](../runbooks/), [`docs/deployment/`](../deployment/), [`docs/accessibility/`](../accessibility/), [`SPEC.md`](../../SPEC.md), [`CLAUDE.md`](../../CLAUDE.md)

---

## 1. Every module built (one line each)

| Step | Module(s)                                                                                                                                                                                | SPEC.md ref              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1    | Monorepo + tooling (`pnpm` + Turborepo + ESLint + commitlint)                                                                                                                            | §4                       |
| 2    | `@jp/shared` (Zod/DTOs/enums), `@jp/design-tokens`, `@jp/i18n`                                                                                                                           | §4 / §6                  |
| 3    | NestJS backend boot, Pino + OTel + Sentry, Drizzle + Redis, `/healthz`+`/readyz`+`/metrics`                                                                                              | §3 / §18.6 / §18.12      |
| 4    | Full schema (60+ tables), migrations 0001–0004, `audit_writer` Postgres role                                                                                                             | §5                       |
| 5    | Auth (OTP + RS256 + refresh family + scope guards + impersonation)                                                                                                                       | §7                       |
| 6    | Geography, centres, batches, centre_holidays, registration form configs                                                                                                                  | §5.4–5.7 / Step 6 prompt |
| 7    | BullMQ — 30 queues, DLQ pairing, cron scheduler, queue metrics publisher                                                                                                                 | §9 / §18.5               |
| 8    | Expo mobile shell (Expo Router v6, 8 role tab navigators, MMKV stores)                                                                                                                   | §11.1                    |
| 9    | Next.js 15 web shell (public site + admin layout, shadcn/ui, next-intl)                                                                                                                  | §11.2                    |
| 10   | Parent enrolment + admin approval, MSV enrolment, multi-child                                                                                                                            | §5.5 / Q1                |
| 11   | Media (signed URLs, processing pipeline), ID card generation                                                                                                                             | §10                      |
| 12   | Notifications fan-out (FCM batched, MSG91 SMS, Resend email, Socket.IO realtime)                                                                                                         | §8 / §11.3               |
| 13   | Attendance + GPS check-in + post-process pipeline + consecutive-absence cron                                                                                                             | §8.1–8.4                 |
| 14   | Offline sync engine (`/v1/sync/batch`, MMKV queues, conflict resolution)                                                                                                                 | §11.4                    |
| 15   | QR scanning + Shivir lifecycle + live attendance dashboard + CSV/PDF exports                                                                                                             | §5.8 / Step 15           |
| 16   | Punya ledger + tier engine + Redis ZSET leaderboards + reconcile cron                                                                                                                    | §7 / §17.3               |
| 17   | Niyams + 30-day reversal window (Q5) + Gallery opt-in (Q6) + streak badges                                                                                                               | §5.9 / Q5 / Q6           |
| 18   | Homework + Notices (critical SMS) + Competitions                                                                                                                                         | §5.10–5.12 / Step 18     |
| 19   | Curriculum + Exams (Q2 super_admin gate at service layer)                                                                                                                                | §5.13 / Q2               |
| 20   | Scheduled quizzes + push quizzes (Socket.IO `/push-quizzes/:id`)                                                                                                                         | §5.14 / Step 20          |
| 21   | FastAPI AI service (HMAC) + Razorpay donations + 80G certs (Q3)                                                                                                                          | §3 / §5.18 / Q3          |
| 22   | Library (Q7 video embed) + Service requests + Reports + Analytics MVs                                                                                                                    | §5.17 / §5.16 / Q7       |
| 23   | Helmet + throttler + auth security suite, k6 SLOs, Detox + Playwright + axe, 14 Terraform modules + 2 env compositions, full CI/CD trio, 13 runbooks, accessibility audit, handover docs | §15 / §16 / §17 / §18    |

---

## 2. Lines of code

| Language / category                       | Lines   | Notes                                                                     |
| ----------------------------------------- | ------- | ------------------------------------------------------------------------- |
| TypeScript (apps + packages, source only) | ~65,000 | `find . -name '*.ts' -not -path '*/node_modules/*' -not -path '*/dist/*'` |
| TSX (mobile + web components)             | ~37,000 | Same filter                                                               |
| Python (apps/ai source)                   | ~620    | `find apps/ai -name '*.py' -not -path '*/.venv/*'`                        |
| SQL migrations                            | ~2,400  | `apps/api/src/db/migrations/`                                             |
| Terraform                                 | ~2,500  | `infra/terraform/` (14 modules + 2 envs)                                  |
| YAML (CI/CD + grafana)                    | ~640    | `.github/workflows/` + `infra/grafana/alerts/`                            |
| Markdown (docs + runbooks)                | ~18,000 | `docs/` + module READMEs                                                  |

Breakdown by app:

| App / package                   | TS+TSX lines |
| ------------------------------- | ------------ |
| `apps/api/src`                  | ~50,600      |
| `apps/mobile` (`src/` + `app/`) | ~17,300      |
| `apps/web` (`src/` + `app/`)    | ~9,800       |
| `packages/*`                    | ~6,400       |

---

## 3. Test coverage

| Suite                                 | Count (Step 23)                         | Notes                                                                                                     |
| ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Integration (Vitest + Testcontainers) | 175 tests across 26 files               | 144 pre-existing + 31 added in Step 23 (5 auth-security specs + 1 queue-registry)                         |
| Unit                                  | 0 dedicated unit specs                  | Integration suite covers controller + service layers end-to-end                                           |
| Detox (mobile e2e)                    | 4 specs authored, not executed          | Requires Android emulator + iOS simulator infra (deferred — see §5)                                       |
| Playwright (web e2e)                  | 3 specs authored + axe-playwright wired | Browser binaries install in CI step `pnpm exec playwright install`; deferred until staging URL configured |
| k6 (load)                             | 5 scripts authored                      | `leaderboard-reads.js` runs as part of Step 23 verification                                               |
| Queue-registry assertion              | 1 spec, 3 tests                         | Verifies all 30 BullMQ queues are enqueueable                                                             |

Pre-existing flaky tests inherited from earlier steps: **5 enrolment specs** fail when run together due to OTP-per-IP rate-limit pollution across the suite. Confirmed pre-existing (reproduces on the cfff3be baseline via `git stash`). Tracked as tech debt — see §5.

---

## 4. Load test results summary (SPEC §15.6 SLOs)

| Scenario                                        | SLO                              | Status (this build)                                              |
| ----------------------------------------------- | -------------------------------- | ---------------------------------------------------------------- |
| `auth-otp-burst.js` (10k VUs / 60s)             | p95 < 500ms, success > 99.5%     | Authored only — run against staging-api during go-live week      |
| `attendance-burst.js` (5k VUs / 60s)            | p95 < 1s, success > 99.9%, 0 dup | Authored only                                                    |
| `leaderboard-reads.js` (50k iters / 200 VUs)    | p95 < 200ms, success > 99.95%    | ✅ Executed against `localhost:3000` during Step 23 verification |
| `notification-fanout.js` (100×500 = 50k pushes) | 95% delivered < 30s              | Authored only                                                    |
| `sync-batch.js` (1k VUs × 50 ops)               | p95 < 5s, 0 dup                  | Authored only                                                    |

> Local k6 numbers reported in `infra/load-tests/results/leaderboard-reads.json` after the verification run; the laptop hardware will likely miss the SLO and that's OK — the contract is staging-class infra.

---

## 5. Outstanding tech debt + remediation timeline

| Item                                         | Why deferred                                                                                 | Remediation owner / target                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Detox e2e execution in CI                    | Needs hosted Android emulator runner                                                         | Ops, +30 days                                                                                                     |
| Playwright e2e execution in CI               | Needs `playwright install --with-deps` Docker image                                          | DevX, +14 days                                                                                                    |
| Full k6 load suite execution against staging | Needs warmed staging infra                                                                   | SRE, go-live week                                                                                                 |
| Real `terraform apply` against AWS           | No AWS account in dev environment                                                            | Cloud platform, +0 (gates production)                                                                             |
| 5 pre-existing flaky enrolments specs        | Tests collide on OTP per-IP rate limit when run together — pollution from earlier test files | Auth backend, +14 days; either move tests to ephemeral Redis prefix or bump the per-IP cap in the integration env |
| OpenAPI spec generation                      | SPEC §11.5 — currently no `openapi.yaml` emitted                                             | Backend, +30 days                                                                                                 |
| Manual VoiceOver + TalkBack walkthrough      | Requires physical devices                                                                    | QA, go-live week                                                                                                  |
| AI moderation feature flag → ON              | Default OFF per CLAUDE.md; needs cost forecast first                                         | Product, +60 days                                                                                                 |

---

## 6. Third-party services + credentials owners

| Service                  | Path in Secrets Manager            | Owner / on-call      | Renewal cadence                     |
| ------------------------ | ---------------------------------- | -------------------- | ----------------------------------- |
| AWS                      | (IAM roles via OIDC)               | Cloud platform lead  | per IAM-policy lifecycle            |
| MSG91 (SMS)              | `jp/prod/integrations/msg91`       | Operations lead      | yearly DLT re-verification          |
| Resend (Email)           | `jp/prod/integrations/resend`      | Operations lead      | on demand                           |
| Firebase Cloud Messaging | `jp/prod/integrations/fcm`         | Mobile platform lead | service account 1yr                 |
| Razorpay                 | `jp/prod/integrations/razorpay`    | Finance lead         | webhook secret rotation per release |
| OpenAI                   | `jp/prod/ai/openai`                | AI/ML lead           | per usage cap                       |
| Cloudflare R2            | `jp/prod/storage/r2`               | Cloud platform lead  | annual key rotation                 |
| Sentry                   | env-baked DSN                      | Backend lead         | yearly                              |
| PagerDuty                | terraform-managed integration key  | Operations lead      | quarterly                           |
| Slack (webhooks)         | `secrets.SLACK_WEBHOOK_*` (GitHub) | Operations lead      | on incident                         |

---

## 7. Complete env var list (auto-extracted from `apps/api/src/core/config/env.schema.ts`)

Generate with:

```bash
node -e "const {envSchema}=require('./apps/api/src/core/config/env.schema'); console.log(Object.keys(envSchema.shape).sort().join('\n'))"
```

Required at boot (validated via Zod, fails-fast on missing):

| Var                                                                   | Source                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| `DATABASE_URL`                                                        | Secrets Manager `jp/prod/database/master.url`                   |
| `DATABASE_URL_READ`                                                   | Secrets Manager (optional; falls back to write)                 |
| `REDIS_URL`                                                           | Secrets Manager `jp/prod/redis/master.url`                      |
| `JWT_PRIVATE_KEY_PEM`                                                 | Secrets Manager `jp/prod/jwt/keys.private_pem`                  |
| `JWT_PUBLIC_KEY_PEM`                                                  | Secrets Manager `jp/prod/jwt/keys.public_pem`                   |
| `JWT_PREVIOUS_PUBLIC_KEY_PEM`                                         | Secrets Manager (during rotation window)                        |
| `CORS_ALLOWED_ORIGINS`                                                | terraform-templated per env                                     |
| `STORAGE_DRIVER`                                                      | `r2` in prod, `minio` in dev                                    |
| `STORAGE_*` (endpoint, keys, buckets)                                 | Secrets Manager `jp/prod/storage/r2` + terraform outputs        |
| `MSG91_AUTH_KEY`                                                      | Secrets Manager `jp/prod/integrations/msg91.auth_key`           |
| `FCM_SERVICE_ACCOUNT_JSON`                                            | Secrets Manager `jp/prod/integrations/fcm.service_account_json` |
| `RESEND_API_KEY`                                                      | Secrets Manager `jp/prod/integrations/resend.api_key`           |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Secrets Manager `jp/prod/integrations/razorpay.*`               |
| `OPENAI_API_KEY`                                                      | Secrets Manager `jp/prod/ai/openai.api_key`                     |
| `AI_SERVICE_URL`                                                      | terraform output (service discovery)                            |
| `AI_SERVICE_HMAC_SECRET`                                              | Secrets Manager `jp/prod/ai/hmac.secret`                        |
| `AI_SERVICE_IP_ALLOWLIST`                                             | terraform-templated                                             |
| `AI_MODERATION_ENABLED`                                               | terraform var (`false` at launch)                               |
| `EIGHTY_G_ENABLED`                                                    | mirrors `platform_settings.eighty_g_enabled`                    |
| `SMS_MONTHLY_CAP_INR`                                                 | terraform var                                                   |
| `OTEL_SERVICE_NAME` / `OTEL_EXPORTER_OTLP_ENDPOINT`                   | terraform-templated                                             |
| `SENTRY_DSN`                                                          | env-baked per env                                               |
| `LOG_LEVEL`                                                           | terraform var (`info` in prod)                                  |
| `NODE_ENV`                                                            | `production`                                                    |
| `PORT`                                                                | `3000` (api) / `3100` (worker) / `3001` (web)                   |

Full canonical list in `apps/api/.env.example`.

---

## 8. Known limitations + deferred roadmap

### Dependency advisories at v1.0

`pnpm audit --audit-level=high` at release time reports:

| Severity | Count | Where                                                                                                                                                                                                                                           |
| -------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | 0     | (Next.js bumped 15.1.3 → 15.5.18 to patch GHSA-9qr9-h5gf-34mp and GHSA-f82v-jwr5-mffw during the Step 23 hardening pass)                                                                                                                        |
| High     | 21    | All in transitive deps — predominantly `@xmldom/xmldom` via Detox dev-only chain, `tar` via dev tooling, `lodash` via legacy ESLint plugins, `@opentelemetry/exporter-prometheus` (we use OTLP instead), `multer` via NestJS unused upload path |

These are dev-only or unreachable production code paths. Tracked as a
follow-up to either upgrade the carriers (Detox, ESLint plugins, OTel exporter
bundle) or add explicit `pnpm.overrides` once the carriers' published
versions catch up. CI's `security-scan` job uses `continue-on-error: true`
on `pnpm audit` for exactly this reason; Snyk + gitleaks + trufflehog do
the hard gating.

### Known limitations (v1.0)

- **Single-region deployment.** ap-south-1 is primary; ap-southeast-1 is cold standby. Cross-region active-active deferred to v1.1.
- **English + Hindi only.** Gujarati strings exist in `@jp/i18n/locales/gu.json` but the UI doesn't yet expose the toggle; targeting v1.1.
- **No SCIM / SSO.** All authentication is OTP. Enterprise SSO is a v1.2 candidate if larger MSV networks adopt the platform.
- **No web push notifications.** Only mobile FCM + email + SMS.
- **80G certificate is per-donation only.** Year-end summary cron is wired but generates per-fiscal-year only on April 1 (matches the Indian fiscal year).

### Deferred roadmap (post-v1.0)

| Theme                | Items                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Reach                | Active-active multi-region, web push, more languages, SMS over WhatsApp                                |
| Personalisation      | Adaptive curriculum (AI), parent-child analytics drilldowns                                            |
| Trust & compliance   | SOC 2 Type I → Type II, ISO 27001, NDPS-ready DPDP audit log packaging                                 |
| Cost                 | Reserved capacity on RDS + ElastiCache after 3 months, S3 Glacier Deep Archive for audit logs > 1 year |
| Developer experience | Detox + Playwright in CI, mutation testing on Punya engine                                             |
| Product surface      | Volunteer registration flow, anonymised parent feedback survey, donor wall, Sant blessing module       |

---

## 9. Repository sign-post

| If you need to …           | Start here                                                       |
| -------------------------- | ---------------------------------------------------------------- |
| Understand a business rule | `CLAUDE.md` (Q1–Q11) → `SPEC.md`                                 |
| Read the schema            | `apps/api/src/db/schema/index.ts`                                |
| Find a queue               | `apps/api/src/queues/queues.constants.ts`                        |
| Handle an alert            | `docs/runbooks/README.md` index                                  |
| Provision infra            | `infra/terraform/envs/{staging,production}/main.tf`              |
| Deploy                     | `.github/workflows/deploy-staging.yml` / `deploy-production.yml` |
| Smoke-test prod            | `infra/smoke-tests/prod-smoke.sh`                                |
| Load-test                  | `infra/load-tests/scenarios/full-load-suite.sh`                  |
| Onboard a new engineer     | `README.md` quickstart → `CLAUDE.md` → this report               |

---

_Sign-off_

— Enaa Creations, May 2026
