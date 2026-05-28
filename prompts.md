# Jain Pathshala — Claude Code Prompts

**Companion to:** `SPEC.md` (full engineering spec) + `CLAUDE.md` (operating rules) + `jp-design-system/` (design tokens + UI kit)
**Project:** Jain Pathshala (Megh Sanskar Vatika network) by Enaa Creations
**Tool:** Claude Code (terminal-based, runs in your local repo)

---

## Before You Start — One-Time Setup

Complete these steps **once** before pasting Prompt 0:

### 1. Repo preparation
```bash
# Create your repo
mkdir jain-pathshala && cd jain-pathshala
git init

# Place these three files in the repo root:
# - SPEC.md          ← rename JainPathshala_ReplitAgent_Prompt.md to SPEC.md
# - CLAUDE.md        ← the Claude Code operating rules file
# - JP_DS.zip        ← your design system zip

# Extract design system
unzip JP_DS.zip
# This creates jp-design-system/ folder in repo root

# Commit everything before starting
git add SPEC.md CLAUDE.md jp-design-system/
git commit -m "chore: add spec, claude rules, and design system"
```

### 2. Start Claude Code
```bash
claude
```
Claude Code reads `CLAUDE.md` automatically at session start.

### 3. Design system files — quick reference
| File | Used at | Purpose |
|---|---|---|
| `jp-design-system/tokens.json` | Prompt 2 | Master token file — all colours, spacing, type, motion |
| `jp-design-system/tailwind.config.js` | Prompt 9 | Tailwind preset for Next.js |
| `jp-design-system/tokens.css` | Prompt 9 | CSS custom properties (`--jp-*`) |
| `jp-design-system/colors.ts` | Prompt 8 | TypeScript constants for Expo |
| `jp-design-system/DESIGN_GUIDE.md` | Prompt 0 | Voice, tone, copy rules |
| `jp-design-system/ui_kits/mobile/components.jsx` | Prompt 8 | Mobile component reference (convert to RN) |
| `jp-design-system/ui_kits/mobile/screens.jsx` | Prompt 8+ | Mobile screen layouts — match these exactly |
| `jp-design-system/ui_kits/admin/components.jsx` | Prompt 9 | Web admin components (usable directly in Next.js) |
| `jp-design-system/ui_kits/admin/screens.jsx` | Prompt 9+ | Web admin screen layouts — match these exactly |
| `jp-design-system/preview/id-card.html` | Prompt 11 | ID card visual spec → convert to id-card.hbs |
| `jp-design-system/preview/attendance-badges.html` | Prompt 13 | Attendance status chips |
| `jp-design-system/preview/gps-session.html` | Prompt 13 | GPS check-in session UI |
| `jp-design-system/preview/tier-badges.html` | Prompt 16 | Punya tier badge designs |
| `jp-design-system/preview/punya-card.html` | Prompt 16 | Punya balance card |
| `jp-design-system/preview/leaderboard.html` | Prompt 16 | Leaderboard layout |
| `jp-design-system/preview/otp-input.html` | Prompt 5/8 | OTP entry screen |
| `jp-design-system/preview/tabbar.html` | Prompt 8 | Mobile tab bar |
| `jp-design-system/preview/buttons.html` | Prompt 8/9 | All button variants |
| `jp-design-system/preview/admin-sidebar.html` | Prompt 9 | Admin sidebar layout |
| `jp-design-system/preview/admin-table.html` | Prompt 9 | Data table layout |
| `jp-design-system/preview/admin-stats.html` | Prompt 9 | KPI/stats card layout |
| `jp-design-system/preview/admin-forms.html` | Prompt 9/10 | Form field components |

---

## How to Use This Document

1. **One prompt = one step.** Each corresponds to one of the 23 steps in Section 19 of `SPEC.md`. Never combine prompts.

2. **Use `/plan` for heavy prompts** (Prompts 4, 5, 8, 13, 14, 23). Type `/plan` before pasting — Claude Code outlines its approach, you review and approve, then it executes. Saves significant cost and prevents wrong-direction work.

3. **Claude Code verifies as it goes.** Each prompt ends with verification commands. Claude Code runs them and shows you output — not just "it worked".

4. **Commit after each prompt.** Each step = one git commit. Format: `feat: step N — description`. If a step fails, you can roll back cleanly.

5. **Between sessions**, start with:
   ```
   Read CLAUDE.md and SPEC.md sections [X, Y, Z], then read the existing 
   code in [relevant dirs] to understand current state. We are on Step N.
   ```

6. **Design system rule:** Before building any screen, Claude Code reads the relevant `jp-design-system/` file and matches the design exactly. It never invents layout or styling from scratch.

---

## PROMPT 0 — Project Bootstrap (Read Before Starting)

```
Read CLAUDE.md fully. Then read jp-design-system/DESIGN_GUIDE.md fully.

You are going to help me build "Jain Pathshala", a production-grade multi-tenant 
religious education platform for the Megh Sanskar Vatika (MSV) network, developed 
under the Enaa Creations banner.

The complete engineering specification is at SPEC.md in this repo root.
The operating rules (stack, roles, business logic, design tokens) are in CLAUDE.md.
The design system (tokens, components, screen layouts) is in jp-design-system/.

SPEC.md defines:
- Full architecture (NestJS + Drizzle + Postgres + Redis + BullMQ + Expo + Next.js 15 + FastAPI + AWS)
- All 60+ database tables with columns, enums, indexes (Section 5)
- All ~100+ API endpoints (Section 6)
- All 30 BullMQ queues (Section 9)
- Auth, RBAC, business logic, offline sync, realtime, media, analytics, security (Sections 7–17)
- DevOps and deployment (Section 18)
- A 23-step build order with explicit dependencies and exit criteria (Section 19)

I will give you ONE prompt at a time, each for one numbered step in Section 19.
Do NOT proceed to the next step until I give the next prompt.

For every prompt:
1. Read CLAUDE.md rules that apply to that step
2. Read the SPEC.md sections the prompt references
3. Read existing code in relevant dirs to understand current state
4. Before building any UI — read the relevant jp-design-system/ files listed in the prompt
5. Build exactly what the step describes
6. After writing each file, run pnpm typecheck to verify it compiles
7. After all files are written, run the exit criteria commands and show actual output
8. Commit: git commit -m "feat: step N — <description>"

Stack constraints (from CLAUDE.md — non-negotiable):
- Drizzle ORM (NOT Prisma)
- NestJS (NOT Express)
- BullMQ (NOT Kafka)
- Modular monolith (NOT microservices, except the FastAPI AI service)
- pnpm workspaces with Turborepo
- TypeScript everywhere except the AI service (Python)
- Bilingual EN/HI — all user-facing content has _en and _hi variants
- All colours/spacing reference jp-design-system tokens — never hardcode hex values

Confirm you have read CLAUDE.md and jp-design-system/DESIGN_GUIDE.md and are ready 
to begin with Step 1.
```

---

## PROMPT 1 — Repository & Tooling Foundation

```
We are on Step 1 of the Jain Pathshala build.

Read from SPEC.md:
- Section 4 (Folder Structure) — exact monorepo layout
- Section 18.2 (docker-compose) — local dev infrastructure
- Section 18.3 (CI/CD ci.yml skeleton)
- Section 19, Step 1

Build:
1. Initialise a pnpm monorepo with the exact folder structure from Section 4.1. Create empty placeholder directories for apps/api, apps/mobile, apps/web, apps/ai, packages/shared, packages/design-tokens, packages/i18n, infra/.
2. Configure:
   - pnpm-workspace.yaml listing all workspaces
   - Root package.json with pnpm@9 in packageManager, common scripts (dev, build, lint, typecheck, test)
   - tsconfig.base.json with strict mode, ES2022 target, paths for @jp/shared/*, @jp/design-tokens/*, @jp/i18n/*
   - .editorconfig, .gitignore (include node_modules, .turbo, .next, dist, .env* except .env.example, coverage, .eas), .nvmrc with 20.11.0
3. Shared tooling:
   - ESLint flat config (eslint.config.mjs) with TypeScript, import-order, unused-imports rules
   - Prettier (.prettierrc.json) with 100 char line width, single quotes, trailing commas
   - Husky pre-commit hook running lint-staged
   - commitlint with Conventional Commits config
4. Turborepo (turbo.json) with pipelines: build, lint, typecheck, test, test:integration, dev (persistent)
5. infra/docker/docker-compose.yml exactly as in Section 18.2 (Postgres 16, Redis 7, MinIO, MailHog)
6. .github/workflows/ci.yml skeleton as in Section 18.3 (lint-typecheck + unit-tests jobs only)
7. Top-level README.md with project summary, prerequisites (Node 20, pnpm 9, Docker), local dev quickstart

After writing each file, run pnpm typecheck to verify it compiles.

Verify and show output for each exit criterion:
- pnpm install succeeds on a clean checkout
- pnpm lint runs without error
- pnpm typecheck passes
- docker compose -f infra/docker/docker-compose.yml up -d — all containers healthy
- Run: docker compose ps (show output)

Commit: git commit -m "feat: step 1 — repository and tooling foundation"
```

---

## PROMPT 2 — Shared Packages

```
We are on Step 2 of the Jain Pathshala build.

Read from SPEC.md:
- Section 4.5 (packages/shared/ structure)
- Section 5.1 (PostgreSQL enums — these become TypeScript enums too)
- Section 6.27 (Validation Standards — Zod usage)
- Section 19, Step 2

Read from jp-design-system/:
- jp-design-system/tokens.json — populate packages/design-tokens/tokens.json with REAL values from this file
- jp-design-system/colors.ts — reference for the mobile TypeScript constants shape

Build:

### packages/shared
- src/enums/ — TypeScript enums mirroring every PostgreSQL enum from Section 5.1 (role, enrolment_status, attendance_status, niyam_status, exam_status, donation_status, sync_op_type, notification_channel, etc — go through 5.1 exhaustively)
- src/schemas/ — Zod schemas for every DTO, organised by domain (auth, users, centres, batches, students, attendance, niyams, gallery, homework, notices, shivirs, competitions, curriculum, exams, quizzes, services, library, donations, notifications, sync, media)
- src/errors/ — error code enum (ERR_AUTH_INVALID_OTP, ERR_AUTH_OTP_EXPIRED, ERR_RBAC_FORBIDDEN, ERR_VALIDATION_FAILED, ERR_RESOURCE_NOT_FOUND, ERR_CONFLICT, ERR_BATCH_OVER_CAPACITY, ERR_DUPLICATE_STUDENT, ERR_PUNYA_REVERSAL_WINDOW_EXPIRED, ERR_RATE_LIMITED, ERR_NIYAM_REVERSAL_WINDOW_EXPIRED, ERR_RBAC_FORBIDDEN_MSV_CURRICULUM, etc — exhaustive), error envelope type per Section 6.27
- src/types/ — Result<T,E>, Paginated<T>, ApiEnvelope<T>, CursorPaginated<T>, IdempotencyKey, ScopeContext
- src/constants/ — MAX_DEVICE_SESSIONS=5, OTP_TTL_SECONDS=300, JWT_ACCESS_TTL='15m', JWT_REFRESH_TTL='30d', NIYAM_REVERSAL_WINDOW_DAYS=30, PAGINATION_DEFAULT=20, PAGINATION_MAX=100, all 30 queue names from Section 9.1 as QUEUES const

### packages/design-tokens
- tokens.json — populate with REAL values from jp-design-system/tokens.json. The structure maps as:
  - jp-design-system tokens.json color.* → design-tokens colors.*
  - jp-design-system tokens.json spacing.* → design-tokens spacing.*
  - jp-design-system tokens.json radius.* → design-tokens radii.*
  - jp-design-system tokens.json shadow.* → design-tokens shadows.*
  - jp-design-system tokens.json font.* → design-tokens typography.fonts.*
  - jp-design-system tokens.json type.* → design-tokens typography.scale.*
  - jp-design-system tokens.json motion.* → design-tokens motion.*
  Do NOT use placeholder sentinels — use the actual hex values and numbers from jp-design-system/tokens.json.
- src/index.ts — typed TypeScript exports of every token as a const with autocomplete

### packages/i18n
- src/locales/en.json and hi.json with keyspaces: auth.*, roles.*, attendance.*, punya.*, niyams.*, homework.*, notices.*, shivirs.*, competitions.*, exams.*, quizzes.*, library.*, donations.*, services.*, gallery.*, errors.* (one key per error code), common.*, validation.*
- Hindi must be proper Devanagari (not transliteration). Jain terms stay in Devanagari: नियम, पुण्य, शिविर, गुरुजी, संचालक, अभिभावक
- src/index.ts — exports t(locale, key, params?), tBilingual({en, hi}), Language type, SUPPORTED_LANGUAGES

After writing each file, run pnpm typecheck.

Verify and show output:
- pnpm --filter @jp/shared build succeeds
- pnpm --filter @jp/design-tokens build succeeds
- pnpm --filter @jp/i18n build succeeds
- pnpm typecheck passes across all packages
- Run: node -e "const {t} = require('./packages/i18n/dist'); console.log(t('hi', 'punya.tiers.jigyasu'))" — must print Devanagari

Commit: git commit -m "feat: step 2 — shared packages with design tokens"
```

