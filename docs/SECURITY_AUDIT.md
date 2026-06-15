# Security Audit — Jain Pathshala

Defensive audit across all surfaces (Express/Drizzle API, Vite/React web, Expo/RN mobile, Postgres schema). Run by 7 parallel specialist reviewers (authz/IDOR · injection · payments · uploads/crypto · config/CORS/secrets · business-logic · client/deps), then **adversarially verified live** against the running stack (role tokens + curl + psql) before reporting. False alarms were dropped (e.g. the "web access token in JS-readable cookie" claim — `jp_access`/`jp_refresh` are `httpOnly`, only `jp_user` PII is readable).

Severity: 🔴 Critical · 🟠 High · 🟡 Medium · ⚪ Low. Status: **FIXED** (this session, verified) · **REC** (documented recommendation — design/infra change).

> **Most findings are "dev-acceptable, prod-critical"** — convenience backdoors (fixed OTP, OTP-in-response, mock payments, dev-capture, public uploads) that are fine for the local demo but must be closed before any production exposure. The FIXED items now gate these on `NODE_ENV`/role; the REC items need infra decisions.

## Findings summary

| # | Sev | Title | Surface | Status |
|---|-----|-------|---------|--------|
| A1 | 🔴 | Fixed default OTP (`123456`) from settings applied to every login | auth | **FIXED** |
| A2 | 🟠 | Login response returns the real OTP (`dev_code`) for any registered phone | auth | **FIXED** |
| A3 | 🟠 | No rate-limiting on OTP send/verify → brute-force / SMS-bomb | auth | **FIXED** |
| A4 | 🟠 | Privilege escalation: any admin-panel role (shikshak) could create global curricula/niyams/punya-configs/library/exams | authz | **FIXED** |
| B1 | 🟠 | Stored XSS via `javascript:`/`data:` URLs (proof/submission/embed/file URLs) rendered in admin `<a href>` | injection | **FIXED** |
| C2 | 🟠 | Webhook signature verified against `JSON.stringify` fallback (not raw bytes) | payments | **FIXED** |
| C3 | 🟠 | Silent fallback to mock payment provider in prod (public HMAC secrets) | payments | **FIXED** |
| C4 | 🟠 | `dev-capture` (fabricate captured donation) gated only on provider name, not env | payments | **FIXED** |
| D1 | 🔴 | `/uploads` served with **no auth** — progress PDFs, ID cards, proofs world-readable by URL | uploads | **FIXED** |
| C1 | 🔴 | Captured donation amount/status never reconciled with Razorpay → forged/refunded 80G receipts | payments | **FIXED** |
| F1 | 🟠 | Punya balance lost-update + duplicate rows (no unique on `student_id`) | logic | **FIXED** |
| F2 | 🟠 | Niyam auto-approve duplicate-per-day point farming (no lock) | logic | **FIXED** |
| F3 | 🟠 | Exam max-attempts TOCTOU (count+insert without lock) | logic | **FIXED** |
| D2 | 🟠 | Stored XSS via MIME-spoofed upload served same-origin | uploads | **REC** (mitigated by `nosniff`) |
| D3 | 🟠 | Any authed user could upload into admin folders (id-cards/library/…) | uploads | **FIXED** |
| E1 | 🟠 | CORS reflects any origin with credentials | config | **FIXED** (prod allow-list) |
| E2 | 🟠 | Stack traces leaked to clients on unhandled errors (no error middleware) | config | **FIXED** |
| B2 | 🟡 | Unbounded `responses` record on public registration intake (storage abuse) | injection | **FIXED** |
| C5 | 🟡 | 80G receipt numbers deterministic + 32-bit collision, no UNIQUE | payments | **FIXED** |
| E5 | 🟡 | Missing security headers (helmet/CSP/nosniff/frame) | config | **FIXED** (nosniff/frame/referrer) |
| A5 | 🟡 | 7-day stateless access token, no revocation on logout | auth | **FIXED** |
| G2 | 🟡 | Mobile token in AsyncStorage→localStorage (XSS on Expo web) | mobile | **FIXED** |
| G3 | 🟡 | Android `usesCleartextTraffic:true` in production build | mobile | **FIXED** |
| G4 | 🟡 | OTP `dev_code` rendered client-side with no `__DEV__` guard | mobile | **FIXED** |
| E6 | ⚪ | `jp_user` cookie (PII) non-HttpOnly | config | **ACCEPTED** (UI-only, not server-trusted) |
| D4 | ⚪ | Stale ID-card/report files never deleted on regenerate | uploads | **FIXED** |
| F4 | ⚪ | `awardPunya` not atomic with its claim transaction (under-award on crash) | logic | **FIXED** |
| — | ⚪ | `pnpm audit`: 12 advisories, **none in client/runtime bundle** (all dev/build tooling) | deps | **REC** |

