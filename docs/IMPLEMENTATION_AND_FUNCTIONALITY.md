# MSV Jain Pathshala — Implementation & Functionality Reference

**Document version:** 1.0  
**Last updated:** June 2026  
**Repository:** `msvjainpathshala` (pnpm monorepo)

This document describes what is implemented today across the database, API, web admin portal, public website, and mobile app. It is intended for developers, QA, and product stakeholders.

---

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [System architecture](#2-system-architecture)
3. [Local development](#3-local-development)
4. [Database layer](#4-database-layer)
5. [Authentication & authorization](#5-authentication--authorization)
6. [API server](#6-api-server)
7. [Web application (jain-pathshala)](#7-web-application-jain-pathshala)
8. [Mobile application (Expo)](#8-mobile-application-expo)
9. [Shared libraries](#9-shared-libraries)
10. [Seed data & test accounts](#10-seed-data--test-accounts)
11. [Feature implementation matrix](#11-feature-implementation-matrix)
12. [Known gaps & roadmap](#12-known-gaps--roadmap)
13. [Operational commands](#13-operational-commands)

---

## 1. Executive summary

**MSV Jain Pathshala** is a platform for managing Jain pathshala centres under the Megh Sanskar Vatika (MSV) network. It supports:

- **Public discovery** — centres, shivirs, notices, library, gallery
- **Admin operations** — students, enrolments, batches, punya, niyams, curriculum, exams, donations, analytics
- **Mobile personas** — guest, parent, student, shikshak, and admin roles on Expo
- **Phone OTP authentication** with JWT sessions (cookies on web, Bearer on mobile)

The stack is **PostgreSQL + Drizzle ORM**, **Express API**, **Vite + React** web, and **Expo Router** mobile, coordinated via a **pnpm workspace**.

---

## 2. System architecture

```mermaid
flowchart LR
  subgraph clients
    Web["Web (Vite :3000)"]
    Mobile["Mobile (Expo :8081)"]
  end
  subgraph api
    API["API Server (Express :8080)"]
  end
  subgraph data
    PG["PostgreSQL (:5434 Docker)"]
  end
  Web -->|cookies + fetch| API
  Mobile -->|Bearer + fetch| API
  API -->|Drizzle| PG
```

### Monorepo packages

| Package | Path | Purpose |
|---------|------|---------|
| `@workspace/db` | `lib/db` | Drizzle schema, migrations push, seed |
| `@workspace/api-zod` | `lib/api-zod` | Zod contracts, roles, API DTOs |
| `@workspace/api-client-react` | `lib/api-client-react` | Generated React Query hooks (Orval) |
| `@workspace/api-spec` | `lib/api-spec` | OpenAPI source for codegen |
| `@workspace/api-server` | `apps/api-server` | REST API |
| `@workspace/jain-pathshala` | `apps/jain-pathshala` | Public + admin web |
| `@workspace/jain-pathshala-mobile` | `apps/jain-pathshala-mobile` | Expo mobile app |
| `@workspace/mockup-sandbox` | `apps/mockup-sandbox` | UI component preview sandbox |

---

## 3. Local development

### Prerequisites

- Node.js 20+ with **Corepack** (`corepack enable`)
- **pnpm** (via workspace)
- **Docker** (recommended for Postgres)

### Environment (`.env`)

Copy `.env.example` to `.env`:

```env
DATABASE_URL=postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala
JP_AUTH_SECRET=jp-dev-secret-do-not-use-in-production
LOG_LEVEL=info
NODE_ENV=development
EXPO_PUBLIC_API_BASE_URL=http://localhost:8080
```

### Default ports

| Service | Port | Command |
|---------|------|---------|
| PostgreSQL (Docker `jp-postgres`) | 5434 | `docker start jp-postgres` |
| API server | 8080 | `pnpm --filter @workspace/api-server run dev` |
| Web app | 3000 | `pnpm --filter @workspace/jain-pathshala run dev` |
| Expo Metro | 8081 | `pnpm --filter @workspace/jain-pathshala-mobile run dev` |

Expo QR (both runs) — pnpm run qr wrote apps/jain-pathshala-mobile/dev-qr.html and tried to open it in the browser. Connection URL: exp://192.168.1.6:8081 (Metro must be running on port 8081 for Expo Go to connect).

Postgres credential check — None of the tested user/password pairs worked against localhost:5432 (local PostgreSQL 17). That’s expected if you’re using Docker jp-postgres on port 5434 with postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala instead.

To scan again: start Metro (pnpm --filter @workspace/jain-pathshala-mobile run dev), then run pnpm --filter @workspace/jain-pathshala-mobile run qr, or open dev-qr.html directly.
### Database setup

```powershell
$env:DATABASE_URL='postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala'
corepack pnpm --filter @workspace/db run push    # apply schema
corepack pnpm --filter @workspace/db run seed    # sample data + settings
```

Schema entry point: `lib/db/src/schema.ts` (re-exports modular files under `lib/db/src/schema/`).

---

## 4. Database layer

### Schema organization

| File | Domain |
|------|--------|
| `enums.ts` | PostgreSQL enums (roles, statuses, tiers, etc.) |
| `geography.ts` | States, cities |
| `identity.ts` | Users, device sessions, OTP codes |
| `centres.ts` | Centres, batches, holidays, assignments |
| `students.ts` | Students, enrolments, MSV enrolments, digital ID cards |
| `attendance.ts` | Sessions, attendance, cancellations |
| `punya.ts` | Features, configs, transactions, balances |
| `niyams.ts` | Niyam catalog, submissions, streaks |
| `notices.ts` | Notices, read receipts |
| `shivirs.ts` | Events, registrations, volunteers |
| `library.ts` | Library items, access logs |
| `gallery.ts` | Punya Wall gallery items |
| `settings.ts` | Key-value configuration |
| `curriculum.ts` | Curricula, sections, items |
| `exams.ts` | Online exams, attempts |
| `donations.ts` | Campaigns, donations |
| `queues.ts` | Queue stats, DLQ jobs (Postgres-backed ops monitor) |

### All tables (39)

#### Geography
| Table | Purpose |
|-------|---------|
| `states` | Indian states |
| `cities` | Cities within a state |

#### Identity
| Table | Purpose |
|-------|---------|
| `users` | Accounts (phone, role, profile, geo, centre) |
| `device_sessions` | Refresh-token sessions per device |
| `otp_codes` | Hashed OTP for phone login |

#### Centres
| Table | Purpose |
|-------|---------|
| `centres` | Pathshala locations |
| `batches` | Class groups (schedule, capacity, shikshak) |
| `centre_holidays` | Closure dates |
| `sanchalak_centre_assignments` | Sanchalak ↔ centre |
| `shikshak_batch_assignments` | Shikshak ↔ batch |

#### Students
| Table | Purpose |
|-------|---------|
| `students` | Student records |
| `enrolments` | Batch admission workflow |
| `msv_enrolments` | MSV programme applications |
| `digital_id_cards` | QR student ID tokens |

#### Attendance
| Table | Purpose |
|-------|---------|
| `sessions` | Scheduled batch sessions |
| `attendance` | Per-student session attendance |
| `session_cancellations` | Cancelled sessions |

#### Punya
| Table | Purpose |
|-------|---------|
| `punya_features` | Named point-earning features |
| `punya_configs` | Points per feature key |
| `punya_transactions` | Awards/deductions |
| `punya_balances` | Running total + tier |

#### Niyams
| Table | Purpose |
|-------|---------|
| `niyams` | Rule catalog (bilingual) |
| `niyam_submissions` | Student submissions |
| `niyam_streaks` | Streak tracking |

#### Content & comms
| Table | Purpose |
|-------|---------|
| `notices` | Scoped announcements |
| `notice_reads` | Read receipts |
| `shivir_events` | Camps/events |
| `shivir_registrations` | Event registrations |
| `shivir_volunteers` | Volunteer assignments |
| `library_items` | Published media |
| `library_access_logs` | Access audit |
| `gallery_items` | Featured Punya Wall entries |

#### Programme extensions
| Table | Purpose |
|-------|---------|
| `curricula` | City-scoped curricula |
| `curriculum_sections` | Ordered sections |
| `curriculum_items` | Ordered bilingual items |
| `online_exams` | Timed exams, OTP, results flag |
| `exam_attempts` | Student attempts/scores |
| `donation_campaigns` | Fundraising campaigns |
| `donations` | Donation records (paise, 80G) |

#### System
| Table | Purpose |
|-------|---------|
| `settings` | App configuration (e.g. dev OTP) |
| `queue_stats` | Queue depth snapshots |
| `queue_dlq_jobs` | Dead-letter jobs for replay |

---

## 5. Authentication & authorization

### Login flow (phone OTP)

1. **Send:** `POST /api/auth/login` with `{ phase: "send", phone: "+91..." }`  
   → Returns `otp_token`, `expires_in_seconds` (dev seed exposes fixed OTP via settings).
2. **Verify:** `POST /api/auth/login` with `{ phase: "verify", otp_token, code, device_id }`  
   → Returns `user` + `tokens`; sets `jp_access` / `jp_refresh` cookies (web).
3. **Refresh:** `POST /api/auth/refresh` (cookie or body).
4. **Session:** `GET /api/auth/me` — current user.
5. **Logout:** `POST` or `DELETE /api/auth/logout`.

### Roles

| Role | Admin panel | Typical use |
|------|-------------|-------------|
| `super_admin` | Yes | Full network + queues |
| `state_admin` | Yes | State-wide |
| `city_admin` | Yes | City programmes, curriculum, exams |
| `sanchalak` | Yes | Centre operations |
| `shikshak` | Yes | Teaching, attendance, punya award |
| `parent` | No | Child progress (mobile) |
| `student` | No | Own punya/niyams (mobile) |
| `guest` | No | Public browse |

### Middleware (`apps/api-server/src/middlewares/auth.ts`)

| Middleware | Effect |
|------------|--------|
| `requireAuth` | Valid JWT from `Authorization: Bearer` or `jp_access` cookie |
| `requireAdminPanel` | Role in admin panel list |
| `requireRole(...)` | Explicit role allow-list (e.g. `super_admin` for queues) |

### Data scoping

- **Centre scope:** `resolveAdminScope(user)` — filters students, batches, enrolments, gallery, etc.
- **City scope:** `cityIdsForUser` — filters curricula, exams, donations.

---

## 6. API server

**Base URL (local):** `http://localhost:8080`  
**Mount tree:** `/api/*`, `/v1/*`

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/healthz` | Public | Liveness `{ status: "ok" }` |

### Auth (`/api/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | OTP send or verify |
| POST | `/api/auth/refresh` | Rotate tokens |
| GET | `/api/auth/me` | Current session |
| POST/DELETE | `/api/auth/logout` | Revoke session |

### Public (`/v1/public`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/public/centres` | Active centres + batch counts |
| GET | `/v1/public/centres/:id` | Centre detail + batches |
| GET | `/v1/public/shivirs` | Published upcoming shivirs |
| GET | `/v1/public/shivirs/:id` | Shivir detail |
| GET | `/v1/public/library` | Public-tier library (`?limit=`) |

### Notices & gallery

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/notices/public` | Public notices |
| GET | `/v1/gallery/` | Public Punya Wall feed |

### Mobile persona (`/v1/me`) — requires auth

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/me/children` | Linked students |
| GET | `/v1/me/students/:id/attendance` | Attendance history (ownership check) |
| GET | `/v1/me/students/:id/punya` | Balance + transactions |
| GET | `/v1/me/students/:id/niyams` | Submissions |
| GET | `/v1/me/niyam-catalog` | Active niyam definitions |
| GET | `/v1/me/today` | Shikshak’s recent sessions |

### Admin core (`/v1/admin`) — admin panel + scope

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/admin/analytics/overview` | Dashboard KPIs |
| GET | `/v1/admin/students` | Students in scope |
| POST | `/v1/admin/students/:id/status` | Activate/deactivate |
| GET | `/v1/admin/batches` | Batches in scope |
| POST | `/v1/admin/batches/:id/:action` | `activate` \| `deactivate` |
| GET | `/v1/admin/enrolments` | Enrolments (`?status=`, `?limit=`) |
| POST | `/v1/admin/enrolments/:id/:action` | `approve` \| `waitlist` \| `reject` |

### Admin resources (read + selected writes)

| Method | Path | Writes |
|--------|------|--------|
| GET | `/v1/admin/centres` | — |
| GET | `/v1/admin/notices` | — |
| GET | `/v1/admin/gallery` | POST feature/unfeature |
| GET | `/v1/admin/library` | — |
| GET | `/v1/admin/shivirs` | — |
| GET | `/v1/admin/niyams` | — |
| GET | `/v1/admin/niyam-submissions` | — |
| GET | `/v1/admin/punya/configs` | — |
| GET | `/v1/admin/punya/transactions` | POST `/punya/award` |
| GET | `/v1/admin/shikshaks` | — |
| GET | `/v1/admin/msv-enrolments` | — |
| GET | `/v1/admin/holidays` | — |
| GET | `/v1/admin/sessions` | — |
| GET | `/v1/admin/geography` | — |
| GET | `/v1/admin/settings` | — |

### Admin modules (curriculum, exams, donations, queues)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/admin/curricula` | City-scoped (`?kind=`) |
| GET | `/v1/admin/curricula/:id/tree` | Sections + items |
| GET | `/v1/admin/exams` | City-scoped |
| POST | `/v1/admin/exams/:id/release-results` | Release results |
| GET | `/v1/admin/exams/:id/attempts` | Attempt list |
| GET | `/v1/admin/donations/campaigns` | Campaigns |
| GET | `/v1/admin/donations` | Donation rows |
| GET | `/v1/admin/queues/stats` | **super_admin only** |
| GET | `/v1/admin/queues/:queueName/dlq` | DLQ list |
| POST | `/v1/admin/queues/:queueName/dlq/:jobId/replay` | Replay job |

### Response envelope

Success: `{ data: T, meta?: {} }`  
Error: `{ error: { code, message, details? } }`

Contracts: `lib/api-zod/src/contracts.ts`

---

## 7. Web application (jain-pathshala)

**Stack:** Vite, React 19, Wouter, Tailwind 4, shadcn/ui  
**Auth:** Cookie session (`credentials: 'include'`)  
**i18n:** English / Hindi on public pages (`LocaleProvider`)

### Public routes (`PublicLayout`)

| Route | Status | Description |
|-------|--------|-------------|
| `/` | Live | Home, mission, stats (static) |
| `/centres`, `/centres/:id` | Live | API-backed centre directory |
| `/shivirs`, `/shivirs/:id` | Live | Shivir listings |
| `/notices` | Live | Public notices |
| `/library` | Live | Public library |
| `/gallery` | Live | Punya Wall |
| `/about`, `/contact`, `/donate`, `/enquire`, `/msv` | **Stub** | Static `PageStub` content |

### Admin routes (`AdminLayout`)

Requires admin role (`canAccessAdminPanel`). Sidebar filtered by `ADMIN_NAV` + role precedence.

| Route | Status | Key actions |
|-------|--------|-------------|
| `/admin/login` | Live | Phone OTP |
| `/admin` | Live | Dashboard KPIs + pending enrolments |
| `/admin/analytics` | Live | Full metrics grid |
| `/admin/students` | Live | List, activate/deactivate |
| `/admin/enrolments` | Live | Filter, approve/waitlist/reject |
| `/admin/batches` | Live | Activate/deactivate |
| `/admin/msv-enrolments` | Read-only list | — |
| `/admin/shikshaks` | Read-only list | — |
| `/admin/curriculum` | Live | List + expandable tree |
| `/admin/exams` | Live | List + release results |
| `/admin/niyams` | Read-only list | — |
| `/admin/shivirs` | Read-only list | — |
| `/admin/punya/manual-award` | Live | Award form |
| `/admin/punya/configs` | Read-only list | — |
| `/admin/punya/audit` | Read-only list | — |
| `/admin/centres` | Read-only list | — |
| `/admin/holidays` | Read-only list | — |
| `/admin/notices` | Read-only list | — |
| `/admin/gallery` | Live | Feature / unfeature |
| `/admin/library` | Read-only list | — |
| `/admin/donations` | Read-only | Campaigns + donations tables |
| `/admin/service-requests` | Read-only | Recent sessions (labelled service requests) |
| `/admin/reports` | Read-only | Session attendance report |
| `/admin/audit` | Read-only | Punya transaction log |
| `/admin/geography` | Read-only | States + cities |
| `/admin/settings` | Read-only | Config keys |
| `/admin/queues` | Live | Stats + DLQ replay (**super_admin**) |

### Web integration patterns

- **Admin:** `src/lib/api-client.ts` — `apiGet` / `apiPost`, unwraps `{ data }`
- **Lists:** `useAdminList(path)` hook — `useEffect` + reload (not React Query yet)
- **Public:** Raw `fetch` to `/v1/public/*` and `/v1/notices/public`

### Admin minimum roles (sidebar)

Defined in `src/components/admin/sidebar-nav.ts` — e.g. enrolments require `sanchalak`, curriculum `city_admin`, queues `super_admin`.

---

## 8. Mobile application (Expo)

**Package:** `@workspace/jain-pathshala-mobile`  
**Router:** Expo Router file-based  
**State:** TanStack React Query (`lib/queries.ts`)  
**Auth:** Bearer token from OTP verify; `EXPO_PUBLIC_API_BASE_URL`

### Persona routing

| Role(s) | Home after login |
|---------|------------------|
| `parent` | `/parent/home` |
| `student` | `/student/home` |
| `shikshak` | `/shikshak/today` |
| `super_admin` … `sanchalak` | `/admin/dashboard` |
| Unauthenticated | `/guest/centres` |

### Guest tabs

Centres, Shivirs, Library, Notices, More (gallery, info, sign-in)

### Parent tabs

Home (attendance + punya), Children, Niyams, Library, Profile

### Student tabs

Home, Punya, Niyams, Library, Profile

### Shikshak tabs

Today (sessions), Students, Batches, Niyams (catalog), Profile

### Admin tabs (mobile)

Dashboard, Students, Enrolments, Batches, Profile — with approve/reject and status actions

### Shared stack screens

`centre/[id]`, `shivir/[id]`, `gallery`, `info/[slug]` (static MSV/about/contact/donate/enquire)

### Mobile API coverage

| Feature | API used | Notes |
|---------|----------|-------|
| OTP login | `/api/auth/login` | Full |
| Public browse | `/v1/public/*`, notices, gallery | Full |
| Parent/student data | `/v1/me/*` | Read-only |
| Admin KPIs & actions | `/v1/admin/*` | Subset of web admin |
| Curriculum / exams / donations | — | **Not wired** |
| Niyam submit / attendance mark | — | **Not wired** |
| Shivir registration | — | **Not wired** |

### Dev helpers

- `pnpm run dev` — Metro with QR helper (`scripts/dev.mjs`)
- `pnpm run qr` — Print URL + open `dev-qr.html`

---

## 9. Shared libraries

| Library | Responsibility |
|---------|----------------|
| `@workspace/db` | Drizzle schema, `db` client, `push`, `seed` |
| `@workspace/api-zod` | Zod schemas, `Role`, `canAccessAdminPanel`, admin DTOs |
| `@workspace/api-spec` | OpenAPI for Orval codegen |
| `@workspace/api-client-react` | Generated hooks (optional; web uses hand-rolled client today) |

---

## 10. Seed data & test accounts

Run: `pnpm --filter @workspace/db run seed`

**Dev OTP:** `123456` for all users (from `settings` table).

| Role | Phone |
|------|-------|
| super_admin | +919800000001 |
| state_admin | +919800000002 |
| city_admin | +919800000003 |
| sanchalak | +919800000004 |
| shikshak | +919800000005 |
| parent | +919800000006 |
| student | +919800000007 |

Seed includes: geography, centres, batches, students, enrolments, sessions/attendance, punya, niyams, notices, shivirs, library, gallery, curriculum tree, sample exams, donation campaigns, queue stats/DLQ.

---

## 11. Feature implementation matrix

| Domain | DB | API read | API write | Web admin | Web public | Mobile |
|--------|:--:|:--------:|:---------:|:---------:|:----------:|:------:|
| Auth / OTP | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| Centres / batches | ✅ | ✅ | Partial | Partial | ✅ | Partial |
| Students / enrolments | ✅ | ✅ | ✅ | ✅ | — | Partial |
| Attendance / sessions | ✅ | ✅ | — | Read-only | — | Read-only |
| Punya | ✅ | ✅ | Award | Partial | — | Read |
| Niyams | ✅ | ✅ | — | Read | — | Read |
| Notices | ✅ | ✅ | — | Read | ✅ | ✅ |
| Library | ✅ | ✅ | — | Read | ✅ | ✅ |
| Gallery | ✅ | ✅ | Feature | ✅ | ✅ | ✅ |
| Shivirs | ✅ | ✅ | — | Read | ✅ | Read |
| MSV enrolments | ✅ | ✅ | — | Read | Stub | — |
| Curriculum | ✅ | ✅ | — | Read + tree | — | — |
| Online exams | ✅ | ✅ | Release results | Partial | — | — |
| Donations | ✅ | ✅ | — | Read | Stub | Stub info |
| Queues / DLQ | ✅ | ✅ | Replay | ✅ (super) | — | — |
| Geography / settings | ✅ | ✅ | — | Read | — | — |
| Donate / contact flows | — | — | — | — | Stub | Static |

**Legend:** ✅ implemented end-to-end for primary use case · Partial = list + some actions · Read = list/view only · Stub = placeholder UI · — = not applicable

---

## 12. Known gaps & roadmap

### API gaps (no routes yet)

- CRUD for centres, batches, notices, library items, shivirs, niyams (create/edit/delete)
- Niyam submission approve/reject from admin API
- Attendance marking (shikshak session take)
- Shivir registration from mobile
- Student/parent niyam submission POST
- Donation payment integration (Razorpay/Stripe)
- Settings update (PATCH)
- MSV enrolment approve/reject
- Impersonation API (web has cookie banner only)

### Web gaps

- Public About, Contact, Donate, Enquire, MSV pages are stubs
- Most admin pages are **list-only** (no create/edit forms)
- React Query configured but unused — migrate from `useAdminList` for caching
- Admin search bar is non-functional (UI only)

### Mobile gaps

- No curriculum, exams, or donation flows
- No niyam submission or attendance marking
- Shikshak uses admin student/batch endpoints (works but not ideal separation)

### Infrastructure

- Production deployment runbooks live in `.migration-backup/` (legacy); current repo uses Docker Postgres for dev only
- No Redis — queue monitor is Postgres-backed for ops visibility

---

## 13. Operational commands

```powershell
# Install
corepack pnpm install

# Typecheck entire monorepo
corepack pnpm run typecheck

# Database
docker start jp-postgres
$env:DATABASE_URL='postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala'
corepack pnpm --filter @workspace/db run push
corepack pnpm --filter @workspace/db run seed

# Services
corepack pnpm --filter @workspace/api-server run dev
corepack pnpm --filter @workspace/jain-pathshala run dev
corepack pnpm --filter @workspace/jain-pathshala-mobile run dev
```

### Key file paths

| Area | Path |
|------|------|
| Drizzle schema entry | `lib/db/src/schema.ts` |
| Drizzle config | `lib/db/drizzle.config.ts` |
| Seed | `lib/db/src/seed.ts` |
| API app | `apps/api-server/src/app.ts` |
| Admin routes | `apps/api-server/src/routes/v1/admin*.ts` |
| API contracts | `lib/api-zod/src/contracts.ts` |
| Web routes | `apps/jain-pathshala/src/App.tsx` |
| Admin pages | `apps/jain-pathshala/src/pages/admin/` |
| Mobile routes | `apps/jain-pathshala-mobile/app/` |

---

## Document maintenance

When adding features:

1. Add/update Drizzle tables under `lib/db/src/schema/`, export from `schema/index.ts`.
2. Run `pnpm --filter @workspace/db run push` and update seed if needed.
3. Add Zod contracts in `lib/api-zod` and API routes under `apps/api-server`.
4. Wire web (`apps/jain-pathshala`) and/or mobile (`apps/jain-pathshala-mobile`).
5. Update this document’s [Feature matrix](#11-feature-implementation-matrix) and [Known gaps](#12-known-gaps--roadmap).

---

*MSV Jain Pathshala — Enaa Creations*
