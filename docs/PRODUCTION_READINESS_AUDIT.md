# Jain Pathshala — Production-Readiness Audit (22 Modules)

_Generated 2026-06-15 by a 50-agent audit: one deep auditor + one adversarial verifier per module, plus 6 cross-cutting sweeps. Every claim was checked against the **actual code** in `artifacts/*` and `lib/*` (the top-level `apps/*` dirs are stale build output and were ignored). The pre-existing `docs/IMPLEMENTATION_STATUS.md` marks all 22 modules "✅" — **that document is materially inaccurate** and should not be trusted for launch decisions._

---

## ⏭️ REMEDIATION LOG — Phases 0–4 (completed 2026-06-15)

The audit below describes the **pre-remediation** state (≈53%). Phases 0–4 have since been executed. Everything below this banner is the *original* audit; this section records what changed.

**Phase 0 — platform unblock (all 4 hard blockers cleared):**
- **SMS OTP** — pluggable provider `artifacts/api-server/src/lib/sms.ts` (MSG91 + generic adapters, mock in dev/test), wired into `auth.ts`; prod fail-fasts without keys.
- **Auth secret** — dev `JP_AUTH_SECRET` stripped from `.replit`; prod guard in `idcard-crypto.ts:11` throws if unset in production.
- **Versioned migrations** — `lib/db/migrations/` now holds `0000_baseline` (69 tables), `0001_indexes` (100 indexes), `0002_phase2`; `generate`/`migrate` scripts added (no more destructive push-only deploys).
- **Mobile build** — `artifacts/jain-pathshala-mobile/eas.json` + iOS/Android bundle IDs.
- **CI + typecheck** — `.github/workflows/ci.yml` + husky pre-push; the `@types/react` dup that broke typecheck is pinned via `pnpm.overrides`. **`pnpm run typecheck` is green across all 5 projects.**

**Phase 1 — platform hardening (all 10 high cross-cutting blockers cleared):** S3 storage provider (`lib/storage.ts`) + signed file tokens; **100 secondary indexes**; audit trail expanded from 10 → **22 route files** (incl. auth, donations, exams, attendance) via `lib/audit.ts`; soft-delete read-consistency; **Redis-backed rate limiter** (`lib/ratelimit.ts`, in-memory fallback); process `uncaughtException`/`unhandledRejection` + graceful shutdown (`index.ts`) and pool `error` handler (`lib/db/src/index.ts`); mobile push (`lib/push.ts`, expo-notifications); `docs/DEPLOYMENT.md`.

**Phase 2 — built the 8 missing consumer/authoring surfaces:** Gallery (media + consent gate), Notices (scoped feed + targeting + read receipts), Curriculum (section/item authoring + cross-city leak fix), Exams (OTP take-flow + skipped-text grading fix), Library (deliverable URLs + tiered feed), Service Requests (consumer create/reply + resolved_at invariant), Centre & Batch (`enrolments.ts` creation path + capacity/duplicate guards), Shivirs (mobile QR scanner + idempotent scan).

**Phase 3 — polish:** competitions roster, mobile shikshak-attendance + GPS + quiz take-flow, atomic manual punya award, MSV approve invariant, registration city-admin publish fix, donation 80G receipts + email provider, birthday push delivery, auth impersonate start/stop + first `auth.test.ts`.

**Phase 4 — verification:** integration tests added for every new Phase 2 surface + new-behavior coverage for exams/service-requests. **Test suite: 106 → 196, all green; typecheck green.** Fixed a latent test-isolation bug in `audit-logs.test.ts` and hardcoded-seed-UUID coupling in the new enrolments/notices tests (now resolve fixture IDs by natural key).

**Still NOT done by code alone (requires real infra/credentials/devices — these block a literal "100%"):** provisioning live MSG91/SMS keys, a real S3 bucket + Razorpay live keys, an actual EAS build submitted to the App/Play stores, a Redis instance in prod, and on-device mobile QA. Code is in place and pluggable for all of these; they need an environment, not more code.

---

## Headline verdict

**Not production-ready. Aggregate adjudicated readiness ≈ 53%.**

The codebase is a genuinely well-engineered *backend skeleton* — the DB schema is broad and correct, the API envelope/error conventions are consistent, money (Razorpay) and points (punya ledger) paths are atomic and idempotent, and there is a real 106-case integration test suite hitting live Postgres. But it is **not shippable**, for two independent reasons:

