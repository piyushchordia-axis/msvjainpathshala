# CLAUDE.md — Jain Pathshala

> This file is read automatically by Claude Code at the start of every session.
> It is the single source of operating rules for this codebase.
> The full engineering specification lives at `SPEC.md` in the repo root.

---

## Project identity

**Product:** Jain Pathshala — a multi-tenant Jain religious education platform
**Organisation:** Megh Sanskar Vatika (MSV) network
**Developer:** Enaa Creations
**Surfaces:** Mobile app (Expo) + Web admin panel (Vite/React) + Backend API (Express 5).  
**NOT YET IMPLEMENTED:** Next.js public site / App Router admin; NestJS API; FastAPI AI service.

---

## The spec file

```
CLAUDE.md  ←  authoritative for binding decisions
SPEC.md    ←  detailed reference where CLAUDE.md is silent
```

**Precedence:** CLAUDE.md is authoritative. Where CLAUDE.md and SPEC.md conflict, **CLAUDE.md wins**. SPEC.md is the detailed reference for anything CLAUDE.md does not cover.

Every prompt you receive will reference specific sections of `SPEC.md` by number (e.g. "Section 5.6", "Section 17.3"). **Always read those sections before writing any code.** Do not rely on memory or make assumptions about the spec — read it. Also re-read any AT*/Q* rules in this file that touch the same topic.

If a prompt says "Read Section 7", open `SPEC.md`, find `### 7.` and read everything until the next top-level section marker.

---

## Stack — non-negotiable

| Layer | Technology (running) | Must NOT use |
|---|---|---|
| ORM | Drizzle (`@workspace/db`) | Prisma, TypeORM |
| Backend framework | **Express 5** in `apps/api-server` | Fastify. NestJS v10+ is the SPEC target — **NOT YET IMPLEMENTED** |
| Queue system | BullMQ (when Redis is up) + `node-cron` for schedules | Kafka, RabbitMQ, SQS |
| Architecture | Modular monolith | Microservices (except AI service — **NOT YET IMPLEMENTED**) |
| Package manager | pnpm workspaces | npm, yarn. Turborepo — **NOT YET IMPLEMENTED** |
| Mobile | Expo SDK 54+ with Expo Router v6 (`apps/jain-pathshala-mobile`) | bare React Native CLI |
| Web | Vite + React + wouter (`apps/jain-pathshala`) | Remix. Next.js 15 App Router — **NOT YET IMPLEMENTED** (SPEC target) |
| Language | TypeScript everywhere | JavaScript (except configs / build scripts) |
| AI service | — | **NOT YET IMPLEMENTED** (SPEC: Python 3.12 + FastAPI) |
| Database | PostgreSQL 16 | MySQL, SQLite, MongoDB |
| Cache / Queues | Redis 7 (BullMQ + rate limits; optional in local/dev) | Memcached |

---

## Monorepo structure

```
msvjainpathshala/          (repo root; also referred to as jain-pathshala)
├── apps/
│   ├── api-server/        ← Express 5 API (`@workspace/api-server`, PORT env, often 8080)
│   │                        + `dev:worker` / `start:worker` BullMQ worker entry
│   ├── jain-pathshala/    ← Vite + React + wouter web/admin (`@workspace/jain-pathshala`)
│   ├── jain-pathshala-mobile/ ← Expo Router v6 mobile (`@workspace/jain-pathshala-mobile`)
│   ├── jp-shared/         ← `@jp/shared` — QUEUE_NAMES, CRON_EXPRESSIONS, errors
│   ├── jp-api/            ← thin `@jp/api` shim (integration-test script only)
│   └── mockup-sandbox/    ← design/mockup sandbox (non-production)
├── lib/
│   ├── db/                ← `@workspace/db` — Drizzle schema, client, migrations, seed
│   ├── api-zod/           ← `@workspace/api-zod` — shared Zod contracts
│   ├── api-spec/          ← OpenAPI / API spec artefacts
│   ├── api-client-react/  ← generated/shared React API client
│   └── i18n/              ← `@workspace/i18n` — EN/HI locale JSON + helpers
├── infra/
│   └── load-tests/        ← k6 / node attendance burst scripts
├── docs/                  ← reviews, fix prompts, deployment notes
├── docker-compose.yml     ← root compose (API image; host Postgres/Redis)
├── SPEC.md
└── CLAUDE.md
```

**NOT YET IMPLEMENTED (SPEC layout):** `apps/api` (NestJS), `apps/web` / `apps/mobile` / `apps/ai`, `packages/*` (shared / design-tokens / i18n), `infra/docker`, `infra/terraform`, `docs/runbooks`.

---

## Eight user roles (role hierarchy, high to low)

```
super_admin → state_admin → city_admin → sanchalak → shikshak → parent → student → guest
```

1. `super_admin` — national authority, manages everything
2. `state_admin` — state-level oversight
3. `city_admin` — city-level operations
4. `sanchalak` — centre head (one or more centres); display name: "Sanchalak"
5. `shikshak` — teacher (one or more batches); display name: "Guruji" (male) / "Didi" (female)
6. `parent` — parent/Abhivaavak, manages one or more children
7. `student` — age 8+, with their own OTP login when a distinct mobile is registered (see Q4)
8. `guest` — unauthenticated public user

**Role enforcement rules:**
- A higher role can always do what a lower role can do (hierarchical)
- Scope guards enforce centre/batch/city boundaries (not just role level)
- MSV programme is a parallel layer on top of standard enrolment — not a separate role
- Student view is a context switch within the parent's session, not a new login

---

## Authentication rules

- **Single login entry point:** mobile number + OTP only. No username/password. No role selector.
- **Role auto-detection:** role is read from `users.role` column after OTP verify.
- **OTP:** 6-digit, 5-minute TTL, max 5 verify attempts, argon2id hash stored (never plaintext).
- **Access token — shipped reality (reconciled 2026-08-17):** HMAC-SHA256 (`lib/tokens.ts`), **1-hour** TTL, env-overridable. The SPEC target is RS256 / 15 minutes; that is **NOT YET IMPLEMENTED** and is an accepted deviation, not a bug to re-raise. Changing it is a deliberate migration (key management + `JWT_PREVIOUS_PUBLIC_KEY_PEM` rotation), not a refactor.
- **Refresh token:** 30 days, rotated on every use, with **family-based reuse detection** (enforced). Rotation revokes the current `device_sessions` row and inserts a successor sharing its `family_id`, so every consumed token stays on record. Presenting a revoked hash whose family still has live rows proves a second copy exists — the whole family is revoked and audited. Only one party can hold the current token and we cannot tell which caller is the thief, so both are cut; the real user re-authenticates by OTP. Do NOT "fix" this back to rotating in place: that is the hole (`0070_session_family_and_kind_check.sql`).
- **Device sessions:** max 5 per user (enforced in the OTP-verify transaction). A 6th login revokes the oldest by `last_used_at`. Re-login on an existing `device_id` **replaces** that device's session rather than consuming a slot — otherwise six sign-ins from one handset evict five genuine other devices.
- **Read/write split — shipped reality:** there is no `dbRead` replica pool; `DATABASE_URL_READ` is unused. Accepted deviation.
- **Student view toggle:** parent switches context to see their child's view. Child must be ≥ 8 years old (Q4) and have `student_view_enabled = true`.
- **Admin impersonation:** super_admin only. Writes TWO audit log entries. All actions during impersonation carry `impersonator_id`.

---

## Critical business rules

These are the rules most likely to be implemented incorrectly. Read carefully.

### Q1 — MSV enrolment: no eligibility rules
MSV approval is **purely admin discretion**. Do not implement any eligibility validation, age checks, or score thresholds for MSV enrolment. The admin approves or rejects based on their own judgement.

### Q2 — MSV curriculum: super_admin only
Creating or editing MSV-type curricula is restricted to `super_admin` at the **service layer**, not just the UI. If a city_admin calls the MSV curriculum endpoint directly, it must return 403. This check lives in the API service layer (Express route/service today; NestJS service in SPEC — **NOT YET IMPLEMENTED**), not only a UI guard.

### Q3 — 80G certificates: toggleable
`platform_settings.eighty_g_enabled` controls whether 80G certificates are generated. Default is `false`. When toggled on, both `eighty_g_registration_number` AND `organization_pan` must be set or the toggle is rejected. Existing certificates are never deleted when toggled off.

### Q4 — Student age gates: 8+ (lowered from 13 on 2026-08-17)
**Shipped reality — two gates, not one.** `POST /v1/auth/switch-view` was never built. What shipped instead is a separate `users.role='student'` OTP login, provisioned during join approval when the child registers a distinct mobile number. Two constants in `lib/api-zod/src/contracts.ts`:

| Constant | Value | Gates |
|---|---|---|
| `MIN_STUDENT_LOGIN_AGE` | **8** | Being provisioned an independent OTP login (`lib/join-provision.ts`) |
| `MIN_STUDENT_VIEW_AGE` | **8** | Student-view capability — writing one's own course progress (`courses.ts`, `services/course-access.ts`) |

Both thresholds are **8**: a child old enough to sign in on their own is treated as old enough to tick off their own progress. They remain **two separate constants** because they gate different capabilities — whether a login exists at all, versus whether the holder may write their own progress record — and they have held different values before. Never collapse them into one, and never retype the number: user-facing copy is built from the constant (see `studentViewAgeRefusal` in `apps/api-server/src/lib/course-visibility.ts`, shared by the online route and the offline sync path so the two cannot drift).

Both are enforced server-side; a missing or unparseable DOB fails both, and is reported as its own distinct message ("date of birth is not on record") rather than as "too young" — roughly 12% of seeded students have no DOB, so conflating the two sends families arguing with the wrong thing. Under-age children are still enrolled normally — they simply get no independent login and reach the app through their parent. Provisioning must **never throw** on an under-age child: it runs inside the sanchalak/city_admin approval transaction, and failing would reject a legitimate enrolment.