---

## PROMPT 3 — Backend Foundation

```
We are on Step 3 of the Jain Pathshala build.

Read from SPEC.md:
- Section 3.3 (NestJS backend tech stack)
- Section 4.2 (apps/api folder structure — every module spelled out)
- Section 17.1 (read/write DB separation)
- Section 18.6 (health checks)
- Section 18.7 (migration runner with advisory lock)
- Section 18.12 (logging standards with PII redaction)
- Section 19, Step 3

Read existing code: packages/shared, packages/design-tokens, packages/i18n

Build the NestJS app at apps/api:

1. Bootstrap — NestJS v10+ with modular folder structure from Section 4.2
   Two entry points: src/main.ts (HTTP port 3000) and src/worker.ts (BullMQ-only, health on port 3100)

2. Core modules (src/core/):
   - config/ — Zod-validated env schema, fails fast on missing required vars, typed ConfigService
   - logger/ — Pino with pretty dev / JSON prod, required fields per Section 18.12, PII redactor in src/observability/log-redactor.ts auto-redacting: phone, email, pan, aadhaar, password, otp, token, authorization
   - database/ — Drizzle with TWO pools: DrizzleService.db (write, DATABASE_URL) and DrizzleService.dbRead (read, DATABASE_URL_READ — falls back to write)
   - redis/ — Four separate ioredis clients: cacheClient, bullmqClient, pubsubClient, socketIoAdapterClient
   - telemetry/ — OpenTelemetry SDK, trace propagation middleware, Sentry (staging/prod only)

3. Cross-cutting (src/common/):
   - validation/ — Global ZodValidationPipe consuming @jp/shared Zod schemas
   - filters/ — Global exception filter → { error: { code, message, details?, request_id } }
   - middleware/ — Request-ID (ULID, async-local-storage), structured request logger
   - interceptors/ — Response envelope interceptor → { data, meta }

4. Health module (src/core/health/):
   - GET /healthz — liveness, returns 200 immediately, no dependency checks
   - GET /readyz — readiness via @nestjs/terminus: Postgres write, Postgres read, Redis, S3
   - GET /metrics — Prometheus, restricted to loopback IP or internal API key

5. Drizzle: drizzle.config.ts, empty src/db/migrations/, empty src/db/schema/
   Migration runner (src/db/migrate.ts) uses pg_advisory_lock(987654321) per Section 18.7

6. Worker entry (src/worker.ts) — loads QueueModule + processors only, no HTTP controllers, 25s graceful shutdown

7. .env.example with every var from Section 14 commented with description
   .env.development with local values pointing to docker-compose services

After writing each file, run pnpm typecheck.

Verify and show actual output:
- pnpm --filter @jp/api dev boots without errors (show startup log)
- curl http://localhost:3000/healthz → 200 {"status":"ok"}
- curl http://localhost:3000/readyz → 200 with all dependencies green (docker-compose must be up)
- curl http://localhost:3000/metrics → Prometheus format (show first 10 lines)
- pnpm --filter @jp/api dev:worker boots cleanly, shows health on port 3100
- Send a test request and show the structured JSON log with request_id, trace_id, and a PII field redacted
- pnpm db:migrate runs without error (show output)

Commit: git commit -m "feat: step 3 — backend foundation"
```

---

## PROMPT 4 — Database Schema & Migrations

> ⚠️ Use `/plan` before pasting this prompt. It is the largest single step.
> Type `/plan` first, review the table list Claude Code plans to create, confirm, then let it proceed.

```
We are on Step 4 of the Jain Pathshala build.

Read from SPEC.md — read ALL of these carefully before writing a single line:
- Section 5 in its entirety (5.1 through 5.22) — every table, every column, every enum, every index
- Section 16 (audit_logs append-only via Postgres role)
- Section 19, Step 4

Read existing code: apps/api/src/core/, apps/api/drizzle.config.ts

Translate the entire Section 5 database design into Drizzle schema files at apps/api/src/db/schema/:

Files to create (one per domain):
enums.ts — every pgEnum() from Section 5.1, declared once
identity.ts — users, device_sessions, device_tokens, phone_otp_attempts, refresh_token_families
geography.ts — states, cities
centres.ts — centres, batches, centre_holidays, shikshak_batch_assignments, sanchalak_centre_assignments
students.ts — students, enrolments, msv_enrolments, digital_id_cards
form_configs.ts — registration_form_configs
attendance.ts — sessions, attendance, absence_notifications, session_cancellations
punya.ts — punya_features, punya_configs, punya_transactions, punya_balances, leaderboard_snapshots
niyams.ts — niyams, niyam_submissions, niyam_streaks
gallery.ts — gallery_items
homework.ts — homework_assignments, homework_submissions
notices.ts — notices, notice_reads
shivirs.ts — shivir_events, shivir_sessions, shivir_registrations, shivir_volunteers, shivir_attendance_scans
competitions.ts — competitions, competition_registrations, competition_results
curriculum.ts — curriculum_templates, curricula, curriculum_sections, curriculum_items, curriculum_assignments, student_curriculum_progress
exams.ts — online_exams, exam_questions, exam_question_options, exam_attempts, exam_answers
quizzes.ts — questions, quiz_events, quiz_attempts, push_quizzes, push_quiz_questions, push_quiz_attempts
services.ts — service_requests
library.ts — library_items, library_access_logs
donations.ts — donations, donation_campaigns, donor_profiles
notifications.ts — notifications, sms_logs
platform.ts — platform_settings (singleton: CHECK id = 1)
audit.ts — audit_logs, sync_operations
student_notes.ts — student_notes, progress_reports
media.ts — media_assets
index.ts — re-exports everything

Conventions (from CLAUDE.md):
- UUIDs via defaultRandom() for all primary keys
- created_at, updated_at as timestamp({ withTimezone: true }) with defaultNow()
- deleted_at nullable where soft-delete needed
- Foreign keys with explicit onDelete strategy from spec
- JSONB columns typed via Zod schemas from @jp/shared

Migrations to create after pnpm db:generate:
- 0001_initial_schema.sql — generated by Drizzle
- 0002_indexes.sql — all composite and partial indexes from Section 5 (hand-written)
- 0003_audit_logs_role_grants.sql:
  CREATE ROLE audit_writer NOLOGIN;
  GRANT INSERT ON audit_logs TO audit_writer;
  REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM PUBLIC;
- 0004_seed_static_data.sql — platform_settings row (id=1, eighty_g_enabled=false), punya_features catalogue, 5 default registration_form_configs

Repository layer (apps/api/src/db/repositories/): thin typed query helpers injected with DrizzleService.
Create at minimum: UsersRepository, BatchesRepository, PunyaTransactionsRepository.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- pnpm db:migrate succeeds (show output)
- psql -c "\dt" — list all tables (must show 60+ tables)
- psql -c "SELECT COUNT(*) FROM punya_features" — must show the catalogue rows
- psql -c "SELECT * FROM platform_settings" — must show the singleton row
- psql -c "\du audit_writer" — must show the role
- pnpm typecheck passes

Commit: git commit -m "feat: step 4 — database schema and migrations"
```

---

## PROMPT 5 — Authentication & Authorisation

> ⚠️ Use `/plan` before pasting this prompt.

```
We are on Step 5 of the Jain Pathshala build.

Read from SPEC.md:
- Section 6.1 (Auth endpoints)
- Section 7 (entire section: login flow, JWT strategy, refresh rotation, device sessions, student-view, role hierarchy, permissions matrix, ScopeGuard, admin impersonation)
- Section 8 (idempotency keys)
- Section 16 (JWT key rotation, OTP abuse prevention, audit logging)
- Section 19, Step 5

Read from jp-design-system/:
- jp-design-system/preview/otp-input.html — OTP screen visual spec (for mobile, implemented in Step 8 — note the design now so it can be referenced later)

Read existing code: apps/api/src/db/schema/, apps/api/src/db/repositories/

Build auth module at apps/api/src/modules/auth/:

### OTP send/verify
- POST /v1/auth/otp/send: validates +91XXXXXXXXXX, rate limits (3/min/phone, 10/hr/phone, 30/hr/IP via Redis sliding window), stores argon2id hash in Redis with TTL=300s, dev logs OTP to console, inserts phone_otp_attempts row, returns { request_id, expires_in_seconds: 300 }
- POST /v1/auth/otp/verify: compares hash, max 3 attempts, creates guest user if new phone, enforces max 5 device sessions (revokes oldest if exceeded), writes audit auth.login.success, returns { access_token, refresh_token, user, role, default_view_context }

### JWT service
- RS256 keypair from env (JWT_PRIVATE_KEY_PEM, JWT_PUBLIC_KEY_PEM), generated locally in dev
- JWT_PREVIOUS_PUBLIC_KEY_PEM accepted during rotation windows
- Access token 15min: { sub, role, scope: { city_id?, centre_id?, batch_ids? }, view_context, device_session_id, kid }
- Refresh token: opaque 64-byte random, argon2id hashed, stored in refresh_token_families with family_id, parent_token_id, used_at
- Reuse detection: refresh with used_at != NULL → revoke entire family + audit auth.refresh.reuse_detected → 401

### Refresh and logout
- POST /v1/auth/refresh: hash lookup, reuse detection, mint new pair, mark old used
- POST /v1/auth/logout: revoke device_session + refresh family, audit auth.logout, return 204

### Student-view toggle (Q4 from CLAUDE.md)
- POST /v1/auth/switch-view: parent token only, student must be ≥ 13 (hard gate), student_view_enabled=true required, mints new access token with view_context='student', refresh unchanged

### Guards and decorators
- JwtAuthGuard — attaches req.user, @Public() decorator skips it
- RoleGuard — @Roles(...) decorator, respects full hierarchy from CLAUDE.md
- ScopeGuard — validates centre/batch/city scope against user's assignments
- Decorators: @Public(), @Roles(...), @RequireScope('centre'|'batch'|'city'), @CurrentUser()

### Admin impersonation
- POST /v1/admin/impersonate/:userId (super_admin only)
- Mints access token with impersonator_id + is_impersonation=true
- Writes TWO audit entries as per CLAUDE.md rules

### Tests (apps/api/src/modules/auth/__tests__/)
Integration tests using Testcontainers Postgres + Redis:
- OTP happy path, expired OTP, wrong code × 3 → blocked, rate limit hit
- Refresh rotation works, reuse → family revoked → second attempt 401
- 6th device revokes oldest, student-view blocked for 12-year-old
- Admin impersonation creates two audit entries

After writing each file, run pnpm typecheck.

Verify and show actual output:
- curl chain: POST /v1/auth/otp/send → check console for OTP → POST /v1/auth/otp/verify → GET protected endpoint with token → 200
- POST refresh → new tokens returned, old refresh token rejected
- POST refresh with the same token again → 401, family revoked
- pnpm --filter @jp/api test:integration (auth tests) — show pass/fail output

Commit: git commit -m "feat: step 5 — authentication and authorisation"
```