1. **Platform-level launch blockers gate every module** (see §2): nobody can log in in production (no SMS OTP), the production auth secret is the public dev string, the DB deploy strategy is destructive, there's no mobile build pipeline, and there's no CI (and typecheck currently fails).
2. **Most modules are backend-complete but front-end/consumer-incomplete**: the admin/API half exists, but the student/parent/volunteer-facing flows are missing, read-only, or wired to placeholder data. Several "headline" features (gallery media, volunteer QR scanner, curriculum authoring, exam-taking UI) **do not exist on any client surface.**

Readiness distribution (adjusted, post-verification):

| Band | Count | Modules |
|------|-------|---------|
| ≥ 70% (nearly there) | 2 | ID Cards (72), Homework (70) |
| 56–69% (half-to-mostly built) | 7 | Progress Reports (66), Niyams (62), Competitions (62), Quiz (61), Attendance (60), Punya (60), Analytics (60) |
| 41–55% (half-built) | 10 | Auth (55), Registration (54), Donations (53), MSV (52), Centre & Batch (48), Birthday (45), Service Requests (43), Curriculum (42), Exams (42), Library (42) |
| ≤ 40% (large gaps) | 3 | Notices (40), Shivirs (40), Gallery (30) |

---

## 1. What is genuinely solid (don't rebuild this)

- **DB schema** — 24 schema modules cover all 22 domains with correct FKs, enums, and unique constraints on race-sensitive join tables.
- **Auth crypto & RBAC engine** — HMAC-SHA256 access tokens (constant-time verify), sha256-hashed 30-day refresh tokens, per-request DB-backed role/active/deletion re-check, single-flight refresh on **both** web and mobile.
- **Payments core (Donations)** — Razorpay order → HMAC verify → webhook with raw-body signature check → **atomic, idempotent** capture; gateway reconciliation; mock-vs-live adapter auto-selected by env. Genuinely production-grade.
- **Punya ledger** — atomic, idempotent `awardPunya`; the points-as-currency invariant holds on the automated paths (niyam approval, homework grade, quiz award).
- **Online Exams API** — real auto-grading, correct partial→finalize manual-grade state machine, OTP gate, window check, TOCTOU-safe attempt cap via advisory lock, strict results-release gate. Strongest back-end layer in the app.
- **ID Card generation** — HMAC-signed QR, `sharp` PNG render, versioned revocation. The *generation* half is the most complete feature in the product (72%).
- **API hygiene** — zero `console.*` / `as any` / `@ts-ignore` / `TODO`/`FIXME` across the API server; pino logger with redaction; centralized Express-5 error handler that never leaks stack traces; consistent `ok()/fail()` envelope; every list endpoint clamps its `limit`.
- **Test suite** — 106 real end-to-end cases (supertest against live seeded Postgres, zero skipped); strong coverage of donations, exams lifecycle, progress, MSV race-safety.

---

## 2. Cross-cutting LAUNCH BLOCKERS (these gate every module)

These are platform-level and must be fixed regardless of per-module completeness. Ordered by severity.

### 🔴 Critical — hard blockers (the app cannot run in production today)

1. **No real SMS OTP provider.** The OTP "send" phase never calls any gateway (zero `twilio/msg91/gupshup/sns/...` references). Dev OTP `123456` is suppressed in prod, so **production login is impossible for everyone.** → `artifacts/api-server/src/routes/auth.ts:83-128`. *Fix: pluggable SMS provider mirroring the `payments.ts` mock-vs-real pattern; fail-fast if unconfigured in prod.*
2. **Production auth secret is the public dev string.** `.replit [userenv.production]` sets `JP_AUTH_SECRET = "jp-dev-secret-do-not-use-in-production"` → all access tokens and signed QR codes are **forgeable by anyone reading the repo**, and it silently defeats the fail-fast guard. → `.replit:43-44`. *Fix: remove the line; inject via secrets manager; rotate.*
3. **Destructive DB migration strategy.** Only `drizzle-kit push`/`push-force` exist — no versioned migrations, no journal. Every deploy risks **data loss / unreviewed destructive schema changes** against a live DB. → `lib/db/package.json`, `drizzle.config.ts`. *Fix: switch prod to `drizzle-kit generate` → reviewed SQL files in git → `migrate`.*
4. **No native mobile build pipeline.** No `eas.json`, no `ios/`/`android/` native projects, no `bundleIdentifier`/`package`/`projectId`. The current build only yields an Expo-Go JS bundle — **you cannot produce an App Store / Play Store binary.** → `artifacts/jain-pathshala-mobile/app.json`. *Fix: add `eas.json` + identifiers + EAS project, or `expo prebuild`.*