### Q5 — Niyam rejection: 30-day window only (with one exemption)
A niyam submission that **awarded points** can only be rejected within 30 days of submission. After 30 days, the reject button in admin UI is disabled AND the API returns `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED` (409). On rejection: Punya is reversed, streak is recomputed, gallery item (if any) is hidden.

**A still-`pending` submission is exempt from the window and may be rejected at any age.** It never awarded anything, so there is nothing to reverse; gating it would strand a stale queue item forever with no way to clear it. This is implemented in `canRejectSubmission` (`lib/niyam-constants.ts`) and was previously recorded only in `.cursor/rules/20-niyam-fix-pass.mdc` — it is authoritative here now. Never hardcode 30 in a client: the API returns `reversal_window_expires_at` and `can_reject`.

**Auto-approve is the default.** `niyams.approval_mode` defaults to `'auto'`, so retroactive rejection is the *primary* admin workflow, not an edge case. Any admin surface that lists only `pending` rows is broken by definition.

### Q5a — Badge Punya is permanent (decided 2026-08-18)
Rejecting a submission reverses **only** that submission's own award (`feature_key='niyam_submission'`). The 25-point `niyam_badge` bonus that a streak milestone triggered is **not** reversed, and the badge row itself survives — badges are historical achievements (`lib/niyam-badges.ts`).

This is a deliberate trade-off, not an oversight. The known consequence is that the bonus is farmable: submit 7 days, collect +25 at the `daily_7` milestone, then have the 7th submission rejected, and repeat. That was accepted because reversing a bonus whose milestone was genuinely reached at the time punishes a child for an adult's later review decision, and because `longest_streak = max(stored, recomputed)` already guarantees a peak can never decrease. If this is ever revisited, the reversal must reference the badge's own idempotency key (`badge:{student}:{niyam}:{key}`) and follow the AT18 reverse-then-award discipline — do not bare-debit.

### Q6 — Gallery opt-in: blanket, per parent (query-time; no backfill)
`users.gallery_visibility_opt_in` is a **single toggle per parent** covering all their children. Parents set it via `PATCH /v1/me/gallery-visibility`. Consent is resolved at **query time** by the join in `GET /v1/gallery` (and admin `can_publish`) — toggling is instant and needs **no backfill**. Gallery rows are created for every approved submission regardless of opt-in; visibility is decided on read. Do not replace this with a write-time check or a per-item hide/restore job. (Older wording that described a backfill is stale; the shipped design is query-time — see `.cursor/rules/20-niyam-fix-pass.mdc` and SPEC.md § gallery consent.)

### Q6a — Niyam submission is offline-first (shipped reality, reconciled 2026-08-18)
There is **no online-only submit path on any client**. `useSubmitNiyam` enqueues into `jp.queue.niyam_submissions` and drains through `POST /v1/sync/batch`; nothing in the mobile or web app calls `POST /v1/niyam-submissions` to create a submission. The HTTP route still exists and is still tested, but in production it is the *secondary* caller.

Both entry points call **`services/niyam-submit.ts` → `submitNiyam()`**, which owns ownership, audience, the date window, media resolution, the advisory lock, and the award + gallery + streak + badge sequence. Rate limiting lives on the HTTP route only — applying it inside the service would reject a parent syncing a week of offline niyams, and a 429 backoff capped at 5 min / 10 attempts cannot outlast an hour-long bucket.

**Why this is written down:** the offline queue writer shipped before the sync handler was fixed, so for a period every submission ran through a parallel handler that awarded nothing — children were told "approved" and received 0 Punya. If you add a second submit path, or "simplify" the route by re-inlining the transaction, that regression returns silently. Submission ownership is **parent/self only** on both paths (`ownedStudentsCondition`); no staff role may submit on a child's behalf.

### Q7 — Library videos: embed URLs only
Library items of `type='video_embed'` store a YouTube or Vimeo URL in `embed_url`. No video files are uploaded to S3/R2. Validate that the URL is a valid YouTube or Vimeo link on creation. The mobile and web apps render these as embedded iframes/WebViews.

### Q11 — Students: never hard delete
Students are deactivated (`status='inactive'`), never deleted from the database. This includes their enrolment records. Re-activation must be possible at any time. Deactivated students do not appear in active enrolment counts, attendance rosters, or Punya leaderboards.

### Q12 — Niyam review scope: shikshak is batch-bound, sanchalak covers the centre (resolved 2026-08-05)
`POST /v1/niyam-submissions/:id/approve` and `/reject` gate on `inBatchWriteScope(scope, student.batch_id, student.centre_id)`, NOT the deprecated centre-level `inScope`. A shikshak decides only on submissions from batches they are assigned to — a Guruji judging whether a child kept a Niyam needs to know the child. `inBatchWriteScope` already resolves `batchIds === null` to centre membership, so sanchalak and above keep whole-centre reach with no special case.

The sanchalak is the safety net, and that only works if they can actually reach the queue: niyam review MUST be available to the sanchalak persona on mobile, not web-only. Do not tighten the shikshak gate without shipping the sanchalak's mobile access in the same release — otherwise an unstaffed batch's submissions strand with nobody able to clear them.

`GET /pending` stays centre-scoped for both roles so a shikshak can see the centre's backlog; only the approve/reject writes are batch-bound.

## Attendance module — binding decisions (resolved 2026-08)

These are decisions, not options. Implement exactly as written. They override any conflicting text in `SPEC.md`.

### AT1 — Attendance status enum
`attendance_status_enum` is: `'present' | 'absent' | 'late' | 'excused'`.

### AT2 — Excused excluded from percentage and Punya
`'excused'` is EXCLUDED from both sides of the attendance percentage and earns 0 Punya. Counting a pre-notified absence against the child removes the incentive to pre-notify.

### AT3 — Late is full attendance
`'late'` earns FULL attendance Punya and counts as attended. The distinction is pastoral information for the Guruji, not a penalty.

### AT4 — Excused from absence notifications
`'excused'` is set automatically when an `absence_notifications` record covers the session date for that student, pre-filled in the Guruji's marking UI and overridable by them. Marking a covered session consumes the notification (sets `resolved_at`). FullSpec §6.3 requires pre-notified absences be distinguishable from unmarked ones; an enum value nobody populates does not satisfy that.

### AT5 — One canonical attendance percentage
ONE canonical implementation: a PostgreSQL view or SQL function. Not a TypeScript service function — materialised views must be able to call it, and if they cannot they will re-implement the arithmetic and drift. Mobile, admin panel and the PDF worker all read from this one place and never compute their own.

```
attendance_% = COUNT(*) FILTER (WHERE status IN ('present','late'))
             / NULLIF(COUNT(*) FILTER (WHERE status IN ('present','late','absent')), 0)
```

Use `COUNT(*) FILTER (WHERE …)`, NOT `COUNT(expr IN (…))`. In Postgres, `COUNT(boolean)` counts every non-null row, so the naive form returns 1.0 for everyone.

Excluded from both sides: sessions with `status='cancelled'`; sessions inside a `centre_holidays` range for that centre; students from `deactivated_at` forward (prior history retained). `'excused'` rows are excluded automatically by appearing in neither FILTER clause.

### AT6 — Silence is not absence
A session with ZERO attendance rows contributes nothing (no rows, no counts) — a Guruji who forgets to submit does not zero out the batch. A PARTIALLY marked session counts only the students actually marked; unmarked students are NOT inferred absent. Absence is an affirmative observation, never an inference from silence.

### AT7 — Session materialisation only
`sessions` rows are created ONLY by the `session.materialise` job, expanding each active batch's `day_of_week` into a rolling 60-day forward window, skipping `centre_holidays`. Constraint `UNIQUE (batch_id, scheduled_date)` enforces this at the database level.

### AT8 — Check-in resolves; soft-create exception
Check-in RESOLVES an existing session; it does not create one. Exception: if no scheduled session matches, create one with `status='in_progress'` and `unscheduled=true`, and notify the Sanchalak. Hard-failing would make a Guruji at an ad-hoc or unmaterialised session lose an entire day's offline work — which is the exact failure this whole exercise exists to prevent.

### AT9 — Timetable change rematerialises
On batch timetable change: delete future `'scheduled'` sessions with zero attendance rows, re-materialise, notify affected parents.

### AT10 — New holiday range
On a new `centre_holidays` range: delete future `'scheduled'` sessions in range with zero attendance rows. Sessions in range that ALREADY have attendance are left intact and are NOT retro-excluded from the percentage — the class demonstrably happened.

### AT11 — No session_cancellations table
`session_cancellations` is NOT a table. The embedded columns on `sessions` (`cancelled_at`, `cancellation_reason`, `cancellation_by`) are the record.

### AT12 — Auto-checkout stale in_progress
Sessions still `'in_progress'` at `scheduled_end_time + 2 hours` are auto-closed with `auto_checked_out=true` and excluded from session-duration analytics.

### AT13 — GPS radius column
Column is `gps_radius_meters`, default 250, per-centre overridable.

### AT14 — Session GPS columns
`sessions` carries `gps_flagged` boolean, `check_in_distance_m` and `check_out_distance_m` (both from the CENTRE), not a flags array. Check-out is radius-validated like check-in.

### AT15 — accuracy_m never blocks
`accuracy_m` is validated SERVER-side and stored. `accuracy_m > 100` marks the check-in unverified and flags it — it does NOT reject. Never block a real Guruji from starting a real class over a bad GPS fix.

### AT16 — Check-in idempotency on submission_op_id
Check-in idempotency keys on `submission_op_id` (not `client_op_id` — see AT19). Same shikshak + same `submission_op_id` returns the existing session with 200. A DIFFERENT `shikshak_user_id` on an already-checked-in session returns 409 and notifies the Sanchalak. The idempotency check runs BEFORE the status assertion, or every legitimate retry fails against `status='in_progress'`.

