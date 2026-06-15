# Jain Pathshala — Go-Live Checklist

_The code for every launch blocker is in place and pluggable (see the remediation banner in
`docs/PRODUCTION_READINESS_AUDIT.md`). What remains to reach a real **100%** is **provisioning,
secrets, and device QA** — not more code. This is the sequenced runbook for that. Env-var
semantics live in [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md); this file is the ordered action list._

Legend: ☐ = to do · each item names the **service to provision**, the **secret(s) to set**, and
**how to verify** it actually works.

---

## 0. Pre-flight (no external services)

- ☐ **Generate the auth secret.** `openssl rand -base64 48` → set `JP_AUTH_SECRET` in the prod
  Secrets manager. Confirm `.replit` does **not** contain the value (it was stripped; the app
  fail-fasts in `production` if unset — `idcard-crypto.ts:11`).
- ☐ **Set core env** per DEPLOYMENT.md §"Core (required)": `DATABASE_URL`, `PORT`, `NODE_ENV=production`,
  `PUBLIC_API_URL`, `CORS_ORIGINS`.
- ☐ **Run versioned migrations against the prod DB** (never `push`/`push-force`):
  `pnpm --filter @workspace/db run migrate`. Verify all three migrations
  (`0000_baseline`, `0001_indexes`, `0002_phase2`) are applied and `drizzle.__migrations` has 3 rows.
- ☐ **CI green on the branch** — `.github/workflows/ci.yml` runs typecheck + the 196-test suite
  against an ephemeral Postgres. Confirm it passes before promoting.

---

## 1. SMS / OTP — **hard blocker** (no login without it)

- ☐ **Provision** an MSG91 account (India) — create an OTP template, note the template id + auth key.
- ☐ **Secrets:** `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (+ optional `MSG91_SENDER_ID`). `SMS_PROVIDER`
  is inferred from the keys; set it to `msg91` explicitly if you prefer. (Generic adapter: set
  `SMS_API_URL` (+ `SMS_API_KEY`) instead.)
- ☐ **Verify:** in production (`NODE_ENV=production`) the mock provider is refused at first send, so a
  misconfig fails loudly. Do a real send to a test handset → receive the code → complete
  `POST /api/auth/login` (phase `send` then `verify`). Confirm **no `dev_code`** is echoed in the
  response (prod drops it).

## 2. File storage (S3) — **required for autoscale / durability**

- ☐ **Provision** an S3 bucket (private) + an IAM principal with `s3:PutObject`/`GetObject`/`DeleteObject`
  on it. Local disk is per-instance and **ephemeral** — ID cards, 80G receipts, and PDF exports are
  lost on redeploy without this.
- ☐ **Secrets:** `S3_BUCKET` + the usual `AWS_*` credentials in the runtime; tune `UPLOAD_URL_TTL_SECONDS`.
- ☐ **Verify:** generate a digital ID card (or a donation 80G receipt), confirm the object lands in the
  bucket, and that the signed `/uploads/*` URL downloads it. Redeploy/restart and confirm the file is
  still retrievable (proves it's not on ephemeral disk).

## 3. Payments — Razorpay live — **required for real donations**

- ☐ **Provision** Razorpay live keys + configure a webhook endpoint pointing at the API.
- ☐ **Secrets:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. (Unset → deterministic
  mock that charges nothing.)
- ☐ **Verify:** run one live ₹1 donation end-to-end → checkout signature verifies → webhook reconciles the
  payment → the donation row flips to paid and an 80G receipt is generated. Confirm a tampered/replayed
  webhook is rejected (HMAC mismatch).

## 4. Redis — **required for correct rate-limiting & single-fire cron**

- ☐ **Provision** a managed Redis instance.
- ☐ **Secret:** `REDIS_URL`. Without it the OTP rate limiter is per-instance (limit multiplies by instance
  count) and resets on restart — and the in-process cron (birthday wishes, etc.) double-fires across
  instances / never fires when scaled to zero (DEPLOYMENT.md §"Autoscale caveats").
- ☐ **Verify:** hammer `POST /api/auth/login` (phase `send`) past the window from two instances and confirm
  a single cluster-wide limit. Confirm birthday-wish cron fires exactly once per day across the fleet.

## 5. Mobile native build (EAS) — **hard blocker for app-store delivery**

- ☐ **Provision:** an Expo/EAS account; set the real `projectId` in `app.json`/`eas.json` (placeholder is
  committed); Apple Developer + Google Play Console accounts; APNs key + FCM/Google service credentials
  for `expo-notifications` push.
- ☐ **Build:** `eas build -p ios` and `eas build -p android` (profiles in `eas.json`). Confirm both produce
  signed binaries.
- ☐ **Verify (on-device QA):** login via real SMS OTP; the persona tabs load; **GPS attendance**
  (`expo-location`) and the **Shivir QR scanner** (`expo-camera`) work on a physical device (simulators
  can't fully exercise camera/GPS); a **push notification** (birthday / notice) is received.
- ☐ **Submit:** `eas submit` to TestFlight / Play internal track, then promote.

---

## 6. Production smoke test (after the above)

- ☐ Login (real OTP) as each of the 7 roles; confirm scoped dashboards load with no console/network errors.
- ☐ Exercise one full flow per high-value module: enrolment create→approve, exam OTP take→grade,
  donation→receipt, notice publish→scoped feed→read receipt, gallery upload→consent-gated public view.
- ☐ Confirm the **audit trail** records auth, money, grading, and admin mutations (now spans 22 routes).
- ☐ Verify graceful shutdown (SIGTERM drains in-flight requests) and that `unhandledRejection`/
  `uncaughtException`/pool-`error` handlers log rather than crash silently.

## 7. Post-launch hygiene

- ☐ Rotate `JP_AUTH_SECRET` on a schedule (invalidates outstanding tokens/QR — communicate the window).
- ☐ Move the in-process cron to a single external worker or a Redis lock if running autoscale > 1 instance.
- ☐ Wire `LOG_LEVEL` + a log sink and basic uptime/error alerting on the API process.
- ☐ Replace the placeholder `docs/IMPLEMENTATION_STATUS.md` "all-✅" claims with the adjudicated readiness
  view, or delete it in favour of `PRODUCTION_READINESS_AUDIT.md`.