**Verified SOUND (no action):** SQL injection (Drizzle params throughout) · path traversal (UUID keys + base-dir guard) · SSRF/ReDoS (none) · ID-card/QR HMAC crypto (domain-separated secret, timing-safe, version/revocation re-checked) · donation capture idempotency (advisory-lock + conditional update) · multi-tenant scoping (correct per-role, resolved from trusted user row, never client fields) · pino redaction of auth headers/cookies · the queues sub-router role guard.

---

## FIXED — round 1 (verified live + 106 tests green)

### A1/A2 — OTP backdoors gated to non-prod — `routes/auth.ts`
`default_otp_code` override and the `dev_code` field in the login response are now wrapped in `if (!isProd)`. In production an attacker can no longer read/guess any account's OTP. *Verified: dev still returns dev_code; the gates are env-only.*

### A3 — Rate limiting on OTP — `routes/auth.ts`
In-memory fixed-window limiter: 5 sends/phone/15min, 30/IP/15min, 30 verify/IP/15min → `429`. Bypassed under `NODE_ENV=test`. *Verified: 6th send → 429.* (Recommend a Redis-backed limiter for multi-instance.)

### A4 — Privilege escalation closed — `routes/v1/admin-modules.ts`
Added `requireRole("super_admin","state_admin","city_admin")` to the `curricula`, `exams`, `niyams`, `punya/configs`, `library` creates (previously only `requireAdminPanel`, so a shikshak/sanchalak could seed the global points economy). *Verified: shikshak create niyam → 403; super_admin → 200.*

### B1 — `javascript:`/`data:` URL XSS closed — `lib/validation.ts` (+ homework/niyam/library)
New `httpUrl()` validator (http(s)-only) replaces bare `z.string().url()` on `submission_url`, `attachment_url`, `proof_url`, `embed_url`, `file_url`. *Verified: a `javascript:` proof_url → 422.* (Defense-in-depth: also sanitize `href` at render in the 3 web link components — recommended.)

### C2/C3/C4 — Payment prod-gating — `lib/payments.ts`, `routes/v1/donations.ts`
Mock provider now **throws at boot in prod** if Razorpay env is absent; webhook **fails closed** if raw bytes weren't captured (no `JSON.stringify` fallback); `dev-capture` returns 404 in prod regardless of provider. *Verified: dev-capture still works in dev.*

### F1 — Atomic punya balance — `lib/punya.ts` + `punya_balances.student_id` UNIQUE
Read-modify-write replaced with `INSERT … ON CONFLICT (student_id) DO UPDATE SET total_points = total_points + n RETURNING` + tier recompute. Added the UNIQUE constraint. No more lost updates or duplicate balance rows.

### F2 — Niyam submit serialized — `routes/v1/niyam-submissions.ts`
Dedup-check + insert now run in a transaction holding `pg_advisory_xact_lock(hash(niyam:student:date))`, so concurrent same-day auto-approve submits can't each award points. (Defense-in-depth: add a partial UNIQUE index `WHERE status <> 'rejected'` — recommended.)

### F3 — Exam attempt-cap serialized — `routes/v1/exams.ts`
Added `pg_advisory_xact_lock(hash(exam:student))` at the top of the start transaction so parallel starts can't exceed `max_attempts` under READ COMMITTED.

### D3 — Upload folder authorization — `routes/v1/uploads.ts`
Admin-content folders (`gallery`, `library`, `id-cards`, `competitions`, `shivirs`) now require admin-panel access; student folders stay open for own submissions.