---

## PROMPT 6 — Geography, Centres, Batches, Form Configs

```
We are on Step 6 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.2, 5.3, 5.4 (database schemas for geography, centres, batches, form configs)
- Section 6.2, 6.3, 6.4 (API endpoints)
- Section 7 (permissions matrix — who can do what)
- Section 17.3 (caching strategy)
- Section 19, Step 6

Read existing code: apps/api/src/modules/auth/, apps/api/src/db/schema/

Build modules under apps/api/src/modules/:

### geography/
- GET /v1/geography/states (public, 24h Redis cache cache:geography:states)
- GET /v1/geography/states/:stateId/cities (public, 24h cache)
- GET /v1/geography/cities/:cityId
- POST /v1/geography/states (super_admin)
- POST /v1/geography/cities (super_admin / state_admin)
- Cache invalidation on any write

### centres/
- GET /v1/centres (scoped: super sees all, city_admin sees city, sanchalak sees assigned, shikshak sees their centres)
- GET /v1/centres/:centreId
- POST /v1/centres (city_admin+): validate lat -90/90, lng -180/180, default gps_radius_meters=500
- PATCH /v1/centres/:centreId (city_admin+ scoped)
- POST /v1/centres/:centreId/deactivate: blocked if active batches exist → 409
- POST /v1/centres/:centreId/sanchalak-assignments (city_admin+)
- DELETE /v1/centres/:centreId/sanchalak-assignments/:userId

### batches/
- GET /v1/centres/:centreId/batches
- GET /v1/batches/:batchId
- POST /v1/centres/:centreId/batches (sanchalak+ scoped): name_en, name_hi, age_group, capacity, schedule JSONB, language_preference
- PATCH /v1/batches/:batchId: capacity reduction blocked if enrolments > new_capacity
- POST /v1/batches/:batchId/shikshak-assignments (sanchalak+ scoped)
- DELETE /v1/batches/:batchId/shikshak-assignments/:userId
- GET /v1/batches/:batchId/timetable: next 8 weeks derived from schedule JSONB
- POST /v1/batches/:batchId/deactivate: blocked if active enrolments exist

### centre_holidays/
- GET /v1/centres/:centreId/holidays?from=&to=
- POST /v1/centres/:centreId/holidays (sanchalak+ scoped): enqueue notifications.centre_holiday_announced
- DELETE /v1/centres/:centreId/holidays/:holidayId

### form-configs/
- GET /v1/form-configs/:persona?city_id= (city override takes precedence over default)
- POST /v1/form-configs (super_admin / city_admin): validate fields JSONB schema — each field needs key, label_en, label_hi, type, required

Caching per Section 17.3: states/cities 24h, form configs 1h, centres 5min list/15min detail, batches 5min

Seed script (pnpm db:seed:dev): create 1 state, 1 city, 3 centres, 4 batches each (12 batches total)

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Run seed: pnpm db:seed:dev (show output)
- curl as sanchalak: GET /v1/centres — must show only assigned centres
- curl as city_admin: attempt to deactivate a centre with active batches → 409
- pnpm --filter @jp/api test:integration (geography/centres tests)

Commit: git commit -m "feat: step 6 — geography, centres, batches, form configs"
```

---

## PROMPT 7 — Background Jobs Infrastructure

```
We are on Step 7 of the Jain Pathshala build.

Read from SPEC.md:
- Section 9 in entirety (queue names, worker concurrency, retry policies, scheduled jobs)
- Section 18.10 (queue depth metrics for auto-scaling)
- Section 19, Step 7

Read existing code: apps/api/src/core/redis/, apps/api/src/worker.ts

Build queue infrastructure:

### Queue registry
apps/api/src/queues/queues.constants.ts — export QUEUES const with ALL 30 queue names from Section 9.1.
Names must exactly match (reference CLAUDE.md queue list):
auth.sms.otp, notifications.fanout, notifications.push, notifications.sms, notifications.email,
attendance.post_process, attendance.consecutive_check, punya.award, punya.leaderboard.refresh,
punya.reconcile, niyam.streak.recompute, media.processing, idcard.generation, report.generation,
report.shivir.export, export.student.pdf, export.bulk.zip, donation.eightyg.cert,
donation.receipt.generate, audit.write, ai.quiz.generate, ai.moderation.image,
shivir.live.broadcast, analytics.refresh_views, digest.weekly.email, db.backfill.generic,
auth.session.cleanup, notifications.birthday, notifications.monthly_reports, debug.echo

### Queue producer module
apps/api/src/queues/queues.module.ts — registers all 30 queues via @nestjs/bullmq
Default job options: attempts:3, backoff:{type:'exponential',delay:5000}, removeOnComplete:{age:86400,count:1000}, removeOnFail:{age:604800}

### BaseProcessor
apps/api/src/queues/processors/base.processor.ts — abstract WorkerHost with tracing, structured logging, try/catch. On final failure → per-queue DLQ (queue name + .dlq)

### DLQ admin endpoints (super_admin only)
- GET /v1/admin/queues/:queueName/dlq
- POST /v1/admin/queues/:queueName/dlq/:jobId/replay
- DELETE /v1/admin/queues/:queueName/dlq/:jobId
- GET /v1/admin/queues/stats

### Cron scheduler
apps/api/src/queues/scheduler.service.ts — registers BullMQ repeatable jobs from CLAUDE.md cron table.
All times in Asia/Kolkata (IST) using date-fns-tz.

### Queue depth metrics
apps/api/src/observability/queue-metrics.service.ts — runs every 30s, publishes:
jp_queue_depth{queue="..."}, jp_queue_processing_rate{queue="..."}, jp_queue_dlq_size{queue="..."}

### debug.echo smoke processor
- Processor that logs { message } payload
- POST /v1/admin/debug/echo (super_admin) → enqueues job, returns { job_id }

### Worker hardening
Update apps/api/src/worker.ts: loads only QueueModule + processors + core modules. SIGTERM → 25s drain timeout.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- pnpm --filter @jp/api dev:worker (show startup — must log all 30 queues registered)
- node -e to call Queue.getRepeatableJobs() and show all 10 cron jobs
- curl POST /v1/admin/debug/echo → job_id returned → worker processes it within 1s (show worker log)
- curl GET /v1/admin/queues/stats (show response)
- curl GET /metrics → show jp_queue_depth lines

Commit: git commit -m "feat: step 7 — background jobs infrastructure"
```

---

## PROMPT 8 — Mobile Shell

> ⚠️ Use `/plan` before pasting this prompt.

```
We are on Step 8 of the Jain Pathshala build.

Read from SPEC.md:
- Section 3.1 (Mobile tech stack — Expo SDK 54+, all libraries)
- Section 4.3 (apps/mobile folder structure — every Expo Router route)
- Section 11 (Offline-first architecture — MMKV store layout)
- Section 19, Step 8

Read from jp-design-system/ — read ALL of these before writing a single component:
- jp-design-system/tokens.json — all token values (already in packages/design-tokens but read the source)
- jp-design-system/colors.ts — JPColors, JPSpacing, JPRadius, JPFonts (copy this file to apps/mobile/src/constants/colors.ts)
- jp-design-system/ui_kits/mobile/components.jsx — component reference. Note: this is web React. Convert each component to React Native: div→View, span/p→Text, button→TouchableOpacity, inline CSS→StyleSheet.create() using JPColors values, no className, no CSS strings
- jp-design-system/ui_kits/mobile/screens.jsx — full screen layout reference. Match these layouts exactly for every screen you build in this step
- jp-design-system/preview/otp-input.html — OTP screen design
- jp-design-system/preview/tabbar.html — tab bar design
- jp-design-system/preview/buttons.html — button variants
- jp-design-system/DESIGN_GUIDE.md — voice/tone rules for all copy

Build the Expo app at apps/mobile/:

### 1. Expo project setup
app.config.ts with EAS config, slug jain-pathshala, scheme jainpathshala, version 0.1.0
iOS bundle: org.jainpathshala.app, Android package: org.jainpathshala.app
All plugins from Section 3.1, all libraries from Section 3.1

### 2. Root layout (app/_layout.tsx)
Theme provider consuming packages/design-tokens (saffron/maroon/cream palette from jp-design-system)
i18n provider from @jp/i18n, persists preferred_language in MMKV jp.profile
Auth context: refresh token in SecureStore, access token in memory + MMKV jp.auth
TanStack QueryClient: staleTime 5min, gcTime 1hr, MMKV persistence
NetInfo → Zustand useNetworkStore
Offline banner: red strip, "You're offline — actions will sync when reconnected"

### 3. API client (src/api/client.ts)
ky-based: base URL from EXPO_PUBLIC_API_BASE_URL, auto-inject Bearer token, single-flight 401 refresh, ULID Idempotency-Key on all non-GET, 30s timeout, unwrap { data } envelope

### 4. MMKV stores (src/storage/) — per Section 11.1
jp.auth, jp.profile, jp.queue.attendance, jp.queue.shivir_scans, jp.queue.niyam_submissions, jp.queue.acknowledgements, jp.cache.batches, jp.cache.students, jp.cache.curriculum, jp.cache.library
Each store: typed wrapper class with get(), set(), delete(), clear(), getAll(), enqueue(), dequeue()

### 5. Login flow
app/(auth)/phone.tsx — match jp-design-system/ui_kits/mobile/screens.jsx login screen. +91 prefix, 10-digit numeric. Font: JPFonts.body (Mukta). Background: JPColors.cream.
app/(auth)/otp.tsx — match otp-input.html design. 6-digit, auto-advance, 60s resend timer. Saffron active state.

### 6. Tab navigators — 8 role-based layouts
Match jp-design-system/preview/tabbar.html and jp-design-system/ui_kits/mobile/screens.jsx tab bar.
Each app/(tabs)/<role>/ with placeholder screens:
- super-admin: Dashboard, Operations, Settings, Profile
- state-admin: Dashboard, Cities, Reports, Profile
- city-admin: Dashboard, Centres, Operations, Reports, Profile
- sanchalak: Dashboard, My Centres, Batches, Reports, Profile
- shikshak: Today, Batches, Niyams, Library, Profile
- parent: Home, My Children, Niyams, Library, Profile (Switch-View button if child ≥ 13)
- student-view: Home, Punya, Niyams, Library, Profile
- guest: Browse Centres, About, Library, Sign Up

### 7. Sync engine skeleton (src/sync/sync-engine.ts)
Triggers: NetInfo restore, AppState foreground, 60s timer. Queue drain priority from CLAUDE.md. Exponential backoff: 5s→15s→45s→2min→5min cap. useSyncStatus: idle|syncing|error|offline

### 8. Bilingual toggle
Settings drawer (long-press logo or profile menu). Persists to jp.profile.preferred_language AND PATCH /v1/users/me. All screens re-render reactively.

### 9. Copy rules from DESIGN_GUIDE.md to apply right now:
- Never use emoji in UI (single exception: festival broadcasts by admins)
- "You" not "the user". "Guruji"/"Didi" not "the teacher"
- Sentence case: "Mark attendance" not "Mark Attendance"
- Jain terms untranslated: Pathshala, Punya, Guruji, Sanchalak, Niyam, Shivir

Copy pre-built RN components from the converted jp-design-system/ui_kits/mobile/components.jsx
to apps/mobile/src/components/ui/. Use them in the login and tab bar screens immediately.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- pnpm --filter @jp/mobile dev starts without error (show Expo QR)
- App loads in Android emulator (EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:3000)
- Login → OTP flow works end-to-end → correct role-based tab nav opens
- Language toggle persists across cold restart
- Offline banner appears when network disabled (show screenshot or description)

Commit: git commit -m "feat: step 8 — mobile shell"
```

