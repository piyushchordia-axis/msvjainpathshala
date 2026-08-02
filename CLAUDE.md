# CLAUDE.md — Jain Pathshala

> This file is read automatically by Claude Code at the start of every session.
> It is the single source of operating rules for this codebase.
> The full engineering specification lives at `SPEC.md` in the repo root.

---

## Project identity

**Product:** Jain Pathshala — a multi-tenant Jain religious education platform
**Organisation:** Megh Sanskar Vatika (MSV) network
**Developer:** Enaa Creations
**Surfaces:** Mobile app (Expo) + Web admin panel (Next.js) + Public website (Next.js) + Backend API (NestJS) + AI service (FastAPI)

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

| Layer | Technology | Must NOT use |
|---|---|---|
| ORM | Drizzle | Prisma, TypeORM |
| Backend framework | NestJS v10+ | Express, Fastify |
| Queue system | BullMQ | Kafka, RabbitMQ, SQS |
| Architecture | Modular monolith | Microservices (except AI service) |
| Package manager | pnpm workspaces + Turborepo | npm, yarn |
| Mobile | Expo SDK 54+ with Expo Router v6 | bare React Native CLI |
| Web | Next.js 15 App Router | Pages Router, Remix, Vite |
| Language | TypeScript everywhere | JavaScript (except configs) |
| AI service | Python 3.12 + FastAPI | Node-based AI service |
| Database | PostgreSQL 16 | MySQL, SQLite, MongoDB |
| Cache / Queues | Redis 7 | Memcached, in-process cache |

---

## Monorepo structure

```
jain-pathshala/
├── apps/
│   ├── api/          ← NestJS backend (port 3000) + worker entry (port 3100)
│   ├── mobile/       ← Expo React Native app
│   ├── web/          ← Next.js 15 public site + admin panel (port 3001)
│   └── ai/           ← Python FastAPI AI service (port 8000)
├── packages/
│   ├── shared/       ← @jp/shared — enums, Zod schemas, error codes, constants
│   ├── design-tokens/← @jp/design-tokens — token JSON + typed exports
│   └── i18n/         ← @jp/i18n — EN/HI translation files + t() helper
├── infra/
│   ├── docker/       ← docker-compose.yml (Postgres, Redis, MinIO, MailHog)
│   ├── terraform/    ← AWS infrastructure as code
│   └── load-tests/   ← k6 load test scripts
├── docs/
│   └── runbooks/     ← operational runbooks
├── SPEC.md           ← full engineering specification (read this)
└── CLAUDE.md         ← this file
```

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
7. `student` — age 13+, accessed via student-view toggle on parent's account (NOT a separate login)
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
- **JWT:** RS256, 15-minute access token, 30-day refresh token with family-based reuse detection.
- **Device sessions:** max 5 per user. 6th login revokes the oldest session.
- **Student view toggle:** parent switches context to see their child's view. Child must be ≥ 13 years old and have `student_view_enabled = true`.
- **Admin impersonation:** super_admin only. Writes TWO audit log entries. All actions during impersonation carry `impersonator_id`.

---

## Critical business rules

These are the rules most likely to be implemented incorrectly. Read carefully.

### Q1 — MSV enrolment: no eligibility rules
MSV approval is **purely admin discretion**. Do not implement any eligibility validation, age checks, or score thresholds for MSV enrolment. The admin approves or rejects based on their own judgement.

### Q2 — MSV curriculum: super_admin only
Creating or editing MSV-type curricula is restricted to `super_admin` at the **service layer**, not just the UI. If a city_admin calls the MSV curriculum endpoint directly, it must return 403. This check lives in the NestJS service, not the guard.

### Q3 — 80G certificates: toggleable
`platform_settings.eighty_g_enabled` controls whether 80G certificates are generated. Default is `false`. When toggled on, both `eighty_g_registration_number` AND `organization_pan` must be set or the toggle is rejected. Existing certificates are never deleted when toggled off.

### Q4 — Student view: 13+ hard gate
Student view toggle via `POST /v1/auth/switch-view` is blocked if `students.dob` computes to age < 13. This is enforced in the auth service, not the client.

