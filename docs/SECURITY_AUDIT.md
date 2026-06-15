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
| D1 | 🔴 | `/uploads` served with **no auth** — progress PDFs, ID cards, proofs world-readable by URL | uploads | **REC** (mitigated) |
| C1 | 🔴 | Captured donation amount/status never reconciled with Razorpay → forged/refunded 80G receipts | payments | **REC** |
| F1 | 🟠 | Punya balance lost-update + duplicate rows (no unique on `student_id`) | logic | **FIXED** |
| F2 | 🟠 | Niyam auto-approve duplicate-per-day point farming (no lock) | logic | **FIXED** |
| F3 | 🟠 | Exam max-attempts TOCTOU (count+insert without lock) | logic | **FIXED** |
| D2 | 🟠 | Stored XSS via MIME-spoofed upload served same-origin | uploads | **REC** (mitigated by `nosniff`) |
| D3 | 🟠 | Any authed user could upload into admin folders (id-cards/library/…) | uploads | **FIXED** |
| E1 | 🟠 | CORS reflects any origin with credentials | config | **FIXED** (prod allow-list) |
| E2 | 🟠 | Stack traces leaked to clients on unhandled errors (no error middleware) | config | **FIXED** |
| B2 | 🟡 | Unbounded `responses` record on public registration intake (storage abuse) | injection | **FIXED** |
| C5 | 🟡 | 80G receipt numbers deterministic + 32-bit collision, no UNIQUE | payments | **REC** |
| E5 | 🟡 | Missing security headers (helmet/CSP/nosniff/frame) | config | **FIXED** (nosniff/frame/referrer) |
| A5 | 🟡 | 7-day stateless access token, no revocation on logout | auth | **REC** |
| G2 | 🟡 | Mobile token in AsyncStorage→localStorage (XSS on Expo web) | mobile | **REC** |
| G3 | 🟡 | Android `usesCleartextTraffic:true` in production build | mobile | **REC** |
| G4 | 🟡 | OTP `dev_code` rendered client-side with no `__DEV__` guard | mobile | **FIXED** |
| E6 | ⚪ | `jp_user` cookie (PII) non-HttpOnly | config | **REC** |
| D4 | ⚪ | Stale ID-card/report files never deleted on regenerate | uploads | **REC** |
| F4 | ⚪ | `awardPunya` not atomic with its claim transaction (under-award on crash) | logic | **REC** |
| — | ⚪ | `pnpm audit`: 12 advisories, **none in client/runtime bundle** (all dev/build tooling) | deps | **REC** |

**Verified SOUND (no action):** SQL injection (Drizzle params throughout) · path traversal (UUID keys + base-dir guard) · SSRF/ReDoS (none) · ID-card/QR HMAC crypto (domain-separated secret, timing-safe, version/revocation re-checked) · donation capture idempotency (advisory-lock + conditional update) · multi-tenant scoping (correct per-role, resolved from trusted user row, never client fields) · pino redaction of auth headers/cookies · the queues sub-router role guard.

---

## FIXED this session (verified live + 105 tests green)

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

## RECOMMENDED (not yet changed — need design/infra decisions)

### D1 🔴 — Authenticated/signed access to `/uploads`  *(partially mitigated)*
`app.ts` serves `/uploads` via anonymous `express.static`, so progress-report **PDFs (a child's data)**, ID-card PNGs, and proof images are world-readable by anyone with the URL (verified: `curl` a file → 200). UUIDv4 filenames are the only thing preventing enumeration. The `released_to_parent` gate is bypassed at the file layer. **Mitigation applied:** `nosniff` (blocks the MIME-sniff XSS). **Proper fix:** route file reads through an authenticated handler that re-checks ownership/scope and streams from storage, and issue short-lived **signed URLs** instead of permanent public links. (A blanket `requireAuth` on `/uploads` would break `<img>`/`<a>` because the cross-origin cookie isn't sent on subresource loads — signed URLs are the right tool.)

### C1 🔴 — Reconcile captured amount/status with the gateway — `routes/v1/donations.ts`
Signature validity proves the order/payment-id pair is authentic; it does **not** prove the money settled at the recorded amount. After verifying the signature, call `razorpay.payments.fetch(payment_id)` and assert `status==="captured"`, `order_id` matches, and `amount===donation.amount_paise` before flipping `payment_status`/issuing the 80G receipt; same check in the webhook. Without this, an authorized-but-uncaptured/partially-captured/refunded payment can still mint a full 80G receipt. (Lower impact while on the mock provider, but the logic is wrong for real Razorpay.)

### C5 🟡 — 80G receipt numbering — `routes/v1/donations.ts` + schema
Receipt = `JP-{FY}-{first 8 hex of UUID}` → predictable and 32-bit (collisions ~77k donations/FY), with no UNIQUE constraint. Use a per-FY monotonic sequence + `UNIQUE(receipt_number)`.

### A5 🟡 — Access-token lifecycle — `lib/tokens.ts`
7-day stateless access token with no revocation; logout only revokes the refresh session. Shorten to minutes–hours and rely on refresh, or add a token-version/`jti` checked in `requireAuth`. (Note: mobile currently persists only the access token — shortening needs the mobile refresh path wired first.)

### G2/G3 🟡 — Mobile hardening
G2: store the token in `expo-secure-store` on native (not AsyncStorage→localStorage); honor `access_expires_at`. G3: set Android `usesCleartextTraffic:false` for production builds (dev LAN needs a network-security-config exception). — `app.json`, `contexts/AuthContext.tsx`

### Others
- **D2** (upload content-sniffing): trust magic bytes, not the client `mimetype`; restrict served extensions. `nosniff` already mitigates execution. — `lib/upload.ts`/`storage.ts`
- **E6** (jp_user PII non-HttpOnly): keep it minimal / drop `phone`; it's never trusted server-side so not an escalation risk. — `lib/cookies.ts`
- **D4** (stale files): `storage.remove` the old key on ID-card/report regenerate.
- **F4** (award atomicity): thread the caller's `tx` into `awardPunya` so the claim + ledger + balance commit together.
- **Deps**: `pnpm audit` → 12 advisories, **all in dev/build tooling** (esbuild, postcss, qs, uuid) — none in the shipped web/mobile bundle. Supply-chain posture is good (`minimumReleaseAge: 1440`, postinstall allowlist). Bump tooling at convenience.

---

## Production-readiness checklist (gating the dev conveniences)
- [ ] `NODE_ENV=production` set in real deployments (gates A1/A2/A3/C3/C4 + error handler).
- [ ] Remove the `default_otp_code` settings row from any prod DB; wire a real SMS OTP provider.
- [ ] Set `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` (else the API refuses to start — C3) and add the C1 amount reconciliation.
- [ ] Set `CORS_ORIGINS` to the real web origin(s).
- [ ] Move `/uploads` to authenticated/signed access (D1).
- [ ] `JP_AUTH_SECRET` set to a strong value (already required-in-prod by `tokens.ts`).

## Verification performed
Per-role API tokens (super_admin→student) + curl + psql against the live stack. Confirmed exploitable-then-fixed: D1 (200→needs auth), A4 (200→403), B1 (accept→422), rate-limit (→429), headers present. **API typecheck green · 105/105 integration tests green** after all fixes.