### E1/E2/E5 — App hardening — `app.ts`
CORS: prod uses a `CORS_ORIGINS` allow-list (dev still reflects so previews work). Added a terminal error-handler (generic 500 envelope + log, no stack traces). Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`. *Verified: nosniff/frame headers present.*

### B2 — Bounded registration intake — `routes/v1/registration.ts`
Public `responses` record capped (≤80 keys, key ≤80 chars, scalar values ≤2000 chars).

### G4 — Client OTP display gated — mobile `app/auth/otp.tsx`
`dev_code` block now `&& __DEV__` (defense-in-depth; server already gates it).

---

## FIXED — the two Criticals (follow-up round)

### D1 🔴 — Signed access to `/uploads` — **FIXED** — `lib/file-tokens.ts`, `app.ts` + 4 routes
Replaced the anonymous `express.static` mount with a route that serves a file **only with a valid short-lived HMAC signature** (`verifyUploadAccess`, `se`+`sig` query params, 24h TTL, domain-separated secret, `nosniff`). Every API response that returns an `/uploads` URL now mints a signed URL via `signUploadUrl()` (id-card `png_url`, progress `pdf_url`, niyam `proof_url`, homework `submission_url`/`attachment_url`); external URLs (admin-pasted library links) pass through unchanged. Files are stored with **unsigned** keys and signed on read, so links can't be persisted-then-expired. Signed URLs keep `<img>`/`<a>` working cross-origin (the S3-presigned model — a blanket `requireAuth` would have broken subresource loads). **Verified live:** signed→200, unsigned→403, tampered→403; the admin ID Cards page renders the signed image (600px).

### C1 🔴 — Gateway amount/status reconciliation — **FIXED** — `lib/payments.ts`, `routes/v1/donations.ts`
Added `fetchPayment()` to the provider interface (real Razorpay adapter → `payments.fetch`; mock omits it). The verify path now, after the signature check, calls `fetchPayment` and asserts `status==="captured"` + `order_id` match + `amount===donation.amount_paise` before issuing the receipt (502 on gateway error, 402 on mismatch). The webhook now asserts the verified entity's `amount`/`status` before crediting. An authorized-but-uncaptured / partial / refunded payment can no longer mint a full 80G receipt. (Mock provider skips reconciliation, so the dev/preview flow is unchanged — verified live.)

## RECOMMENDED (not yet changed — need design/infra decisions)

## FIXED — round 2 (remaining hardening; user-approved)

### C5 🟢 — Per-FY sequential 80G receipts — `donations.ts` + schema
Replaced the id-derived receipt with a gapless monotonic series per financial year (`JP/2026-27/00001`) from a `donation_receipt_counters` table (atomic `INSERT … ON CONFLICT … last_no+1` inside the capture txn; no number consumed on idempotent re-capture) + `UNIQUE(receipt_number)`. Verified live: `JP/2026-27/00010 → 00011`.

### A5 🟢 — Short access TTL + silent refresh + logout revoke — `tokens.ts`, `auth.ts`, web + mobile clients
Access TTL is now 1h (env `ACCESS_TOKEN_TTL_SECONDS`). The web api-client and mobile api both do single-flight refresh-on-401 + retry; mobile now persists the refresh token and revokes it on logout (logout accepts a body `refresh_token` for the cookieless mobile). Verified live: access exp = 3600s, `/api/auth/refresh` rotates the pair; web build + mobile bundle green.

### G2 🟢 — Mobile token in the OS keystore — `lib/secure-storage.ts`, `AuthContext.tsx`
Tokens now stored via `expo-secure-store` (iOS Keychain / Android Keystore) on native, with an AsyncStorage/localStorage fallback on Expo-web. The (non-secret) user profile stays in AsyncStorage.

### G3 🟢 — Android cleartext gated to non-prod — `app.config.js`
`usesCleartextTraffic` is `true` only when `EAS_BUILD_PROFILE !== "production"` (dev/preview LAN); production EAS builds force HTTPS.

### D2 🟢 — Upload content sniffing — `routes/v1/uploads.ts`
Validate the actual bytes with `file-type` (magic number) against the allowlist and derive the stored extension from the detected type — a script mislabeled `image/png` is rejected (422). With the D1 serving route (unknown extensions → `application/octet-stream` + `nosniff`), execution is doubly prevented. Covered by a new test.

### D4 / F4 / F2 🟢 — `id-cards.ts` · `lib/punya.ts` · niyam schema
D4: regenerating an ID card deletes the superseded PNG. F4: `awardPunya` runs ledger-insert + balance-upsert + tier in one transaction. F2: partial `UNIQUE(niyam_id, student_id, submission_date) WHERE status<>'rejected'` (defense-in-depth atop the advisory lock). B1 also hardened at the web render boundary via `safeHref`.

## Remaining (accepted / deferred)
- **E6** ⚪ — the `jp_user` cookie keeps `phone` (the web uses it for the sidebar avatar/name fallback). It is non-HttpOnly by necessity (UI-only) and **never trusted server-side**; XSS is hardened (URL-scheme validation + `nosniff` + frame-deny). Accepted by design.
- **Dev/build dependency advisories** — 12 from `pnpm audit`, all in dev/build tooling (esbuild/postcss/qs/uuid), **none in the shipped bundle**. Bump via `pnpm update` at convenience (deferred to avoid churn).

---

## Production-readiness checklist (gating the dev conveniences)
- [ ] `NODE_ENV=production` set in real deployments (gates A1/A2/A3/C3/C4 + error handler).
- [ ] Remove the `default_otp_code` settings row from any prod DB; wire a real SMS OTP provider.
- [ ] Set `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` (else the API refuses to start — C3). Amount reconciliation (C1) is now implemented and active on the real adapter.
- [ ] Set `CORS_ORIGINS` to the real web origin(s).
- [x] `/uploads` now requires a signed URL (D1) — optionally tune `UPLOAD_URL_TTL_SECONDS` (default 24h).
- [ ] `JP_AUTH_SECRET` set to a strong value (already required-in-prod by `tokens.ts`).

## Verification performed
Per-role API tokens (super_admin→student) + curl + psql against the live stack. Confirmed exploitable-then-fixed: D1 (200→needs signed URL; signed 200 / unsigned 403 / tampered 403, ID-card image renders), A4 (200→403), B1 (accept→422), rate-limit (→429), headers present, C5 receipts sequential (`…/00010→00011`), A5 access exp=3600s + `/refresh` rotates, D2 mislabeled upload→422. **typecheck green (api/web/mobile) · web build green · mobile web bundle green · 106/106 integration tests green** after all fixes (both rounds).