### 🟠 High — must fix before / immediately around launch

5. **No CI pipeline at all** (no `.github/workflows/`), and `.husky/` has no active hooks. Nothing runs typecheck/tests/format on push. **And `pnpm run typecheck` currently FAILS** — 4 `TS2322` errors from duplicate `@types/react` (19.1.x + 19.2.x). *Fix: pin `@types/react` via `pnpm.overrides`; add CI running typecheck + the vitest suite against a Postgres service container; add a pre-push hook.*
6. **Uploads on ephemeral local disk.** `LocalDiskProvider` writes to `<cwd>/uploads` (gitignored, ephemeral). On autoscale/redeploy, **ID-card PNGs, 80G receipts, and progress-report PDFs vanish**, and aren't shared across instances. → `artifacts/api-server/src/lib/storage.ts:40-87`. *Fix: implement `S3StorageProvider` against the existing interface; select by env.*
7. **Audit trail materially incomplete.** Only 29 audit calls across 10 of 24 route files; 15 mutating route files write **no** audit record — including `auth.ts` (login/logout), `donations.ts` (payment capture), `exams.ts` (grading), `attendance.ts` (marking). Defeats the "append-only audit log" promise of Module 20. *Fix: add `auditFromReq` to all sensitive mutations.*
8. **Zero secondary indexes in the entire schema.** No non-unique `index()` declarations anywhere; every scoped/list/dashboard query filters on un-indexed FK/scoping columns (`notifications.user_id`, `attendance.student_id`, `punya_transactions.*`, `audit_logs.created_at`, …). Will not scale. *Fix: add `index()` on all FK + scoping columns and ordering tuples.*
9. **Soft-delete is declared but never implemented or filtered.** `deleted_at` exists on users/centres/batches/students/homework but nothing writes it and ~28/29 reads omit `isNull(deleted_at)`. *Fix: either remove the columns or commit to soft-delete on both write and every read.*
10. **ID-card QR secret has no production guard** — falls back to the public dev value unlike `tokens.ts`/`file-tokens.ts` which throw. → `artifacts/api-server/src/lib/idcard-crypto.ts:8`. *Fix: throw in prod if `JP_AUTH_SECRET` is unset.*
11. **No DB-pool error listener and no process-level handlers.** `pool` has no `'error'` handler (idle-client errors on failover → unhandled `'error'` → crash); no `unhandledRejection`/`uncaughtException` handlers. → `lib/db/src/index.ts:13`, `artifacts/api-server/src/index.ts`. *Fix: add listeners + graceful shutdown.*
12. **Push notifications unreachable on mobile.** Server registers tokens & sends Expo push, but the app has **no `expo-notifications`** dep, never requests permission, never registers a token. Module 21 (Birthday push) + Notices/Quiz push are **dead on device.** *Fix: add `expo-notifications`, register post-login, add response listener + deep-link.*
13. **OTP rate-limiter is in-memory (per-process).** The only brute-force protection; behind autoscale the per-phone/per-IP caps multiply by instance count, and it's disabled under `NODE_ENV=test` with no assertion. → `auth.ts:33-45`. *Fix: back with Redis (already running natively on :6379); add a 429-on-6th-attempt test.*
14. **Deployment substrate undefined.** `infra/` Terraform is **untracked** by git (real source only in `.migration-backup/infra/terraform`); `.replit` defines no `[deployment.build]`/`[deployment.run]` and root `package.json` has no `start`. *Fix: pick a target, restore/commit IaC, define explicit build+run commands.*

---

## 3. Per-module readiness matrix

`pct` = adjudicated readiness after adversarial verification. Verdict = how the first-pass audit compared to reality (`understated` = even worse than first thought).