### Q5 — Niyam rejection: 30-day window only
A niyam submission can only be rejected within 30 days of submission. After 30 days, the reject button in admin UI is disabled AND the API returns `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED` (409). On rejection: Punya is reversed, streak is recomputed, gallery item (if any) is hidden.

### Q6 — Gallery opt-in: blanket, per parent
`users.gallery_visibility_opt_in` is a **single toggle per parent** covering all their children. When toggled off, ALL existing gallery items from their children are hidden (backfill). When toggled on, all hidden-due-to-opt-out items are restored (backfill).

### Q7 — Library videos: embed URLs only
Library items of `type='video_embed'` store a YouTube or Vimeo URL in `embed_url`. No video files are uploaded to S3/R2. Validate that the URL is a valid YouTube or Vimeo link on creation. The mobile and web apps render these as embedded iframes/WebViews.

### Q11 — Students: never hard delete
Students are deactivated (`status='inactive'`), never deleted from the database. This includes their enrolment records. Re-activation must be possible at any time. Deactivated students do not appear in active enrolment counts, attendance rosters, or Punya leaderboards.

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

## Cron table (frozen — single list)

One table for all scheduled work. Times are IST (Asia/Kolkata) unless noted. Entries marked **schedule** are `@nestjs/schedule` crons (not BullMQ queues) — their absence from `@jp/shared/constants` queue names is intentional, not a bug. Entries marked **queue** are BullMQ repeatable/cron-driven jobs whose names DO appear in queue constants.

| Job | Schedule | Kind | Notes |
|---|---|---|---|
| `session.materialise` | Nightly 01:00 IST | schedule | AT7 — rolling 60-day window |
| `attendance.no_show_check` | Every 15 min | schedule | Unchecked-in sessions past start |
| `attendance.auto_checkout` | Every 30 min | schedule | AT12 — `scheduled_end_time + 2h` |
| `attendance.consecutive_check` | Daily 02:00 IST | schedule | AT27 — was 22:00; moved to next-day 02:00 |
| `notifications.birthday` | Daily 06:00 IST | schedule | |
| `notifications.monthly_reports` | 1st of month 02:00 IST | schedule | |
| `punya.leaderboard.refresh` | Every 5 min | queue | BullMQ |
| `punya.reconcile` | Daily 03:00 IST | queue | BullMQ |
| `analytics.refresh_views` | Daily 04:00 IST | schedule | Materialised view refresh |
| `digest.weekly.email` | Monday 07:00 IST | schedule | |
| `auth.session.cleanup` | Daily 02:30 IST | schedule | |
| `media.cleanup_unfinalized` | Daily 03:30 IST | schedule | |
| `donation.eightyg.year_end_summary` | 1 April 00:30 IST | schedule | |

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

### Token files (already set up)
```
packages/design-tokens/tokens.json    ← master token file (W3C format)
apps/web/tailwind.config.ts           ← Tailwind preset consuming tokens
apps/web/src/styles/tokens.css        ← CSS custom properties (--jp-* prefix)
apps/mobile/src/constants/colors.ts  ← JPColors, JPSpacing, JPRadius, JPFonts
```

### Never hardcode values
**Wrong:** `color: '#D4621A'`
**Right:** `color: JPColors.saffron` (mobile) or `text-saffron` (web Tailwind)

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
# Start all local infrastructure
docker compose -f infra/docker/docker-compose.yml up -d

# API (HTTP server, port 3000)
pnpm --filter @jp/api dev

# API (BullMQ worker, port 3100)
pnpm --filter @jp/api dev:worker

# Mobile (Expo dev server)
pnpm --filter @jp/mobile dev

# Web (Next.js, port 3001)
pnpm --filter @jp/web dev