---

## PROMPT 9 — Web Shell + Admin Panel Skeleton

```
We are on Step 9 of the Jain Pathshala build.

Read from SPEC.md:
- Section 3.2 (Web tech stack — Next.js 15, shadcn/ui, next-intl, Recharts)
- Section 4.4 (apps/web folder structure)
- Section 6.26 (Public/Website endpoints)
- Section 7 (role/scope guards)
- Section 19, Step 9

Read from jp-design-system/ — read ALL before writing a single component:
- jp-design-system/tailwind.config.js — use as Tailwind preset (presets: [require('./jp-design-system/tailwind.config.js')])
- jp-design-system/tokens.css — copy to apps/web/src/styles/globals.css (CSS custom properties)
- jp-design-system/ui_kits/admin/components.jsx — Sidebar, DataTable, StatsCard, StatusBadge, TextField, etc. These are web React — usable in Next.js directly. Align with shadcn/ui primitives where applicable.
- jp-design-system/ui_kits/admin/screens.jsx — MATCH THESE LAYOUTS exactly for all admin screens
- jp-design-system/preview/admin-sidebar.html — sidebar design
- jp-design-system/preview/admin-table.html — data table design
- jp-design-system/preview/admin-stats.html — KPI card design
- jp-design-system/preview/admin-forms.html — form field design
- jp-design-system/preview/buttons.html — button variants
- jp-design-system/assets/ — copy logo-primary.svg, logo-mark.svg, motif-mandala.svg to apps/web/public/

Build apps/web/:

### 1. Next.js 15 setup
App Router, TypeScript strict, Tailwind with jp-design-system preset (saffron/maroon/cream palette loads from tailwind.config.js)
shadcn/ui: button, card, input, label, dialog, dropdown-menu, table, toast, tabs, select, form, alert, badge, separator, sheet
next-intl: EN/HI subpath routing /en/... and /hi/...

### 2. Public routes (app/[locale]/(public)/)
page.tsx — homepage: saffron hero with jp-design-system/assets/motif-mandala.svg, mission statement, stats
about, centres, centres/[slug], shivirs, shivirs/[id], notices, gallery, library, donate, enquire, msv, contact
Public layout: top nav (cream bg, saffron accents, Mukta font), footer "Enaa Creations | © 2026"
All copy follows DESIGN_GUIDE.md voice/tone rules

### 3. Admin panel (app/[locale]/admin/)
admin/layout.tsx: match jp-design-system/ui_kits/admin/screens.jsx sidebar layout exactly
- Cream background, saffron active states, maroon hover
- Impersonation banner: red strip "Impersonating [name] — acting as [role]"
- Role-filtered sidebar per Section 7 permissions matrix
admin/login/page.tsx — OTP flow matching mobile login design
admin/page.tsx — role-specific dashboards matching jp-design-system/ui_kits/admin/screens.jsx dashboard screens. Placeholder cards for now — real data comes per-feature step.

### 4. Auth middleware (app/middleware.ts)
HTTP-only cookie token, RS256 verification, redirect to /admin/login on 401, redirect to / on role mismatch

### 5. Component library (src/components/)
Copy components from jp-design-system/ui_kits/admin/components.jsx to src/components/ui/:
- Sidebar (already matches design), DataTable with sort/filter/pagination/bulk actions
- StatsCard (match admin-stats.html), StatusBadge, AgePill, TierBadge
- FormBuilder (renders from registration_form_configs schema)
- BillingualText, RoleBadge, ConfirmDialog, ChartWrappers (Recharts)

### 6. Tailwind integration
tailwind.config.ts extends jp-design-system preset. CSS vars in globals.css from tokens.css.
All Tailwind classes: bg-saffron, text-maroon, rounded-md, shadow-2, font-display, etc. — no hardcoded hex anywhere.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- pnpm --filter @jp/web dev starts on localhost:3001
- http://localhost:3001/en — public homepage renders with saffron palette (show description)
- http://localhost:3001/hi — same in Hindi (Devanagari)
- http://localhost:3001/en/admin/login — OTP login works against local API
- Login as super_admin → full sidebar; login as sanchalak → restricted sidebar
- Language switch: /en/admin → /hi/admin URL updates, content changes
- Parent accessing /admin → redirected to /
- pnpm typecheck passes

Commit: git commit -m "feat: step 9 — web shell and admin panel skeleton"
```

---

## PROMPT 10 — Student Enrolment & Approval

```
We are on Step 10 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.3, 5.4, 5.5 (students, enrolments, msv_enrolments, form_configs, digital_id_cards)
- Section 6.5, 6.6, 6.7 (Students, MSV, ID Cards endpoints)
- Section 8 (enrolment workflow — capacity check, duplicate detection)
- Section 19, Step 10
- Q1 and Q11 in CLAUDE.md (MSV admin discretion, students never deleted)

Read from jp-design-system/:
- jp-design-system/preview/admin-forms.html — enrolment form design
- jp-design-system/preview/admin-status-badges.html — status pill variants (pending/active/waitlisted/rejected)
- jp-design-system/preview/admin-table.html — enrolment grid layout

Read existing code: apps/api/src/modules/auth/, apps/api/src/db/schema/students.ts, apps/api/src/db/schema/enrolments.ts

Build:

### Backend

#### enrolments/ module
- POST /v1/enrolments (parent or guest): validate form config fields, duplicate detection warning (return 200 with meta.warning if same first_name+dob+parent_phone exists), insert with status=pending, audit enrolment.submitted. Do NOT check capacity here.
- GET /v1/enrolments (sanchalak+ scoped): filters — status, batch_id, age_group, search
- GET /v1/enrolments/:id
- POST /v1/enrolments/:id/approve: capacity check (409 ERR_BATCH_OVER_CAPACITY if full), transactional status update, enqueue idcard.generation, enqueue notifications.fanout event=enrolment.approved, audit enrolment.approved
- POST /v1/enrolments/:id/reject: reason required, enqueue parent notification, audit
- POST /v1/enrolments/:id/waitlist
- POST /v1/enrolments/:id/transfer (city_admin+): validate target capacity, update current_batch_id, enqueue new idcard.generation

#### students/ module
- GET /v1/students (scoped), GET /v1/students/:id
- PATCH /v1/students/:id (parent or sanchalak+)
- POST /v1/students/:id/deactivate (sanchalak+): status=inactive, deactivated_at, reason. NEVER DELETE per Q11.
- POST /v1/students/:id/reactivate
- GET /v1/parents/me/students (parent only, includes inactive)

#### msv/ module
- POST /v1/msv/enrolments: no eligibility check (Q1 — pure admin discretion), status=pending
- GET /v1/msv/enrolments (city_admin+ scoped)
- POST /v1/msv/enrolments/:id/approve: status=approved, trigger ID card regeneration, notify parent
- POST /v1/msv/enrolments/:id/reject

### Mobile
app/(auth)/sign-up.tsx and app/(parent)/students/new.tsx:
Match jp-design-system/ui_kits/mobile/screens.jsx enrolment form screen.
Dynamic form renders from GET /v1/form-configs/parent?city_id=. Cream background, saffron submit button.
app/(parent)/students/index.tsx: match screens.jsx "My Children" screen.
Status pills: use JPColors.success (active), JPColors.warning (pending/waitlisted), JPColors.error (rejected) from colors.ts

### Admin Panel
admin/enrolments/page.tsx: match jp-design-system/preview/admin-table.html layout.
Status badges use jp-design-system/preview/admin-status-badges.html variants.
Bulk approve: row-level capacity failure reported inline, not as full-page error.
admin/enrolments/[id]/page.tsx: duplicate warning banner in amber (JPColors.warning / jp-design-system semantic warning colour)
admin/msv-enrolments/page.tsx and [id]/page.tsx

After writing each file, run pnpm typecheck.

Verify and show actual output:
- curl: guest POST /v1/enrolments → student created with status=pending
- curl: POST /v1/enrolments again with same name+dob+phone → 200 with meta.warning duplicate_suspected
- curl: POST /v1/enrolments/:id/approve when batch at capacity → 409 ERR_BATCH_OVER_CAPACITY
- curl: POST /v1/enrolments/:id/approve when under capacity → 200, check queue stats show idcard.generation enqueued
- pnpm --filter @jp/api test:integration (enrolment tests)

Commit: git commit -m "feat: step 10 — student enrolment and approval"
```

---

## PROMPT 11 — Media & File Architecture

```
We are on Step 11 of the Jain Pathshala build.

Read from SPEC.md:
- Section 2.6 (Media Upload Flow)
- Section 5.21 (media_assets schema)
- Section 6.24 (Media endpoints)
- Section 10 (File & Media Architecture)
- Section 19, Step 11

Read from jp-design-system/:
- jp-design-system/preview/id-card.html — ID card VISUAL SPEC. Convert this HTML to a Handlebars template at apps/api/src/templates/id-card.hbs. Keep the saffron/maroon/cream palette, the layout (photo top-left, QR bottom-right, MSV badge top-right when enabled). Replace hardcoded values with: {{student_name_en}}, {{student_name_hi}}, {{father_name}}, {{photo_url}}, {{student_id}}, {{centre_name_en}}, {{centre_name_hi}}, {{batch_name_en}}, {{batch_name_hi}}, {{qr_code_url}}, {{msv_badge}}, {{valid_year}}
- jp-design-system/assets/logo-mark.svg — embed in ID card template header

Read existing code: apps/api/src/queues/, apps/api/src/modules/

Build:

### Storage abstraction
StorageService interface, R2 adapter (S3-compatible), MinIO adapter (dev). STORAGE_DRIVER env picks adapter.
4 buckets: jp-{env}-media-private, jp-{env}-media-public, jp-{env}-exports, jp-{env}-receipts
MinIO bootstrap script creates buckets with correct policies at dev startup.

### Media API
- POST /v1/media/sign-upload: validate size limits per purpose (student_photo 5MB, niyam_submission 25MB image/100MB video, library_pdf 50MB), validate content-type whitelist, create media_assets row status=pending, return presigned PUT URL
- POST /v1/media/finalize: HEAD the object, verify size/type, status=processing, enqueue media.processing
- GET /v1/media/:assetId: scope check, return signed read URL 1h TTL

### media.processing processor
Images: EXIF strip (security), sharp variants (thumb_sm 200px, thumb_md 600px, thumb_lg 1200px, WebP q80)
Videos: ffmpeg thumbnail frame at 1s
PDFs: pdf2pic cover thumbnail
On success: status=ready, variants JSONB. On final failure: status=failed.

### idcard.generation processor
1. Load student, parent, centre, batch, MSV status, photo asset
2. Render apps/api/src/templates/id-card.hbs (match jp-design-system/preview/id-card.html exactly)
3. Puppeteer → PNG 1080×1700px
4. QR code via qrcode npm package: encodes https://jainpathshala.org/s/{uuid_short}
5. Upload to jp-{env}-media-public/idcards/{student_id}.png
6. Upsert digital_id_cards row
7. Notify parent: "Your child's digital ID card is ready"
Regenerate triggers: transfer (new batch), MSV approval, photo update

### Mobile upload helper (apps/mobile/src/api/media.ts)
uploadFile(asset, purpose): sign → PUT → finalize → poll until ready (30s max). Progress callback for UI.
expo-image-picker with quality compression for images.

### Wire photo upload
Update apps/mobile/app/(parent)/students/new.tsx from Step 10 to use uploadFile().

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Full upload chain: POST sign-upload → PUT file → POST finalize → poll GET until status=ready
- Show variants exist in MinIO: mc ls minio/jp-dev-media-private/{key}__thumb_sm.webp
- Check EXIF stripped: exiftool on original vs processed (GPS should be absent)
- Approve an enrolment → wait 30s → show digital_id_cards row exists → GET /v1/media/:id returns signed URL
- Open the signed URL — show the ID card matches jp-design-system/preview/id-card.html layout

Commit: git commit -m "feat: step 11 — media and file architecture"
```