| # | Module | pct | Verdict | Backend (DB+API) | Client | The blocking gap |
|---|--------|-----|---------|------------------|--------|------------------|
| 4 | Digital ID Cards | **72** | accurate | strong | web+mobile view ok | Verification/scan-side & revocation UX gaps; otherwise nearly done |
| 9 | Homework | **70** | understated | strong | web+mobile real | Award-integrity edge cases, minor; closest to done after ID cards |
| 22 | Student Progress Reports | **66** | accurate | strong (5/5 tests) | web ok; no parent client | PDF + per-item levels real; parent-facing surface thin |
| 7 | Niyams (Tasks) | **62** | understated | strong | web review + mobile submit | Auto-approve (proof-less) branch untested; scope edges |
| 12 | Competitions | **62** | accurate | strong | web + mobile browse | **No roster/registrations list endpoint**; `open` omits points fields |
| 15 | Quiz System | **61** | accurate | strong | web + mobile take | Mobile take-flow blocker; push delivery dead (see #12) |
| 5 | Attendance & GPS | **60** | accurate | API+web ok | **mobile read-only, no GPS** | Shikshak can't mark attendance or capture GPS on mobile |
| 6 | Punya Points | **60** | accurate | atomic ledger ok | display only | Manual-award path non-atomic + unaudited (admin-resources.ts:327) |
| 20 | Analytics/Reports/Audit/PDF | **60** | accurate | partial | web audit log ok | Audit trail incomplete (see #7); analytics partly placeholder |
| 1 | Authentication | **55** | accurate | strong crypto | web+mobile flows | **No SMS OTP (prod login impossible)**; dead impersonate route; no auth tests |
| 3 | Registration Forms | **54** | accurate | API ok | admin+public | Publish broken for non-super-admins (cityId null); review flow gaps |
| 18 | Donations | **53** | accurate | **excellent** | public `/donate` | Core is great; ops/receipt-delivery + no client beyond web checkout |
| 19 | MSV Programme | **52** | accurate | race-safe core | web admin | Seed has approved-status/enrolment desync; not linked to curriculum content |
| 2 | Centre & Batch Mgmt | **48** | understated | partial | web admin | **No enrolment-creation path anywhere**; decisions lack state/idempotency guard |
| 21 | Birthday Wishes | **45** | understated | cron + inbox ok | inbox only | Push dead on device (see #12); duplicate-send risk; spec'd worker fleet missing |
| 16 | Service Requests | **43** | accurate | API ok | admin only | **No consumer/create flow has callers**; message handler corrupts status |
| 13 | Curriculum (Std + MSV) | **42** | accurate | read-only | read-only tree | **No section/item authoring anywhere**; admin-created curricula are permanently empty; progress query leaks across all cities |
| 14 | Online Exams | **42** | accurate | **strong API** | **no take-flow UI** | Students cannot take an exam on any surface; text-Q skip finalizes early; grading city-wide |
| 17 | Library / Resources | **42** | accurate | public read only | public list | `file_url` never returned (files undeliverable); no member/tiered access; no edit/delete; admin read unscoped |
| 10 | Notices | **40** | accurate | create-only (38 LOC) | public + thin admin | No authenticated/scoped feed; batch targeting impossible; targeting cols dead on write; no edit/delete; `notice_reads` dead |
| 11 | Shivirs (scanner+dashboard) | **40** | overstated | strong crypto | **no scanner on any surface** | Volunteer QR scanner doesn't exist (web or mobile); attendance can never be captured; admin read leak + write-side RBAC bug |
| 8 | Gallery | **30** | accurate | **no media column** | colour-swatch tiles | No production insert path (永empty); schema has no image/url; ignores `gallery_visibility_opt_in` consent (minors privacy); no takedown |

---

## 3a. Per-surface status (DB / API / Web / Mobile)

Legend: ✅ complete · ⚠️ partial (gaps/risks) · 🟡 stub · 🔌 UI present but not wired to a real API · ❌ missing · — n/a.
**0 of 22 modules were rated `production_ready` by the auditors** (even before adversarial review). The recurring shape is **DB solid → API partial → client missing**: DB is ✅ on 18/22, but API is `complete` on only 5/22, and the web/mobile clients are the weakest layer.

| # | Module | DB | API | Web | Mobile |
|---|--------|----|-----|-----|--------|
| 1 | Authentication | ✅ | ⚠️ | ✅ | ✅ |
| 2 | Centre & Batch Management | ✅ | ⚠️ | ⚠️ | ⚠️ |
| 3 | Dynamic Registration Forms | ✅ | ⚠️ | ⚠️ | ❌ |
| 4 | Digital ID Cards | ✅ | ✅ | ⚠️ | ✅ |
| 5 | Attendance & GPS Sessions | ✅ | ✅ | ✅ | ⚠️ |
| 6 | Punya Points Engine | ⚠️ | ⚠️ | ✅ | ✅ |
| 7 | Niyams (Tasks) | ✅ | ⚠️ | ✅ | ⚠️ |
| 8 | Gallery | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 9 | Homework | ✅ | ⚠️ | ⚠️ | ⚠️ |
| 10 | Notices | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| 11 | Shivirs (scanner + dashboard) | ✅ | ⚠️ | ⚠️ | ⚠️ |
| 12 | Competitions | ✅ | ⚠️ | ⚠️ | ⚠️ |
| 13 | Curriculum (Std + MSV) | ⚠️ | ⚠️ | ⚠️ | ❌ |
| 14 | Online Exams | ✅ | ⚠️ | ⚠️ | ❌ |
| 15 | Quiz System | ✅ | ✅ | ⚠️ | ⚠️ |
| 16 | Service Requests | ✅ | ⚠️ | ⚠️ | ❌ |
| 17 | Library / Resources | ✅ | ⚠️ | ⚠️ | ⚠️ |
| 18 | Donations | ✅ | ⚠️ | ⚠️ | ❌ |
| 19 | MSV Programme Track | ✅ | ⚠️ | ⚠️ | 🔌 unwired |
| 20 | Analytics / Reports / Audit / PDF | ✅ | ⚠️ | ✅ | — |
| 21 | Birthday Wishes | ✅ | ⚠️ | — | ⚠️ |
| 22 | Student Progress Reports | ✅ | ✅ | ✅ | ❌ |

Surface tally: **DB** ✅18 / ⚠️4 — **API** ✅5 / ⚠️17 — **Web** ✅5 / ⚠️15 / —2 — **Mobile** ✅4 / ⚠️9 / 🔌1 / ❌6 / —2.

---

## 4. Per-module detail (what's confirmed working vs. broken)

### 🔴 Tier C — large gaps (≤ 45%)

**Gallery (30%)** — The single most-incomplete module. There is **no image/URL column** in `gallery_items`, the contract has no image field, and web/mobile render name-on-colour tiles. No production path inserts items (only seed, gated on `is_featured`). Admin has feature/unfeature but **no DELETE / takedown / `is_public` toggle**. Public read **ignores `students.gallery_visibility_opt_in`** (defaults false) — a live privacy exposure for minors. Zero tests. Effectively needs to be built.

**Shivirs (40%)** — Backend crypto/locking is strong, but the **headline volunteer QR scanner has no client on any surface** (no `expo-camera`, no web scanner) — attendance can never be captured through the product. `shivir_volunteers`/`shivir_registrations` have no producer anywhere (dead). `GET /v1/admin/shivirs` leaks across cities (no scope filter); `POST /v1/admin/shivirs` is unscoped on `city_id` with inverted guard logic. No unique index on scans → duplicates inflate counts. Marquee atomic-revocation path is untested.

**Notices (40%)** — `notices.ts` is 38 LOC (only `GET /public`). No authenticated/audience-scoped feed exists, so all internal notices are invisible to users. Schema has no `batch_id` though the audience enum includes `'batch'`. Insert writes only `centre_id` (state/city targeting cols dead on write). No PATCH/DELETE. `notice_reads` table is dead. No push, no audit. Web dialog collects no scope and no `content_hi`.

**Curriculum (42%)** — **No section/item CRUD anywhere**; `POST /admin/curricula` inserts only the parent shell, so admin-authored curricula are permanently empty — the entire "centrally manage curriculum" capability is non-functional (content exists only via seed). Web tree is read-only. `GET /progress/students/:id` with no `curriculum_id` does `.where(undefined)` → returns items from **every curriculum across all cities/tracks**. No student↔curriculum assignment table. `POST /admin/curricula` doesn't scope-check `city_id` (a city_admin can author for any city or create central curricula).

**Online Exams (42%)** — API/DB are the strongest layers (real grading state machine, OTP gate, advisory-lock cap, release gate, 341-LOC tests). But **students have no take-flow UI on any surface** (zero web refs to grade/attempt-detail endpoints; zero mobile exam refs). Skipped text questions are never persisted → grade route prematurely finalizes as `graded` with an understated score. Grading is city-scoped only (a shikshak can grade any student city-wide).

**Library / Resources (42%)** — `file_url` is **never returned by any read endpoint** → uploaded files undeliverable on every surface. No authenticated/member endpoint (`me.ts` has zero library refs) → the tiered student/msv/shikshak access is non-functional (public hard-filters `access_tier='public'`). No PUT/PATCH/DELETE; admin table read-only. `library_access_logs` dead. Admin GET unscoped. Web renders an open action only for `video`, so seeded audio is unopenable.

**Service Requests (43%)** — Admin/API threading exists, but **no consumer create/reply flow has any caller** on any surface (the create endpoint is orphaned). Concrete data bug: `POST /:id/messages` bumps `last_response_at` but never touches `status`, and combined with the resolve path leaves status/`resolved_at` inconsistent.

**Birthday Wishes (45%)** — In-app inbox subset is solid and tested (9 green tests), but **push is dead on device** (no `expo-notifications`). Duplicate-send risk; the spec'd dedicated BullMQ worker fleet was replaced by an in-process cron (`index.ts:19-23`), worsening multi-instance duplicate risk.

### 🟠 Tier B — half-built (48–55%)

**Centre & Batch (48%, understated)** — **No enrolment-creation path exists anywhere** (only the seed inserts enrolments) — the core enrolment lifecycle is non-functional. Enrolment decisions (`POST /admin/enrolments/:id/:action`) have **no state-transition/idempotency guard** (any action on any status, repeatable).

**MSV (52%)** — Apply/approve/reject core is race-safe and tested, admin web wired. But the shipped seed has a real `msv_status='approved'` vs missing `msv_enrolments` desync (Anaya Doshi) that propagates into ID cards/competitions/admin. MSV is never linked to MSV curriculum content (ties to Curriculum gaps).

**Donations (53%)** — Payment core is excellent (see §1). Gaps are operational: receipt **delivery** (PDF generated but no email/send path verified), no client beyond the web checkout, and donations writes no audit (see #7).

**Registration Forms (54%)** — JSON field defs + versioned configs + public `/register` exist, but **publish is broken for non-super-admins** (UI omits `city_id` → `cityId=null` → fails), and the submission review→approve→user-creation flow has gaps.

**Authentication (55%)** — Crypto and RBAC are production-grade (see §1), but blocked by **no SMS OTP** (prod login impossible). Also: a `/admin/impersonate/stop` UI control with **no server route** (dead/misleading), no OTP/auth-specific tests (only a token-minting helper), and `platform` hardcoded `'web'` server-side.

### 🟡 Tier A — mostly built (60–72%)

**ID Cards (72%)** — Most complete. Generation, signed QR, PNG, revocation all real and unmocked. Remaining: verification/scan UX and minor revocation-flow polish.

**Homework (70%, understated)** — Full assign→submit→grade→punya loop real across DB/API/web/mobile; award integrity slightly understated by the first audit. Minor edge-case hardening.

**Progress Reports (66%)**, **Niyams (62%)**, **Competitions (62%)**, **Quiz (61%)**, **Attendance (60%)**, **Punya (60%)**, **Analytics (60%)** — backend solid; gaps are specific (Competitions: no roster endpoint; Attendance: mobile read-only + no GPS; Quiz: mobile take-flow + push; Punya: non-atomic manual award; Analytics: incomplete audit trail + some placeholder numbers).

---

## 5. Recommended path to 100%

**Phase 0 — unblock production (do first; ~1 week).** Items #1–#4 + #5 from §2: real SMS OTP, remove the dev secret from `.replit` + rotate, versioned migrations, EAS build config, fix typecheck + add CI. *Without these nothing can ship.*

**Phase 1 — platform hardening (~1 week).** §2 #6–#14: S3 storage, complete the audit trail, add indexes, resolve soft-delete, ID-card secret guard, pool/process error handlers, mobile push, Redis-backed rate limiter, deployment commands + committed IaC.

**Phase 2 — finish the broken-core modules (~2–3 weeks).** Build the missing consumer/authoring surfaces: Gallery (media column + upload + consent + takedown), Shivirs (volunteer scanner on mobile + scope fixes), Curriculum (section/item authoring + scoped progress), Exams (student take-flow UI + text-Q persistence), Library (`file_url` delivery + member tiers), Notices (authenticated scoped feed + targeting + edit/delete), Service Requests (consumer flow + status fix), Centre & Batch (enrolment creation + state guards).

**Phase 3 — polish Tier A/B (~1–2 weeks).** Competitions roster endpoint, Attendance mobile marking + GPS, Quiz mobile take-flow, Punya manual-award atomicity, MSV seed/data fix + curriculum linkage, Registration publish fix, Donations receipt delivery, Birthday push, auth tests + impersonate route.

**Phase 4 — verification.** Per-module integration tests for every fixed path (auth lockout, gallery consent, exam take→grade, enrolment lifecycle, scope isolation), then re-run this audit.

---

_Source data: 50-agent workflow run `wf_c9a1484c-d69` (3.3M tokens, 1320 tool calls). Each module's status was independently produced and then adversarially re-verified against source; only `audit_accurate`/`understated`/`overstated` verdicts that survived refutation are reported here._