# AI service (FastAPI, port 8000)
cd apps/ai && uvicorn main:app --reload
```

### Database
```bash
pnpm db:generate    # generate Drizzle migration from schema changes
pnpm db:migrate     # apply migrations (uses advisory lock)
pnpm db:studio      # open Drizzle Studio
pnpm db:seed:dev    # seed local dev data
```

### Code quality
```bash
pnpm typecheck      # typecheck all packages
pnpm lint           # lint all packages
pnpm test           # unit tests (Vitest)
pnpm test:integration  # integration tests (Testcontainers)
```

### Turborepo
```bash
pnpm build          # build all packages in dependency order
pnpm --filter @jp/shared build   # build one package
```

---

## All 30 BullMQ queues

These queue names are used throughout the codebase. Always import from `@jp/shared/constants` — never hardcode queue name strings.

```
auth.sms.otp                notifications.fanout          attendance.post_process
attendance.consecutive_check  punya.award                  punya.leaderboard.refresh
punya.reconcile               niyam.streak.recompute       media.processing
idcard.generation             report.generation            report.shivir.export
export.student.pdf            export.bulk.zip              donation.eightyg.cert
donation.receipt.generate     audit.write                  ai.quiz.generate
ai.moderation.image           shivir.live.broadcast        analytics.refresh_views
digest.weekly.email           db.backfill.generic          auth.session.cleanup
notifications.birthday        notifications.monthly_reports notifications.push
notifications.sms             notifications.email          debug.echo
```

### Scheduled jobs
**Deleted as a separate list.** The single frozen cron table (including `session.materialise`, attendance jobs, and the jobs formerly listed here) lives under **"Cron table (frozen — single list)"** above. Do not maintain a second copy.

---

## Socket.IO namespaces

```
/shivirs/:shivirId       → volunteers + admins of that shivir
/push-quizzes/:quizId    → participants of that push quiz
/admin-dashboard/:cityId → city_admin+ of that city (live activity feed)
```

Authentication: clients connect with `auth: { token }` — JWT verified before namespace join.
Redis adapter (`@socket.io/redis-adapter`) required for multi-instance deployments.

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
- **HMAC for AI service:** all NestJS → FastAPI calls carry `X-Signature: hex(HMAC-SHA256(secret, body))`
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
→ homework_submissions → acknowledgements
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

These files exist in the repo after Step 2. Reference them — never rebuild from scratch.

```
packages/design-tokens/tokens.json           ← master tokens (W3C format)
packages/design-tokens/src/index.ts          ← typed TypeScript exports
packages/i18n/src/locales/en.json            ← English strings
packages/i18n/src/locales/hi.json            ← Hindi strings (Devanagari)
apps/web/tailwind.config.ts                  ← Tailwind consuming tokens
apps/web/src/styles/globals.css              ← CSS custom properties
apps/mobile/src/constants/colors.ts         ← JPColors, JPSpacing, JPRadius
apps/mobile/src/components/ui/              ← pre-built RN components
apps/web/src/components/ui/                 ← pre-built React components
apps/api/src/templates/id-card.hbs          ← student ID card Handlebars template
```

---

## Environment variables

All env vars are validated via Zod in `apps/api/src/core/config/`. The app **fails fast** on startup if required vars are missing. Full list in `apps/api/.env.example`.

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
| Using `Prisma` for any ORM operation | Use `Drizzle` with `DrizzleService.db` or `.dbRead` |
| Hardcoding queue names as strings | Import from `@jp/shared/constants` — `QUEUES.PUNYA_AWARD` etc |
| Awarding Punya without idempotency_key | Always pass `idempotency_key` to `PunyaService.award()` |
| Hard-deleting students or enrolments | Use `status='inactive'` + `deactivated_at` — never DELETE |
| Returning raw phone/OTP in logs | PII redactor handles this — but never manually log these fields |
| Using RGB/hex directly in mobile components | Use `JPColors.*` from `apps/mobile/src/constants/colors.ts` |
| Using className or CSS in React Native | Use `StyleSheet.create()` with token values |
| Creating MSV curriculum as city_admin | Service-layer 403 — read Q2 |
| Rejecting niyam after 30 days | Return `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED` — read Q5 |
| SMS to opted-out users | Check `users.notification_preferences.sms` before enqueuing |
| Concurrent Punya awards creating duplicates | UPSERT on `idempotency_key` unique index |
| Socket.IO without Redis adapter in multi-task deploy | Always initialise with `@socket.io/redis-adapter` |

---

*Last updated: August 2026 — Offline sync canonical model; AT1–AT31; CLAUDE.md > SPEC.md*