---

## PROMPT 12 — Notifications & Realtime

```
We are on Step 12 of the Jain Pathshala build.

Read from SPEC.md:
- Section 2.5 (Notification Fanout Flow)
- Section 5.18 (notifications, sms_logs schemas)
- Section 6.22 (Notifications endpoints)
- Section 8 (critical notice SMS fallback, Devanagari segment math)
- Section 9.3 (Socket.IO namespaces)
- Section 17.4 (FCM batching)
- Section 19, Step 12

Read from jp-design-system/:
- jp-design-system/preview/toast.html — toast/notification visual design
- jp-design-system/ui_kits/mobile/screens.jsx — notifications screen layout

Read existing code: apps/api/src/queues/, apps/api/src/modules/

Build:

### Fanout pipeline (notifications.fanout processor)
Event types: enrolment.approved, attendance.marked, niyam.assigned, niyam.rejected, homework.assigned, homework.approved, notice.published, notice.critical, shivir.registered, shivir.reminder, exam.result_published, quiz.scheduled, donation.receipt_ready, idcard.ready, birthday.wish, holiday.announced, session.cancelled, competition.result, service_request.resolved, punya.tier_upgrade, streak.badge_earned
Scope types: user, batch, centre, city, state, national, msv_cohort, role
Resolve recipients → split by notification_preferences → batch into push/sms/email jobs
Always insert notifications row (in-app feed)

### Push processor (notifications.push)
FCM batched sends via firebase-admin (max 500/batch per Section 17.4)
Bilingual templates by preferred_language (Mukta renders Devanagari correctly)
Revoke stale device tokens on messaging/registration-token-not-registered

### SMS processor (notifications.sms)
MSG91 integration. Devanagari segment math: Math.ceil(text.length / 70) for Hindi vs /160 for ASCII.
Monthly spend cap: track sms_logs cost_inr, block when over SMS_MONTHLY_CAP_INR, super_admin override flag.

### Email processor (notifications.email)
Resend API. React Email templates: enrolment-approved, monthly-report-ready, donation-receipt, 80g-certificate, weekly-digest-city-admin, weekly-digest-sanchalak

### In-app feed API
GET /v1/notifications?cursor=&limit=20, POST /v1/notifications/:id/read, POST /v1/notifications/read-all, GET /v1/notifications/unread-count (30s cache), PATCH /v1/users/me/notification-preferences, POST /v1/device-tokens, DELETE /v1/device-tokens/:id

### Socket.IO (apps/api/src/realtime/)
@socket.io/redis-adapter. JWT auth on connect. Three namespaces per CLAUDE.md:
/shivirs/:shivirId, /push-quizzes/:quizId, /admin-dashboard/:cityId

### Mobile push handler (apps/mobile/src/notifications/)
Register FCM token on login. Foreground → in-app banner matching jp-design-system/preview/toast.html.
Background → system notification with deep link. Token rotation handler.

### Mobile notifications feed
app/(tabs)/.../notifications.tsx — match jp-design-system/ui_kits/mobile/screens.jsx notifications screen.
Cream background, saffron unread dot, ink text. Cursor pagination, pull-to-refresh.

### Admin live dashboard
Add "Live Activity" card to city_admin dashboard matching jp-design-system/ui_kits/admin/screens.jsx.
Subscribes to /admin-dashboard/:cityId. Last 20 events. No page refresh required.

### Wire previous steps
Update enrolment approval (Step 10): actually call notifications.fanout queue
Update ID card generation (Step 11): enqueue idcard.ready notification
Update centre holiday creation (Step 6): enqueue holiday.announced notification

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Approve enrolment → show push job in queue stats within 1s
- Publish a critical notice → show both push and SMS jobs enqueued
- Toggle sms=false in notification preferences → repeat notice → SMS job NOT enqueued for that user
- Show Socket.IO connection to /admin-dashboard/:cityId in browser DevTools Network tab

Commit: git commit -m "feat: step 12 — notifications and realtime"
```

---

## PROMPT 13 — Attendance & GPS Check-In (Phase 1 Capstone)

> ⚠️ Use `/plan` before pasting this prompt.

```
We are on Step 13 of the Jain Pathshala build.

Read from SPEC.md:
- Section 2.4 (Offline Sync Flow — Attendance Example)
- Section 5.6 (attendance, sessions, absence_notifications, session_cancellations schemas)
- Section 6.8 (Attendance & Sessions endpoints)
- Section 8 (GPS check-in with Haversine, attendance marking transaction, idempotency)
- Section 11 (offline-first patterns)
- Section 19, Step 13

Read from jp-design-system/:
- jp-design-system/preview/gps-session.html — GPS check-in screen design
- jp-design-system/preview/attendance-badges.html — P/A/L/E status chip designs (use these exact colours)
- jp-design-system/ui_kits/mobile/screens.jsx — attendance marking screen layout (find the shikshak today/attendance screens)
- jp-design-system/preview/admin-table.html — admin attendance grid layout

Read existing code: apps/api/src/modules/, apps/mobile/src/sync/

Build:

### Backend

#### sessions/ module
- POST /v1/sessions/checkin (shikshak): Haversine distance vs centre gps_coordinates + gps_radius_meters. Outside radius → session with gps_flagged=true + sanchalak notification. Idempotent: same batch+date with status=in_progress → return existing.
- POST /v1/sessions/:id/checkout: status=completed, notify sanchalak with summary
- POST /v1/sessions/:id/cancel: reason required (min 10 chars), notify all batch parents event=session.cancelled
- GET /v1/sessions?batch_id=&from=&to=

#### attendance/ module
- POST /v1/attendance/mark (shikshak): items array with client_op_id per item. UPSERT on (session_id, student_id). Each item must be in active enrolments (deactivated students rejected).
  Transaction: UPSERT attendance → UPSERT punya_transactions (idempotency_key=attendance:{session_id}:{student_id}) → UPDATE punya_balances. Enqueue attendance.post_process (debounced per session, not per item).
- POST /v1/absences/notify (parent): advance absence notice, inserts absence_notifications

#### attendance.post_process processor
Streak computation: compare to previous session date (accounting for holidays/cancellations). Milestone awards (7/14/30/60/100): Punya via punya.award queue with idempotent key. Parent notifications per student.

#### attendance.consecutive_check cron
3 consecutive absences (not excused, accounting for cancellations/holidays) → student_notes alert row + notify parent + sanchalak + city_admin

### Mobile (match jp-design-system layouts exactly)

app/(shikshak)/today/index.tsx: match screens.jsx "Today" tab. Batch cards with status pills. Cream bg, saffron active.
app/(shikshak)/sessions/[id]/checkin.tsx: match gps-session.html design. GPS capture, off-site warning banner in amber.
app/(shikshak)/sessions/[id]/mark.tsx: match screens.jsx attendance marking screen.
Each student row: 3-way toggle using attendance-badges.html colours exactly (present=success green, absent=error red, late=warning amber, excused=info blue).
Long-press → notes modal. Pre-fill excused from absence_notifications.
Offline: queue to jp.queue.attendance with client_op_id per item. Show "Saved offline — will sync" banner.
app/(shikshak)/sessions/[id]/checkout.tsx

app/(parent)/attendance/index.tsx: calendar heatmap using attendance-badges.html colours for each date cell.
"Inform Absence" CTA, date range + reason form.

Update sync engine (src/sync/sync-engine.ts) with actual attendance handler:
group by session_id → POST /v1/attendance/mark → dequeue on success, backoff on error.

### Admin Panel
admin/attendance/page.tsx: match admin-table.html layout. Today's sessions across scope, GPS flag indicator.
admin/attendance/sessions/[id]/page.tsx: full roster with status chips matching attendance-badges.html.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- curl chain: POST checkin (in-radius) → POST mark 5 students → POST checkout (show each response)
- Check punya_transactions: SELECT COUNT(*) WHERE idempotency_key LIKE 'attendance:%' — must equal student count
- Resubmit same mark request with same client_op_ids → SELECT COUNT(*) still the same (idempotency works)
- Check punya_balances updated for each student
- pnpm --filter @jp/api test:integration (attendance tests)

Commit: git commit -m "feat: step 13 — attendance and GPS check-in (phase 1 capstone)"
```

---

## PROMPT 14 — Offline Sync Engine

> ⚠️ Use `/plan` before pasting this prompt.

```
We are on Step 14 of the Jain Pathshala build.

Read from SPEC.md:
- Section 2.4 (Offline Sync Flow)
- Section 5.19 (sync_operations schema)
- Section 6.23 (Sync endpoints)
- Section 8 (idempotency keys)
- Section 11 in entirety (Offline-First Architecture)
- Section 19, Step 14

Read existing code: apps/api/src/modules/, apps/mobile/src/sync/, apps/mobile/src/storage/

Build:

### Backend sync/ module

POST /v1/sync/batch:
- For each operation: check sync_operations (user_id, client_op_id) unique index
  - Exists + succeeded → return cached result (no-op)
  - Exists + failed → return cached error
  - Not exists → insert status=processing
- Route by op_type: attendance.mark, niyam.submit, homework.submit, shivir.scan, notice.acknowledge, notification.read
- Each operation: own try/catch. On success: status=succeeded, cache response. On fail: status=failed, cache error.
- Conflict: state-machine violations (attendance on cancelled session) → 409. Metadata → last-write-wins by client_timestamp.
- Return: { results: [{client_op_id, status, data?, error?}], server_timestamp }

GET /v1/sync/bootstrap:
Returns user's complete working set. For parent: students + enrolments + batch info. For shikshak: batches + students + niyams + homework. For sanchalak: centres + batches + pending enrolments.
Plus: 30 recent notifications, 10 notices, niyams catalogue, library tier metadata, leaderboard snapshot.
Redis cache per user 5min. Includes server_timestamp.

GET /v1/sync/delta?since=:
Changes since timestamp via updated_at indexes. Same shape as bootstrap but filtered.

### Mobile sync engine (apps/mobile/src/sync/sync-engine.ts)
Full implementation replacing Step 8 skeleton:

Triggers: NetInfo restore, AppState active, 60s timer.

Drain priority (from CLAUDE.md): attendance → shivir_scans → niyam_submissions → homework_submissions → acknowledgements
Batch: up to 50 ops per POST /v1/sync/batch.

Results:
- success → dequeue
- retryable=true (5xx, network) → keep, increment attempts, exponential backoff
- retryable=false (4xx, conflict) → surface to UI: "This action couldn't be completed: [reason]"

After drain: GET /v1/sync/delta?since=last_sync_at → refresh caches. Update jp.profile.last_sync_at.

Retry policy: 5s→15s→45s→2min→5min cap, max 10 attempts.
After max: mark failed in MMKV, surface "Sync issue with N actions — Tap to view"

Bootstrap: on login success → GET /v1/sync/bootstrap → cache to jp.cache.*. Subsequent launches: delta if last_sync_at < 24h, else full bootstrap.

UI:
- Offline banner (already exists from Step 8) — ensure it stays visible
- Tab bar badge: dot for pending ops, number if >9
- Success toast after drain: "N actions synced" — saffron toast matching preview/toast.html
- Failed ops: orange indicator on profile tab → tap → list with Retry/Discard per item
- Conflict modal: "This action couldn't be completed because [reason]" — View server state / Discard / Retry

After writing each file, run pnpm typecheck.

Verify and show actual output:
- curl POST /v1/sync/batch with 5 attendance operations → results array returned
- Repeat same request → all return cached success (no new DB writes)
- curl GET /v1/sync/bootstrap → show response structure (truncated), must be under 500KB for a 2-child parent
- curl POST /v1/sync/batch with 100 ops → show p95 timing: pnpm --filter @jp/api test:integration --grep="sync batch 100"
- pnpm --filter @jp/api test:integration (sync tests)

Commit: git commit -m "feat: step 14 — offline sync engine"
```

