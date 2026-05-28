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
SPEC.md  ←  single source of truth for ALL decisions
```

Every prompt you receive will reference specific sections of `SPEC.md` by number (e.g. "Section 5.6", "Section 17.3"). **Always read those sections before writing any code.** Do not rely on memory or make assumptions about the spec — read it.

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

### Punya spiritual tiers (locked)
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

### 10 scheduled cron jobs (all IST — Asia/Kolkata)
| Job | Schedule |
|---|---|
| `notifications.birthday` | Daily 06:00 |
| `notifications.monthly_reports` | 1st of month 02:00 |
| `punya.leaderboard.refresh` | Every 5 min |
| `punya.reconcile` | Daily 03:00 |
| `analytics.refresh_views` | Daily 04:00 |
| `digest.weekly.email` | Monday 07:00 |
| `auth.session.cleanup` | Daily 02:30 |
| `attendance.consecutive_check` | Daily 22:00 |
| `media.cleanup_unfinalized` | Daily 03:30 |
| `donation.eightyg.year_end_summary` | 1 April 00:30 |

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

## Offline sync rules

- **Client op IDs:** every mutation from mobile carries a `client_op_id` (ULID). Backend stores in `sync_operations` table and treats duplicate `client_op_id` as a no-op, returning the cached result.
- **MMKV queue priority:** `attendance` → `shivir_scans` → `niyam_submissions` → `homework_submissions` → `acknowledgements`
- **Retry policy:** exponential backoff 5s → 15s → 45s → 2min → 5min cap, max 10 attempts
- **Conflict resolution:** server is authoritative for state-machine transitions (e.g. marking attendance on a cancelled session returns 409). Last-write-wins by `client_timestamp` for metadata fields.

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

*Last updated: May 2026 — Enaa Creations / Jain Pathshala v1.0*