### AT17 — Attendance Punya idempotency key
Punya idempotency key for attendance is `attendance:{session_id}:{student_id}:{revision}` where `revision` is an int column on `attendance`, incremented on every status change. A key constant across corrections cannot represent a state TRANSITION.

### AT18 — Reverse-then-award on corrections
Award-worthiness changes are always expressed as an explicit REVERSE-then-AWARD pair, never as a bare second award:
- old status award-worthy AND new status not → reverse only
- old not award-worthy AND new is → award only
- BOTH award-worthy but the point value differs (e.g. present→late under a future differential rate) → reverse the old, award the new
- both award-worthy and value identical → NO transaction, and do NOT bump revision

A reversal references the most recent UNREVERSED award for `(session_id, student_id)` in `reversal_of` — not blindly `revision−1`, which may point at a revision that produced no transaction.

### AT19 — Two-level op IDs
Two-level identifiers, deliberately named differently so they cannot be conflated:
- `submission_op_id` — one per submission → `sync_operations`, drives batch replay-safety
- `client_op_id` — one per item → `attendance.client_op_id`, per-row repair

Both are ULIDs stored as `char(26)` with a format CHECK. Not the `uuid` type.

### AT20 — Guarded insert then balance
Punya balances are NEVER incremented unconditionally alongside a guarded insert. The insert uses `ON CONFLICT DO NOTHING … RETURNING`, and the balance moves only by the amount actually returned. A guarded insert plus an unguarded increment double-awards on every resync — the most likely silent corruption in this module.

### AT21 — Points from punya_features
Attendance point values resolve from `punya_features` at award time (city-scoped, global fallback), Redis-cached. Never inline a constant.

### AT22 — Repeating streak bonus
Streak bonus: 20 points every 4 consecutive attended sessions, REPEATING — not one-time milestones at 7/14/30/60/100. `'present'` and `'late'` count as attended; `'excused'` neither continues nor breaks a streak (skip it); `'absent'` resets to 0. Holidays and cancelled sessions are skipped when determining "consecutive". Streak bonus transactions use `source_entity_kind='attendance_streak'` (NOT `'attendance'`) and an idempotency key including the TRIGGERING `session_id`, since milestone 4 recurs after every reset. If a mark that completed a streak is later corrected, the bonus is reversed along with the attendance award.

### AT23 — Punya tier thresholds in configuration
Punya tiers: Jigyasu 0–100, Shravak 101–500, Sadhak 501–1500, Shraman 1501–5000, Tirthankar 5001+. These live in CONFIGURATION alongside `punya_features`, not as code constants — adjustable without a migration. Any conflicting threshold table in SPEC.md is deleted; this rule is the source.

### AT24 — Marking cancelled sessions
Marking attendance on a session with `status='cancelled'` returns 409 `ERR_SESSION_CANCELLED`. The guard lives in the marking transaction itself.

### AT25 — Cancel with existing marks
Cancelling a session that already has attendance rows is BLOCKED unless `force_cancel` is passed. `force_cancel` bumps each affected attendance row's `revision`, writes reversals at the new revision (per AT18), writes an audit entry, and suppresses the duplicate "session cancelled" push to parents who already received "attendance marked".

### AT26 — Same-day edit window on client marked_at
The same-day edit window is Asia/Kolkata, evaluated against the client's `marked_at`, NOT server receipt time, and enforced in the SERVICE layer on both the bulk and single-mark routes. Evaluating on receipt time means a Guruji offline over a weekend has their entire roster rejected on Monday — data loss in the module's primary use case. Enforcing only on PATCH is bypassed by re-submitting the roster.

### AT27 — Consecutive-absence alerts
Consecutive-absence alerts notify parent + SANCHALAK + city_admin, run at 02:00 IST the FOLLOWING day, and trigger only on three `'absent'` rows — `'excused'` never counts. An evening run fires before offline marks have synced, producing false escalations. The Sanchalak is the centre head and the person who can actually phone the family.

### AT28 — Shivir attendance is separate
Shivir attendance is separate. `shivir_attendance_scans` does NOT feed attendance %, streaks, or automatic Punya. Shivir Punya is awarded only via the manual `msv_shivir` feature.

### AT29 — British table naming
Table naming is British: `centres`, `sanchalak_centre_assignments`, `centre_holidays`.

### AT30 — Holidays route split
`GET /v1/admin/centres/:id/holidays` must not be role "any". Split into a public `GET /v1/centres/:id/holidays` (published only) and an admin route scoped to sanchalak+.

### AT31 — Debounced attendance push + windowed admin feed
The parent "attendance marked" push is debounced per `(student, session)` behind a 5-minute settle window. The Socket.IO admin feed emits a 10-second windowed aggregate count, not one event per mark. The load-test SLO is 5,000 marks in 60s.

### AT32 — Check-in is never a precondition for marking attendance (resolved 2026-08-05)
Marking attendance MUST NOT require a prior check-in. A Guruji who forgot to tap "Start class", whose GPS never resolved, or who declined the location permission still marks a full roster — same as AT6 refuses to infer absence from silence and AT8 refuses to lose a day's work over an unmaterialised session. Blocking the roster is a larger harm than an unverified session.

Four binding consequences:

1. **Soft transition.** The first mark on a `'scheduled'` session sets `status='in_progress'` and `conducted_by` in the SAME transaction as the mark, leaving `check_in_at` NULL. This is what the AT8 soft-create path already does for unmaterialised sessions; a materialised session must not behave differently. Marking a `'completed'` session inside the AT26 edit window does NOT reopen it.

2. **No fix is not a bad fix.** `check_in_lat`, `check_in_lng`, `check_in_distance_m` and `check_in_accuracy_m` are NULLABLE and MUST be NULL when no location was captured. Never write sentinel coordinates. `(0, 0)` is a real point in the Gulf of Guinea; passing it means every soft-created session records the Guruji ~6,000 km from the centre, flags them, and pages the Sanchalak. Callers with no fix pass `null` — never `lat: 0, lng: 0, accuracy_m: 9999`.

3. **`gps_flagged` means "measured and wrong", never "not measured".** It is set only when a real fix was compared against `gps_radius_meters` and failed, or when `accuracy_m > 100` (AT15). A session with no fix at all sets `gps_unverified=true` and `gps_flagged=false`. `notifyGpsFlag` MUST NOT fire for a session that was never geolocated — a Sanchalak who is paged for every offline roster stops reading the alerts.

4. **Visible, not punitive.** A session marked without check-in carries `check_in_at IS NULL` and surfaces to the Sanchalak as "not checked in", distinct from both a verified check-in and a GPS-flagged one. It is pastoral information, exactly as AT3 treats `'late'` — not a violation, not an alert, and never a reason to reject the marks.

---

## Attendance — frozen route table

Resource-nested and hyphenated. These are the only attendance/session routes — do not invent alternatives.

| Method | Route | Notes |
|---|---|---|
| POST | `/v1/sessions/:id/check-in` | GPS check-in; idempotent on `submission_op_id` (AT16) |
| POST | `/v1/sessions/:id/check-out` | GPS check-out; radius-validated (AT14) |
| POST | `/v1/sessions/:id/attendance` | Bulk mark |
| PATCH | `/v1/sessions/:id/attendance/:student_id` | Single-mark edit |
| POST | `/v1/sessions/:id/cancel` | Cancel; `force_cancel` when marks exist (AT25) |
| GET | `/v1/sessions/today` | Shikshak today's sessions |
| GET | `/v1/students/:id/attendance` | History / month query |
| POST | `/v1/students/:id/absences` | Parent advance absence |
| GET | `/v1/admin/attendance/centres/:id/log` | Centre attendance log |
| GET | `/v1/centres/:id/holidays` | Public — published holidays only (AT30) |
| GET | `/v1/admin/centres/:id/holidays` | Admin — sanchalak+ (AT30) |
| POST | `/v1/sync/batch` | Single offline transport (AT19) |

---

## Courses module — binding decisions (resolved 2026-08-07, folded in 2026-08-21)

These are decisions, not options. Implement exactly as written. They override any conflicting text
in `SPEC.md` and supersede `SPEC.md` §5.13, §6.16 and Step 19 where they conflict. Full rationale
and worked examples live in `docs/CURRICULUM_ENHANCEMENT.md` (the rationale archive, per its own
header) — read it when this section is silent. CU31 (offline sync) already lives in the
**"Offline sync — canonical model"** section above; the `course_progress`/`course_certification`
queue entries, drain order and conflict rules there are this rule's implementation — do not
duplicate it here.

Gaps between these rules and the shipped code are tracked in
`docs/reviews/COURSES_MODULE_REVIEW.md` and closed via `docs/reviews/COURSES_FIX_CURSOR_PROMPTS.md`
— these rules state the target, not a claim that every line of code matches it yet.

### CU1 — Rename to courses; three levels, frozen
`course_templates` (one-time copy, CU7) → `courses` → `course_sections` → `course_subsections`.
Exactly three levels — do not add a fourth. `curriculum_level_enum` keeps its pgEnum name; renaming
it is churn with no payoff.

### CU2 — Courses are never assigned to a batch or centre
No `course_assignments` table, no `batches.course_id`, no course↔batch link of any kind. A course is
a body of material; a student's relationship to it is their own progress rows and nothing else.

### CU3 — Course visibility
A student sees a course when **all** of: `courses.status = 'active'` (CU4); `courses.city_id IS
NULL` (national) OR matches the student's centre's city; and if `courses.kind = 'msv'`,
`students.msv_status = 'approved'` (reads `students.msv_status`, not `msv_enrolments` — the same
predicate `msvCurriculumByStudent()` already uses elsewhere). No age-group targeting —
`course_templates.age_group` is authoring metadata only and is never copied onto derived courses or
used to filter visibility. Parents see every child's courses; a student in student-view (8+, Q4)
sees their own.