---

## PROMPT 15 — QR Scanning & Shivir Management

```
We are on Step 15 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.11 (Shivirs schemas)
- Section 6.14 (Shivirs endpoints)
- Section 8 (Shivir in/out vs present-only scan logic)
- Section 9.3 (/shivirs/:shivirId Socket.IO namespace)
- Section 12 (PDF/CSV export)
- Section 19, Step 15

Read from jp-design-system/:
- jp-design-system/ui_kits/mobile/screens.jsx — find the QR scanner and shivir screens
- jp-design-system/preview/admin-table.html — shivir roster grid
- jp-design-system/preview/admin-stats.html — live dashboard stat cards

Read existing code: apps/api/src/realtime/, apps/api/src/modules/, apps/mobile/src/sync/

Build:

### Backend shivirs/ module
CRUD: POST /v1/shivirs (city_admin+), GET list/detail, POST sessions, POST volunteers, POST registrations, GET roster.
POST /v1/shivirs/:id/scan (volunteer): decode QR uuid_short → look up student → validate registration.
in_out mode: state machine — no scan=IN, last IN=OUT, last OUT=409 (override via force=true).
present_only mode: second scan=409.
Idempotency via client_op_id. Emit Socket.IO scan.completed to /shivirs/:id namespace.
POST /v1/shivirs/:id/export: enqueue report.shivir.export → CSV + PDF → signed URL notification.

### Mobile (apps/mobile/app/(volunteer)/)
app/(volunteer)/scan/[shivirId]/[sessionId].tsx — match jp-design-system/ui_kits/mobile/screens.jsx scanner screen.
expo-camera barcode scanner. Success: green flash + student name + direction. Failure: red flash + error.
Offline: queue to jp.queue.shivir_scans. "Scan history" bottom sheet.

### Admin Panel (apps/web/app/[locale]/admin/shivirs/)
Match jp-design-system/ui_kits/admin/screens.jsx shivir screens.
shivirs/[id]/live/page.tsx: stat cards matching admin-stats.html. Socket.IO subscription to /shivirs/:id.
4 counters: Registered, Currently In, Already Out, Not Arrived. Live activity feed below.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Create shivir, register 5 students, scan 5 in → GET /v1/shivirs/:id/live shows 5 in
- Scan same student again (present_only) → 409
- in_out: scan in → scan out → scan again → 409 without force, 200 with force=true
- Socket.IO: scan event emitted (show in browser console)
- pnpm --filter @jp/api test:integration (shivir tests)

Commit: git commit -m "feat: step 15 — QR scanning and shivir management"
```

---

## PROMPT 16 — Punya Engine & Leaderboards

```
We are on Step 16 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.7 (Punya schemas)
- Section 6.9 (Punya endpoints)
- Section 8 (Punya concurrency + nightly reconciliation)
- Section 9 (punya.* processors)
- Section 17.5 (Redis sorted sets for leaderboards)
- Section 19, Step 16

Read from jp-design-system/:
- jp-design-system/preview/punya-card.html — Punya balance card design. Use tier colours exactly from tokens.json color.tier.*
- jp-design-system/preview/tier-badges.html — badge designs for each tier (Jigyasu/Shravak/Sadhak/Shraman/Tirthankar). These are the 5 colours from CLAUDE.md tier table — match them exactly.
- jp-design-system/preview/leaderboard.html — leaderboard row layout

Read existing code: apps/api/src/modules/, apps/api/src/queues/

Build:

### PunyaService.award()
Internal method — idempotency_key mandatory. UPSERT on unique index. Single transaction: insert punya_transactions + UPDATE punya_balances. Recompute tier (5 tiers from CLAUDE.md). On tier upgrade: emit punya.tier_upgrade event. Trigger punya.leaderboard.refresh queue with 5s debounce key per scope.
Admin endpoint: POST /v1/punya/award (sanchalak+) — manual award, amount within configured bounds, reason mandatory.

### Punya reversal
POST /v1/punya/reverse: validate reversal_of IS NULL (no double reversal), created_at > NOW()-30days (Q5). Insert negative transaction, UPDATE balances, recompute tier. Audit logged.

### Read endpoints
GET /v1/students/:id/punya/balance, /transactions, /tier-progress
GET /v1/leaderboards/:scope — read Redis ZREVRANGE, hydrate names/photos from Postgres. 60s edge cache.

### punya.leaderboard.refresh processor
ZADD per scope: lb:batch:{id}:{YYYY-MM}, lb:centre:{id}:{YYYY-MM}, lb:city:{id}:{YYYY-MM}, lb:national:{YYYY-MM}, lb:msv:{YYYY-MM} (MSV students only). EXPIRE for TTL.

### Monthly reset cron
Snapshot ZSET → leaderboard_snapshots table. Begin new month.

### punya.reconcile cron
Sum punya_transactions per student → compare punya_balances → fix drift → alert if >10 students affected.

### Tier upgrade flow
On punya.tier_upgrade event: push notification + Puppeteer tier certificate PDF → upload + notify parent.

### Mobile
app/(parent|student-view)/punya/index.tsx — match jp-design-system/preview/punya-card.html EXACTLY.
Circular points display, tier name in tier colour (from tokens.json color.tier.*), progress bar to next tier.
app/(parent|student-view)/punya/leaderboard.tsx — match preview/leaderboard.html.
Each row: rank, avatar, name, points. Current user row highlighted in saffron-50 background.
Scope tabs: My Batch | Centre | City | National | MSV (MSV tab visible only for MSV students).

### Admin Panel
admin/punya/configs/page.tsx — city_admin adjusts point values within super_admin-set bounds.
admin/punya/manual-award/page.tsx — match admin-forms.html layout for the award form.
admin/punya/audit/page.tsx — reconcile drift report, manual awards, recent reversals.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- PunyaService.award() twice with same idempotency_key → SELECT COUNT(*) from punya_transactions WHERE idempotency_key=X → must be 1
- 10 concurrent award calls to same student → all succeed, balance = correct sum (show SELECT)
- Reverse a transaction → balance reduced, tier recomputed if applicable
- Manually corrupt punya_balances → run reconcile cron → show balance restored + alert logged
- GET /v1/leaderboards/batch → show correct ordering

Commit: git commit -m "feat: step 16 — punya engine and leaderboards"
```

---

## PROMPT 17 — Niyams Module + Gallery

```
We are on Step 17 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.8, 5.9 (niyams, niyam_submissions, niyam_streaks, gallery_items schemas)
- Section 6.10, 6.11 (Niyams + Gallery endpoints)
- Section 8 (Niyam auto-approve + 30-day retro reject)
- Q5 and Q6 in CLAUDE.md (30-day window, gallery blanket opt-in)
- Section 19, Step 17

Read from jp-design-system/:
- jp-design-system/ui_kits/mobile/screens.jsx — niyam submission screen, gallery grid
- jp-design-system/preview/admin-status-badges.html — approved/rejected status badges
- jp-design-system/preview/admin-table.html — niyam submissions grid layout

Read existing code: apps/api/src/modules/punya/, apps/api/src/modules/media/

Build:

### Niyams module
CRUD endpoints per Section 6.10. Auto-approve on submit (Q5 — no manual approval needed).
POST /v1/niyams/:id/submissions: status=approved immediately, Punya award via punya.award (idempotency_key=niyam:{submission_id}), enqueue niyam.streak.recompute, enqueue gallery.evaluate.
POST /v1/niyam-submissions/:id/reject (admin): Q5 check — created_at > NOW()-30days else 409 ERR_NIYAM_REVERSAL_WINDOW_EXPIRED. Reverse Punya, recompute streak, hide gallery item, notify parent.

### niyam.streak.recompute processor
Walk all approved submissions → compute consecutive streak respecting frequency.
On milestone (7/14/30/60/100): Punya award + push notification. On rejection breaking streak: recompute backwards.

### Gallery module
gallery.evaluate queue: check users.gallery_visibility_opt_in (Q6). Insert gallery_items if true.
PATCH /v1/users/me {gallery_visibility_opt_in: bool}: backfill — true→false hides all items, false→true restores all. No partial per-child control (Q6 — blanket).
GET /v1/gallery: visible=true only, featured first, then created_at DESC. Public (no auth for non-PII view).
Privacy: return only first_name + city + age_group + niyam_name. NO full name, NO parent info.
POST /v1/gallery/:id/feature, /unfeature (city_admin+, audit logged)
DELETE /v1/gallery/:id (city_admin+, reason required, notify parent)

### Mobile
app/(parent|student-view)/niyams/index.tsx — match screens.jsx niyams screen.
"Today's Niyams" (daily frequency, not yet submitted) vs "Active Niyams". Streak badge row.
app/(parent|student-view)/niyams/[id]/submit.tsx — camera/library picker. Cream background, saffron submit.
Full offline: queue to jp.queue.niyam_submissions.
app/(parent)/profile/privacy.tsx — gallery opt-in toggle with DESIGN_GUIDE.md copy:
"When enabled, photos and videos your child submits as part of niyams may appear in our public city gallery. Personal information like full name and your contact details are never shared. You can change this anytime."

### Admin Panel
admin/niyams/[id]/submissions/page.tsx — match admin-table.html. Reject button disabled after 30 days with tooltip "Rejection window closed".
Reject dialog: reason field min 20 chars. Error state uses jp-design-system semantic error colour.
admin/gallery/page.tsx — feature/unfeature/remove actions. Status filter using admin-status-badges.html.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Submit niyam → SELECT from punya_transactions WHERE idempotency_key LIKE 'niyam:%' → 1 row
- Reject within 30 days → punya_transactions has reversal row, balance reduced
- Set submission created_at = NOW()-31days → reject → 409 ERR_NIYAM_REVERSAL_WINDOW_EXPIRED
- Toggle gallery_visibility_opt_in false → SELECT COUNT(*) FROM gallery_items WHERE visible=true AND student in [parent's children] → 0
- Toggle back → count restored

Commit: git commit -m "feat: step 17 — niyams module and gallery"
```

---

## PROMPT 18 — Homework, Notices, Competitions

```
We are on Step 18 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.9, 5.10, 5.12 (homework, notices, competitions schemas)
- Section 6.12, 6.13, 6.15 (Homework, Notices, Competitions endpoints)
- Section 8 (critical notice SMS fallback, Devanagari segment math)
- Section 19, Step 18

Read from jp-design-system/:
- jp-design-system/preview/homework-card.html — homework card design
- jp-design-system/preview/notice-cards.html — notice card variants (pinned/critical/standard)
- jp-design-system/preview/admin-forms.html — notice composer form
- jp-design-system/ui_kits/mobile/screens.jsx — homework list and notice feed screens

Read existing code: apps/api/src/modules/punya/, apps/api/src/modules/notifications/

Build:

### Homework module
Batch or individual assignment. State machine: pending→submitted→approved|rejected|late.
After due_date if still pending: cron marks late + notifies.
Star approval: bonus Punya. Punya idempotency_key=homework:{submission_id}.

### Notices module
POST /v1/notices: scope authority enforced (city_admin only posts within their city).
is_critical=true: push + SMS fanout. SMS: Devanagari math = Math.ceil(text.length / 70) for Hindi, /160 for ASCII. Daily cap check from CLAUDE.md.
Scheduled notices: status=scheduled until cron processes.
GET /v1/notices: auth-aware — public flag controls guest access.
POST /v1/notices/:id/read: records notice_reads row.

### Competitions module
Registration: validate window, eligibility, max_participants.
Results: position 1/2/3 → Punya per punya_features. participant → smaller Punya.
Publish-results step is separate from results entry.

### Mobile (match jp-design-system layouts)
app/(any)/notices/index.tsx — match notice-cards.html: pinned notices at top (saffron left border), critical notices with red background, standard cream cards.
Critical notice: red banner "Important — please read and acknowledge". Acknowledgement button in error red.
app/(parent|student-view)/homework/[id].tsx — match homework-card.html design.
app/(parent|student-view)/competitions/[id].tsx — registration CTA in saffron.

### Admin Panel
admin/notices/new/page.tsx — match admin-forms.html. Critical toggle with ConfirmDialog:
"This will send an SMS to all [N] recipients. Estimated cost: ₹[X]. Are you sure?"
Cost estimate uses real SMS segment calculation before user confirms.
Bilingual editor fields: label_en/label_hi pairs side-by-side.
admin/competitions/:id/results/page.tsx — position dropdown per registered student.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Assign homework to batch of 3 → SELECT COUNT(*) FROM homework_submissions WHERE assignment_id=X → 3
- Approve with star → punya_transactions has homework idempotency_key entry
- SMS segment math: console.log(Math.ceil("नमस्ते जैन पाठशाला में आपका स्वागत है।".length / 70)) — show result
- Publish critical notice → show push + SMS jobs in queue stats
- Competition: enter top-3 results → SELECT from punya_transactions WHERE reference_type='competition' — show 3 rows

Commit: git commit -m "feat: step 18 — homework, notices, competitions"
```

---

## PROMPT 19 — Curriculum & Online Exams

```
We are on Step 19 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.13, 5.14 (Curriculum, Exams schemas)
- Section 6.16, 6.17 (Curriculum, Exams endpoints)
- Section 8 (Exam OTP class-wide)
- Q2 in CLAUDE.md (MSV curriculum — super_admin only at SERVICE LAYER)
- Section 19, Step 19

Read from jp-design-system/:
- jp-design-system/ui_kits/mobile/screens.jsx — exam taking screen and curriculum progress screen
- jp-design-system/preview/admin-forms.html — exam question authoring form

Read existing code: apps/api/src/modules/punya/, apps/api/src/db/schema/curriculum.ts, apps/api/src/db/schema/exams.ts

Build:

### Curriculum module
Templates (super_admin). City curricula: Q2 — if type='msv' and caller role != super_admin → ERR_RBAC_FORBIDDEN_MSV_CURRICULUM at SERVICE LAYER (not just guard).
Assign to centre/batch: one active Standard + one active MSV per batch.
Student progress: upsert student_curriculum_progress per item. Optional Punya on mastered.

### Online Exams module
Exam OTP: single 6-digit OTP for entire class (not per-student). Admin generates, distributes verbally.
POST /v1/exams/:id/start-attempt: OTP valid for first 30min of exam window only. No existing in-progress attempt for this student.
Autosaved answers: incremental POST, debounced.
Auto-grade: MCQ single/multi, true_false. Free text: admin grades after submission.
Release results: computes ranks, awards top-3 Punya, sends per-student push.

### Mobile
app/(parent|student-view)/exams/[id]/take.tsx — match screens.jsx exam screen.
Timer top-right in saffron. Question palette overlay. Auto-submit on expiry.
Offline-tolerant: answers cached in MMKV, synced on reconnect.
app/(parent|student-view)/curriculum/index.tsx — tree view with progress bars in saffron.

### Admin Panel
admin/exams/:id/page.tsx — "Generate OTP" button (one-click reveal). admin-forms.html style.
admin/curriculum/new/page.tsx — MSV type option hidden for city_admin (UI-level), but service-layer 403 is the real enforcement.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- curl: city_admin POST /v1/curricula with type=msv → 403 (show response body with error code)
- curl: super_admin POST /v1/curricula with type=msv → 201
- Exam: generate OTP, start attempt with correct OTP → in_progress. Wrong OTP → 401. OTP after 30min → 409.
- Submit exam → auto-graded MCQ results visible immediately. Release → push jobs enqueued.

Commit: git commit -m "feat: step 19 — curriculum and online exams"
```

---

## PROMPT 20 — Quizzes (Scheduled + Push)

```
We are on Step 20 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.14 (quiz_events, questions, push_quizzes schemas)
- Section 6.18 (Quizzes endpoints)
- Section 9.3 (/push-quizzes/:quizId Socket.IO namespace)
- Section 19, Step 20

Read from jp-design-system/:
- jp-design-system/ui_kits/mobile/screens.jsx — push quiz participation screen and shikshak control screen
- jp-design-system/preview/leaderboard.html — end-of-quiz leaderboard layout

Read existing code: apps/api/src/realtime/, apps/api/src/modules/punya/

Build:

### Question bank
POST /v1/questions (city_admin+ for standard, super_admin for MSV). AI-generated questions enter with ai_review_status=pending_review — not available until reviewed.

### Scheduled quizzes
Standard scheduled flow: notify → attempt within window → auto-grade MCQ → Punya.

### Push quizzes (real-time)
POST /v1/quizzes/push/:id/start: emit quiz.started to /push-quizzes/:id namespace.
POST /v1/quizzes/push/:id/next-question: emit quiz.question_next with question + options (no correct answer).
Answer submission: validate question currently active + within time window.
POST /v1/quizzes/push/:id/end: award Punya, emit final leaderboard.

### AI stub endpoint
POST /v1/admin/quizzes/ai-generate: enqueue ai.quiz.generate job. GET poll status.

### Mobile (match jp-design-system layouts exactly)
app/(parent|student-view)/quizzes/push/[id]/play.tsx — match screens.jsx push quiz screen.
Countdown ring in saffron. Question in ink/cream. Options as cream cards with saffron selected state.
app/(shikshak)/quizzes/push/[id]/control.tsx — match screens.jsx shikshak control screen.
Response bar chart: JPColors.success for correct, JPColors.error for incorrect.
End-of-quiz leaderboard: match preview/leaderboard.html with tier badges from tier-badges.html.

### Admin Panel
admin/questions/ai-review/page.tsx — pending AI questions with approve/reject per question.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Create push quiz, start, send question, 3 concurrent answer submissions → all recorded
- Submit answer after timer expired → 409
- End quiz → punya_transactions has entries for correct answers
- Socket.IO events captured: show quiz.started, quiz.question_next, quiz.ended events

Commit: git commit -m "feat: step 20 — quizzes (scheduled and push)"
```

---

## PROMPT 21 — AI Service & Donations

```
We are on Step 21 of the Jain Pathshala build.

Read from SPEC.md:
- Section 3.5 (AI service — FastAPI, HMAC, IP allowlist)
- Section 4.6 (apps/ai folder structure)
- Section 5.17 (Donations schemas)
- Section 6.21 (Donations endpoints)
- Section 8 (donation 80G flow)
- Section 16 (PAN encryption)
- Q3 in CLAUDE.md (80G toggleable)
- Section 19, Step 21

Read from jp-design-system/:
- jp-design-system/ui_kits/admin/screens.jsx — find donation management screens
- jp-design-system/preview/admin-forms.html — donation form design
- jp-design-system/preview/admin-stats.html — campaign progress card design

Read existing code: apps/api/src/modules/, apps/api/src/queues/processors/

Build:

### FastAPI AI service (apps/ai/)
Python 3.12, FastAPI, Pydantic v2, OpenAI SDK.
HMAC middleware: X-Signature header required, reject if mismatch.
IP allowlist middleware: AI_SERVICE_IP_ALLOWLIST env (comma-separated CIDRs).
POST /ai/quiz/generate: GPT-4o-mini, structured JSON output, POST back to NestJS /v1/questions/ai-batch.
POST /ai/moderation/image: OpenAI moderation, POST result back to NestJS.
Dockerfile in infra/docker/ for the AI service.

### NestJS AI module
POST /v1/questions/ai-batch (HMAC-verified, called by FastAPI only).
ai-quiz-generate.processor.ts: POST to FastAPI with HMAC, 60s timeout.

### Donations module
POST /v1/donations/initiate: create Razorpay order, encrypt PAN with AES-256-GCM (KMS in prod, local key in dev), create donations row status=initiated.
POST /v1/donations/webhook: verify x-razorpay-signature, idempotent (check if already processed). On payment.captured: status=completed, enqueue receipt.generate + eighty_g.cert (only if eighty_g_enabled=true AND PAN present).
Campaigns: progress shows sum of completed donations.

### donation.receipt.generate processor
Handlebars template apps/api/src/templates/donation-receipt.hbs. Puppeteer PDF. Upload to jp-{env}-receipts/donations/{id}.pdf. Email + push donor.

### donation.eightyg.cert processor (Q3 — only when eighty_g_enabled=true)
Separate template apps/api/src/templates/eighty-g-cert.hbs (formal Indian tax cert format). Upload to jp-{env}-receipts/80g/{id}.pdf.

### Platform settings
PATCH /v1/platform-settings (super_admin only): if enabling 80G, both eighty_g_registration_number AND organization_pan required. Audit logged.

### Mobile + Web donation flow (match jp-design-system layouts)
apps/web/app/[locale]/(public)/donate/page.tsx — match admin-forms.html form style.
Amount chips: ₹501, ₹1001, ₹2501, ₹5001, custom. Saffron selected state. Cream background.
Campaign progress card: match admin-stats.html with progress bar in saffron.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- curl AI service (without HMAC) → 401
- curl AI service (with valid HMAC) → quiz generation succeeds, questions appear in DB with ai_review_status=pending_review
- Donation webhook: send same payment.captured payload twice → second returns 200 with no new DB rows (idempotency)
- eighty_g_enabled=false → complete donation → only receipt enqueued, no 80G cert job
- eighty_g_enabled=true + PAN set → complete donation → both jobs enqueued

Commit: git commit -m "feat: step 21 — AI service and donations"
```

---

## PROMPT 22 — Library, Service Requests, Reports, Analytics