### CU4 — Course lifecycle
`courses.status` is `'draft' | 'active' | 'archived'`, default `'draft'`. `draft → active` is an
explicit audited transition (not a field edit), rejected unless `name_hi` is set (CU5),
`academic_year` is set, the course has ≥1 section, and every section has `punya_points` explicitly
set (CU22). Once `'active'`, a course can only move to `'archived'`, never back to `'draft'`.
Archiving removes the course from CU3 visibility for new work but never touches what a student
already earned — progress, Punya, certificates and CU27 verification all survive, and an archived
course still appears in the student's own history and CU30 reports. The archive confirm must state
how many students currently have in-progress, uncertified work on it.

### CU5 — Courses and templates are bilingual
`name_en` NOT NULL, `name_hi` nullable (CU4's publish gate makes it effectively required before a
course can go live — nullable only so the migration over live rows is possible without violating the
Devanagari rule).

### CU6 — PATCH and DELETE for courses
`PATCH /v1/admin/courses/:id` and `DELETE /v1/admin/courses/:id` (soft, per CU29) must exist and be
reachable — a course must be renameable, re-kindable, re-yearable and archivable after creation.

### CU7 — Templates are a one-time copy; there is no drift
Deriving a course from a template snapshots it: sections and sub-sections are copied,
`courses.template_id` records provenance, and the two are independent from that moment forward.
Editing or deleting a template never touches a derived course — no sync, no propagation, no override
flags. Templates are authored and derived by `super_admin` only.

### CU8 — Q2 resolution: MSV authoring is super_admin only
Creating or editing a `kind='msv'` course, or any course with `city_id IS NULL`, is `super_admin`
only, enforced in the **service layer**. This closes two gaps: `kind='msv'` must be gated even when
the caller supplies an in-scope `city_id`, and section/sub-section authoring under a **national**
course is super_admin only — Q2 wins over any SPEC list that also allows `state_admin` there.

### CU9 — One row per student per node
ONE `student_course_progress` row per `(student, node)` — exactly one of `section_id`/`subsection_id`
is set (`num_nonnulls = 1` CHECK), `certified_at`/`certified_by` are set together or not at all, and
`certified_at IS NOT NULL` requires `status = 'completed'`. Uniqueness is **two partial indexes**
(one per node type), never one composite — Postgres treats NULLs as distinct, so a composite index
over a nullable column silently stops constraining. `client_marked_at` is the client's clock (same
reasoning as AT26) and is what CU31's conflict rule compares — never server receipt time.

### CU10 — Every write is an UPSERT, with the index predicate repeated
Every progress write is `ON CONFLICT … DO UPDATE`, never read-then-insert. Because the unique indexes
are partial, the conflict target must repeat the predicate (`target` + `targetWhere` in Drizzle) or
it fails at runtime with "no unique or exclusion constraint matching the ON CONFLICT specification."

### CU11 — Status has three values; `mastered` is dead
`not_started ⇄ in_progress ⇄ completed` ("to be started" in the UI). `start` stamps `started_at`
(first time only); `close` stamps `completed_at`. Movement is free in both directions while
`certified_at IS NULL`, for every actor including parent and student. `'mastered'` is never written —
certification (`certified_at`/`certified_by`, CU17) is what `mastered` would have meant; the enum
value stays reserved (dropping a pgEnum value requires recreating the type) but writing it is a bug.

### CU12 — Certified rows are frozen for everyone, at both layers
Once `certified_at IS NOT NULL`, any write that would change `status` returns `409
ERR_COURSE_NODE_CERTIFIED` for parent, student, shikshak and sanchalak alike. Only the CU19
super_admin correction path may move it, clearing `certified_at`/`certified_by` in the same
statement. The `certified_requires_completed` CHECK (CU9) is the net — if a service guard is missed,
the write 500s (23514) instead of the designed 409. **Both layers are required.**

### CU13 — Bulk status write is the primary path for a shikshak
`POST /v1/courses/nodes/:nodeId/progress/bulk` — exactly one of `batch_id`/`student_ids` (both or
neither is 422). `batch_id` is a student-selector only (courses have no batch link, CU2); it resolves
to the batch's active roster and never includes deactivated students (Q11). Every resolved student
must pass `inBatchWriteScope(scope, student.batch_id, student.centre_id)` — same gate as CU21 — and
a `student_ids` list containing anyone out of scope is rejected whole with 403, never partially
applied.

### CU14 — Bulk advances, never regresses
A bulk write applies to a student only if the new status is strictly further along CU11 than their
current one. Regression requires an explicit `reset: true` on a separate route, shikshak+ only, with
an audited entry **per affected student** — without it, one bulk tap silently walks a whole roster
backwards with no trace. Certified rows (`certified_at IS NOT NULL`) are excluded from every bulk
write, `reset` included (CU12). Single-student self-correction stays free (CU11) — this rule governs
the bulk route only.

### CU15 — Silence is not regression
A student with no progress row for a node is `not_started` by absence, not by assertion. Never
backfill `not_started` rows on course publish or enrolment — a row exists only once someone has acted
on that node. Mirrors AT6.

### CU16 — Section status is stored AND derived; divergence is information
A section carries its own declared progress row (CU9) *and* a derived roll-up over that student's
sub-section rows within it — the roll-up is `fn_course_progress` (CU28) scoped to one section, never
a second formula. Both are surfaced, on every surface that shows section progress. A section declared
`completed` while its sub-sections sit at `not_started` is **not an error** — it is information for
the Sanchalak, exactly as AT32 treats a session marked without check-in. Never auto-correct one from
the other, and never block the declaration because the roll-up disagrees. A section with zero
sub-sections has a derived roll-up of `NULL`, not `0` and not `100` — this belongs in the function
itself, not in one caller.

### CU17 — The star requires `completed`
Certification is an orthogonal flag (`certified_at`/`certified_by`), not a status — `status` stays
`completed`. A node must be `completed` before it can be certified; online, a request against a node
that isn't returns `409 ERR_COURSE_NODE_NOT_COMPLETE`. **Offline soft-transition** (AT32 pattern):
when a certification arrives via `/v1/sync/batch` and the node isn't yet `completed`, the certify
transaction sets `status`, `completed_at`, `certified_at` and `certified_by` in one statement, same
reasoning as AT8/AT32. Both sections and sub-sections can be starred; sub-section stars never carry
Punya (CU21). The star's label names the certifying shikshak with the correct honorific from
`users.gender` — male → "Certified by Guruji"/"गुरुजी द्वारा प्रमाणित", female → "Certified by
Didi"/"दीदी द्वारा प्रमाणित", **NULL or other → "Certified"/"प्रमाणित"**. The third branch is required,
not optional — `users.gender` is nullable with no backfill.

### CU18 — Certification is irreversible; every certification is audited
No revoke route. Final for shikshak, sanchalak, city_admin and state_admin. Every certify writes an
audit entry (`entityKind: 'course_certification'`) — same rule extends to CU6 PATCH/DELETE, CU4
publish, CU7 derive, and any edit to `course_sections.punya_points`. Certification is per-student with
no bulk route; the client shows an explicit confirm (student name, node title, the actual **clamped**
Punya value) before the write — bulk the reversible thing (CU13), make the irreversible thing
deliberate, same posture as AT25's `force_cancel`.

### CU19 — The super_admin correction path
Reachable only from the super_admin console, service-layer role-checked (not just the route). It, in
one transaction: (1) increments `student_course_progress.revision`; (2) clears
`certified_at`/`certified_by`, optionally regressing `status`; (3) writes a reversing
`punya_transactions` row with its own idempotency key and `source_revision = revision` (AT18
reverse-only — without its own key, running the correction twice double-reverses); (4) **only when
the correction is on a `section` node and the course was complete**, reverses the course bonus too
(CU23) — a sub-section correction touches no course-level state, because sub-sections carry no Punya
under CU21 and are not part of CU25's course-complete predicate; (5) sets `voided_at`/`voided_by` on
any issued section certificate, and on the course certificate too if the course was complete (CU24) —
voided certificates are never deleted, CU27 reports them as `void`; a later correct re-certification
clears the void fields and re-issues rather than leaving the certificate voided forever; (6) writes
two audit entries — one for the correction, one naming the acting super_admin from the real caller,
never hardcoded.

### CU20 — Deleting a certified node is blocked
Soft-deleting a `course_section`/`course_subsection` is rejected with `409
ERR_COURSE_NODE_HAS_CERTIFICATIONS` if any progress row for it has `certified_at IS NOT NULL` —
archive the course instead (CU4). This is a **service-layer precondition inside the delete
transaction**, checked before the delete, not a database FK — CU29 makes deletion soft, so `ON DELETE
RESTRICT` never fires on it. The same guard applies to deleting the parent **course** (CU29): a course
with certified sections cannot be deleted, only archived.