```
We are on Step 22 of the Jain Pathshala build.

Read from SPEC.md:
- Section 5.15, 5.16, 5.20 (services, library, student_notes/reports schemas)
- Section 6.19, 6.20, 6.25 (Service Requests, Library, Analytics endpoints)
- Section 12 in entirety (Analytics & Reporting)
- Q7 in CLAUDE.md (library videos as embed URLs — YouTube/Vimeo only, no file upload)
- Section 19, Step 22

Read from jp-design-system/:
- jp-design-system/ui_kits/admin/screens.jsx — analytics dashboard and library management screens
- jp-design-system/preview/admin-stats.html — analytics KPI cards
- jp-design-system/preview/admin-table.html — library items grid
- jp-design-system/preview/colors-tier.html — tier colour usage in charts

Read existing code: apps/api/src/modules/, apps/api/src/queues/processors/

Build:

### Library module
4 tiers: public (guest), student_parent (any enroled), msv_only (MSV-approved), shikshak_only.
Q7: type=video_embed stores embed_url (YouTube/Vimeo regex validation). asset_id forbidden for video. embed_url forbidden for non-video.
Access enforcement at service layer. Signed URLs with 1h TTL for pdf/audio/image.
library_access_logs: every view + download logged.

### Service Requests module
Assign to sanchalak if student-related, city_admin otherwise.
Escalation chain: sanchalak → city_admin → state_admin → super_admin.
Thread model: respond endpoint appends messages.

### Progress Reports module
Monthly cron: report.generation jobs for all active students (NOT deactivated — Q11).
report.generation processor: Handlebars template apps/api/src/templates/progress-report-monthly.hbs. Bilingual per parent's preferred_language. Puppeteer PDF.
Bulk export: archiver streaming ZIP via export.bulk.zip queue.
Per-student full export: complete data dump via export.student.pdf queue.

### Analytics module
Materialised views (migration 0010): mv_centre_engagement, mv_punya_distribution, mv_msv_pipeline, mv_attendance_trends, mv_niyam_completion, mv_donations_summary.
Refresh via REFRESH MATERIALIZED VIEW CONCURRENTLY (non-blocking).
Endpoints scoped + Redis cached 5min.

### Weekly digest (digest.weekly.email processor)
City admins: city metrics past week. Sanchalaks: centre metrics. React Email templates.

### Mobile + Web (match jp-design-system layouts)
apps/mobile app/(any)/library/[id].tsx: PDF inline viewer, audio HTML5, image fullscreen, video YouTube/Vimeo embed (not a native video player).
apps/web admin/analytics/page.tsx — match admin-stats.html KPI cards + Recharts charts using jp-design-system tier colours for tier distribution chart.

After writing each file, run pnpm typecheck.

Verify and show actual output:
- Non-MSV parent GET /v1/library/{msv_only_item_id} → 403
- Super_admin GET same → 200
- POST video_embed item with non-YouTube/Vimeo URL → 400 validation error
- POST video_embed with valid YouTube URL → 201, embed_url stored, asset_id null
- Materialised view refresh: REFRESH MATERIALIZED VIEW CONCURRENTLY mv_centre_engagement runs without table lock
- pnpm --filter @jp/api test:integration (library + analytics tests)

Commit: git commit -m "feat: step 22 — library, service requests, reports, analytics"
```

---

## PROMPT 23 — Hardening, Load Testing, Production Deployment

> ⚠️ Use `/plan` before pasting this prompt. This is the final and longest step.

```
We are on Step 23 — the final step of the Jain Pathshala build.

Read from SPEC.md:
- Section 15 in entirety (Testing Strategy)
- Section 16 in entirety (Security)
- Section 17 in entirety (Performance & Scaling)
- Section 18 in entirety (DevOps & Deployment)
- Section 19, Step 23

Read from jp-design-system/:
- jp-design-system/ui_kits/admin/screens.jsx — verify final admin screens match throughout
- jp-design-system/ui_kits/mobile/screens.jsx — verify final mobile screens match throughout

Read ALL existing code: do a thorough review before starting this step. Run pnpm typecheck and pnpm test first to get a baseline.

Work through each section in order:

### 1. Load tests (infra/load-tests/k6/)
auth-otp-burst.js — 10k concurrent OTP sends over 60s. SLO: p95 < 500ms, success > 99.5%
attendance-burst.js — 5k concurrent attendance writes over 60s. SLO: p95 < 1s, success > 99.9%, zero duplicates
leaderboard-reads.js — 50k concurrent leaderboard reads over 60s. SLO: p95 < 200ms, success > 99.95%
notification-fanout.js — 100 critical notices × 500 recipients = 50k pushes. SLO: 95% delivered within 30s
sync-batch.js — 1k concurrent sync/batch calls with 50 ops each. SLO: p95 < 5s, zero duplicates

infra/load-tests/scenarios/full-load-suite.sh runs all 5 scripts sequentially, collates Markdown report.

### 2. E2E test hardening

Detox (apps/mobile/e2e/):
parent-full-journey.e2e.ts — sign up → enrol → approval → niyam submission → exam → reports
shikshak-full-day.e2e.ts — login → 3 batches → attendance with offline interrupt → niyam review → homework
sanchalak-operations.e2e.ts — approve 5 enrolments → create batch → publish notice
volunteer-shivir.e2e.ts — scan 30 attendees in/out across 2 sessions with intermittent offline

Playwright (apps/web/e2e/):
public-site.spec.ts — guest browsing, donation flow (Razorpay test mode), receipt download
admin-city.spec.ts — full city_admin workflow
admin-super.spec.ts — impersonation → verify banner → both audit entries written
Each: run axe-playwright accessibility check, fail on WCAG AA violations

Integration: all 30 queues tested (enqueue → process → success path → DLQ → admin replay)

### 3. Security hardening

CI additions (.github/workflows/ci.yml):
npm audit --audit-level=high, Snyk action (SNYK_TOKEN secret), gitleaks, trufflehog

OWASP ZAP (.github/workflows/dast.yml — weekly):
zaproxy/action-baseline against staging, fail on Medium+ findings, upload report to S3

Auth security tests (apps/api/src/modules/auth/__tests__/security/):
malformed JWT, expired JWT, alg:none attack, refresh replay, rate-limit bypass attempts, OTP brute force, privilege escalation (parent → all admin endpoints = 403), IDOR (parent A → parent B's students = 403)

Security headers (via helmet):
Strict HSTS, CSP, X-Content-Type-Options, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy
CORS: explicit origins per env, no wildcard in staging/prod

### 4. Backup and DR

docs/runbooks/backup-verification.md — monthly restore drill procedure
docs/runbooks/disaster-recovery.md — RTO 4h, RPO 15min, exact failover commands, comms plan
Configure: RDS automated snapshots 30-day retention, weekly manual snapshots cross-region, S3 versioning + lifecycle, Redis RDB every 4h

### 5. Terraform IaC (infra/terraform/)
Modules: vpc, rds-postgres (primary + replica + KMS encryption), elasticache-redis (cluster + TLS), ecs-cluster, ecs-service-api, ecs-service-worker (queue-depth-based scaling), ecs-service-ai, alb, cloudfront, s3-buckets, route53, ses, secrets, monitoring
Envs: infra/terraform/envs/staging/ and /production/
ECS worker scaling: on jp_queue_depth metric > 1000 → scale out. 300s scale-in cooldown.
CloudFront: 1yr TTL for versioned assets, 5min for HTML, 0 for API. Origin shield ap-south-1.
WAF: AWS managed core rule set + rate limit 2000req/5min per IP.

### 6. Complete CI/CD (.github/workflows/)
ci.yml — lint+typecheck (10min), unit tests (15min), integration (20min), build all (15min), security scans (5min)
deploy-staging.yml — on merge to main: ECR push :staging-{sha}, Terraform apply staging, smoke tests, Slack notify
deploy-production.yml — manual trigger, 2 required approvers, blue/green ECS deployment (10%→50%→100% with 5min waits), DB migration gate (dry-run → manual approval → apply), git tag push
dast.yml — weekly on staging

### 7. Observability
Grafana dashboards: Platform Health (latency/RPS/errors), Queue Status (depth/DLQ), Database (pool/slow queries/replication lag)
PagerDuty alerts: p95 > 2s for 5min, error rate > 1% for 3min, queue depth > 10k for 5min, DLQ > 100, DB pool exhaustion, Punya reconcile >10 students drifted
docs/runbooks/ — create all 13 runbooks listed in SPEC.md Section 19 Step 23

### 8. Accessibility audit
Web: axe-playwright integrated in Playwright suite, fail on AA violations
docs/accessibility/checklist.md — manual VoiceOver + TalkBack walkthrough checklist
Verify: all jp-design-system tier + age group colours pass WCAG AA contrast ratio (4.5:1 body, 3:1 UI)

### 9. Performance budgets
Web Lighthouse: LCP < 2.5s 3G simulated, CLS < 0.1, JS bundle < 250KB gzipped public / 600KB admin
Run N+1 query audit on all endpoints with pg_stat_statements — find and fix any endpoint executing > 5 queries
Mobile: cold start < 3s on mid-range Android, APK < 50MB

### 10. App store submission prep
docs/deployment/play-store-listing.md — metadata, data safety form template, screenshot specs
docs/deployment/app-store-listing.md — metadata, privacy nutrition label template, review notes
EAS Build production profiles in apps/mobile/eas.json

### 11. Go-live checklist
docs/deployment/go-live-checklist.md — full pre-deploy checklist from SPEC.md Section 19 Step 23
infra/smoke-tests/prod-smoke.sh — automated post-deploy verification script

### 12. Handover documentation
docs/handover/final-report.md:
1. Every module built (one line each with spec section reference)
2. Lines of code per language (run: find . -name "*.ts" | xargs wc -l | tail -1)
3. Test coverage percentages
4. Load test results summary table
5. Outstanding tech debt + remediation timeline
6. All third-party services + credentials owners
7. Complete env var list with sources
8. Known limitations + deferred roadmap items

After writing each file, run the relevant verification commands.

Final verification — run ALL of these and show output:
- pnpm typecheck — must pass
- pnpm test — show overall pass rate
- pnpm test:integration — show overall pass rate
- docker compose up → pnpm db:migrate → pnpm db:seed:dev → run prod-smoke.sh against localhost
- k6 run infra/load-tests/k6/leaderboard-reads.js (fastest test) — show p95 latency
- npm audit --audit-level=high — zero high/critical vulnerabilities

Commit: git commit -m "feat: step 23 — hardening, load testing, production deployment"

Tag the release:
git tag v1.0.0 -m "Jain Pathshala v1.0 — production ready"
git push origin v1.0.0
```

---

## End of Prompts

You have **24 prompts total** — PROMPT 0 (bootstrap) plus PROMPT 1–23 mapping one-to-one to the 23 build steps in `SPEC.md` Section 19.

### Design system integration points summary

| Prompt | jp-design-system files used |
|---|---|
| 0 | DESIGN_GUIDE.md |
| 2 | tokens.json → packages/design-tokens |
| 8 | colors.ts, ui_kits/mobile/components.jsx, ui_kits/mobile/screens.jsx, preview/otp-input.html, preview/tabbar.html, preview/buttons.html |
| 9 | tailwind.config.js, tokens.css, ui_kits/admin/components.jsx, ui_kits/admin/screens.jsx, preview/admin-*.html, assets/*.svg |
| 10 | preview/admin-forms.html, preview/admin-status-badges.html, preview/admin-table.html |
| 11 | preview/id-card.html → id-card.hbs, assets/logo-mark.svg |
| 12 | preview/toast.html, ui_kits/mobile/screens.jsx |
| 13 | preview/gps-session.html, preview/attendance-badges.html, ui_kits/mobile/screens.jsx |
| 15 | ui_kits/mobile/screens.jsx (scanner), preview/admin-stats.html |
| 16 | preview/punya-card.html, preview/tier-badges.html, preview/leaderboard.html |
| 17 | ui_kits/mobile/screens.jsx (niyams), preview/admin-status-badges.html |
| 18 | preview/homework-card.html, preview/notice-cards.html, preview/admin-forms.html |
| 19 | ui_kits/mobile/screens.jsx (exam), preview/admin-forms.html |
| 20 | ui_kits/mobile/screens.jsx (quiz), preview/leaderboard.html |
| 21 | ui_kits/admin/screens.jsx, preview/admin-forms.html, preview/admin-stats.html |
| 22 | ui_kits/admin/screens.jsx, preview/admin-stats.html, preview/admin-table.html |
| 23 | Full review of both ui_kits |

### Three rules to follow throughout
1. Before building any screen → read the relevant `jp-design-system/` file first
2. After each file is written → run `pnpm typecheck`
3. After each prompt completes → `git commit -m "feat: step N — description"`

### The three business rules most likely to be missed
- **Q2:** MSV curriculum = super_admin only at service layer (not just UI hide)
- **Q5:** Niyam rejection window = 30 days hard gate with ERR_NIYAM_REVERSAL_WINDOW_EXPIRED
- **Q3:** 80G cert only generates when `platform_settings.eighty_g_enabled = true` AND donor PAN present