### CU21 — Punya is minted by certification alone
Start/close/reopen any node, by anyone: 0 Punya. Sub-section certified: 0 Punya (recognition without
currency). Section certified: `course_sections.punya_points × city multiplier`,
`source_entity_kind='course_section'`. Course fully certified (CU25): `courses.punya_points × city
multiplier`, `source_entity_kind='course'` — a milestone award (AT22's repeating-streak spirit) that
fires from the same transaction as the final section's certification, never a cron sweep. Certification
scope gates on `inBatchWriteScope(scope, student.batch_id, student.centre_id)` — identical to niyam
approve/reject (Q12) — resolving `batchIds === null` to centre membership so sanchalak+ keep whole-
centre reach with no special case. **Never ship the shikshak certification gate without the
sanchalak's mobile certification screen in the same release** — an unstaffed batch's queue strands
otherwise (Q12).

### CU22 — Points are authored; the multiplier is `punya_configs`
`course_sections.punya_points` (0–1000) and `courses.punya_points` (0–2000) are authored by the
city_admin at design time — authored data, not a hardcoded constant (AT21). `courses.punya_points = 0`
is legitimate ("certificate, no bonus"); a section's `punya_points` is a CU4 publish precondition
precisely because 0 there silently disables the main award path. The multiplier lives in the existing
`punya_features`/`punya_configs` tables (`key`/`feature_key` = `'course_section_certified'` |
`'course_completed'`), stored as **integer percent** (`100` = 1×, `250` = 2.5×) — never a numeric
multiplier column. `award = ROUND(punya_points * punya_configs.points / 100.0)`, clamped to
`punya_features.min_points…max_points`, resolved at award time (city-scoped, global fallback,
Redis-cached per AT21) and snapshotted into the transaction row. **A missing or inactive
`punya_features` row means the award is 0, never unclamped** — the clamp must not be skippable just
because `max_points` defaults to 0. Mechanics otherwise follow AT20 unchanged: guarded insert `ON
CONFLICT DO NOTHING … RETURNING`, balance moves only by the amount actually returned.

### CU23 — Idempotency keys
```
section award:     course_section_certified:{section_id}:{student_id}:{revision}
section reversal:  course_section_certified:reverse:{section_id}:{student_id}:{revision}
course  award:     course_completed:{course_id}:{student_id}:{trigger_section_id}:{revision}
course  reversal:  course_completed:reverse:{course_id}:{student_id}:{trigger_section_id}:{revision}
```
`revision` is `student_course_progress.revision` (CU9). The section key needs the revision because
CU19 makes re-certification after a correction reachable — without it the guarded insert returns
nothing and the student gets a star with zero points (the AT17 failure). The course key needs the
**triggering section** because course completion recurs (AT22's repeating-milestone problem): a
correction can de-complete a course and a later certification can re-complete it, keyed on whichever
section triggered that completion.

### CU24 — Certificate schema
`course_certificates`: `kind IN ('section','course')`, `section_id` set iff `kind='section'`,
`verification_code char(12)` (Crockford base32, CSPRNG, ~60 bits, retry on collision), `voided_at`/
`voided_by` nullable, `storage_key` NULL until the PDF worker finishes (NULL = "issuing", not
broken). Unique per `(student_id, section_id)` and `(student_id, course_id)` (partial indexes on
`section_id IS NOT NULL`/`IS NULL`).

### CU25 — What "fully certified" means, and certificates are point-in-time
A section certificate issues when that section's own progress row is certified (not when its
sub-sections are). A course certificate issues when every non-deleted section is certified — a
course with zero sections issues nothing (the predicate would otherwise be vacuously true) — in the
same transaction as the triggering section's certification, alongside the CU21 course bonus.
`scope_snapshot` records the node ids/titles the certificate covered **at issue time**; adding a
section to an active course later does not void or re-issue anything, and CU27 verifies against the
snapshot, not the live tree. This is why CU4 forbids `active → draft` but permits editing an active
course — coverage (CU28) may drop for every student; that is honest and expected.

### CU26 — Generation
`PdfBuilder.createBilingual()` (not `.create()`, which is English-first/WinAnsi and cannot render
Devanagari) — the same builder the monthly centre report uses. No Handlebars, no Puppeteer. Queued on
the existing `report.generation` queue with a payload discriminator — do not add a queue name.
Signed URL with TTL, never a public URL.

### CU27 — Certificates verify live and leak nothing
`GET /v1/certificates/verify/:code` is public, rate-limited per **IP** (not a client-controlled
header) in Redis, and returns only: validity (`valid`/`void`/`not_found`), the course/section title,
issue date, and the student's **first name only** — never full name, DOB, centre or any id. This rule
is scoped to the public verification endpoint; the certificate **PDF** artefact handed to the family
prints the student's real full name. A PDF in a parent's hand is a rendering of state, not the state
itself — the only thing that makes CU19's correction path survivable, since a voided certificate
would otherwise still circulate looking valid.

### CU28 — One canonical progress calculation, in SQL
ONE PostgreSQL function, `fn_course_progress(p_student_id, p_course_id, p_section_id DEFAULT NULL)` —
not a TypeScript service helper; the PDF worker, mobile, the admin panel and CU16's section roll-up
all read from this one place. Leaf nodes = all non-deleted `course_subsections`, plus non-deleted
`course_sections` with zero non-deleted sub-sections (a section-only course must still report
non-NULL progress). `coverage = leaf_reached / leaf_total`, `mastery = leaf_certified / leaf_reached`
(NULL, not 0, when `leaf_reached = 0`) — both `::numeric` cast (int/int truncates), both via a real
`LEFT JOIN` (CU15: untouched nodes have no row), both `COUNT(*) FILTER (WHERE …)` never `COUNT(expr IN
(…))`, and the leaf-certified filter applied on the join predicate (CU9 puts sections and
sub-sections in the same table — an unrestricted count pulls certified sections into a
leaf-denominated numerator). Excluded everywhere: soft-deleted nodes (CU29); students from
`deactivated_at` forward, prior history retained (Q11). No materialised view — the frozen MV list
above is not extended for this.

### CU29 — Soft delete; RESTRICT is the net, not the guard
`courses`, `course_sections`, `course_subsections` and `course_templates` carry `deleted_at`. Every
CASCADE FK in the tree (including `student_id`) becomes RESTRICT — the `student_id` cascade
especially, since it contradicts Q11's never-hard-delete rule by assuming a delete that must never
happen. RESTRICT alone protects nothing once deletion is soft (the FK only fires on a hard `DELETE`)
— **CU20's service-layer precondition is the actual guard**; the FK exists only so a stray hard
delete can't do the damage either. Undelete (`deleted_at = NULL`) is admin-only, audited, and restores
the node plus its progress rows.

### CU30 — Progress report gains a versioned curriculum block
`progress_reports.snapshot` gains a `snapshot_version` column and a `courses: [{ course_id, coverage,
mastery, section_certified, section_total, certified_nodes[] }]` block, read from `fn_course_progress`
(CU28) — never recomputed in the report worker. Readers branch on `snapshot_version`; pre-change
snapshots are version 1 with no `courses` key.

### CU32 — Error codes
`ERR_COURSE_NODE_CERTIFIED` (409, CU12), `ERR_COURSE_NODE_NOT_COMPLETE` (409, CU17 online path),
`ERR_COURSE_NODE_HAS_CERTIFICATIONS` (409, CU20), `ERR_COURSE_NODE_NOT_FOUND` (404),
`ERR_COURSE_STUDENT_OUT_OF_SCOPE` (403, CU13/CU21/parent-student scope),
`ERR_COURSE_NOT_PUBLISHABLE` (422, CU4). Never a raw string.

### CU33 — Manual archive, with a staleness nudge
No automatic archiving, no year filter — a city_admin decides, because archiving removes a course
from every student's view. The admin course list carries a persistent banner listing active courses
whose `academic_year` is older than the current one (one-tap archive per course), plus a secondary
warning once a city exceeds 15 active courses. The archive confirm states how many students have
in-progress uncertified work on that course (CU4).

---

## Courses — frozen route table

Resource-nested. These are the only course routes — do not invent alternatives. Roles are the
minimum; a higher role can always do what a lower role can (role hierarchy above).

| Method | Route | Roles / notes |
|---|---|---|
| POST · PATCH · DELETE | `/v1/admin/course-templates[/:id]` | super_admin (CU7) |
| POST | `/v1/admin/course-templates/:id/derive` | super_admin — snapshot copy (CU7) |
| POST | `/v1/admin/courses` | city_admin; super_admin only for msv / `city_id IS NULL` (CU8) |
| PATCH · DELETE | `/v1/admin/courses/:id` | city_admin — soft delete (CU6, CU29) |
| POST | `/v1/admin/courses/:id/publish` | city_admin — draft → active, gated + audited (CU4) |
| GET | `/v1/admin/courses?kind=&status=` | shikshak |
| GET | `/v1/admin/courses/:id/tree` | shikshak |
| POST | `/v1/courses/:courseId/sections` | city_admin — body includes `punya_points` (CU22) |
| PATCH · DELETE | `/v1/courses/sections/:sectionId` | city_admin (CU20 guard) |
| POST | `/v1/courses/:courseId/sections/reorder` | city_admin |
| POST | `/v1/courses/sections/:sectionId/subsections` | city_admin |
| PATCH · DELETE | `/v1/courses/subsections/:subsectionId` | city_admin (CU20 guard) |
| POST | `/v1/courses/sections/:sectionId/subsections/reorder` | city_admin |
| GET | `/v1/courses` | any authenticated — active + city/national + MSV gate (CU3) |
| GET | `/v1/courses/:id/tree?student_id=` | any authenticated — student-facing read path with status + star per node |
| GET | `/v1/students/:id/course-progress?course_id=` | owner or in-scope admin |
| POST | `/v1/courses/nodes/:nodeId/progress` | shikshak, sanchalak, parent (own child), student (self, 8+) |
| POST | `/v1/courses/nodes/:nodeId/progress/bulk` | shikshak (CU13) |
| POST | `/v1/courses/nodes/:nodeId/progress/reset` | shikshak — audited (CU14) |
| POST | `/v1/courses/nodes/:nodeId/certify` | shikshak — batch-bound (CU21) |
| GET | `/v1/students/:id/certificates` | owner or in-scope admin |
| GET | `/v1/certificates/verify/:code` | public, rate-limited (CU27) |
| POST | `/v1/sync/batch` | offline transport for `course_progress`/`course_certification` (CU31, offline section above) |

`:nodeId` resolves against `course_sections` then `course_subsections`; matching neither is `404
ERR_COURSE_NODE_NOT_FOUND`. Both core write bodies are per-student (`student_id` in the body, not the
path — a parent has more than one child):
```ts
POST /v1/courses/nodes/:nodeId/progress   { student_id, status, note?, client_op_id, marked_at }
POST /v1/courses/nodes/:nodeId/certify    { student_id, certification_note?, client_op_id, certified_at }
```
A `parent` writes only for their own children; a `student` (student-view, 8+ per Q4) only for
themselves — never a sibling (`403 ERR_COURSE_STUDENT_OUT_OF_SCOPE`), and never a certified row
(CU12).

---

## Cron table (frozen — single list)

Source of truth: `CRON_EXPRESSIONS` in `apps/jp-shared/src/constants.ts` (`@jp/shared/constants`). Times are IST (`Asia/Kolkata` via `node-cron`, not `@nestjs/schedule` — Nest schedule is **NOT YET IMPLEMENTED**).

**Kind:**
- **queue** — cron tick enqueues a BullMQ job (handler registered via `registerQueueHandler`).
- **schedule** — cron tick runs work inline (or is a stub tick); not driven through a BullMQ worker for that tick. `niyam-streak-lapse` is explicitly documented in constants as not a BullMQ queue.

| Job | Schedule (`CRON_EXPRESSIONS`) | Kind | Notes |
|---|---|---|---|
| `session.materialise` | `0 1 * * *` (nightly 01:00 IST) | queue | AT7 — rolling 60-day window |
| `attendance.no_show_check` | `*/15 * * * *` | queue | Unchecked-in sessions past start |
| `attendance.auto_checkout` | `*/30 * * * *` | queue | AT12 — `scheduled_end_time + 2h` |
| `attendance.consecutive_check` | `0 2 * * *` (02:00 IST) | queue | AT27 — following day |
| `notifications.birthday` | `0 6 * * *` | queue | |
| `notifications.push_receipts` | `*/30 * * * *` | queue | Expo receipt sweep / dead-token reap |
| `niyam-streak-lapse` | `0 5 * * *` | schedule | Zero lapsed `current_streak` (not BullMQ) |
| `notifications.monthly_reports` | `0 2 1 * *` (1st 02:00 IST) | queue | Fan-out: insert last-month `centre_monthly_reports` per active centre (UNIQUE centre+month) and enqueue `report.generation` |
| `punya.leaderboard.refresh` | `30 0 1 * *` (1st 00:30 IST) | queue | Monthly leaderboard snapshot — ranks the month's ledger SUM, top 20 per city (BRD §7.6). Was `*/5` and ranked LIFETIME balances. |
| `punya.reconcile` | `0 3 * * *` | queue | Balance rebuild from ledger |
| `analytics.refresh_views` | `0 4 * * *` | queue | Materialised view refresh |
| `digest.weekly.email` | `0 7 * * 1` (Monday 07:00 IST) | schedule | Tick stub today |
| `auth.session.cleanup` | `30 2 * * *` | schedule | Inline session + retention prune |
| `media.cleanup_unfinalized` | `30 3 * * *` | schedule | Tick stub today |
| `donation.eightyg.year_end_summary` | `30 0 1 4 *` (1 April 00:30 IST) | schedule | Tick stub today |
| `exam.attempt_abandon` | `*/30 * * * *` | queue | Abandon `in_progress` after `window_end + 2h` |
| `exam.top_score` | `15 3 * * *` | queue | Top-score Punya catch-up (primary path is enqueue on release) |

Event-driven queue names that are **not** in `CRON_EXPRESSIONS` (still in `QUEUE_NAMES`): `attendance.post_process`, `notifications.parent`, `idcard.generation`, `report.generation` (also enqueued by `notifications.monthly_reports` and by admin POST).

---

## Materialised view names (frozen)

One name per view. Do not invent aliases.

| Canonical name | Purpose |
|---|---|
| `mv_centre_engagement` | Per-centre monthly engagement (includes attendance rate via AT5 function) |
| mv_city_attendance_monthly | City attendance trends |
| mv_donation_summary | Donation aggregates |
| mv_msv_funnel | MSV pipeline funnel |
| `mv_punya_distribution` | Punya distribution by tier/city |
| `mv_niyam_completion` | Niyam completion aggregates |
| `mv_monthly_leaderboard_city` | Monthly leaderboard snapshot |

---

## Design system

### Token files
```
apps/jain-pathshala-mobile/constants/colors.ts  ← mobile colour tokens (running)
apps/jain-pathshala/src/index.css              ← web HSL / CSS variables (running)
```
**NOT YET IMPLEMENTED:** `packages/design-tokens/tokens.json` (W3C master), `apps/web/tailwind.config.ts` / `tokens.css`, `apps/mobile/src/constants/colors.ts` under the SPEC path names.

### Never hardcode values
**Wrong:** `color: '#D4621A'`
**Right:** token colours from `apps/jain-pathshala-mobile/constants/colors.ts` (mobile) or CSS variables / theme classes in `apps/jain-pathshala` (web). Do not invent hex literals.

### Palette summary
| Token | Hex | Usage |
|---|---|---|
| `saffron` | `#D4621A` | Primary actions, CTAs, active states |
| `maroon` | `#7A1818` | Secondary brand, accents |
| `cream` | `#FDF8F2` | Page background |
| `cream-dark` | `#F5EDE0` | Card surfaces |
| `gold` | `#C8941F` | Tirthankar tier, MSV badge, premium indicators |
| `ink` | `#1A0A00` | Primary text |
| `ink-sub` | `#8B6F5E` | Secondary text |

### Age group colours (locked)
| Group | Colour | Hex |
|---|---|---|
| Bal (youngest) | Red | `#B91C1C` |
| Kishor | Amber | `#854D0E` |
| Tarun | Green | `#166534` |
| Yuva (oldest) | Blue | `#1E3A8A` |

### Punya spiritual tiers (AT23 — configuration defaults)
Thresholds live in CONFIGURATION alongside `punya_features`, not as code constants. Colours below are design tokens; point ranges are the default config values (AT23):
| Tier | Colour | Points range |
|---|---|---|
| Jigyasu (learner) | Earth `#8B6F5E` | 0–100 |
| Shravak (listener) | Green `#166534` | 101–500 |
| Sadhak (seeker) | Blue `#1E3A8A` | 501–1500 |
| Shraman (ascetic) | Maroon `#7A1818` | 1501–5000 |
| Tirthankar (enlightened) | Gold `#C8941F` | 5001+ |

### Typography
- **Display/headings:** Tiro Devanagari Sanskrit (excellent Devanagari support)
- **Body/UI:** Mukta (covers Devanagari + Gujarati + Latin)
- **Mono:** JetBrains Mono (code only)
- **Minimum line-height for any Devanagari text:** 22px (ascenders are taller)
- **String length buffer:** all layouts must tolerate +35% string length for Hindi vs English

### UI tone rules (from DESIGN_GUIDE.md)
- Warm, spiritually calm — never cold fintech or clinical edtech
- Address users as **"you"**. Teachers are **Guruji** or **Didi**, never "the teacher"
- Sentence case for buttons and headings: `Mark attendance`, not `MARK ATTENDANCE`
- **No emoji in product UI** — use the icon set instead
- Jain terms stay untranslated: Pathshala, Punya, Guruji, Sanchalak, Niyam, Shivir
- Errors must state the problem AND the fix: `That OTP is incorrect — check your SMS and try again`

---

## Key commands

### Local development
```bash
# API container (root compose; expects host Postgres/Redis — see docker-compose.yml)
docker compose up -d

# API HTTP server — PORT is required (often 8080 in .env)
pnpm --filter @workspace/api-server run dev

# BullMQ worker process (PERF #15 split; optional RUN_WORKERS_INLINE=1 on API)
pnpm --filter @workspace/api-server run dev:worker

# Mobile (Expo)
pnpm --filter @workspace/jain-pathshala-mobile run dev

# Web admin (Vite)
pnpm --filter @workspace/jain-pathshala run dev
```

**NOT YET IMPLEMENTED:** `infra/docker/docker-compose.yml` full local stack; `@jp/api` / `@jp/mobile` / `@jp/web` package names as primary apps; FastAPI AI on port 8000; NestJS on 3000 / worker 3100 as default ports.

### Database
```bash
pnpm db:generate    # drizzle-kit generate (@workspace/db)
pnpm db:migrate     # drizzle-kit migrate
# seed: pnpm --filter @workspace/db run seed
```

**NOT YET IMPLEMENTED as root scripts:** `pnpm db:studio`, `pnpm db:seed:dev` (use the `@workspace/db` package scripts).

### Code quality
```bash
pnpm typecheck                              # libs + apps
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run test:integration
# or: pnpm --filter @jp/api run test:integration
```

**NOT YET IMPLEMENTED:** root `pnpm lint` / `pnpm test` umbrella scripts as documented in older SPEC tooling.

### Build
```bash
pnpm build                                  # typecheck + recursive build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/jain-pathshala run build
```

**NOT YET IMPLEMENTED:** Turborepo (`turbo.json` / `pnpm --filter @jp/shared build` as the primary graph).

---

## Queue names (`QUEUE_NAMES`)

Source of truth: `QUEUE_NAMES` in `apps/jp-shared/src/constants.ts`. Always import from `@jp/shared/constants` — never hardcode queue name strings.

There are **21** named entries (not 30). Several SPEC queues (`auth.sms.otp`, `notifications.fanout`, `punya.award`, `ai.*`, etc.) are **NOT YET IMPLEMENTED** — do not invent them as string literals.

```
session.materialise              attendance.auto_checkout         attendance.no_show_check
attendance.post_process          attendance.consecutive_check     notifications.parent
notifications.birthday           notifications.push_receipts      niyam-streak-lapse
notifications.monthly_reports    punya.leaderboard.refresh        punya.reconcile
analytics.refresh_views          digest.weekly.email              auth.session.cleanup
media.cleanup_unfinalized        donation.eightyg.year_end_summary exam.attempt_abandon
exam.top_score                   idcard.generation                report.generation
```

Notes:
- `niyam-streak-lapse` is listed in `QUEUE_NAMES` for cron registration identity but is **not** a BullMQ queue (constants comment).
- `attendance.post_process`, `notifications.parent`, `idcard.generation` are event/enqueue-driven and have **no** `CRON_EXPRESSIONS` entry.
- `report.generation` is event/enqueue-driven (admin POST + fan-out from `notifications.monthly_reports`); it has **no** direct `CRON_EXPRESSIONS` entry.

### Scheduled jobs
**Deleted as a separate list.** The single frozen cron table (matching `CRON_EXPRESSIONS`) lives under **"Cron table (frozen — single list)"** above. Do not maintain a second copy.

---

## Socket.IO namespaces

```
/shivirs/:shivirId       → volunteers + admins of that shivir
/push-quizzes/:quizId    → participants of that push quiz, + a `staff` room
/admin-dashboard/:cityId → city_admin+ of that city (live activity feed)
```

Authentication: clients connect with `auth: { token }` — JWT verified before namespace join.
Redis adapter (`@socket.io/redis-adapter`) required for multi-instance deployments.

**`/push-quizzes/:quizId` carries two audiences and they must not share a payload.**
Joining requires either an admin-panel role that passes the quiz read gate
(`quizVisibleToAdmin`), or ownership of a student the quiz actually targets
(`quizMatchesStudent` — the same rule as the take flow). Staff additionally join
a `staff` room.

- `push_quiz.update` — lifecycle (`started`, `ended`), emitted to the whole
  namespace. This is how a student sitting in the runner learns the quiz closed;
  push polling is deliberately paused during an attempt, so nothing else tells them.
- `push_quiz.roster` — `submitted`, emitted to the **`staff` room only**. It
  carries a student id and score, so sending it namespace-wide would leak one
  child's result to every other child in the class.

The 5s roster poll stays as the fallback for clients that cannot open a socket.

---

## Database conventions

- **Primary keys:** UUID via `defaultRandom()` — no auto-increment integers
- **Timestamps:** `created_at`, `updated_at` with `withTimezone: true` on every table. `deleted_at` (nullable) for soft-delete tables.
- **Soft delete:** Students, enrolments, centres, batches — never hard-delete. Use `deleted_at` or `status` columns.
- **Idempotency keys:** Punya transactions, attendance marks, sync operations — all use a `idempotency_key` unique index with UPSERT pattern. Never award Punya without one.
- **Audit logs:** append-only via `audit_writer` Postgres role (INSERT only, no UPDATE/DELETE). All admin actions must write an audit entry.
- **JSONB columns:** validate against Zod schemas from `@jp/shared` before writing. Never write untyped JSONB.
- **Read/write split:** `DrizzleService.db` = write pool, `DrizzleService.dbRead` = read pool (falls back to write if `DATABASE_URL_READ` not set).

---

## API response envelope

All API responses must use these shapes:

**Success:**
```json
{ "data": <payload>, "meta": { "request_id": "...", "timestamp": "..." } }
```

**Error:**
```json
{ "error": { "code": "ERR_AUTH_INVALID_OTP", "message": "human-readable", "details": [], "request_id": "..." } }
```

Error codes are defined in `@jp/shared/errors`. Always use the enum — never return raw strings.

---

## Bilingual requirements

- All user-facing content must have `_en` and `_hi` variants (e.g. `title_en`, `title_hi`)
- All API responses include both variants; client renders based on `preferred_language`
- All i18n strings live in `packages/i18n/src/locales/en.json` and `hi.json`
- Hindi must use proper Devanagari script — transliteration (Hinglish) is never acceptable
- Jain religious terms (नियम, पुण्य, शिविर, गुरुजी, संचालक, अभिभावक) stay in Devanagari even in EN locale

---

## Security rules (always enforced)

- **PII redaction in logs:** `phone`, `email`, `pan`, `aadhaar`, `password`, `otp`, `token`, `authorization` are auto-redacted in all Pino log output
- **OTP storage:** argon2id hash only — never plaintext, never reversible hash
- **JWT algorithm:** RS256 only — reject tokens with `alg: none` or symmetric algorithms
- **Signed URLs:** all media assets served via signed URLs with TTL — never public S3 URLs for private content
- **HMAC for AI service:** all API → FastAPI calls carry `X-Signature: hex(HMAC-SHA256(secret, body))` — **NOT YET IMPLEMENTED** (no FastAPI AI service in this monorepo yet)
- **Webhook signatures:** Razorpay webhooks verified via `x-razorpay-signature` before any processing
- **Rate limiting:** OTP send: 3/min/phone, 10/hr/phone, 30/hr/IP. Implemented in Redis with sliding window.

---

## Offline sync — canonical model

This is the only offline sync specification. Implementers build from this section without asking. Conflicting informal descriptions elsewhere are deleted or reduced to a pointer here.

### 1. Queue definitions (MMKV keys)

Exact keys. Payload shapes below are TypeScript-facing contracts (stored as JSON in MMKV arrays).

```ts
// jp.queue.checkin
type PendingCheckInOp = {
  submission_op_id: string; // ULID char(26)
  batch_id: string;         // uuid
  session_date: string;     // YYYY-MM-DD
  lat: number;
  lng: number;
  accuracy_m: number;
  client_timestamp: string; // ISO-8601
};

// jp.queue.attendance
type PendingAttendanceOp = {
  submission_op_id: string;
  batch_id: string;
  session_date: string;     // YYYY-MM-DD — NEVER a client-minted session_id
  marks: Array<{
    student_id: string;
    status: 'present' | 'absent' | 'late' | 'excused';
    notes?: string;
    client_op_id: string;   // ULID char(26) — per item (AT19)
  }>;
  marked_at: string;        // ISO-8601 — client clock; same-day window uses this (AT26)
  client_timestamp: string;
};

// jp.queue.checkout
type PendingCheckOutOp = {
  submission_op_id: string;
  batch_id: string;
  session_date: string;
  lat: number;
  lng: number;
  accuracy_m: number;
  client_timestamp: string;
};

// jp.queue.shivir_scans
type PendingShivirScanOp = {
  submission_op_id: string;
  shivir_session_id: string;
  qr_payload: string;
  scanned_at: string;
  client_timestamp: string;
};

// jp.queue.niyam_submissions  — canonical name; never jp.queue.niyam_uploads
type PendingNiyamSubmissionOp = {
  submission_op_id: string;
  niyam_id: string;
  student_id: string;
  proof_asset_id?: string;
  client_timestamp: string;
};

// jp.queue.homework_submissions
type PendingHomeworkSubmissionOp = {
  submission_op_id: string;
  assignment_id: string;
  student_id: string;
  payload: Record<string, unknown>;
  client_timestamp: string;
};

// jp.queue.course_progress
type PendingCourseProgressOp = {
  submission_op_id: string;   // ULID char(26)
  node_kind: 'section' | 'subsection';
  node_id: string;            // uuid
  marks: Array<{
    student_id: string;
    status: 'not_started' | 'in_progress' | 'completed';
    note?: string;
    client_op_id: string;     // ULID char(26) — per item (AT19)
  }>;
  marked_at: string;          // ISO-8601 — client clock → client_marked_at (CU9)
  client_timestamp: string;
};

// jp.queue.course_certification
type PendingCourseCertificationOp = {
  submission_op_id: string;
  node_kind: 'section' | 'subsection';
  node_id: string;
  student_id: string;         // always exactly one — CU18 forbids bulk
  certification_note?: string;
  client_op_id: string;
  certified_at: string;       // ISO-8601 — client clock
  client_timestamp: string;
};

// jp.queue.acknowledgements
type PendingAcknowledgementOp = {
  submission_op_id: string;
  kind: string;
  entity_id: string;
  client_timestamp: string;
};
```

**Session resolution key:** `jp.queue.checkin` and `jp.queue.attendance` (and checkout) key on `(batch_id, session_date)` only. The client never mints a `session_id`. The server resolves the existing materialised session (AT7) or soft-creates under AT8. Any doc that says "group by `session_id`" for offline attendance is wrong.

### 2. Drain order — causal, not priority

```
checkin → attendance → checkout → shivir_scans → niyam_submissions
→ homework_submissions → course_progress → course_certification → acknowledgements
```

A session must be `in_progress` before marks land against it, and check-out must not close a session before its marks arrive. `jp.queue.checkin` is part of this chain; omitting it lets marks race a session that does not yet exist on the server.

**Ordering guard + escape hatch:** If the attendance queue holds an op for `(batch_id, session_date)` and the checkin queue holds a **PENDING** op for the same key, drain checkin first. If that check-in op is in the **FAILED** terminal state (attempts exhausted), do **not** block — release the attendance op. The server resolves or creates the session under AT8. Without this escape hatch, one permanently-failed check-in blocks that batch's attendance forever; strict sequential draining without the hatch would also stall homework and acknowledgements behind it.

Within a single queue, drain by `submission_op_id` ascending (ULID lexicographic order = creation order).

### 3. Identifiers (AT19)

| ID | Scope | Stored on | Purpose |
|---|---|---|---|
| `submission_op_id` | one per submission | `sync_operations` | Batch replay-safety |
| `client_op_id` | one per item | `attendance.client_op_id` (and analogous item columns) | Per-row repair |

Both are **ULIDs** stored as `char(26)` with a format CHECK constraint — **not** the Postgres `uuid` type. A ULID will not insert into a `uuid` column. ULID is required because it sorts lexicographically, so the queue drains in creation order for free.

**True idempotency anchor for attendance rows:** `UNIQUE (session_id, student_id)` with `ON CONFLICT DO UPDATE`. That is the only guarantee that holds however many times the client retries. `submission_op_id` makes the sync *transport* idempotent; the unique constraint makes the *domain row* idempotent.

### 4. Transport — single path

`POST /v1/sync/batch` is the **only** transport for all offline operations. The client must not have two sync code paths (no parallel "online-shaped" retry that bypasses `/v1/sync/batch` for queued ops).

**Request:**
```ts
{
  ops: Array<{
    submission_op_id: string; // char(26) ULID
    op_type:
      | 'checkin'
      | 'attendance'
      | 'checkout'
      | 'shivir_scan'
      | 'niyam_submission'
      | 'homework_submission'
      | 'course_progress'
      | 'course_certification'
      | 'acknowledgement';
    payload: unknown;         // typed by op_type — see §1
    client_timestamp: string; // ISO-8601
  }>;
}
```

**Response:**
```ts
{
  results: Array<{
    submission_op_id: string;
    status: 'success' | 'duplicate' | 'conflict' | 'failed';
    server_id?: string;
    error?: { code: string; message: string; details?: unknown };
  }>;
}
```

One failed op must not fail the batch — process every op independently and return a per-op result. Each `op_type` handler calls the **same** service method as its direct online endpoint (check-in service, attendance mark service, etc.). Never a parallel offline-only implementation.

### 5. Server-side replay record (`sync_operations`)

For every op, the handler **must write** a `sync_operations` row (not a read-only lookup table):

| Column | Notes |
|---|---|
| `submission_op_id` | char(26) ULID |
| `user_id` | actor |
| `op_kind` | same vocabulary as `op_type` |
| `request_payload` | jsonb |
| `response_payload` | jsonb — what the client should receive on replay |
| `status` | `success` \| `duplicate` \| `conflict` \| `failed` |
| `applied_at` | timestamptz |

Uniqueness: `UNIQUE (user_id, submission_op_id)`.

**Replay:** look up `(user_id, submission_op_id)`. If a row exists with `status='success'`, return the stored `response_payload` without re-executing. `client_op_id` does **not** belong on `sync_operations` — it is per-item and lives on `attendance` (and peers).

### 6. Conflict resolution

Restated unambiguously (replaces SPEC §8.11):

- **Attendance status:** newest `marked_at` wins; ties broken by server receipt order. If the stored row already has a newer `marked_at`, return `status='duplicate'` and do not apply. This comparison lives in the **shared service method**, not the sync layer — the online path is governed by it too.
- **Metadata (notes):** last-write-wins by `client_timestamp`.
- **State-machine violations** (e.g. marking a cancelled session): HTTP 409 / result `conflict` — never silently accepted (AT24).
- **Course progress:** newest `marked_at` wins, compared against the stored `client_marked_at`; ties broken by server receipt order. If the stored row is newer, return `status='duplicate'` and do not apply. This comparison lives in the **shared service method**, so the online path is governed by it too.
- **Course certification:** if the row is already certified, return `status='duplicate'`, not `conflict`. Out of scope returns `conflict` and is terminal.

### 7. Retry

Exponential backoff with jitter: **5s → 15s → 45s → 2min → 5min cap**, **max 10 attempts**.

A 30-minute backoff on a Saturday-morning burst means marks land after the Guruji has gone home — that policy is deleted. Jitter is required: thirty devices reconnect together when a centre's wifi returns.

- Network / 5xx / 429 → retry with backoff.
- HTTP 4xx other than 409/429 → terminal `failed` (no further auto-retry); surface for manual retry.
- `conflict` (409) → terminal for that op; show conflict UI (do not auto-retry as if transient).

### 8. Failure states (mobile UI)

Every queued op carries a local state. Only `queued` is insufficient — a mark that will never sync must not look like success.

| State | UI |
|---|---|
| `queued` | "Saved offline — will sync" |
| `syncing` | Progress indicator |
| `synced` | Confirmation, auto-dismiss |
| `duplicate` | Silently dequeue (server already had a newer mark) |
| `conflict` | 409 — explain what happened and what to do, per the error voice rule (state the problem AND the fix) |
| `failed` | Attempts exhausted — offer manual retry; **never** silently discard |

---
## Build process rules

### Before writing any code in a session
1. Read `CLAUDE.md` (this file) — you are reading it now ✓
2. Read the spec sections referenced in the prompt
3. Read existing code in the relevant directories to understand current state
4. If the prompt says `/plan` — output a numbered plan first and wait for approval before writing

### While writing code
- After writing each file, run `pnpm typecheck` to verify it compiles
- If a test suite exists for the module, run it after completing the module
- Never leave `TODO` comments for critical logic — implement it or surface it explicitly
- Never hardcode values that belong in env vars or tokens
- Never skip exit criteria — each one requires a command run + output shown

### After completing a step
- Run all verification commands listed in the exit criteria
- Show actual command output (not just "it works")
- Commit with message: `feat: step N — <short description>`
- Format: `feat:`, `fix:`, `chore:`, `test:`, `docs:` per Conventional Commits

### When something is unclear
- Check `SPEC.md` first — it is very detailed
- If the spec doesn't cover it, surface the ambiguity explicitly before guessing
- For the 11 open questions (listed at the end of `SPEC.md`), apply the Q1–Q11 rules documented in this file under "Critical business rules"

---

## Design system file locations (at build time)

**Running paths (prefer these):**
```
apps/jain-pathshala-mobile/constants/colors.ts   ← mobile colours
apps/jain-pathshala-mobile/constants/typography.ts
apps/jain-pathshala/src/index.css               ← web CSS variables / brand tokens
lib/i18n/src/locales/en.json                    ← English strings (`@workspace/i18n`)
lib/i18n/src/locales/hi.json                    ← Hindi strings (Devanagari)
```

**NOT YET IMPLEMENTED (SPEC Step-2 paths — do not delete the requirement):**
```
packages/design-tokens/tokens.json           ← master tokens (W3C format)
packages/design-tokens/src/index.ts          ← typed TypeScript exports
packages/i18n/src/locales/{en,hi}.json       ← (locales live under lib/i18n today)
apps/web/tailwind.config.ts / globals.css
apps/mobile/src/constants/colors.ts + components/ui/
apps/web/src/components/ui/
apps/api/src/templates/id-card.hbs           ← ID cards are generated in api-server today (PNG path)
```

---

## Environment variables

Env for the running API: `apps/api-server/.env.example` (and root/compose overrides).  
**NOT YET IMPLEMENTED:** Zod fail-fast config module at `apps/api/src/core/config/` (Nest layout).

Key vars by category:
```
# Database
DATABASE_URL                    # PostgreSQL write connection
DATABASE_URL_READ               # PostgreSQL read replica (optional, falls back to write)

# Auth
JWT_PRIVATE_KEY_PEM             # RS256 private key
JWT_PUBLIC_KEY_PEM              # RS256 public key
JWT_PREVIOUS_PUBLIC_KEY_PEM     # RS256 previous key (rotation window)

# Storage
STORAGE_DRIVER                  # 'minio' (dev) | 'r2' (prod) | 's3'
STORAGE_ENDPOINT                # MinIO/R2/S3 endpoint URL
STORAGE_ACCESS_KEY_ID
STORAGE_SECRET_ACCESS_KEY
STORAGE_BUCKET_PRIVATE          # jp-dev-media-private | jp-prod-media-private
STORAGE_BUCKET_PUBLIC           # jp-dev-media-public  | jp-prod-media-public
STORAGE_BUCKET_EXPORTS
STORAGE_BUCKET_RECEIPTS

# External services
MSG91_AUTH_KEY                  # SMS provider
FCM_SERVICE_ACCOUNT_JSON        # Firebase push notifications
RESEND_API_KEY                  # Email
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
OPENAI_API_KEY                  # AI service

# AI service
AI_SERVICE_URL                  # http://localhost:8000 in dev
AI_SERVICE_HMAC_SECRET
AI_SERVICE_IP_ALLOWLIST         # comma-separated CIDRs

# Feature flags
AI_MODERATION_ENABLED           # false by default
EIGHTY_G_ENABLED                # mirrors platform_settings.eighty_g_enabled
SMS_MONTHLY_CAP_INR             # daily SMS spend cap
```

---

## Common pitfalls to avoid

| Pitfall | Correct approach |
|---|---|
| Using `Prisma` for any ORM operation | Use `Drizzle` from `@workspace/db` (`db` / read pools as implemented) |
| Hardcoding queue names as strings | Import from `@jp/shared/constants` — `QUEUE_NAMES.*` only (no invented `QUEUES.PUNYA_AWARD`) |
| Awarding Punya without idempotency_key | Always pass `idempotencyKey` into the Punya award helper |
| Hard-deleting students or enrolments | Use `status='inactive'` + `deactivated_at` — never DELETE |
| Returning raw phone/OTP in logs | PII redactor handles this — but never manually log these fields |
| Using RGB/hex directly in mobile components | Use tokens from `apps/jain-pathshala-mobile/constants/colors.ts` |
| Using className or CSS in React Native | Use `StyleSheet.create()` with token values |
| Creating MSV curriculum as city_admin | Service-layer 403 — read Q2 |
| Rejecting niyam after 30 days | Return `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED` — read Q5 |
| SMS to opted-out users | Check `users.notification_preferences.sms` before enqueuing |
| Concurrent Punya awards creating duplicates | UPSERT on `idempotency_key` unique index |
| Socket.IO without Redis adapter in multi-task deploy | Always initialise with `@socket.io/redis-adapter` |

---

*Last updated: August 2026 — Stack reconciled to Express/`apps/api-server` + `QUEUE_NAMES`/`CRON_EXPRESSIONS`; offline sync; AT1–AT32; CU1–CU30/CU32/CU33 (CU31 in the offline section); CLAUDE.md > SPEC.md*
