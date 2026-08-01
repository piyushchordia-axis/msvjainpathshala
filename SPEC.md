# JAIN PATHSHALA — MEGH SANSKAR VATIKA
## Production-Grade Implementation Prompt for Replit Agent
### Single-Cycle Full Build | v1.0 | Enaa Creations

---

> **AGENT INSTRUCTIONS (READ FIRST)**
>
> You are building a **production-grade, scalable, multi-tenant SaaS platform** — NOT a prototype, NOT an MVP, NOT a demo.
>
> Build **every module, every endpoint, every queue, every worker, every migration, every test scaffold** described below in a **single production cycle**. Do not split into phases. Do not defer features. Do not summarize.
>
> A separate **design system is already wired into the project** (Tailwind tokens + shadcn primitives for web; a styled-components / restyle theme for mobile). DO NOT define colors, typography, spacing, shadows, or any visual tokens. Reference the placeholders below wherever a component is needed:
>
> `[PRIMARY_BUTTON]`, `[SECONDARY_BUTTON]`, `[DESTRUCTIVE_BUTTON]`, `[GHOST_BUTTON]`, `[ICON_BUTTON]`,
> `[CARD_COMPONENT]`, `[MODAL_COMPONENT]`, `[DRAWER_COMPONENT]`, `[SHEET_COMPONENT]`,
> `[INPUT_COMPONENT]`, `[TEXTAREA_COMPONENT]`, `[SELECT_COMPONENT]`, `[MULTISELECT_COMPONENT]`, `[DATEPICKER_COMPONENT]`, `[FILE_UPLOAD_COMPONENT]`, `[OTP_INPUT_COMPONENT]`,
> `[TYPOGRAPHY_DISPLAY]`, `[TYPOGRAPHY_H1]`, `[TYPOGRAPHY_H2]`, `[TYPOGRAPHY_H3]`, `[TYPOGRAPHY_BODY]`, `[TYPOGRAPHY_CAPTION]`, `[TYPOGRAPHY_LABEL]`,
> `[SUCCESS_COLOR]`, `[ERROR_COLOR]`, `[WARNING_COLOR]`, `[INFO_COLOR]`, `[PRIMARY_COLOR]`, `[ACCENT_COLOR]`, `[NEUTRAL_COLOR]`,
> `[BADGE_COMPONENT]`, `[AVATAR_COMPONENT]`, `[TOAST_COMPONENT]`, `[SKELETON_COMPONENT]`, `[EMPTY_STATE_COMPONENT]`, `[TABLE_COMPONENT]`, `[TABS_COMPONENT]`, `[ACCORDION_COMPONENT]`.
>
> Wire functionality, layout, state, and accessibility — but every visual choice resolves to a placeholder.

---

# 1. PROJECT OVERVIEW

### 1.1 App Identity
- **Product Name:** Jain Pathshala
- **Programme Banner:** Megh Sanskar Vatika (MSV)
- **Vendor:** Enaa Creations
- **Surfaces:** Android app, iOS app, Public Website, Web Admin Panel
- **Tagline:** Digitising Jain religious education centres across India.

### 1.2 Business Goal
A unified operations and engagement platform for a multi-city network of free Jain religious education centres. The platform digitises enrolment, attendance, curriculum, spiritual gamification (Punya), tasks (Niyams), camps (Shivirs), exams, donations, and library distribution under one hierarchy (National → State → City → Centre → Batch → Student).

### 1.3 Target Users (8 Roles)
1. `super_admin` — National authority. Manages everything.
2. `state_admin` — State-level oversight.
3. `city_admin` — City-level operations.
4. `sanchalak` — Centre Head (one or more centres).
5. `shikshak` — Teacher (display: Guruji / Didi). One or more batches.
6. `parent` — Parent / Abhivaavak. One or more children.
7. `student` — Aged 13+. Accessed via toggle on parent's account (NOT a separate login).
8. `guest` — Unauthenticated public.

### 1.4 Platform Scope

| Surface | Stack | Audience |
|---|---|---|
| Mobile App | Expo / React Native | All authenticated roles + Guests |
| Public Website | Next.js (SSR) | Guests + SEO + Public Notices |
| Admin Panel | Next.js (App Router, protected) | Sanchalak and above |
| Backend API | NestJS modular monolith | All clients |
| AI Service | Python FastAPI | Backend-only (server-to-server) |

### 1.5 Major Modules
1. Authentication & RBAC (OTP, JWT, role auto-detection, student-view toggle)
2. Centre & Batch Management
3. Dynamic Registration Forms (Student, Shikshak, Sanchalak)
4. Digital ID Cards (QR + PNG generation)
5. Attendance & GPS Sessions (offline-first)
6. Punya Points Engine (transactions + tiers + leaderboards)
7. Niyams (Tasks) — auto-approve, retroactive rejection, streaks
8. Gallery (blanket parent consent)
9. Homework
10. Notices (bilingual, with SMS fallback for critical)
11. Shivirs (volunteer scanner, live attendance dashboard)
12. Competitions
13. Curriculum (Standard + MSV centrally-managed track)
14. Online Exams (OTP-gated, auto + manual grading)
15. Quiz System (scheduled events + push quizzes + AI generation)
16. Service Requests
17. Library / Resources (4 access tiers, YouTube/Vimeo embeds)
18. Donations (Razorpay + configurable 80G certificates)
19. MSV Programme Track (parallel layer)
20. Analytics, Reports, Audit Logs, Per-Student PDF Export
21. Birthday Wishes & Progress Reports (automated)
22. Bilingual Content (EN/HI) — pervasive
23. Notifications (Push + In-app + SMS fallback)
24. Public Website (12 pages)
25. AI Service (quiz gen, moderation, report summarisation)

### 1.6 Scalability Expectations
- **Initial:** 100,000 active users across 5–10 cities.
- **Year 2:** 500,000+ users, multi-city nationwide.
- **Notifications:** Millions/year. Peak fanout: 20,000 parents in a single critical notice.
- **Media:** Niyam photos/videos at scale — designed for tens of thousands of uploads/day.
- **Leaderboards:** Real-time-ish (≤60s lag) across batch / centre / city / MSV scopes.
- **Attendance:** Spiky load every Saturday/Sunday morning (95% of sessions).

### 1.7 Multi-Tenant Considerations
- **Single logical tenant** (one MSV network). City is the primary scoping unit. Every query that returns lists must enforce `city_id` scope based on the actor's role.
- **Tenant isolation enforced at repository layer** via a `ScopedQueryBuilder` that takes an `ActorContext` (user_id, role, city_id, centre_id[]).
- **Row-Level scoping rules** are encoded once in `src/common/access/scope-rules.ts` and applied uniformly.

### 1.8 Offline Requirements
**Mandatory offline-first features:**
- Attendance marking by Shikshak (full session worth of marks must work offline)
- GPS check-in/check-out queue (capture coords, sync later)
- Shivir QR scanning by volunteers
- Notice reading (last 50 notices cached)
- ID card display (PNG cached locally)
- Homework viewing
- Niyam viewing & photo capture (upload queued)

### 1.9 Realtime Requirements
- Shivir live attendance dashboard (volunteer scans → admin sees instantly)
- Push quiz lifecycle (Shikshak posts → student banner appears)
- Notice broadcast
- Service request status changes

---

# 2. SYSTEM ARCHITECTURE

### 2.1 High-Level Topology

```
                          ┌────────────────────────────┐
                          │   Cloudflare / CloudFront  │
                          │   (CDN + WAF + DDoS)       │
                          └──────────┬─────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        │                            │                            │
┌───────▼────────┐         ┌─────────▼────────┐         ┌─────────▼────────┐
│  Mobile App    │         │  Public Website  │         │  Admin Panel     │
│  (Expo / RN)   │         │   (Next.js SSR)  │         │   (Next.js)      │
└───────┬────────┘         └─────────┬────────┘         └─────────┬────────┘
        │                            │                            │
        │      HTTPS / JWT           │                            │
        └────────────────────────────┼────────────────────────────┘
                                     │
                          ┌──────────▼──────────────┐
                          │  Application Load       │
                          │  Balancer (AWS ALB)     │
                          └──────────┬──────────────┘
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                  │                  │
         ┌────────▼───────┐  ┌───────▼────────┐ ┌───────▼────────┐
         │  API Node 1    │  │  API Node 2    │ │  API Node N    │
         │  (NestJS)      │  │  (NestJS)      │ │  (NestJS)      │
         │  ECS Fargate   │  │  ECS Fargate   │ │  ECS Fargate   │
         └────────┬───────┘  └───────┬────────┘ └───────┬────────┘
                  │                  │                  │
                  └──────────────────┼──────────────────┘
                                     │
        ┌───────────────┬────────────┼────────────┬────────────────┐
        │               │            │            │                │
   ┌────▼─────┐  ┌──────▼─────┐ ┌────▼─────┐ ┌────▼──────┐ ┌───────▼────┐
   │ Postgres │  │   Redis    │ │ BullMQ   │ │ S3 / R2   │ │  AI Svc    │
   │  (RDS)   │  │ (Elasti-   │ │ Workers  │ │  Media    │ │ (FastAPI)  │
   │ Primary  │  │  Cache)    │ │ (ECS)    │ │           │ │            │
   │ + Read   │  │            │ │          │ │           │ │            │
   │ Replicas │  │            │ │          │ │           │ │            │
   └──────────┘  └────────────┘ └────┬─────┘ └───────────┘ └────────────┘
                                     │
              ┌──────────────────────┼─────────────────────┐
              │                      │                     │
       ┌──────▼──────┐       ┌───────▼────────┐    ┌───────▼────────┐
       │ FCM Push    │       │  MSG91 SMS     │    │  Razorpay      │
       │ (Firebase)  │       │                │    │  Payments      │
       └─────────────┘       └────────────────┘    └────────────────┘
```

### 2.2 Service / Module Boundaries (Modular Monolith)

The backend is a **modular monolith**. Each domain module is a self-contained NestJS module with controllers, services, repositories, DTOs, events, and queue workers. Modules communicate via **typed event bus** (EventEmitter2) — never via direct service-to-service imports across module boundaries.

**Module boundary rule:** A module may import only from `common/`, `infra/`, and event payload types of other modules. Cross-module data is fetched via the receiver's exposed `*.facade.ts` (a thin read-only public surface) — never via repository imports.

**Future microservice extraction candidates** (mark with `@ExtractCandidate` comment on the module class):
- `notifications` (push + sms + email fan-out)
- `ai-service` (already extracted as Python FastAPI)
- `media` (S3 signed URLs + processing)
- `reports` (PDF generation + analytics aggregation)

### 2.3 Auth Flow

```
Mobile/Web Client
      │
      │ POST /v1/auth/otp/request  { phone }
      ▼
NestJS AuthController
      │
      ├─► AuthService.requestOtp()
      │       │
      │       ├─► RateLimiter (Redis: otp:req:{phone}) → 3/hr, 10/day
      │       ├─► Generate 6-digit OTP
      │       ├─► Redis SETEX otp:{phone} = hash, ttl 5min
      │       └─► Queue: SmsQueue.sendOtp(phone, otp)
      │
      ▼
Client enters OTP
      │
      │ POST /v1/auth/otp/verify  { phone, otp, device_id }
      ▼
AuthService.verifyOtp()
      │
      ├─► Validate otp hash vs Redis
      ├─► Look up user by phone → resolve role
      ├─► Issue JWT access (15min) + refresh (30d)
      ├─► Persist device_sessions row (device_id, refresh_hash)
      └─► Return { access, refresh, role, user, msv_flag, student_view_eligible }
```

### 2.4 Offline Sync Flow (Attendance Example)

```
Shikshak marks attendance offline
      │
      ▼
MMKV writes to local table: pending_attendance
   { submission_op_id (char26 ULID), marks: [{ student_id, status, client_op_id (char26) }], marked_at, created_at }
      │
      ▼
Device comes online → SyncEngine wakes up
      │
      ├─► POST /v1/sync/batch  { ops: [pending_attendance...] }
      │   (idempotent — server keyed on submission_op_id; AT19)
      │
      ▼
SyncController → SyncService.applyOps()
      │
      ├─► For each op: lookup submission_op_id in sync_operations table
      │       └─ if exists → return its prior result (idempotent replay)
      │       └─ if new → execute in DB transaction; persist result
      │
      └─► Returns per-op { submission_op_id, status, server_id, error? }
      │
      ▼
Client clears successful ops from MMKV pending queue
```

### 2.5 Notification Fanout Flow

```
Domain event emitted (e.g. notice.created)
      │
      ▼
NotificationsListener handles event
      │
      ├─► Resolves recipients (e.g. all parents of batch)
      ├─► For each recipient → enqueue NotificationsQueue.deliver
      │     (one job per recipient = per-recipient retry isolation)
      │
      ▼
NotificationsWorker
      │
      ├─► Persist row in notifications table
      ├─► Look up active device_tokens
      ├─► FCM batch send (chunks of 500)
      ├─► On critical + send_sms flag → enqueue SmsQueue.sendBroadcast
      └─► Update notification.delivery_status
```

### 2.6 Media Upload Flow

```
Client (Niyam photo upload)
      │
      │ POST /v1/media/sign-upload  { kind: "niyam_proof", mime, size }
      ▼
MediaController.signUpload()
      │
      ├─► Validate: mime allowlist, size <= 25MB (photo) or 100MB (video)
      ├─► Generate S3 key: {kind}/{yyyy}/{mm}/{user_id}/{uuid}.{ext}
      ├─► Generate presigned PUT URL (5 min TTL)
      └─► Return { upload_url, s3_key, asset_id }
      │
      ▼
Client uploads directly to S3
      │
      ▼
POST /v1/media/finalize  { asset_id, s3_key, checksum }
      │
      ├─► Persist media_assets row, status=uploaded
      └─► Enqueue MediaProcessingQueue.process(asset_id)
            │
            ▼
      MediaWorker
            ├─► Verify file exists in S3, size matches
            ├─► Generate thumbnails (sharp)
            ├─► EXIF strip (privacy)
            ├─► Optional: NSFW scan via AI service
            ├─► Persist thumbnails to S3
            └─► Update media_assets.status=ready, expose URLs
```

---

# 3. COMPLETE TECH STACK

### 3.1 Mobile (Expo / React Native)

| Concern | Choice | Notes |
|---|---|---|
| Framework | Expo SDK 54+ | Bare-managed; EAS Build |
| Router | Expo Router v6 | File-based; typed routes |
| Language | TypeScript strict | `"strict": true` everywhere |
| Global state | Zustand | One store per domain (`useAttendanceStore`, `usePunyaStore`, etc.) |
| API state | TanStack Query v5 | Persisted to MMKV (offline cache) |
| Forms | React Hook Form + Zod | Shared zod schemas from `@jp/shared` |
| Local storage | MMKV | Fast, sync access for sync-engine |
| Notifications | expo-notifications + FCM | Background handler registered |
| Camera | expo-camera | Niyam capture + QR scan |
| QR Scan | expo-barcode-scanner | Shivir volunteer flow |
| Location | expo-location | GPS check-in/out |
| Maps | react-native-maps | Centre locator |
| Media playback | expo-av | Audio library, video embeds via webview |
| i18n | i18next + react-i18next | EN/HI |
| Animations | react-native-reanimated v3 | Tier celebrations, transitions |
| SVG | react-native-svg | ID card render, badges |
| PDF rendering | react-native-pdf | Progress reports |
| File system | expo-file-system | Downloaded reports / ID cards |
| Push native | @react-native-firebase/messaging | Production FCM |
| Sentry | @sentry/react-native | Crash + perf monitoring |

### 3.2 Web (Next.js)

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 15+ (App Router) | RSC where applicable |
| Language | TypeScript strict | |
| API state | TanStack Query v5 | |
| Global state | Zustand | |
| Forms | React Hook Form + Zod | |
| Styling | TailwindCSS + shadcn/ui | Design system tokens pre-wired |
| i18n | next-intl | EN/HI, route-based locale |
| Charts | Recharts | Admin analytics |
| Animations | Framer Motion | |
| Auth | iron-session (httpOnly) + JWT to API | |
| Tables | TanStack Table v8 | Admin data grids |
| Date | date-fns | |
| Sentry | @sentry/nextjs | |

### 3.3 Backend (NestJS)

| Concern | Choice | Notes |
|---|---|---|
| Framework | NestJS 10+ | Modular monolith |
| Language | TypeScript strict | |
| ORM | Drizzle ORM | Postgres dialect |
| DB | PostgreSQL 16 (RDS) | Primary + 2 read replicas |
| Cache / OTP / Rate limit | Redis 7 (ElastiCache) | |
| Queue | BullMQ | Redis-backed |
| Auth | Custom JWT (access + refresh) | RS256, key rotation |
| Validation | class-validator + class-transformer | DTOs |
| Docs | Swagger / OpenAPI | `/v1/docs` (internal-only behind auth) |
| Realtime | Socket.IO | `socket.io-redis-adapter` for multi-node |
| Scheduling | `@nestjs/schedule` + BullMQ repeatable | |
| Logging | Pino + nestjs-pino | JSON structured |
| Observability | OpenTelemetry → Grafana / Loki / Tempo | |
| Errors | Sentry SDK | |
| Mailer | Resend SDK | Receipts, reports |
| SMS | MSG91 REST | OTP + critical notices |
| Push | firebase-admin | FCM v1 API |
| Payments | Razorpay Node SDK | Webhooks verified |
| PDF | Puppeteer (headless Chromium) | ID cards, reports, 80G certs |
| QR | `qrcode` npm | |
| File upload | AWS SDK v3 (S3) | Presigned URLs |
| Image processing | sharp | Thumbnails |
| Rate limit | `@nestjs/throttler` + custom Redis | |
| Health | `@nestjs/terminus` | `/healthz`, `/readyz` |

### 3.4 Infrastructure

| Layer | Choice |
|---|---|
| Container runtime | Docker |
| Compute | AWS ECS Fargate (api, workers, ai-service) |
| Load balancer | AWS ALB |
| DB | AWS RDS PostgreSQL Multi-AZ |
| Cache | AWS ElastiCache Redis (cluster mode) |
| Object storage | Cloudflare R2 (primary), AWS S3 (DR backup) |
| CDN | CloudFront |
| DNS | Route53 |
| Secrets | AWS Secrets Manager |
| CI/CD | GitHub Actions → ECR → ECS deploy |
| Monitoring | Sentry (errors) + Grafana/Loki (logs) + Grafana/Tempo (traces) |
| SSL | ACM (cert auto-renewal) |
| WAF | CloudFront + AWS WAF managed rules |
| Backups | RDS automated snapshots (35-day retention), R2 versioning |

### 3.5 AI / ML Service (Python FastAPI)

| Concern | Choice |
|---|---|
| Framework | FastAPI |
| LLM | OpenAI GPT-4o-mini for generation; GPT-4o for moderation |
| Queue link | Redis (shared) — BullMQ jobs trigger jobs into a Redis stream consumed by Python |
| Use cases | Quiz question generation, report summarisation, content moderation, multilingual translation, future chatbot |
| Endpoints (internal-only, mTLS) | `POST /ai/quiz/generate`, `POST /ai/moderate`, `POST /ai/translate`, `POST /ai/report/summarise` |
| Auth | Service-to-service shared secret (HMAC headers) + IP allowlist |

---

# 4. FOLDER STRUCTURE

### 4.1 Monorepo Root

```
jain-pathshala/
├── apps/
│   ├── mobile/                # Expo React Native
│   ├── web/                   # Next.js public website + admin panel
│   ├── api/                   # NestJS backend
│   └── ai/                    # Python FastAPI AI service
├── packages/
│   ├── shared/                # Cross-package: zod schemas, enums, types
│   ├── design-tokens/         # Design system tokens (placeholders resolved here)
│   ├── i18n/                  # Shared EN/HI translation files
│   └── eslint-config/         # Shared ESLint config
├── infra/
│   ├── docker/
│   ├── terraform/
│   ├── github-actions/
│   └── scripts/
├── docs/
├── .env.example
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### 4.2 Backend — `apps/api/`

```
apps/api/
├── src/
│   ├── main.ts                          # Bootstrap, helmet, cors, swagger
│   ├── app.module.ts                    # Root module
│   ├── config/
│   │   ├── env.schema.ts                # Zod env validation
│   │   ├── config.module.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── s3.config.ts
│   │   ├── razorpay.config.ts
│   │   └── feature-flags.config.ts
│   ├── common/
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts
│   │   │   ├── roles.decorator.ts
│   │   │   ├── scope.decorator.ts
│   │   │   └── idempotency-key.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   ├── scope.guard.ts             # Enforces city/centre scoping
│   │   │   └── recaptcha.guard.ts
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts
│   │   │   ├── transform.interceptor.ts   # { data, meta } envelope
│   │   │   ├── timeout.interceptor.ts
│   │   │   └── audit.interceptor.ts
│   │   ├── filters/
│   │   │   ├── http-exception.filter.ts
│   │   │   └── all-exceptions.filter.ts
│   │   ├── pipes/
│   │   │   ├── zod-validation.pipe.ts
│   │   │   └── parse-uuid.pipe.ts
│   │   ├── middleware/
│   │   │   ├── request-id.middleware.ts
│   │   │   ├── rate-limit.middleware.ts
│   │   │   └── correlation-id.middleware.ts
│   │   ├── access/
│   │   │   ├── role-hierarchy.ts          # role precedence map
│   │   │   ├── permissions.matrix.ts      # action → roles map
│   │   │   ├── scope-rules.ts             # query scoping per role
│   │   │   └── actor-context.ts
│   │   ├── events/
│   │   │   ├── event-bus.module.ts
│   │   │   └── domain-events.ts           # Typed event names + payloads
│   │   ├── errors/
│   │   │   ├── app-error.ts
│   │   │   ├── error-codes.ts
│   │   │   └── domain-errors.ts
│   │   └── utils/
│   │       ├── pagination.ts
│   │       ├── cursor.ts
│   │       ├── hash.ts
│   │       └── haversine.ts
│   ├── infra/
│   │   ├── database/
│   │   │   ├── database.module.ts
│   │   │   ├── drizzle.client.ts          # Read + write clients
│   │   │   ├── transaction.service.ts
│   │   │   └── schema/                    # Drizzle schemas, organised by domain
│   │   │       ├── index.ts               # Re-exports all
│   │   │       ├── identity.schema.ts
│   │   │       ├── geography.schema.ts
│   │   │       ├── centres.schema.ts
│   │   │       ├── batches.schema.ts
│   │   │       ├── students.schema.ts
│   │   │       ├── attendance.schema.ts
│   │   │       ├── punya.schema.ts
│   │   │       ├── niyams.schema.ts
│   │   │       ├── gallery.schema.ts
│   │   │       ├── homework.schema.ts
│   │   │       ├── notices.schema.ts
│   │   │       ├── shivirs.schema.ts
│   │   │       ├── competitions.schema.ts
│   │   │       ├── curriculum.schema.ts
│   │   │       ├── exams.schema.ts
│   │   │       ├── quizzes.schema.ts
│   │   │       ├── service-requests.schema.ts
│   │   │       ├── library.schema.ts
│   │   │       ├── donations.schema.ts
│   │   │       ├── notifications.schema.ts
│   │   │       ├── audit.schema.ts
│   │   │       ├── sms.schema.ts
│   │   │       ├── progress-reports.schema.ts
│   │   │       ├── student-notes.schema.ts
│   │   │       ├── form-configs.schema.ts
│   │   │       ├── platform-settings.schema.ts
│   │   │       ├── sync.schema.ts
│   │   │       ├── media.schema.ts
│   │   │       └── enums.ts               # All pg enums
│   │   ├── redis/
│   │   │   ├── redis.module.ts
│   │   │   ├── redis.service.ts
│   │   │   └── cache.service.ts
│   │   ├── queue/
│   │   │   ├── queue.module.ts
│   │   │   ├── queue-names.ts             # Single source of truth
│   │   │   └── queue-registry.ts
│   │   ├── storage/
│   │   │   ├── s3.module.ts
│   │   │   ├── s3.service.ts
│   │   │   └── signed-url.service.ts
│   │   ├── websocket/
│   │   │   ├── ws.module.ts
│   │   │   ├── ws.gateway.ts
│   │   │   └── ws-events.ts
│   │   ├── ai/
│   │   │   ├── ai.module.ts
│   │   │   └── ai.client.ts               # HTTP client → FastAPI
│   │   └── observability/
│   │       ├── logger.module.ts
│   │       ├── tracing.ts
│   │       └── metrics.ts
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── otp.service.ts
│   │   │   ├── token.service.ts
│   │   │   ├── device-session.service.ts
│   │   │   ├── strategies/
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── refresh.strategy.ts
│   │   │   ├── dto/
│   │   │   │   ├── otp-request.dto.ts
│   │   │   │   ├── otp-verify.dto.ts
│   │   │   │   ├── refresh.dto.ts
│   │   │   │   └── switch-view.dto.ts
│   │   │   └── repositories/
│   │   │       ├── user.repository.ts
│   │   │       └── device-session.repository.ts
│   │   ├── users/
│   │   ├── geography/                     # States, cities
│   │   ├── centres/
│   │   ├── batches/
│   │   ├── students/
│   │   ├── enrolments/                    # Approval workflow + MSV
│   │   ├── form-configs/                  # Dynamic registration forms
│   │   ├── id-cards/
│   │   ├── attendance/
│   │   │   ├── attendance.module.ts
│   │   │   ├── attendance.controller.ts
│   │   │   ├── sessions.controller.ts
│   │   │   ├── attendance.service.ts
│   │   │   ├── gps-session.service.ts
│   │   │   ├── absence-notification.service.ts
│   │   │   ├── session-cancellation.service.ts
│   │   │   ├── centre-holiday.service.ts
│   │   │   ├── dto/
│   │   │   ├── repositories/
│   │   │   ├── listeners/
│   │   │   └── workers/
│   │   │       └── streak-recompute.worker.ts
│   │   ├── punya/
│   │   │   ├── punya.module.ts
│   │   │   ├── punya.controller.ts
│   │   │   ├── punya.service.ts
│   │   │   ├── punya-transactions.service.ts
│   │   │   ├── tier.service.ts
│   │   │   ├── leaderboard.service.ts
│   │   │   ├── feature-catalogue.service.ts
│   │   │   ├── listeners/
│   │   │   │   ├── attendance-marked.listener.ts
│   │   │   │   ├── homework-approved.listener.ts
│   │   │   │   ├── niyam-submitted.listener.ts
│   │   │   │   └── niyam-rejected.listener.ts
│   │   │   └── workers/
│   │   │       ├── leaderboard-refresh.worker.ts
│   │   │       └── tier-recompute.worker.ts
│   │   ├── niyams/
│   │   │   ├── niyams.module.ts
│   │   │   ├── niyams.controller.ts
│   │   │   ├── niyams.service.ts
│   │   │   ├── submissions.service.ts
│   │   │   ├── streaks.service.ts
│   │   │   └── ...
│   │   ├── gallery/
│   │   ├── homework/
│   │   ├── notices/
│   │   ├── shivirs/
│   │   │   ├── shivirs.module.ts
│   │   │   ├── shivirs.controller.ts
│   │   │   ├── volunteers.controller.ts
│   │   │   ├── scans.controller.ts
│   │   │   ├── scans.service.ts
│   │   │   ├── live-dashboard.service.ts
│   │   │   ├── ws/
│   │   │   │   └── shivirs.gateway.ts
│   │   │   └── ...
│   │   ├── competitions/
│   │   ├── curriculum/
│   │   ├── exams/
│   │   ├── quizzes/
│   │   ├── service-requests/
│   │   ├── library/
│   │   ├── donations/
│   │   │   ├── donations.module.ts
│   │   │   ├── donations.controller.ts
│   │   │   ├── donations.service.ts
│   │   │   ├── razorpay.service.ts
│   │   │   ├── webhooks.controller.ts
│   │   │   ├── eighty-g.service.ts
│   │   │   └── campaigns.service.ts
│   │   ├── msv/                           # MSV facade orchestrating other modules
│   │   ├── notifications/
│   │   │   ├── notifications.module.ts
│   │   │   ├── notifications.controller.ts
│   │   │   ├── notifications.service.ts
│   │   │   ├── push.service.ts
│   │   │   ├── sms.service.ts
│   │   │   ├── email.service.ts
│   │   │   ├── delivery-pipeline.service.ts
│   │   │   ├── device-token.service.ts
│   │   │   └── workers/
│   │   │       ├── push-deliver.worker.ts
│   │   │       ├── sms-deliver.worker.ts
│   │   │       └── email-deliver.worker.ts
│   │   ├── progress-reports/
│   │   ├── student-notes/
│   │   ├── audit/
│   │   ├── analytics/
│   │   ├── exports/
│   │   ├── media/
│   │   ├── platform-settings/
│   │   ├── sync/                          # Offline sync receiver
│   │   │   ├── sync.module.ts
│   │   │   ├── sync.controller.ts
│   │   │   ├── sync.service.ts
│   │   │   └── idempotency.service.ts
│   │   └── webhooks/
│   ├── workers/
│   │   ├── worker.main.ts                 # Separate entrypoint for worker container
│   │   └── worker.module.ts
│   └── scheduler/
│       ├── scheduler.module.ts
│       ├── jobs/
│       │   ├── monthly-progress-report.job.ts
│       │   ├── leaderboard-monthly-reset.job.ts
│       │   ├── birthday-wishes.job.ts
│       │   ├── consecutive-absence-flag.job.ts
│       │   ├── shikshak-no-show-flag.job.ts
│       │   ├── streak-reset.job.ts
│       │   └── analytics-aggregation.job.ts
│       └── cron-config.ts
├── test/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   └── helpers/
├── drizzle/
│   ├── migrations/                        # Generated SQL
│   └── meta/
├── drizzle.config.ts
├── nest-cli.json
├── tsconfig.json
├── Dockerfile
└── package.json
```

### 4.3 Mobile — `apps/mobile/`

```
apps/mobile/
├── app/                          # Expo Router
│   ├── _layout.tsx               # Root layout, providers
│   ├── index.tsx                 # Splash / role-router
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── otp.tsx
│   ├── (guest)/
│   │   ├── notices.tsx
│   │   ├── centres.tsx
│   │   ├── shivirs.tsx
│   │   ├── donate.tsx
│   │   └── library.tsx
│   ├── (parent)/
│   │   ├── _layout.tsx           # Tab bar
│   │   ├── home.tsx
│   │   ├── attendance.tsx
│   │   ├── homework.tsx
│   │   ├── niyams.tsx
│   │   ├── punya.tsx
│   │   ├── notices.tsx
│   │   ├── id-card.tsx
│   │   ├── service-requests.tsx
│   │   ├── msv.tsx               # Visible only if any child is MSV
│   │   ├── student-view-toggle.tsx
│   │   └── profile.tsx           # Includes Gallery Visibility toggle
│   ├── (student)/                # Rendered when student-view toggle ON
│   │   ├── _layout.tsx
│   │   ├── home.tsx
│   │   ├── punya.tsx
│   │   ├── niyams.tsx
│   │   ├── quizzes.tsx
│   │   └── id-card.tsx
│   ├── (shikshak)/
│   │   ├── _layout.tsx
│   │   ├── home.tsx
│   │   ├── check-in.tsx
│   │   ├── batches/
│   │   │   ├── [batchId]/
│   │   │   │   ├── attendance.tsx
│   │   │   │   ├── homework.tsx
│   │   │   │   ├── push-quiz.tsx
│   │   │   │   ├── notes.tsx
│   │   │   │   └── notice.tsx
│   │   └── profile.tsx
│   ├── (sanchalak)/
│   │   ├── _layout.tsx
│   │   ├── home.tsx
│   │   ├── enrolments.tsx        # Approval queue
│   │   ├── shikshaks.tsx
│   │   ├── attendance-log.tsx
│   │   ├── gallery.tsx
│   │   ├── notices.tsx
│   │   ├── service-requests.tsx
│   │   ├── analytics.tsx
│   │   └── profile.tsx
│   ├── (city-admin)/
│   │   └── … (most admin work in web panel)
│   ├── (shivir-volunteer)/
│   │   ├── _layout.tsx
│   │   ├── scanner.tsx
│   │   └── synced-queue.tsx
│   └── +not-found.tsx
├── src/
│   ├── api/                      # TanStack Query hooks per resource
│   │   ├── client.ts             # axios instance with auth interceptors
│   │   ├── auth.api.ts
│   │   ├── attendance.api.ts
│   │   ├── punya.api.ts
│   │   ├── niyams.api.ts
│   │   └── …
│   ├── stores/                   # Zustand
│   │   ├── auth.store.ts
│   │   ├── attendance-offline.store.ts
│   │   ├── sync.store.ts
│   │   ├── language.store.ts
│   │   ├── child-context.store.ts
│   │   └── student-view.store.ts
│   ├── components/               # Wrap design-system placeholders
│   ├── features/
│   │   ├── attendance/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   │   ├── useMarkAttendance.ts
│   │   │   │   ├── useOfflineSync.ts
│   │   │   │   └── useGpsCheckIn.ts
│   │   │   └── offline/
│   │   │       ├── attendance-mmkv.ts
│   │   │       └── attendance-sync-engine.ts
│   │   ├── niyams/
│   │   ├── gallery/
│   │   ├── id-card/
│   │   │   ├── components/IDCard.tsx     # SVG rendering
│   │   │   └── hooks/useIdCardSvg.ts
│   │   ├── shivir-scanner/
│   │   │   ├── components/
│   │   │   └── offline/
│   │   │       ├── scan-mmkv.ts
│   │   │       └── scan-sync-engine.ts
│   │   ├── notifications/
│   │   │   ├── push-handler.ts
│   │   │   └── deep-link-router.ts
│   │   └── reports/
│   ├── lib/
│   │   ├── mmkv.ts
│   │   ├── i18n.ts
│   │   ├── analytics.ts
│   │   ├── sentry.ts
│   │   └── deep-link.ts
│   ├── sync/
│   │   ├── sync-engine.ts        # Cross-feature orchestrator
│   │   ├── sync-types.ts
│   │   └── retry-policy.ts
│   └── theme/
│       └── tokens.ts             # Re-exports design-tokens placeholders
├── assets/
│   ├── fonts/
│   ├── images/
│   └── i18n/
│       ├── en.json
│       └── hi.json
├── app.config.ts                 # Expo config (with EAS profiles)
├── eas.json
├── babel.config.js
├── tsconfig.json
└── package.json
```

### 4.4 Web — `apps/web/`

```
apps/web/
├── app/
│   ├── [locale]/                 # next-intl locale route param (en|hi)
│   │   ├── (public)/
│   │   │   ├── page.tsx          # Home
│   │   │   ├── about/page.tsx
│   │   │   ├── centres/page.tsx
│   │   │   ├── centres/[id]/page.tsx
│   │   │   ├── shivirs/page.tsx
│   │   │   ├── shivirs/[id]/page.tsx
│   │   │   ├── notices/page.tsx
│   │   │   ├── achievements/page.tsx
│   │   │   ├── gallery/page.tsx
│   │   │   ├── library/page.tsx
│   │   │   ├── donate/page.tsx
│   │   │   ├── enrolment-enquiry/page.tsx
│   │   │   ├── msv/page.tsx
│   │   │   └── contact/page.tsx
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── otp/page.tsx
│   │   ├── (admin)/
│   │   │   ├── layout.tsx        # Role-guarded
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── centres/…
│   │   │   ├── batches/…
│   │   │   ├── students/…
│   │   │   ├── enrolments/…
│   │   │   ├── shikshaks/…
│   │   │   ├── sanchalaks/…
│   │   │   ├── attendance/…
│   │   │   ├── punya/…
│   │   │   ├── niyams/…
│   │   │   ├── gallery/…
│   │   │   ├── homework/…
│   │   │   ├── notices/…
│   │   │   ├── shivirs/…
│   │   │   ├── competitions/…
│   │   │   ├── curriculum/…
│   │   │   ├── exams/…
│   │   │   ├── quizzes/…
│   │   │   ├── service-requests/…
│   │   │   ├── library/…
│   │   │   ├── donations/…
│   │   │   ├── form-builder/…
│   │   │   ├── analytics/…
│   │   │   ├── audit-logs/…
│   │   │   ├── platform-settings/…   # Super Admin: 80G, feature flags
│   │   │   └── question-bank/…
│   │   └── layout.tsx
│   ├── api/                      # Next.js BFF (signed cookies, never exposes JWT)
│   │   └── …
│   └── layout.tsx
├── src/
│   ├── api/                      # Server-side fetchers + TanStack hooks
│   ├── components/
│   │   ├── ui/                   # shadcn primitives (already wired)
│   │   ├── admin/
│   │   ├── public/
│   │   └── forms/
│   ├── features/                 # Same shape as mobile
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── session.ts        # iron-session
│   │   │   └── permissions.ts
│   │   ├── i18n/
│   │   ├── api-client.ts
│   │   └── seo.ts
│   ├── middleware.ts             # Locale + auth guard
│   └── types/
├── messages/
│   ├── en.json
│   └── hi.json
├── public/
├── next.config.ts
├── tailwind.config.ts            # Pre-wired design tokens (do not modify)
├── tsconfig.json
└── package.json
```

### 4.5 Shared — `packages/shared/`

```
packages/shared/
├── src/
│   ├── enums/
│   │   ├── roles.ts
│   │   ├── age-groups.ts
│   │   ├── attendance-status.ts
│   │   ├── tier.ts
│   │   ├── niyam-type.ts
│   │   ├── proof-type.ts
│   │   ├── homework-status.ts
│   │   ├── curriculum-level.ts
│   │   └── …
│   ├── schemas/                # Zod schemas reused across web/mobile/api DTOs
│   │   ├── auth.ts
│   │   ├── student.ts
│   │   ├── attendance.ts
│   │   └── …
│   ├── api-types/              # Response envelope types
│   ├── events/                 # Domain event payload types
│   └── constants/
│       ├── punya-rules.ts
│       ├── tier-thresholds.ts
│       └── streak-rules.ts
└── package.json
```

### 4.6 AI Service — `apps/ai/`

```
apps/ai/
├── src/
│   ├── main.py                # FastAPI app
│   ├── routes/
│   │   ├── quiz.py
│   │   ├── moderation.py
│   │   ├── translate.py
│   │   └── summarise.py
│   ├── services/
│   │   ├── openai_client.py
│   │   ├── quiz_generator.py
│   │   └── moderator.py
│   ├── auth/
│   │   └── hmac.py
│   ├── consumers/
│   │   └── redis_stream_consumer.py
│   └── config.py
├── Dockerfile
├── pyproject.toml
└── requirements.txt
```

---

# 5. DATABASE DESIGN

PostgreSQL 16. Drizzle ORM. All tables include `created_at`, `updated_at` (`timestamptz`, default `now()`), `created_by` and `updated_by` (`uuid`, nullable, FK → `users.id`). Soft-delete columns (`deleted_at timestamptz`) added on entity tables where historical retention matters (students, users, niyams, notices, gallery_items, library_items). Hard-delete is forbidden in services — use soft delete + audit log.

### 5.1 PostgreSQL Enums (`infra/database/schema/enums.ts`)

```ts
role_enum:               'super_admin' | 'state_admin' | 'city_admin' | 'sanchalak' | 'shikshak' | 'parent' | 'student' | 'guest'
gender_enum:             'male' | 'female' | 'other'
language_enum:           'en' | 'hi'
age_group_enum:          'bal' | 'kishor' | 'tarun' | 'yuva'
attendance_status_enum:  'present' | 'absent' | 'late' | 'excused'  # AT1 — CLAUDE.md
session_status_enum:     'scheduled' | 'in_progress' | 'completed' | 'cancelled'
student_status_enum:     'active' | 'inactive'
enrolment_status_enum:   'pending' | 'approved' | 'rejected' | 'waitlisted'
msv_status_enum:         'none' | 'applied' | 'waitlisted' | 'approved' | 'rejected' | 'revoked'
tier_enum:               'jigyasu' | 'shravak' | 'sadhak' | 'shraman' | 'tirthankar'
niyam_type_enum:         'daily' | 'weekly' | 'monthly'
proof_type_enum:         'photo' | 'video' | 'either'
niyam_submission_status_enum: 'auto_approved' | 'rejected'
homework_status_enum:    'pending' | 'starred' | 'approved' | 'late'
notice_audience_enum:    'batch' | 'centre' | 'city' | 'state' | 'national' | 'msv'
service_request_status_enum: 'submitted' | 'in_review' | 'resolved'
curriculum_level_enum:   'not_started' | 'in_progress' | 'completed' | 'mastered'
shivir_attendance_mode_enum: 'in_out' | 'present_only'
shivir_scan_kind_enum:   'check_in' | 'check_out' | 'present'
exam_question_type_enum: 'mcq_single' | 'mcq_multi' | 'true_false' | 'short_text' | 'image_based'
quiz_scope_enum:         'national' | 'state' | 'city' | 'centre' | 'batch'
library_content_type_enum: 'pdf' | 'video' | 'audio' | 'image'
library_access_tier_enum:  'public' | 'student' | 'msv' | 'shikshak'
donation_purpose_enum:   'general' | 'shivir' | 'scholarship' | 'infrastructure'
donation_frequency_enum: 'one_time' | 'recurring'
payment_status_enum:     'created' | 'authorized' | 'captured' | 'failed' | 'refunded'
notification_channel_enum: 'push' | 'sms' | 'email' | 'in_app'
notification_status_enum: 'pending' | 'sent' | 'delivered' | 'failed'
audit_action_enum:       'create' | 'update' | 'delete' | 'approve' | 'reject' | 'transfer' | 'login' | 'logout' | 'config_change'
media_kind_enum:         'niyam_proof' | 'student_photo' | 'shikshak_photo' | 'sanchalak_photo' | 'library_pdf' | 'library_audio' | 'library_image' | 'homework_attachment' | 'notice_attachment' | 'gallery_featured' | 'misc'
media_status_enum:       'pending' | 'uploaded' | 'processing' | 'ready' | 'failed' | 'quarantined'
sync_op_status_enum:     'success' | 'duplicate' | 'failed'
```

### 5.2 Identity & Geography

#### `users`
| Column | Type | Constraints |
|---|---|---|
| id | uuid pk | default `gen_random_uuid()` |
| phone | varchar(15) | unique, indexed |
| email | varchar(255) | nullable |
| role | role_enum | not null |
| full_name | text | not null |
| gender | gender_enum | nullable (required for shikshak) |
| preferred_language | language_enum | default `'en'` |
| profile_photo_asset_id | uuid | fk → media_assets.id, nullable |
| state_id | uuid | fk → states.id, nullable |
| city_id | uuid | fk → cities.id, nullable |
| centre_id_default | uuid | fk → centres.id, nullable (sanchalak primary) |
| is_active | boolean | default true |
| last_login_at | timestamptz | nullable |
| gallery_visibility_opt_in | boolean | default false (parent setting Q6) |
| deleted_at | timestamptz | nullable |

Indexes: `idx_users_phone`, `idx_users_role_city (role, city_id)`, partial `idx_users_active where is_active = true`.

#### `device_sessions`
`id (pk), user_id (fk), device_id (text), platform (text), refresh_token_hash (text), expires_at, last_used_at, revoked_at`. Index: `(user_id, revoked_at IS NULL)`.

#### `states` / `cities`
States: `id, name, code`. Cities: `id, state_id, name, code`. Indexes: `(state_id, name)`.

### 5.3 Centres, Batches, Students

#### `centres`
`id, city_id (fk), name, address_line, locality, pincode, lat numeric(10,7), lng numeric(10,7), gps_radius_meters int default 250, contact_phone, contact_email, status (active|inactive), academic_year text, deleted_at`. Indexes: `(city_id, status)`, GIST/BTREE on `(lat, lng)`.

#### `batches` *(Gap A — first-class entity)*
| Column | Type |
|---|---|
| id | uuid pk |
| centre_id | uuid fk → centres |
| name | text |
| day_of_week | int[] (1=Mon..7=Sun) |
| start_time | time |
| end_time | time |
| age_group | age_group_enum |
| shikshak_id | uuid fk → users (nullable) |
| academic_year | text |
| status | (active|inactive) |
| capacity | int default 50 |

Indexes: `(centre_id, status)`, `(shikshak_id)`. Validation: end_time > start_time; day_of_week within {1..7}.

#### `students`
`id, parent_user_id (fk→users), full_name, father_name, dob, age_group (derived/maintained), profile_photo_asset_id, centre_id (fk), batch_id (fk, nullable), student_code (e.g. MSV-AHM-00123, unique), msv_status (msv_status_enum default 'none'), status (student_status_enum default 'active'), enrolled_at, deactivated_at, deleted_at`. Indexes: `(parent_user_id)`, `(centre_id, status)`, `(batch_id, status)`, unique `(student_code)`, partial `(msv_status) where msv_status='approved'`.

#### `sanchalak_centre_assignments`
`id, sanchalak_user_id, centre_id, assigned_at, revoked_at`. Composite unique `(sanchalak_user_id, centre_id) where revoked_at IS NULL`.

#### `shikshak_batch_assignments`
`id, shikshak_user_id, batch_id, role_in_batch (primary|secondary), assigned_at, revoked_at`.

#### `enrolments`
`id, student_id (nullable until approval issues student), parent_user_id, requested_centre_id, requested_batch_id, status (enrolment_status_enum), reviewer_user_id, decided_at, rejection_reason, form_response_id (fk→registration_form_responses)`.

#### `msv_enrolments`
`id, student_id (fk), application_form_response_id, motivation_statement_redacted (text), recommending_shikshak_id (nullable), status (msv_status_enum), reviewer_user_id, decided_at, certificate_year, notes`. Decision Q1 — purely admin discretion, no eligibility logic.

### 5.4 Form Configs (Dynamic Registration)

#### `registration_form_configs`
`id, city_id, form_kind (student|shikshak|sanchalak), is_active, version_no, base_field_overrides jsonb, custom_fields jsonb, published_at, published_by`. Unique `(city_id, form_kind, version_no)`.

#### `registration_form_responses`
`id, form_config_id (fk), user_id (subject), responses jsonb, submitted_at`.

### 5.5 Digital ID Cards

#### `digital_id_cards`
`id, student_id (fk, unique), card_number (e.g. MSV-AHM-00123), qr_payload text, qr_payload_signature text (HMAC), png_asset_id, svg_payload text, msv_badge boolean, version_no int, generated_at, last_regenerated_at`. Unique `(student_id)`. Regenerated on transfer, photo change, or MSV status change.

### 5.6 Attendance & Sessions

Binding decisions: CLAUDE.md AT1–AT31.

#### `sessions`
Created ONLY by `session.materialise` (AT7). Columns: `id, batch_id, scheduled_date date, scheduled_start_time, scheduled_end_time, status (session_status_enum default 'scheduled'), shikshak_user_id (assigned), unscheduled boolean default false (AT8), check_in_at timestamptz, check_in_lat numeric(10,7), check_in_lng numeric(10,7), check_in_distance_m int, check_in_accuracy_m int, check_in_unverified boolean default false (AT15), check_out_at timestamptz, check_out_lat, check_out_lng, check_out_distance_m int, check_out_accuracy_m int, duration_minutes int, gps_flagged boolean default false (AT14), auto_checked_out boolean default false (AT12), cancelled_at, cancellation_reason text, cancellation_by (fk→users), submission_op_id char(26) nullable`. Constraints: `UNIQUE (batch_id, scheduled_date)` (AT7). Indexes: `(shikshak_user_id, scheduled_date)`, `(scheduled_date, status)`. Cancellation is recorded on these embedded columns (AT11).

#### `attendance`
`id, session_id (fk), student_id (fk), status (attendance_status_enum), revision int not null default 1 (AT17), marked_at, marked_by (fk→users), client_op_id char(26) nullable unique (AT19 — per-row ULID), notes text`. Unique `(session_id, student_id)`. Indexes: `(student_id, marked_at desc)`, `(session_id)`. Partial: `(student_id) where status='absent'` for consecutive-absence checks. Punya key: `attendance:{session_id}:{student_id}:{revision}` (AT17).

#### `absence_notifications`
`id, student_id, parent_user_id, expected_session_id (nullable), expected_date date, reason text, resolved_at timestamptz nullable (AT4), created_at`. Index: `(student_id, expected_date)`. Covering a session date pre-fills `'excused'` in the marking UI; marking consumes the row via `resolved_at` (AT4).

#### `centre_holidays`
`id, centre_id, name, start_date, end_date, published boolean default true, created_by, notify_sent boolean default false`. Index: `(centre_id, start_date, end_date)`. Public holiday GET returns published only (AT30).

#### Attendance percentage
Canonical SQL function/view only — see CLAUDE.md AT5. Clients never recompute.

### 5.7 Punya

#### `punya_features`
Feature catalogue: `id, key (e.g. attendance_present, homework_approved, niyam_completion, manual_seva, streak_bonus_4_sessions), default_points int, is_manual boolean, requires_reason boolean, scope (global|city), min_points, max_points`. Super-admin managed. Attendance points resolve here at award time (AT21). **Tier thresholds** (Jigyasu 0–100 … Tirthankar 5001+) live in configuration alongside this catalogue — see CLAUDE.md AT23; do not hardcode alternate bands in this document.

#### `punya_configs`
City-level overrides: `id, city_id, feature_id, points_override int, min_points, max_points`. Unique `(city_id, feature_id)`.

#### `punya_transactions` **(financial-grade ledger)**
| Column | Notes |
|---|---|
| id | uuid pk |
| student_id | fk |
| feature_key | text (denormalised for fast leaderboard queries) |
| points | int (signed; negative for reversals) |
| reason | text |
| awarded_by_user_id | fk (nullable for system) |
| source_entity_kind | text (e.g. 'attendance', 'niyam_submission', 'manual') |
| source_entity_id | uuid |
| reversal_of | uuid (fk → punya_transactions.id, nullable) — for Niyam rejections |
| is_msv_track | boolean (for parallel MSV leaderboard) |
| awarded_at | timestamptz |
| city_id | uuid (denormalised for leaderboards) |
| centre_id | uuid (denormalised) |
| batch_id | uuid (denormalised) |
| idempotency_key | text unique (per-source-entity-id+feature_key) |

Indexes:
- `idx_punya_student_awarded (student_id, awarded_at desc)`
- `idx_punya_city_awarded (city_id, awarded_at desc)`
- `idx_punya_batch_awarded (batch_id, awarded_at desc)`
- `idx_punya_msv (city_id, is_msv_track, awarded_at desc)`
- Unique `idempotency_key`
- Partial `idx_punya_reversal (reversal_of) where reversal_of is not null`

#### `punya_balances` *(maintained projection)*
`student_id pk, total_points, msv_points, current_tier (tier_enum), tier_reached_at, last_updated_at`. Updated transactionally with every `punya_transactions` insert. NOT a cache — source of truth for "current balance" with insert-time math; reconciled hourly from ledger.

#### Leaderboards
- Computed by a `leaderboard-refresh.worker` every 60s into Redis sorted sets:
  - `lb:batch:{batch_id}` (zset of student_id → points)
  - `lb:centre:{centre_id}`, `lb:city:{city_id}`, `lb:msv:{city_id}`
- Materialised view `mv_monthly_leaderboard_city` for monthly-reset display, refreshed nightly.

### 5.8 Niyams (Tasks)

#### `niyams`
`id, title_en, title_hi, description_en, description_hi, type (niyam_type_enum), start_date, end_date (nullable), audience_kind (all|msv_only|age_group|batch|centre|city), audience_filters jsonb, proof_type (proof_type_enum), points_value int, reference_asset_id (nullable), created_by_user_id, city_id, msv_only boolean, deleted_at`. Indexes: `(city_id, start_date)`, `(msv_only)`, `(type)`.

#### `niyam_submissions`
| Column | |
|---|---|
| id | uuid pk |
| niyam_id | fk |
| student_id | fk |
| parent_user_id | fk |
| proof_asset_id | fk → media_assets |
| status | niyam_submission_status_enum (auto_approved or rejected) |
| auto_approved_at | timestamptz default now() |
| rejected_at | timestamptz nullable |
| rejected_by_user_id | fk nullable |
| rejection_reason | text |
| punya_transaction_id | fk (the awarded txn) |
| reversal_transaction_id | fk (the reversal txn if rejected) |
| submitted_at | timestamptz |
| submission_date date | denormalised for streaks |

Indexes: `(niyam_id, student_id, submission_date)`, `(student_id, submitted_at desc)`, `(rejected_at) where rejected_at IS NULL`. **Rejection window: 30 days enforced in service.**

#### `niyam_streaks`
`id, student_id, niyam_id, current_streak int, longest_streak int, last_completion_date, badge_awarded boolean default false, badge_kind text`. Unique `(student_id, niyam_id)`.

#### `gallery_items`
`id, niyam_submission_id (fk, unique), student_id, centre_id, city_id, niyam_id, asset_id, is_featured boolean default false, featured_at, removed boolean default false, removed_by, created_at`. Index: `(city_id, is_featured, created_at desc)`. Visibility check at query time joins `users.gallery_visibility_opt_in`.

### 5.9 Homework

#### `homework_assignments`
`id, batch_id, title, description, due_date, attachment_asset_id, created_by_user_id, is_msv boolean, target_student_ids uuid[] (null=all in batch)`. Index: `(batch_id, due_date desc)`.

#### `homework_submissions`
`id, assignment_id, student_id, status (homework_status_enum), submission_asset_id (nullable), feedback_note, marked_by_user_id, marked_at, late boolean, punya_transaction_id`. Unique `(assignment_id, student_id)`. Index: `(student_id, status)`.

### 5.10 Notices

#### `notices`
`id, scope (notice_audience_enum), city_id, centre_id, batch_id, msv_only, content_en text, content_hi text, attachments jsonb, pinned boolean, scheduled_for timestamptz, published_at, is_public boolean, is_critical boolean, send_sms boolean, created_by_user_id, deleted_at`. Indexes: `(scope, city_id, published_at desc)`, `(batch_id, published_at desc)`, partial `(is_public) where is_public = true`.

#### `notice_reads`
`id, notice_id, user_id, read_at`. Unique `(notice_id, user_id)`.

### 5.11 Shivirs

#### `shivir_events`
`id, city_id, name, description, start_date, end_date, location_text, location_lat, location_lng, capacity, msv_only boolean, attendance_mode (shivir_attendance_mode_enum), sessions_count int default 1`. Index: `(city_id, start_date)`.

#### `shivir_sessions`
`id, shivir_event_id, day_number, session_date, start_time, end_time`. Unique `(shivir_event_id, day_number)`.

#### `shivir_registrations`
`id, shivir_event_id, student_id, registered_at, registered_by_user_id, status (registered|cancelled)`. Unique `(shivir_event_id, student_id)`.

#### `shivir_volunteers`
`id, shivir_event_id, user_id, assigned_by, assigned_at, revoked_at`.

#### `shivir_attendance_scans`
| Column | |
|---|---|
| id | uuid pk |
| shivir_event_id | fk |
| shivir_session_id | fk |
| student_id | fk |
| volunteer_user_id | fk |
| scan_kind | shivir_scan_kind_enum |
| scanned_at | timestamptz |
| client_op_id | uuid unique (offline idempotency) |
| device_offline boolean |

Indexes: `(shivir_session_id, student_id)`, `(shivir_event_id, scanned_at desc)`, unique `client_op_id`. For `in_out` mode, app logic toggles next scan to check_out if last was check_in.

### 5.12 Competitions

#### `competitions`
`id, city_id, name_en, name_hi, description_en, description_hi, category, eligible_age_groups age_group_enum[], msv_only boolean, registration_window_start, registration_window_end, event_date, winner_points int, participant_points int, status (draft|open|closed|results_published)`.

#### `competition_registrations`
`id, competition_id, student_id, registered_at, result_rank int, result_note, punya_transaction_id`. Unique `(competition_id, student_id)`.

### 5.13 Curriculum

#### `curriculum_templates`
Super Admin masters. `id, name, kind (standard|msv), age_group, created_by_user_id`.

#### `curricula`
`id, city_id (null for msv_master), kind (standard|msv), template_id (nullable), name, academic_year, status`. **MSV curricula are created only by Super Admin (Q2) — controlled at the service layer.**

#### `curriculum_sections`
`id, curriculum_id, title_en, title_hi, order_index`.

#### `curriculum_items`
`id, section_id, title_en, title_hi, description_en, description_hi, order_index`.

#### `curriculum_assignments`
`id, curriculum_id, centre_id (nullable), batch_id (nullable), assigned_at`.

#### `student_curriculum_progress`
`id, student_id, curriculum_item_id, level (curriculum_level_enum default 'not_started'), updated_by_user_id, note, updated_at`. Unique `(student_id, curriculum_item_id)`.

### 5.14 Exams & Quizzes

#### `online_exams`
`id, city_id, title_en, title_hi, description_en, description_hi, target_audience jsonb, window_start, window_end, max_attempts int, total_marks int, pass_mark int, exam_otp text (numeric), completion_points int, top_score_points int, results_released boolean default false, show_rank boolean`. Index: `(city_id, window_start)`.

#### `exam_questions`
`id, exam_id, question_type (exam_question_type_enum), question_en, question_hi, marks int, image_asset_id (nullable), order_index`.

#### `exam_question_options`
`id, question_id, label_en, label_hi, is_correct boolean, order_index`.

#### `exam_attempts`
`id, exam_id, student_id, started_at, submitted_at, score int, auto_score int, manual_score int, status (in_progress|submitted|graded), otp_verified_at`. Index: `(exam_id, student_id)`.

#### `exam_answers`
`id, attempt_id, question_id, selected_option_ids uuid[], short_text_answer text, auto_score int, manual_score int, admin_comment text, graded_by_user_id`.

#### `questions` (quiz bank)
`id, scope (national|state|city), city_id (nullable), question_en, question_hi, options jsonb, correct_indices int[], difficulty, age_groups age_group_enum[], topic, source (manual|ai), ai_generation_id (fk nullable), reviewed boolean, reviewed_by`.

#### `quiz_events`
`id, scope (quiz_scope_enum), city_id, centre_id, batch_id, title_en, title_hi, start_at, end_at, participation_points, win_points, target_age_groups`.

#### `quiz_event_questions`
`id, quiz_event_id, question_id, order_index`.

#### `quiz_attempts`
`id, quiz_event_id, student_id, started_at, submitted_at, score, correct_count, total_count`.

#### `push_quizzes`
`id, batch_id, shikshak_user_id, started_at, expires_at, completion_points`.

#### `push_quiz_questions`
`id, push_quiz_id, question_en, question_hi, options jsonb, correct_indices int[], order_index`.

#### `push_quiz_attempts`
`id, push_quiz_id, student_id, answers jsonb, score, submitted_at`.

### 5.15 Service Requests

#### `service_requests`
`id, parent_user_id, student_id (nullable), category, description, status (service_request_status_enum), assigned_to_user_id, centre_id, city_id, last_response_at, created_at, resolved_at`. Index: `(city_id, status)`, `(parent_user_id, created_at desc)`.

#### `service_request_messages`
`id, request_id, author_user_id, message, created_at`.

### 5.16 Library

#### `library_items`
`id, content_type (library_content_type_enum), title_en, title_hi, description_en, description_hi, asset_id (nullable; for pdf/audio/image), embed_url (nullable; for video — Q7), tags text[], age_groups age_group_enum[], languages language_enum[], access_tier (library_access_tier_enum), msv_only boolean, uploaded_by_user_id, city_id (nullable), deleted_at`. Indexes: `(access_tier)`, `(content_type)`, GIN on `tags`.

#### `library_access_logs`
`id, item_id, user_id (nullable for guest), action (view|download), at`. Index: `(item_id, at desc)`.

### 5.17 Donations

#### `donations`
`id, donor_name, donor_phone, donor_email, donor_pan (encrypted, nullable), amount_paise bigint, currency text default 'INR', purpose (donation_purpose_enum), campaign_id (nullable), frequency (donation_frequency_enum), razorpay_order_id, razorpay_payment_id, razorpay_signature, status (payment_status_enum), payment_captured_at, eighty_g_eligible boolean, receipt_number text, eighty_g_certificate_asset_id (nullable), notes`. Indexes: `(donor_phone)`, `(campaign_id)`, `(status)`, `(payment_captured_at desc)`.

#### `donation_campaigns`
`id, city_id (nullable), name, description, target_amount_paise, raised_amount_paise (denormalised, updated transactionally), starts_at, ends_at, is_public, progress_bar_visible`.

#### `donor_profiles`
`id, user_id (nullable; for app-signed-in donors), name, email, phone, pan_hash, total_donated_paise`.

#### `platform_settings` *(Q3 — single row table)*
`id (singleton), eighty_g_enabled boolean default false, eighty_g_registration_number text nullable, eighty_g_trust_name text, eighty_g_trust_address text, eighty_g_section text default '80G', last_updated_by, last_updated_at`.

### 5.18 Notifications & SMS

#### `notifications`
`id, user_id, kind (text; e.g. 'attendance_marked', 'niyam_punya_awarded'), title_en, title_hi, body_en, body_hi, data jsonb (deep-link payload), is_read boolean default false, channel notification_channel_enum, status notification_status_enum, source_entity_kind, source_entity_id, created_at`. Indexes: `(user_id, is_read, created_at desc)`, `(status) where status='pending'`.

#### `device_tokens`
`id, user_id, platform (ios|android|web), token text unique, last_seen_at, revoked_at`.

#### `sms_logs`
`id, notice_id (nullable; null for OTP), phone, body, provider_message_id, status, cost_paise, sent_at`.

### 5.19 Audit & Sync

#### `audit_logs`
`id, actor_user_id, actor_role, action audit_action_enum, entity_kind, entity_id, before jsonb, after jsonb, ip, user_agent, request_id, created_at`. Indexes: `(entity_kind, entity_id, created_at desc)`, `(actor_user_id, created_at desc)`, `(created_at desc)`. **Append-only — no UPDATE/DELETE policies (enforced via Postgres role).**

#### `sync_operations` *(offline idempotency)*
`id, user_id, submission_op_id char(26) unique (AT19), op_kind text, request_payload jsonb, response_payload jsonb, status sync_op_status_enum, error text, applied_at`. Unique `(user_id, submission_op_id)`. TTL: rows older than 90 days purged by daily cron. Per-item repair IDs live on domain rows as `client_op_id char(26)`, not here.

### 5.20 Student Notes & Reports

#### `student_notes`
`id, student_id, author_user_id (shikshak), note text, created_at, updated_at, deleted_at`. **Never visible to parent/student.**

#### `progress_reports`
`id, student_id, period_kind (monthly|termly), period_label text (e.g. '2026-01' or 'Term 1 2025-26'), generated_at, pdf_asset_id, shikshak_comment text (nullable; termly only), released_to_parent boolean default false, released_at, snapshot jsonb (full payload for archival)`. Unique `(student_id, period_kind, period_label)`.

### 5.21 Media

#### `media_assets`
`id, kind media_kind_enum, owner_user_id, s3_bucket, s3_key, mime_type, size_bytes bigint, checksum_sha256 text, width int, height int, duration_seconds int, thumbnail_s3_key text, status media_status_enum, exif_stripped boolean, virus_scan_status text, processed_at, deleted_at`. Index: `(owner_user_id, kind)`, `(status) where status='pending'`.

### 5.22 Drizzle Configuration

`drizzle.config.ts`:
```ts
export default {
  schema: './src/infra/database/schema/*.schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
} satisfies Config;
```

**Migration strategy**
- Filename pattern: `0001_initial_identity.sql`, `0002_centres_batches_students.sql`, etc.
- One migration per domain in the initial bundle.
- All future schema changes follow `NNNN_descriptive_name.sql` numbering.
- `migrate:up` runs in container start hook (idempotent, locks via `pg_advisory_lock(0xDB_MIGRATE)`).
- Rollback strategy: forward-only migrations; rollbacks are explicit reverse migrations checked in (`0042_revert_xyz.sql`).

**Partitioning suggestion (post-launch when at scale)**
- `audit_logs`, `notifications`, `punya_transactions`, `shivir_attendance_scans` — partition BY RANGE on `created_at`/`awarded_at` monthly when row count > 50M.
- `attendance` — partition BY RANGE on session date (per academic year) at 10M rows.

---

# 6. API DESIGN

**Conventions**
- Base URL: `https://api.jainpathshala.org/v1`
- All endpoints are versioned: `/v1/...`. Future-breaking: `/v2/...`.
- All responses use the envelope: `{ data, meta?: { pagination?, request_id }, error?: { code, message, details? } }`.
- All requests authenticate via `Authorization: Bearer <jwt>` except public + auth endpoints.
- All mutating endpoints support `Idempotency-Key` header.
- Pagination: cursor-based by default (`?cursor=...&limit=20`, max 100). Lists also accept `?page=N&page_size=20` for admin grids.
- Standard query params: `sort` (e.g. `sort=created_at:desc`), `q` (search), `filter[key]=value`.
- Rate limits per role (Redis-backed):
  - Anonymous: 60 req/min/IP
  - Authenticated read: 300 req/min/user
  - Authenticated write: 60 req/min/user
  - OTP request: 3/hour/phone, 10/day/phone, 30/day/IP
  - Exam attempt submit: 5/min/user

### 6.1 Auth

| Method | Route | Auth | Roles | Body / Notes |
|---|---|---|---|---|
| POST | `/v1/auth/otp/request` | none | any | `{ phone }` → enqueues SMS. Returns 202 `{ otp_token, expires_in: 300 }`. |
| POST | `/v1/auth/otp/verify` | none | any | `{ phone, otp, device_id, platform, otp_token }` → 200 `{ access_token, refresh_token, user, role, msv_view_available, student_view_eligible }`. |
| POST | `/v1/auth/refresh` | none | any | `{ refresh_token, device_id }` → rotates both tokens. Detects reuse → revokes session. |
| POST | `/v1/auth/logout` | jwt | any | `{ device_id }` → revokes refresh token. |
| GET | `/v1/auth/me` | jwt | any | Returns full identity context. |
| POST | `/v1/auth/switch-view` | jwt | parent | `{ to: 'student' | 'parent', student_id? }` → returns new context token; subsequent requests must include header `X-View-Context: student:{student_id}` or `parent`. |
| POST | `/v1/auth/devices/register` | jwt | any | `{ device_id, fcm_token, platform }` → persists token. |
| DELETE | `/v1/auth/devices/:device_id` | jwt | any | Revokes a device session. |
| GET | `/v1/auth/devices` | jwt | any | Lists active sessions. |

**OTP rules:** 6-digit, 5-min TTL, max 5 verify attempts before invalidation. Brute-force protection via Redis `otp:verify-fail:{phone}` counter.

### 6.2 Geography

| Method | Route | Auth | Roles |
|---|---|---|---|
| GET | `/v1/geography/states` | optional | any |
| GET | `/v1/geography/states/:id/cities` | optional | any |
| POST | `/v1/admin/states` | jwt | super_admin |
| POST | `/v1/admin/cities` | jwt | super_admin, state_admin |

### 6.3 Centres & Batches

| Method | Route | Auth | Roles |
|---|---|---|---|
| GET | `/v1/centres` | optional | any (public locator). Filters: city_id, q. |
| GET | `/v1/centres/:id` | optional | any |
| POST | `/v1/admin/centres` | jwt | super_admin, state_admin, city_admin |
| PATCH | `/v1/admin/centres/:id` | jwt | super_admin, state_admin, city_admin |
| GET | `/v1/admin/centres/:id/dashboard` | jwt | city_admin+, sanchalak (own centre) |
| GET | `/v1/batches` | jwt | shikshak, sanchalak, city_admin+ |
| GET | `/v1/batches/:id` | jwt | members + admins of scope |
| POST | `/v1/admin/batches` | jwt | sanchalak, city_admin+ | Body: `{ centre_id, name, day_of_week[], start_time, end_time, age_group, shikshak_id, academic_year, capacity }` |
| PATCH | `/v1/admin/batches/:id` | jwt | sanchalak (own centre), city_admin+ |
| POST | `/v1/admin/batches/:id/assign-shikshak` | jwt | sanchalak, city_admin+ |
| GET | `/v1/admin/batches/:id/students` | jwt | shikshak (own batch), sanchalak+, city_admin+ |

### 6.4 Form Configs (Dynamic Registration)

| Method | Route | Roles |
|---|---|---|
| GET | `/v1/forms/:kind` | any — returns active form config for the caller's city (or city query param for guest) |
| GET | `/v1/admin/forms/:kind/versions` | city_admin+ |
| POST | `/v1/admin/forms/:kind/draft` | city_admin |
| POST | `/v1/admin/forms/:kind/publish` | city_admin (with audit log) |

### 6.5 Students & Enrolments

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/enrolments` | parent (creates enrolment) |
| GET | `/v1/parent/students` | parent (own children) |
| GET | `/v1/students/:id` | parent (own), student (own via view), shikshak (own batch), sanchalak+, city_admin+ |
| GET | `/v1/admin/enrolments?status=pending` | sanchalak+, city_admin+ |
| POST | `/v1/admin/enrolments/:id/approve` | sanchalak (own centre), shikshak (own batch + sanchalak co-approval), city_admin+ |
| POST | `/v1/admin/enrolments/:id/reject` | sanchalak+, city_admin+ |
| POST | `/v1/admin/students/:id/transfer` | sanchalak (within own centres), city_admin+ |
| POST | `/v1/admin/students/:id/deactivate` | sanchalak+, city_admin+ → sets status=inactive (Q11) |

### 6.6 MSV

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/msv/enrolments` | parent (apply for student) |
| GET | `/v1/admin/msv/applications` | city_admin+ |
| POST | `/v1/admin/msv/applications/:id/decide` | city_admin+ (approve/reject/waitlist — Q1) |
| POST | `/v1/admin/msv/students/:id/revoke` | city_admin+ |
| GET | `/v1/msv/dashboard` | parent (with MSV child), student-view, city_admin+ |

### 6.7 ID Cards

| Method | Route | Roles |
|---|---|---|
| GET | `/v1/students/:id/id-card` | parent (own), student-view, shikshak (own batch), sanchalak+, city_admin+ |
| POST | `/v1/admin/students/:id/id-card/regenerate` | sanchalak+, city_admin+ |
| GET | `/v1/id-cards/verify` | jwt (any admin/shikshak) | Query: `?qr=<signed_payload>` → returns student profile + validity. |

### 6.8 Attendance & Sessions

Frozen route table — see CLAUDE.md. Use only the routes listed below.

| Method | Route | Roles | Notes |
|---|---|---|---|
| GET | `/v1/sessions/today` | shikshak | Returns batches scheduled today + status. |
| POST | `/v1/sessions/:id/check-in` | shikshak | Body `{ lat, lng, accuracy_m, submission_op_id }`. Idempotent on `submission_op_id` before status assert (AT16). Distance vs `centres.gps_radius_meters`; sets `gps_flagged` when outside (AT14). `accuracy_m > 100` → unverified flag, never reject (AT15). |
| POST | `/v1/sessions/:id/check-out` | shikshak | Body `{ lat, lng, accuracy_m, submission_op_id }`. Radius-validated like check-in (AT14). |
| POST | `/v1/sessions/:id/attendance` | shikshak | Body `{ marks: [{ student_id, status, notes?, client_op_id }], submission_op_id, marked_at }`. Bulk. Same-day window on client `marked_at` IST (AT26). |
| PATCH | `/v1/sessions/:id/attendance/:student_id` | shikshak (same-day) | Edit single mark; same AT26/AT18 rules as bulk. |
| POST | `/v1/sessions/:id/cancel` | shikshak, sanchalak+, city_admin+ | Body `{ reason, force_cancel? }`. Blocked if marks exist unless `force_cancel` (AT25). |
| GET | `/v1/students/:id/attendance` | parent (own), student-view, shikshak (own), sanchalak+ | Query `month=YYYY-MM`. Percentage from AT5 SQL only. |
| POST | `/v1/students/:id/absences` | parent | Body `{ date, reason }`. |
| GET | `/v1/admin/attendance/centres/:id/log` | sanchalak (own), city_admin+ |
| POST | `/v1/admin/centres/:id/holidays` | sanchalak+, city_admin+ |
| GET | `/v1/centres/:id/holidays` | public | Published holidays only (AT30). |
| GET | `/v1/admin/centres/:id/holidays` | sanchalak+ | Full admin list (AT30). |
| POST | `/v1/sync/batch` | jwt | Single offline transport; keyed on `submission_op_id` (AT19). |

### 6.9 Punya

| Method | Route | Roles |
|---|---|---|
| GET | `/v1/students/:id/punya/balance` | parent (own), student-view, shikshak (own), sanchalak+ |
| GET | `/v1/students/:id/punya/transactions` | same as above, paginated |
| POST | `/v1/admin/punya/manual-award` | shikshak (own batch), sanchalak+, city_admin+ | Body `{ student_id, feature_key, points, reason }`. Validates against feature catalogue min/max. |
| GET | `/v1/leaderboard?scope=batch&id=…` | jwt scoped | Returns top N + caller's rank. |
| GET | `/v1/leaderboard?scope=centre&id=…` | jwt scoped |
| GET | `/v1/leaderboard?scope=city&id=…` | jwt scoped |
| GET | `/v1/leaderboard?scope=msv&id=…` | jwt scoped |
| POST | `/v1/admin/punya/features` | super_admin | CRUD feature catalogue |
| POST | `/v1/admin/punya/configs` | city_admin |
| POST | `/v1/admin/batches/:id/leaderboard-mode` | city_admin (tier-display toggle for younger ages) |

### 6.10 Niyams

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/niyams` | shikshak (batch scope), sanchalak (centre scope), city_admin (city scope) |
| GET | `/v1/niyams` | parent / student-view → returns active Niyams for student, grouped by daily/weekly/monthly |
| POST | `/v1/niyams/:id/submissions` | parent / student-view | Body `{ student_id, proof_asset_id, client_op_id }`. **Auto-approves (Q5)**: writes submission, awards Punya transactionally, emits event. |
| POST | `/v1/admin/niyam-submissions/:id/reject` | shikshak, sanchalak, city_admin | Body `{ reason }`. **Only within 30 days (Q5)**. Reverses Punya transactionally, emits notification. |
| GET | `/v1/admin/niyam-submissions` | scoped to role |
| GET | `/v1/students/:id/niyam-streaks` | parent / student-view / shikshak / admins |

### 6.11 Gallery

| Method | Route | Roles |
|---|---|---|
| GET | `/v1/gallery?city_id=&featured=true` | any (public reads only featured-and-opted-in items) |
| POST | `/v1/admin/gallery/:id/feature` | sanchalak+, city_admin+ |
| POST | `/v1/admin/gallery/:id/unfeature` | same |
| POST | `/v1/admin/gallery/:id/remove` | same |
| PATCH | `/v1/profile/gallery-visibility` | parent | Body `{ opt_in: boolean }` (Q6) |

### 6.12 Homework

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/homework` | shikshak (own batch) |
| GET | `/v1/students/:id/homework` | parent / student-view / shikshak / admins |
| POST | `/v1/homework/:id/mark-done` | parent / student-view | Acknowledgement |
| POST | `/v1/admin/homework/:id/submissions/:student_id/grade` | shikshak | Body `{ status: 'approved' \| 'starred', feedback_note? }`. Auto-awards Punya on 'approved'. |

### 6.13 Notices

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/notices` | shikshak (batch), sanchalak (centre), city_admin+ | Body includes `is_critical`, `send_sms`, `is_public`. |
| GET | `/v1/notices` | jwt — unified feed for the caller |
| GET | `/v1/notices/public` | none — for guest + website |
| POST | `/v1/notices/:id/read` | jwt |
| PATCH | `/v1/admin/notices/:id/pin` | author or city_admin+ |

### 6.14 Shivirs

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/shivirs` | city_admin+ |
| GET | `/v1/shivirs` | jwt (filtered by msv eligibility) + guest (public only) |
| POST | `/v1/admin/shivirs/:id/volunteers` | city_admin, sanchalak |
| POST | `/v1/shivir-scans` | volunteer | Body `{ shivir_session_id, qr_payload, client_op_id, scanned_at }`. Verifies QR signature; resolves student; applies in/out toggle. Idempotent. |
| GET | `/v1/admin/shivirs/:id/live` | city_admin+, sanchalak, volunteer | WebSocket also: `ws/shivirs/:id` channel. |
| GET | `/v1/admin/shivirs/:id/export?format=csv\|pdf` | city_admin+ |

### 6.15 Competitions

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/competitions` | city_admin+ |
| GET | `/v1/competitions` | jwt scoped |
| POST | `/v1/competitions/:id/register` | parent / student-view |
| POST | `/v1/admin/competitions/:id/results` | city_admin | Body `{ results: [{ student_id, rank, note }] }`. Awards Punya per defined points. |

### 6.16 Curriculum

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/curricula` | city_admin (Standard); super_admin only for MSV (Q2 — service-layer enforced) |
| GET | `/v1/admin/curricula?kind=msv\|standard` | scoped |
| POST | `/v1/admin/curricula/:id/sections` | scoped |
| POST | `/v1/admin/curricula/:id/items` | scoped |
| POST | `/v1/admin/curricula/:id/assign` | scoped — to centre/batch |
| POST | `/v1/admin/students/:id/curriculum-progress` | shikshak | Body `{ item_id, level, note? }` |
| GET | `/v1/students/:id/curriculum-progress` | scoped |

### 6.17 Exams

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/exams` | city_admin+ |
| GET | `/v1/exams` | parent / student-view (in window) |
| POST | `/v1/exams/:id/start` | parent / student-view | Body `{ student_id, exam_otp }`. Validates OTP; creates exam_attempt; returns questions paginated. |
| POST | `/v1/exam-attempts/:id/answer` | session-attempt-bound jwt |
| POST | `/v1/exam-attempts/:id/submit` | same — auto-grades MCQ/T-F; queues manual short-text |
| POST | `/v1/admin/exam-attempts/:id/grade` | city_admin | Manual short-text grading |
| POST | `/v1/admin/exams/:id/release-results` | city_admin |

### 6.18 Quizzes

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/admin/quiz-events` | city_admin+ |
| GET | `/v1/quiz-events` | parent / student-view |
| POST | `/v1/quiz-events/:id/start` | student-view |
| POST | `/v1/quiz-attempts/:id/submit` | student-view |
| POST | `/v1/shikshak/push-quizzes` | shikshak | Body `{ batch_id, questions[], expires_at }`. Pushes via WebSocket + push notification. |
| POST | `/v1/push-quizzes/:id/submit` | student-view |
| POST | `/v1/admin/question-bank/ai-generate` | super_admin | Body `{ topic, age_group, language, count }` → enqueues AI job; returns generation_id. |
| GET | `/v1/admin/question-bank/ai-generations/:id` | super_admin | Polls AI job; on `ready`, returns drafted questions for review. |
| POST | `/v1/admin/question-bank/ai-generations/:id/publish` | super_admin |

### 6.19 Service Requests

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/service-requests` | parent |
| GET | `/v1/service-requests` | parent (own) |
| GET | `/v1/admin/service-requests` | sanchalak (own centre), city_admin+ |
| POST | `/v1/admin/service-requests/:id/respond` | scoped admin |
| POST | `/v1/admin/service-requests/:id/status` | scoped admin | `{ status }` |
| POST | `/v1/admin/service-requests/:id/reassign` | scoped admin |

### 6.20 Library

| Method | Route | Roles |
|---|---|---|
| GET | `/v1/library` | any (public tier); jwt for higher tiers — filters by access_tier based on caller role/MSV |
| GET | `/v1/library/:id` | scoped |
| POST | `/v1/admin/library` | super_admin, state_admin (national/state), city_admin (city), shikshak (batch, pending sanchalak approval — separate flag) |
| POST | `/v1/admin/library/:id/approve` | sanchalak+ |
| POST | `/v1/library/:id/access-log` | any | View / download tracking (anonymised for guest) |

### 6.21 Donations

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/donations/orders` | any | Body `{ amount_paise, purpose, campaign_id?, donor_name, donor_phone, donor_email, donor_pan? }`. Creates Razorpay order. |
| POST | `/v1/donations/verify` | any | Body `{ order_id, payment_id, signature }`. Verifies HMAC; persists payment; emails receipt + 80G cert (if Q3 enabled). |
| POST | `/v1/webhooks/razorpay` | razorpay (verified signature) | Idempotent. |
| GET | `/v1/donations/me` | jwt (donor_profile) |
| GET | `/v1/admin/donations` | super_admin, city_admin (city-scoped) |
| GET | `/v1/admin/donations/export?range=…&format=csv\|xlsx` | super_admin, city_admin |
| POST | `/v1/admin/donation-campaigns` | super_admin, city_admin (city) |
| PATCH | `/v1/admin/platform-settings/80g` | super_admin | Body `{ enabled, registration_number, trust_name, trust_address }` (Q3) |

### 6.22 Notifications

| Method | Route | Roles |
|---|---|---|
| GET | `/v1/notifications` | jwt |
| POST | `/v1/notifications/:id/read` | jwt |
| POST | `/v1/notifications/read-all` | jwt |
| POST | `/v1/admin/broadcasts` | super_admin, state_admin, city_admin | Body `{ scope, content_en, content_hi, send_sms, is_critical }`. |

### 6.23 Sync (Offline)

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/sync/batch` | jwt | Body `{ ops: [{ submission_op_id, op_kind, payload }] }`. Returns per-op result. Per-item `client_op_id`s live inside payloads (AT19). |
| GET | `/v1/sync/bootstrap` | jwt | Returns initial offline-cache payload for caller's role (batches, students, niyams, last 50 notices, current punya balance). |

### 6.24 Media

| Method | Route | Roles |
|---|---|---|
| POST | `/v1/media/sign-upload` | jwt | Body `{ kind, mime, size, checksum_sha256 }` → presigned PUT URL. |
| POST | `/v1/media/finalize` | jwt | Body `{ asset_id, s3_key, checksum_sha256 }`. |
| GET | `/v1/media/:id` | jwt scoped | Returns signed GET URL (60min TTL) or CDN URL for public assets. |

### 6.25 Analytics & Exports

| Method | Route | Roles |
|---|---|---|
| GET | `/v1/admin/analytics/overview` | sanchalak+, city_admin+, state_admin, super_admin (scoped) |
| GET | `/v1/admin/analytics/attendance?range=...` | scoped |
| GET | `/v1/admin/analytics/engagement` | scoped |
| GET | `/v1/admin/analytics/donations` | scoped |
| POST | `/v1/admin/exports/students/:id` | city_admin, sanchalak (own) → enqueues PDF generation job; returns export_id |
| POST | `/v1/admin/exports/centres/:id/all-students` | city_admin → bulk ZIP |
| GET | `/v1/admin/exports/:id` | requester | poll status; returns asset_id when ready |
| GET | `/v1/admin/audit-logs` | scoped (city for city_admin, all for super_admin) |

### 6.26 Public/Website

| Method | Route |
|---|---|
| GET | `/v1/public/centres` |
| GET | `/v1/public/notices` |
| GET | `/v1/public/shivirs` |
| GET | `/v1/public/library` |
| GET | `/v1/public/achievements` |
| GET | `/v1/public/gallery` |
| POST | `/v1/public/enrolment-enquiry` |
| POST | `/v1/public/contact` |

### 6.27 Validation Standards
- Every DTO has a paired Zod schema in `packages/shared/schemas/`.
- All bilingual fields require BOTH `_en` and `_hi` when creating/updating; missing one returns 422 with `error.code = 'BILINGUAL_FIELDS_REQUIRED'`.
- Phone validation: E.164 (`+91…`).
- All UUIDs validated against UUID v4 regex.
- All datetimes ISO 8601 with timezone.

### 6.28 Caching Strategy
- `GET /v1/public/*` — Edge-cached 60s via CDN.
- `GET /v1/centres`, `/v1/leaderboard/*` — Redis-cached 60s, invalidated on relevant writes.
- `GET /v1/id-cards/verify` — Redis-cached 10s per qr_payload.
- `GET /v1/library` (public tier) — Redis-cached 5min.
- All caches keyed with role + scope to prevent cross-tenant leakage.

---

# 7. AUTHENTICATION & AUTHORIZATION

### 7.1 Login Flow
1. User enters phone on `(auth)/login` screen → `POST /v1/auth/otp/request`.
2. Backend: rate-limit check → generate 6-digit OTP → store `otp:{phone}` in Redis (TTL 300s) as bcrypt hash → enqueue SMS via `SmsQueue.sendOtp` → return `otp_token` (opaque, used to bind verify to request).
3. User receives SMS → enters OTP → `POST /v1/auth/otp/verify`.
4. Backend: compare hash → on success, resolve user by phone:
   - If user not found → check Guest-enquiry path; reject for OTP login.
   - If found → issue access JWT (15min) + refresh JWT (30d), persist `device_sessions` row with bcrypt(refresh).
5. On verify failure → increment `otp:verify-fail:{phone}` Redis counter; after 5 fails, invalidate OTP.

### 7.2 JWT Strategy
- **Algorithm:** RS256 (keypair in AWS Secrets Manager, rotated quarterly).
- **Access token claims:** `sub` (user_id), `role`, `city_id`, `centre_ids` (sanchalak), `batch_ids` (shikshak), `view` (`parent`|`student:{id}`), `jti`, `iat`, `exp` (15min).
- **Refresh token claims:** `sub`, `sid` (session_id), `iat`, `exp` (30d), `jti`.
- **Key rotation:** Two valid public keys at any time. Old key remains valid 24h post-rotation.

### 7.3 Refresh Token Rotation
- On `POST /v1/auth/refresh`, server validates `sid` exists and not revoked.
- Hash incoming refresh → compare against stored `refresh_token_hash`.
- On match: issue new pair, replace stored hash atomically.
- **Reuse detection:** If a refresh token is presented whose hash was already rotated → mark session compromised, revoke all sessions for the user, send security notification.

### 7.4 Device Session Management
- Each login creates a `device_sessions` row.
- Max 5 active devices per user; oldest revoked on overflow.
- `GET /v1/auth/devices` returns active sessions; user can revoke individually.

### 7.5 Student View Toggle (Q4)
- Parent's access token includes `view: 'parent'`.
- `POST /v1/auth/switch-view { to: 'student', student_id }`:
  - Server verifies the student belongs to the parent and is ≥13.
  - Issues a new access token with `view: 'student:{id}'` (same `sub`).
  - Returns new access token; refresh token unchanged.
- All read endpoints check `view` to scope responses to the active context.
- Switching back: `POST /v1/auth/switch-view { to: 'parent' }`.

### 7.6 RBAC Hierarchy

Role precedence (high → low): `super_admin > state_admin > city_admin > sanchalak > shikshak > parent > student > guest`.

**Hierarchy rule:** A role can perform any action permitted to roles below it within its scope.

### 7.7 Permissions Matrix (Excerpt — full matrix in `src/common/access/permissions.matrix.ts`)

| Action | Roles |
|---|---|
| `centre.create` | super_admin, state_admin (own state), city_admin (own city) |
| `centre.update` | sanchalak (own centre), city_admin+ |
| `batch.create` | sanchalak (own centre), city_admin+ |
| `student.enrol` | parent (own child); sanchalak/city_admin can also create |
| `enrolment.approve` | sanchalak (own centre), city_admin+ |
| `attendance.mark` | shikshak (own batch) |
| `session.cancel` | shikshak (own batch), sanchalak (own centre), city_admin+ |
| `punya.manual_award` | shikshak (own batch student), sanchalak+, city_admin+ |
| `niyam.create.batch_scope` | shikshak (own batch) |
| `niyam.create.centre_scope` | sanchalak (own centre) |
| `niyam.create.city_scope` | city_admin |
| `niyam_submission.reject` | shikshak (own batch), sanchalak+, city_admin+ (within 30 days) |
| `gallery.feature` | sanchalak (own centre), city_admin |
| `notice.create.critical_sms` | city_admin+ |
| `notice.create.public` | city_admin+ |
| `msv.curriculum.create` | super_admin only (Q2) |
| `msv.application.decide` | city_admin+ (Q1) |
| `donation.config.80g` | super_admin (Q3) |
| `audit_logs.read` | scoped: sanchalak (own centre), city_admin (own city), super_admin (national) |
| `student.export.pdf` | sanchalak (own centre students), city_admin (city) |
| `question_bank.ai_generate` | super_admin |

### 7.8 Guards & Decorators

```ts
@UseGuards(JwtAuthGuard, RolesGuard, ScopeGuard)
@Roles('city_admin', 'sanchalak')
@Scope('centre')   // ScopeGuard reads route param :centreId and asserts caller has access
@Post('/v1/admin/centres/:centreId/batches')
```

`ScopeGuard` resolves a per-route scope check from `scope-rules.ts`. Example: for `Scope('centre')`, it verifies `actor.role === 'sanchalak'` and `centreId IN actor.centre_ids`, OR `actor.role >= 'city_admin'` and `centre.city_id === actor.city_id`.

### 7.9 Admin Impersonation
- `super_admin` may issue an impersonation token: `POST /v1/admin/impersonate { target_user_id, reason, ttl_minutes }`.
- New token includes `impersonator_user_id` and `expires_in ≤ 30min`.
- Every action under impersonation is double-logged: actor (target) + `impersonated_by`.

### 7.10 Brute Force & API Rate Limiting
- Redis-backed sliding window.
- Per-IP and per-user counters.
- Special tighter limits on: `/auth/otp/*`, `/donations/*`, `/exam-attempts/*`.

### 7.11 Audit Logging Triggers
- All `POST/PATCH/DELETE` actions automatically intercepted by `AuditInterceptor`.
- The interceptor writes to `audit_logs` with diff of `before` and `after`.
- Login, logout, refresh-reuse, impersonation start/end, OTP failures (5+) — all logged.

---

# 8. BUSINESS LOGIC & EDGE CASES

### 8.1 Enrolment Workflow
1. Parent submits enrolment via `POST /v1/enrolments` with selected centre + batch + student details + dynamic form responses.
2. **Validation:** centre is active, batch is within centre, age_group matches batch, parent phone not duplicated.
3. Creates `enrolment` row with `status='pending'`; if parent user doesn't exist, creates one.
4. Notification fans out to centre's sanchalak and the batch's shikshak.
5. Approver opens enrolment → reviews → `POST /admin/enrolments/:id/approve`:
   - Service runs in DB transaction:
     - Creates `students` row, generates `student_code` (deterministic counter per centre).
     - Sets enrolment status, decided_at, reviewer_user_id.
     - Generates digital ID card (queued).
     - Emits `enrolment.approved` event → notifications.
6. **Edge case — batch capacity:** if `batch.capacity` reached, approval returns 409 `BATCH_FULL`; admin must reassign.
7. **Edge case — duplicate child:** detected via `(parent_user_id, full_name, dob)`; warns admin but allows override.
8. **Edge case — orphan student:** parent deletes account → students remain (parent_user_id nullable); admin must reassign.

### 8.2 GPS Check-In Logic
Binding: CLAUDE.md AT8, AT13–AT16.
1. Shikshak opens "Today's Sessions" → taps Check-In on a scheduled session (or soft-creates if none — AT8).
2. Client captures `lat, lng, accuracy_m` and sends them; client MUST NOT reject on accuracy.
3. POST `/v1/sessions/:id/check-in` with `submission_op_id`.
4. Server (order matters — AT16):
   - Idempotency FIRST: same shikshak + same `submission_op_id` → 200 existing session.
   - Different `shikshak_user_id` on already-checked-in session → 409 + notify Sanchalak.
   - Then status handling; compute Haversine from centre; set `check_in_*`, `check_in_accuracy_m`, status=`in_progress`.
   - If distance > `centre.gps_radius_meters`: allow check-in, set `gps_flagged=true`, notify Sanchalak (AT14).
   - If `accuracy_m > 100`: set `check_in_unverified=true` / flag — do NOT reject (AT15).
5. **No-show:** `attendance.no_show_check` every 15 min (frozen cron table).
6. Check-out uses the same radius validation and stores `check_out_distance_m` (AT14).

### 8.3 Attendance Marking (Online + Offline)
Binding: CLAUDE.md AT2–AT6, AT17–AT26, AT31.
1. Shikshak opens batch attendance screen; covered absences pre-fill `'excused'` (AT4).
2. Client either calls `/v1/batches/:id/students` (online) or reads cached roster from MMKV (offline).
3. Marks each student; generate `submission_op_id` once per submission and a `client_op_id` per mark (AT19, both char(26) ULID).
4. Online: POST `/v1/sessions/:id/attendance { marks, submission_op_id, marked_at }` immediately.
5. Offline: write to MMKV `pending_attendance`; drain via `POST /v1/sync/batch`.
6. **Idempotency:** `sync_operations` keyed on `submission_op_id`. Cancelled session → 409 `ERR_SESSION_CANCELLED` inside the marking transaction (AT24).
7. Transactional logic (AT17–AT22):
   ```
   BEGIN;
     assert session.status <> 'cancelled';
     for each mark: upsert attendance; bump revision only when award-worthiness/value changes;
     award-worthiness transitions = reverse-then-award (never bare second award);
     INSERT punya_transactions ... ON CONFLICT DO NOTHING RETURNING;
     credit balance ONLY by returned rows (AT20);
     points from punya_features (city→global), Redis-cached (AT21);
     streak bonus every 4 attended sessions, repeating (AT22);
     consume covering absence_notifications.resolved_at (AT4);
   COMMIT;
   ```
8. Same-day edit window: Asia/Kolkata against client `marked_at`, enforced on bulk AND PATCH (AT26).
9. Parent push debounced 5 min per (student, session); admin Socket.IO feed 10s aggregates (AT31).
10. **Edge case — student transferred mid-day:** attendance still applies to original batch; manual reconciliation by sanchalak.

### 8.4 Niyam Submission & Auto-Approval (Q5)
1. Parent uploads photo via `/v1/media/sign-upload` → S3 → `/v1/media/finalize`.
2. Submits Niyam: `POST /v1/niyams/:id/submissions { student_id, proof_asset_id, client_op_id }`.
3. Transaction:
   ```
   BEGIN;
     INSERT niyam_submissions(status='auto_approved', auto_approved_at=now());
     INSERT punya_transactions(idempotency_key="niyam_sub:{submission_id}", ...);
     UPDATE punya_balances;
     INSERT INTO gallery_items (visibility resolved at query-time via parent opt-in);
     Trigger niyam_streaks update (Niyam type aware);
   COMMIT;
   Emit niyam.submitted event;
   ```
4. **Streak logic:**
   - For `daily`: streak increments by 1 if `last_completion_date = today - 1`; resets to 1 if gap; updates if same-day duplicate is ignored.
   - For `weekly`: increments if `last_completion_date` is within previous ISO week; resets if gap.
   - For `monthly`: increments if `last_completion_date` is in previous calendar month.
   - Badge awarded at thresholds (7-day, 30-day, 4-week, 3-month).
5. **Retroactive rejection** (`POST /admin/niyam-submissions/:id/reject`):
   - Asserts `submitted_at >= now() - 30 days`.
   - Transactional:
     ```
     BEGIN;
       UPDATE niyam_submissions SET status='rejected', rejected_at, rejected_by, rejection_reason;
       INSERT punya_transactions(points = -original.points, reversal_of=original_txn_id, ...);
       UPDATE punya_balances (atomic decrement);
       UPDATE gallery_items SET removed=true;
       Recompute niyam_streaks (may break streak retroactively);
     COMMIT;
     Emit niyam.rejected event;
     ```
6. **Edge case — Niyam ended before submission processed:** allowed; the submission's `submitted_at` is checked against `niyam.end_date`.

### 8.5 Punya Concurrency
- All Punya writes use `idempotency_key` unique index → safe under retries.
- `punya_balances` updated via `INSERT ... ON CONFLICT (student_id) DO UPDATE SET total_points = punya_balances.total_points + EXCLUDED.delta`.
- Leaderboards in Redis updated via `ZINCRBY` after the DB transaction commits (event listener pattern).
- **Reconciliation job** (nightly): re-aggregates ledger and corrects any drift in `punya_balances`.

### 8.6 Shivir Scan Logic (In/Out vs Present-Only)
1. Volunteer scans QR → parses signed payload → extracts `student_id`.
2. Verifies signature against current HMAC secret; if invalid → 400.
3. Resolves student → checks `shivir_registrations`.
4. **In/Out mode:**
   - Look up latest `shivir_attendance_scans` for `(student_id, session_id)`:
     - None → insert `check_in`.
     - Last is `check_in` → insert `check_out`.
     - Last is `check_out` → insert new `check_in` (re-entry — valid for multi-entry sessions).
5. **Present-Only mode:** insert `present` if no prior scan for same session; else 409.
6. Push notification to parent emitted immediately.
7. WebSocket emits to `shivir:{event_id}` channel with delta — admin dashboard updates live.
8. **Offline:** volunteer's app queues scans in MMKV. On sync, `client_op_id` provides idempotency.

### 8.7 Notice Critical SMS Fallback
- City admin posts notice with `is_critical=true, send_sms=true`.
- Event `notice.created` → `NotificationsListener` builds recipient list.
- For each recipient: push job → if `send_sms`, also enqueue SMS job (per-recipient).
- SMS body truncated to 160 chars; English by default unless user `preferred_language='hi'` (Devanagari uses Unicode SMS — fewer chars per segment; we calculate segments).
- Cost tracking via `sms_logs`.

### 8.8 Donation 80G Flow (Q3)
1. Client calls `POST /v1/donations/orders` with optional PAN.
2. Razorpay order created; client invokes Razorpay checkout SDK.
3. On client success: `POST /v1/donations/verify { order_id, payment_id, signature }`.
4. Backend verifies HMAC SHA256 (`razorpay_payment_id|order_id` with secret).
5. Updates `donations.status='captured'`; generates receipt PDF.
6. **If `platform_settings.eighty_g_enabled=true`:** generates 80G certificate PDF (separate template), attaches `eighty_g_certificate_asset_id`.
7. Emails both via Resend; pushes notification to donor if signed in.
8. **Webhook `POST /v1/webhooks/razorpay`** is the source of truth — handles late captures and refunds.

### 8.9 Exam OTP Access Control
- Admin sets numeric OTP at creation, stored hashed.
- Parent enters OTP at start; server verifies; sets `otp_verified_at` on the attempt.
- All subsequent answer/submit endpoints require the attempt's JWT-issued attempt token.
- **Edge case — OTP shared:** if multiple students submit attempts with same OTP, allowed (it's a class-wide OTP, not per-student).
- Max attempts enforced per `(exam_id, student_id)`.

### 8.10 Idempotency Keys
- Offline batch transport uses `submission_op_id` in `sync_operations` (AT19).
- Attendance Punya keys: `attendance:{session_id}:{student_id}:{revision}` (AT17).
- General POST endpoints may also accept `Idempotency-Key` header (Redis `idem:{user_id}:{key}` TTL 24h).
- Repeating the same key returns the original response.

### 8.11 Conflict Resolution (Offline Sync)
- `sync_operations.submission_op_id` is the batch replay key (AT19); per-row `client_op_id` is for item repair only.
- For attendance: cancelled session → 409 `ERR_SESSION_CANCELLED` (AT24). Same-day edits use client `marked_at` IST (AT26). Corrections use reverse-then-award (AT18).
- For Niyam submissions: each upload generates new op IDs; multiple submissions allowed.

### 8.12 Soft-Delete Strategy
- Tables with `deleted_at` excluded from default queries via Drizzle's `withDeleted: false` pattern.
- Admin "restore" endpoint per critical entity.
- Audit logs always include soft-delete and restore events.

### 8.13 Birthday Wishes (Automated)
- Daily scheduler `birthday-wishes.job` runs at 06:00 IST (cron tz-aware).
- Query: students where `EXTRACT(MONTH FROM dob) = today_month AND EXTRACT(DAY FROM dob) = today_day AND status='active'`.
- For each: enqueue in-app notification + push to parent; bulk notification to shikshak listing birthday students in their batch.

### 8.14 Monthly Progress Report Generation
- Scheduler `monthly-progress-report.job` runs on 1st of each month at 02:00 IST.
- For each active student: enqueues `ReportGenerationQueue.generate` job (chunked, 500 at a time).
- Worker:
  - Aggregates attendance %, homework completion, niyam streaks, punya tier, top niyams, curriculum %.
  - Renders HTML via Handlebars template (bilingual).
  - Puppeteer → PDF.
  - Uploads to S3, persists `progress_reports` row, sends notification to parent.
- **Termly variant**: same flow but at end of academic term; shikshak gets a 7-day window to add `shikshak_comment` before parent release.

### 8.15 Consecutive Absence Flag
- Scheduler: `attendance.consecutive_check` at **02:00 IST** the following day (AT27).
- For each active student: three consecutive `'absent'` rows (excused never counts; holidays/cancelled skipped).
- Notify parent + **Sanchalak** + city_admin (AT27).

### 8.16 Leaderboard Monthly Reset
- Scheduler runs 1st of month at 00:30 IST.
- Snapshots current Redis sorted sets to materialised view `mv_monthly_leaderboard_city`.
- Awards monthly top-student badges + certificates (queued).
- Resets Redis zsets for `lb:*:monthly:*` keys.
- Cumulative leaderboards persist.

### 8.17 Concurrency on Singleton-ish Settings
- `platform_settings` is a single-row table with `id='global'`.
- Updates wrapped in `SELECT FOR UPDATE` to prevent dirty writes.

---

# 9. REALTIME + QUEUE ARCHITECTURE

### 9.1 BullMQ Queues (single source of truth: `infra/queue/queue-names.ts`)

```ts
export const QUEUES = {
  AUTH_SMS_OTP:               'auth.sms.otp',
  NOTIFICATIONS_PUSH:         'notifications.push',
  NOTIFICATIONS_SMS:          'notifications.sms',
  NOTIFICATIONS_EMAIL:        'notifications.email',
  NOTIFICATIONS_FANOUT:       'notifications.fanout',
  ATTENDANCE_POST_PROCESS:    'attendance.post_process',
  PUNYA_LEADERBOARD_REFRESH:  'punya.leaderboard.refresh',
  PUNYA_TIER_RECOMPUTE:       'punya.tier.recompute',
  PUNYA_RECONCILE:            'punya.reconcile',
  NIYAM_STREAK_RECOMPUTE:     'niyam.streak.recompute',
  GALLERY_VISIBILITY_UPDATE:  'gallery.visibility.update',
  MEDIA_PROCESSING:           'media.processing',
  MEDIA_VIRUS_SCAN:           'media.virus_scan',
  MEDIA_THUMBNAIL:            'media.thumbnail',
  MEDIA_EXIF_STRIP:           'media.exif_strip',
  ID_CARD_GENERATION:         'idcard.generation',
  REPORT_GENERATION:          'report.generation',
  EXPORT_STUDENT_PDF:         'export.student.pdf',
  EXPORT_BULK_ZIP:            'export.bulk.zip',
  DONATION_RECEIPT_PDF:       'donation.receipt.pdf',
  DONATION_80G_CERT:          'donation.eightyg.cert',
  AUDIT_WRITE:                'audit.write',
  AI_QUIZ_GENERATE:           'ai.quiz.generate',
  AI_MODERATION:              'ai.moderation',
  AI_TRANSLATE:               'ai.translate',
  AI_REPORT_SUMMARISE:        'ai.report.summarise',
  ANALYTICS_AGGREGATION:      'analytics.aggregation',
  SHIVIR_LIVE_BROADCAST:      'shivir.live.broadcast',
  WEBHOOK_RAZORPAY:           'webhook.razorpay',
  SYNC_DEAD_LETTER:           'sync.dead_letter',
} as const;
```

### 9.2 Worker Responsibilities

| Queue | Worker | Concurrency | Retry | Description |
|---|---|---|---|---|
| `auth.sms.otp` | `OtpSmsWorker` | 50 | 3 attempts, 2s backoff | Send OTP via MSG91 |
| `notifications.fanout` | `NotificationFanoutWorker` | 20 | 3, exp backoff | Resolves recipients, enqueues per-recipient push jobs |
| `notifications.push` | `PushDeliveryWorker` | 100 | 5, exp backoff (1s→32s) | FCM batched send (500/batch) |
| `notifications.sms` | `SmsDeliveryWorker` | 30 | 3, exp | MSG91 per-recipient |
| `notifications.email` | `EmailDeliveryWorker` | 20 | 3, exp | Resend |
| `attendance.post_process` | `AttendancePostProcessWorker` | 10 | 3 | Streak updates, leaderboard zincrby |
| `punya.leaderboard.refresh` | `LeaderboardRefreshWorker` | 1 (repeatable every 60s) | n/a | Recomputes Redis zsets from DB delta |
| `punya.tier.recompute` | `TierRecomputeWorker` | 10 | 3 | Determines tier transitions, emits notification |
| `niyam.streak.recompute` | `NiyamStreakWorker` | 10 | 3 | Recompute on submission insert or rejection |
| `media.processing` | `MediaProcessingWorker` | 20 | 3 | Thumbnails, EXIF strip via sharp |
| `media.virus_scan` | `VirusScanWorker` | 10 | 2 | ClamAV (or no-op stub in dev) |
| `idcard.generation` | `IdCardGenerationWorker` | 10 | 3 | SVG → PNG via Puppeteer, persists asset |
| `report.generation` | `ReportGenerationWorker` | 5 | 2 | Puppeteer PDFs, large workload |
| `export.student.pdf` | `StudentExportWorker` | 5 | 2 | Full per-student PDF |
| `export.bulk.zip` | `BulkZipExportWorker` | 2 | 1 | Streams ZIP to S3 |
| `donation.receipt.pdf` | `DonationReceiptWorker` | 10 | 3 | Renders + emails receipt |
| `donation.eightyg.cert` | `EightyGCertWorker` | 10 | 3 | Renders + emails 80G cert |
| `audit.write` | `AuditWriteWorker` | 50 | 5 | Async write of audit logs (off the request path) |
| `ai.quiz.generate` | `AiQuizGenerateWorker` | 5 | 2 | Calls FastAPI; persists draft questions |
| `ai.moderation` | `AiModerationWorker` | 10 | 2 | Niyam media moderation (async/non-blocking) |
| `analytics.aggregation` | `AnalyticsAggregationWorker` | 1 (cron nightly) | n/a | Refreshes materialised views |
| `shivir.live.broadcast` | `ShivirLiveBroadcastWorker` | 30 | 2 | Publishes scan deltas to Socket.IO room |
| `webhook.razorpay` | `RazorpayWebhookWorker` | 20 | 5 | Idempotent capture/refund processing |

### 9.3 Dead-Letter Strategy
- Each queue has a paired DLQ: e.g. `notifications.push.dlq`.
- Jobs that exhaust retries are moved to DLQ + Sentry alert + email to ops list.
- Admin UI page `/admin/system/queues` lists DLQ depths, top failing jobs, supports requeue + purge.

### 9.4 WebSocket Events

Socket.IO with Redis adapter. Namespaces:
- `/shivirs` — `subscribe { event_id }` → joins room; receives `scan.added`, `dashboard.updated`.
- `/push-quizzes` — `subscribe { batch_id }` → receives `quiz.created`, `quiz.expired`.
- `/admin-dashboard` — receives `notice.broadcast`, live counts. Attendance live counts are **10-second windowed aggregates**, not one event per mark (AT31).

All clients send `auth { token }` on connect; server validates JWT before joining rooms.

### 9.5 Scheduled Jobs (BullMQ repeatable / @nestjs/schedule)

**Single source:** CLAUDE.md **"Cron table (frozen — single list)"**. Do not maintain a second conflicting schedule here.

| Cron | Job | Kind |
|---|---|---|
| `0 1 * * *` IST | `session.materialise` | @nestjs/schedule |
| `*/15 * * * *` | `attendance.no_show_check` | @nestjs/schedule |
| `*/30 * * * *` | `attendance.auto_checkout` | @nestjs/schedule |
| `0 2 * * *` IST | `attendance.consecutive_check` | @nestjs/schedule (AT27) |
| `0 6 * * *` IST | `notifications.birthday` | @nestjs/schedule |
| `0 2 1 * *` IST | `notifications.monthly_reports` | @nestjs/schedule |
| every 5 min | `punya.leaderboard.refresh` | BullMQ queue |
| `0 3 * * *` IST | `punya.reconcile` | BullMQ queue |
| `0 4 * * *` IST | `analytics.refresh_views` | @nestjs/schedule |
| `0 7 * * 1` IST | `digest.weekly.email` | @nestjs/schedule |
| `30 2 * * *` IST | `auth.session.cleanup` | @nestjs/schedule |
| `30 3 * * *` IST | `media.cleanup_unfinalized` | @nestjs/schedule |
| `30 0 1 4 *` IST | `donation.eightyg.year_end_summary` | @nestjs/schedule |
| `30 0 1 * *` IST | `leaderboard-monthly-reset.job` | @nestjs/schedule |
| `0 4 * * *` IST | `sync-operations-purge.job` (>90d) | @nestjs/schedule |
| `0 5 * * *` IST | `niyam-streak-reset.job` | @nestjs/schedule |

---

# 10. FILE & MEDIA ARCHITECTURE

### 10.1 Upload Flow
1. Client calls `POST /v1/media/sign-upload` with `{ kind, mime, size, checksum_sha256 }`.
2. Server validates:
   - `kind` in allowlist; matches caller's permission.
   - `mime` in per-kind allowlist (e.g. `niyam_proof`: jpeg, png, webp, mp4, mov).
   - `size` ≤ per-kind max (photos 25MB, videos 100MB).
3. Server inserts `media_assets` row with `status='pending'`.
4. Generates S3 key: `{kind}/{yyyy}/{mm}/{user_id}/{uuid}.{ext}`.
5. Generates presigned PUT URL (TTL 300s) with `Content-MD5` enforcement.
6. Returns `{ asset_id, upload_url, s3_key, headers }`.
7. Client PUTs directly to S3.
8. Client calls `POST /v1/media/finalize { asset_id, s3_key, checksum_sha256 }`.
9. Server verifies S3 object exists via HEAD; size matches; updates `status='uploaded'`; enqueues `media.processing`.

### 10.2 Processing Pipeline
- `MediaProcessingWorker`:
  - Downloads original (streaming).
  - Strips EXIF (privacy).
  - For images: generates `thumbnail_240`, `thumbnail_720`, `original_optimised` via sharp.
  - For videos: generates first-frame thumbnail; no transcode for v1 (later: HLS via MediaConvert).
  - Uploads derived assets to S3 under `{original_key}_thumb240.webp` etc.
  - On success: `status='ready'`.
  - On failure: `status='failed'`, error logged, parent submission flagged for review.
- Optional async `ai.moderation` job for `niyam_proof` kind: AI service returns `safe|unsafe|flagged`. If `unsafe`: `status='quarantined'`, Gallery item hidden, admin notified.

### 10.3 Signed GET URLs
- `GET /v1/media/:id` returns CDN URL (CloudFront signed URL, 60min TTL) for ready assets that caller is authorised to view.
- Authorisation checks per kind:
  - `niyam_proof` → asset.owner_user_id, asset.student.parent_user_id, student's shikshak, sanchalak, city_admin+.
  - `student_photo`, `id_card` → student's parent, student-view, shikshak (own batch), sanchalak+, city_admin+.
- Public-tier library assets → public CDN URL (unsigned).

### 10.4 Bucket Structure
- `jp-prod-media-private` (R2): all user-uploaded media; private; CloudFront signed access.
- `jp-prod-media-public` (R2): public library content; CloudFront public access.
- `jp-prod-exports` (R2): ephemeral PDFs/ZIPs (lifecycle: delete after 30d).
- `jp-prod-receipts` (R2): donation receipts + 80G certs (lifecycle: keep 7 years).
- `jp-prod-backups` (S3): RDS automated snapshots, infra backups.

### 10.5 Validation & Security
- MIME sniffing via `file-type` package on processing worker (defense vs spoofed extensions).
- Max upload bytes enforced both client-side (Expo file picker) and at presigned URL (`Content-Length`).
- ClamAV (cluster, separate ECS service) wired post-launch for full virus scanning — wired in `media.virus_scan` queue.
- All public bucket policies use CloudFront-only access (origin access identity).
- No bucket allows public list.

### 10.6 Lifecycle / Cleanup
- Daily cron `media-orphan-cleanup`: deletes S3 objects whose `media_assets.status='pending'` for > 24h (upload abandoned).
- Quarterly cron archives `media_assets` where `deleted_at IS NOT NULL` for > 90d to cold storage.

---

# 11. OFFLINE-FIRST ARCHITECTURE

### 11.1 Local Storage Layout (MMKV)

```
MMKV instances:
  jp.auth                   → access_token, refresh_token, user, view
  jp.queue.attendance       → array<PendingAttendanceOp>
  jp.queue.checkin          → array<PendingCheckInOp>
  jp.queue.checkout         → array<PendingCheckOutOp>
  jp.queue.shivir_scans     → array<PendingShivirScanOp>
  jp.queue.niyam_uploads    → array<PendingNiyamUploadOp>
  jp.cache.batches          → batch roster snapshots
  jp.cache.students         → student roster per batch
  jp.cache.niyams           → active niyams for student
  jp.cache.notices          → last 50 notices
  jp.cache.id_card          → png base64 + meta
  jp.cache.punya_balance    → last seen balance
  jp.bootstrap.version      → last bootstrap epoch
```

### 11.2 Sync Engine
- Singleton: `apps/mobile/src/sync/sync-engine.ts`.
- Triggered on:
  - App foreground (NetInfo listener)
  - Connectivity change (offline → online)
  - Background timer every 30s when online
- Flow per cycle:
  1. Collect all pending ops from all queues.
  2. Group into a single `POST /v1/sync/batch { ops }` request (max 100 ops per batch).
  3. Process per-op result:
     - `success` → remove from MMKV; update local cache.
     - `duplicate` → remove from MMKV; treat as success.
     - `failed` (retryable) → keep in queue; increment local attempt counter; on counter > 5 → move to `dead_letter` MMKV; surface in "Sync Issues" screen.
- Optimistic UI: mutations write to MMKV + update Zustand store immediately; UI shows green checkmark with cloud-with-arrow icon → green-only on confirmed sync.

### 11.3 Retry Policy
- Local exponential backoff: 5s, 15s, 60s, 5min, 30min.
- Network errors trigger retry; HTTP 4xx (except 409/429) move to dead-letter immediately.

### 11.4 Conflict Resolution
- Idempotent operations on server via `submission_op_id` / per-row `client_op_id` (AT19, Section 8.10).
- Server may return `duplicate` → client treats as success.
- For data freshness (e.g. notices), server returns `etag` per resource; client refetches if stale.

### 11.5 Bootstrap Hydration
- On first login or major version upgrade: `GET /v1/sync/bootstrap` returns:
  - User profile, view context
  - Linked children + their batches + shikshak info
  - Active niyams per child
  - Last 50 notices (unified feed)
  - Current punya balance per child
  - ID card PNG references
  - Centre holidays
- Stored in MMKV under `jp.cache.*` keys. Version-stamped.

### 11.6 Stale Cache Strategy
- Each cache entry has `fetched_at`.
- UI shows "Last updated" banner on home screen.
- Background refresh: cache > 4h triggers silent refetch on app open.
- Critical reads (homework deadlines, niyam end_date) always fetch live when online.

### 11.7 Offline UI Indicators
- Top banner when offline: "Offline — changes will sync when you're back online."
- Sync Issues drawer accessible from any screen — lists dead-letter ops with retry/discard.
- Attendance roster shows "pending sync" badge per submission.

---

# 12. ANALYTICS & REPORTING

### 12.1 Architecture
- **Hot path**: Redis counters for daily/weekly rolling metrics (attendance %, active users, niyam submissions/day).
- **Warm path**: Postgres materialised views refreshed nightly — canonical names only (CLAUDE.md frozen MV table): `mv_centre_engagement`, `mv_city_attendance_monthly`, `mv_donation_summary`, `mv_msv_funnel`, `mv_punya_distribution`, `mv_niyam_completion`, `mv_monthly_leaderboard_city`.
- **Cold path**: Optional future export to S3 + Athena for BI; not required at launch.

### 12.2 Materialised Views (DDL summary)

```sql
CREATE MATERIALIZED VIEW mv_centre_engagement AS
  SELECT centre_id, academic_month,
    attendance_rate, homework_completion_rate,
    niyam_completion_rate, total_punya_awarded,
    active_students
  FROM (
    -- per-centre aggregation joining attendance, homework_submissions, niyam_submissions, punya_transactions
    ...
  );
CREATE UNIQUE INDEX ... ON mv_centre_engagement (centre_id, academic_month);
```

Refreshed via `analytics.aggregation` worker nightly.

### 12.3 Dashboards
- **Sanchalak** (`/admin/dashboard`):
  - Today's sessions + shikshak check-in status
  - Centre attendance rate (this month)
  - Niyam submissions awaiting nothing (auto-approve — so "this week's submissions")
  - Open service requests
  - Gallery items pending review
- **City Admin**:
  - Centres summary (cards)
  - Trend charts: attendance, homework completion, punya distribution
  - MSV funnel (applied → approved → active)
  - Donation summary
- **State/Super Admin**:
  - All cities — centre counts, student counts, attendance heatmap
  - National Shivir calendar
  - SMS cost tracker
  - 80G config status

### 12.4 PDF Generation
- Stack: Puppeteer + Handlebars templates in `apps/api/src/templates/`.
- Templates:
  - `progress-report.hbs` (monthly + termly)
  - `donation-receipt.hbs`
  - `eighty-g-certificate.hbs`
  - `student-full-export.hbs`
  - `id-card.hbs` (also used for SVG)
  - `monthly-top-student-certificate.hbs`
- Brand tokens (saffron/maroon/cream) resolve from `packages/design-tokens` CSS variables; Puppeteer renders with same theme.

### 12.5 Per-Student PDF Export
- `POST /v1/admin/exports/students/:id` → enqueues `export.student.pdf` job → returns `export_id`.
- Worker:
  - Loads all entities: personal info, enrolment timeline, attendance history (paginated), homework, punya ledger, niyam completions, competition results, MSV status changes.
  - Renders multi-section PDF (~10–30 pages).
  - Uploads to `jp-prod-exports`.
  - Persists `media_assets` row.
  - Pushes notification to requester.

### 12.6 Bulk ZIP Export
- `POST /v1/admin/exports/centres/:id/all-students` → queues `export.bulk.zip`.
- Worker streams ZIP to S3 using multipart upload (`archiver` + S3 stream).
- For very large centres: chunks output into multiple ZIPs (max 500MB each); manifest CSV included.

### 12.7 Scheduled Email Reports
- Weekly digest job: every Monday 06:00 IST.
- Recipients: `sanchalak` (centre summary), `city_admin` (city rollup), `super_admin` (national).
- Email via Resend with embedded charts (PNG generated server-side via Chart.js).

---

# 13. SEED DATA

Seed scripts in `apps/api/scripts/seed/`. Run order: `pnpm seed:dev` executes `seed-all.ts` which calls each module in dependency order.

### 13.1 Geography
- 5 states: Maharashtra, Gujarat, Rajasthan, Karnataka, Madhya Pradesh.
- 12 cities across them: Mumbai, Pune, Ahmedabad, Surat, Vadodara, Jaipur, Udaipur, Bengaluru, Mysuru, Bhopal, Indore, Ujjain.

### 13.2 Users (roles)
- 1 `super_admin`: `+919900000001` / name "Acharya Anand"
- 3 `state_admin`s (MH, GJ, RJ).
- 12 `city_admin`s (one per city).
- 30 `sanchalak`s.
- 80 `shikshak`s (mix of male/female; M → Guruji, F → Didi).
- 5,000 `parent`s with 7,500 children total (some with multiple).
- 800 of those students aged ≥13 (eligible for student-view).
- 600 students marked `msv_status='approved'`.

### 13.3 Centres & Batches
- 40 centres distributed across cities.
- 3–6 batches per centre = ~180 batches.
- Each batch assigned 1 primary shikshak.
- Mix of age groups; each centre has at least one Bal and one Kishor.

### 13.4 Punya
- Feature catalogue: 8 default features (attendance_present 10, homework_approved 15, streak_bonus_4_sessions 20, niyam_completion variable, manual_seva 10–50, festival 15, helping_others 10–30, msv_shivir variable).
- 90 days of synthetic attendance + homework submissions to seed leaderboards and tiers.
- Seeded punya transactions; some students at each tier (Jigyasu → Tirthankar).

### 13.5 Niyams
- 20 active niyams across cities (daily/weekly/monthly mix; English + Hindi titles).
- 6,000 niyam_submissions (auto-approved) spread over 30 days.
- 30% of parents opted in for Gallery → ~1,800 gallery items.
- 50 featured gallery items.

### 13.6 Homework
- 200 homework assignments across batches.
- 4,000 submissions with various statuses.

### 13.7 Notices
- 80 notices across scopes: 20 batch, 30 centre, 20 city, 10 MSV.
- 5 marked critical with `send_sms=true`.
- 15 marked `is_public=true` (visible on website).

### 13.8 Shivirs
- 8 Shivirs (3 MSV-only, 5 open).
- 4 historical (with full scan history) + 4 upcoming.
- 2 with `in_out` mode, 6 `present_only`.

### 13.9 Competitions
- 10 competitions: 4 results-published, 3 open, 3 draft.

### 13.10 Curriculum
- 4 Super Admin master templates (Standard Bal, Standard Kishor, MSV Bal, MSV Kishor).
- City-level standard curricula assigned to centres.
- Sample progress for 200 students.

### 13.11 Exams & Quizzes
- 5 online exams (2 results-released).
- 200 question bank entries (50% AI-flagged, 50% manual).
- 6 scheduled quiz events.
- 30 historical push quizzes.

### 13.12 Library
- 60 items across content types.
- Public (15), Student (25), MSV (12), Shikshak (8).
- 10 video items with sample YouTube embed URLs.

### 13.13 Donations
- 200 historical donations (mix of campaigns, purposes, sizes).
- 3 active campaigns.
- 80G initially **disabled** in `platform_settings` (per Q3 default).
- 50 donor profiles.

### 13.14 Service Requests
- 60 service requests across statuses.

### 13.15 Notifications & Audit
- ~5,000 notification rows seeded for realistic load.
- ~10,000 audit log entries.

### 13.16 Media
- Faker-generated reference URLs to public placeholder media assets in a seeded R2 dev bucket.

### 13.17 Platform Settings
- Single row with `eighty_g_enabled=false`, ready for super_admin to toggle.

---

# 14. ENVIRONMENT VARIABLES

### 14.1 Backend `apps/api/.env`

```
# Runtime
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
TZ=Asia/Kolkata
APP_BASE_URL=https://api.jainpathshala.org
WEB_BASE_URL=https://www.jainpathshala.org

# Database (RDS Postgres)
DATABASE_URL=postgres://jp_app:****@jp-prod-rds.****.rds.amazonaws.com:5432/jainpathshala
DATABASE_URL_READ=postgres://jp_read:****@jp-prod-rds-ro.****.rds.amazonaws.com:5432/jainpathshala
DATABASE_POOL_MAX=20
DATABASE_POOL_MIN=2
DATABASE_SSL=true

# Redis (ElastiCache cluster mode)
REDIS_URL=rediss://:****@jp-prod-redis.****.cache.amazonaws.com:6379
REDIS_TLS=true
REDIS_KEY_PREFIX=jp:prod:

# JWT (RS256, keys in Secrets Manager — load on boot)
JWT_PRIVATE_KEY_PEM=...
JWT_PUBLIC_KEY_PEM=...
JWT_PREV_PUBLIC_KEY_PEM=...   # For rotation grace period
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000
JWT_ISSUER=jainpathshala.org
JWT_AUDIENCE=jp.api

# OTP
OTP_TTL_SECONDS=300
OTP_REQUEST_LIMIT_PER_HOUR=3
OTP_REQUEST_LIMIT_PER_DAY=10
OTP_MAX_VERIFY_ATTEMPTS=5

# S3 / R2
S3_REGION=auto
S3_ENDPOINT=https://****.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET_PRIVATE=jp-prod-media-private
S3_BUCKET_PUBLIC=jp-prod-media-public
S3_BUCKET_EXPORTS=jp-prod-exports
S3_BUCKET_RECEIPTS=jp-prod-receipts
S3_CDN_PRIVATE=https://cdn-priv.jainpathshala.org
S3_CDN_PUBLIC=https://cdn.jainpathshala.org
SIGNED_URL_TTL_SECONDS=3600

# Razorpay
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

# Firebase FCM
FCM_PROJECT_ID=...
FCM_SERVICE_ACCOUNT_JSON=...        # Full JSON
FCM_BATCH_SIZE=500

# MSG91 SMS
MSG91_AUTH_KEY=...
MSG91_SENDER_ID=JPMSV
MSG91_OTP_TEMPLATE_ID=...
MSG91_NOTICE_TEMPLATE_ID=...
MSG91_DLT_ENTITY_ID=...

# Resend Email
RESEND_API_KEY=...
RESEND_FROM=Jain Pathshala <noreply@jainpathshala.org>

# AI Service
AI_SERVICE_BASE_URL=https://ai.internal.jainpathshala.org
AI_SERVICE_HMAC_SECRET=...
AI_SERVICE_TIMEOUT_MS=30000

# Sentry / observability
SENTRY_DSN=...
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.jainpathshala.org
OTEL_SERVICE_NAME=jp-api

# Rate limiting
RATE_LIMIT_ANON_PER_MIN=60
RATE_LIMIT_AUTH_READ_PER_MIN=300
RATE_LIMIT_AUTH_WRITE_PER_MIN=60

# Feature flags
FEATURE_AI_QUIZ_GENERATION=true
FEATURE_VIRUS_SCANNING=false
FEATURE_LIVE_SHIVIR_WS=true
FEATURE_SCHEDULED_EXAMS=true

# CORS
CORS_ALLOWED_ORIGINS=https://www.jainpathshala.org,https://admin.jainpathshala.org
```

### 14.2 Worker `apps/api/.env.worker` (additional)

```
WORKER_KIND=all                       # or: notifications | media | reports | analytics
WORKER_CONCURRENCY_OVERRIDE=
```

### 14.3 Web `apps/web/.env`

```
NEXT_PUBLIC_API_BASE_URL=https://api.jainpathshala.org
NEXT_PUBLIC_CDN_PUBLIC=https://cdn.jainpathshala.org
NEXT_PUBLIC_SENTRY_DSN=...
NEXT_PUBLIC_RAZORPAY_KEY_ID=...
NEXT_PUBLIC_GTM_ID=...                # Optional analytics
NEXT_PUBLIC_DEFAULT_LOCALE=en
NEXT_PUBLIC_LOCALES=en,hi

# Server-side only
SESSION_SECRET=...                    # iron-session
SESSION_COOKIE_NAME=jp_session
API_INTERNAL_BASE_URL=http://api.internal:3000
```

### 14.4 Mobile `apps/mobile/.env` (Expo public)

```
EXPO_PUBLIC_API_BASE_URL=https://api.jainpathshala.org
EXPO_PUBLIC_SENTRY_DSN=...
EXPO_PUBLIC_RAZORPAY_KEY_ID=...
EXPO_PUBLIC_FCM_SENDER_ID=...
EXPO_PUBLIC_DEFAULT_LOCALE=en
EXPO_PUBLIC_DEEP_LINK_SCHEME=jainpathshala
EXPO_PUBLIC_BUILD_PROFILE=production
```

### 14.5 AI service `apps/ai/.env`

```
OPENAI_API_KEY=...
OPENAI_MODEL_GENERATION=gpt-4o-mini
OPENAI_MODEL_MODERATION=omni-moderation-latest
REDIS_URL=...
AI_HMAC_SECRET=...
SERVICE_PORT=8000
ALLOWED_CALLER_IPS=10.0.0.0/16
SENTRY_DSN=...
```

### 14.6 Infrastructure / CI

```
AWS_REGION=ap-south-1
AWS_ACCOUNT_ID=...
ECR_REPO_API=...
ECR_REPO_WORKER=...
ECR_REPO_WEB=...
ECR_REPO_AI=...
ECS_CLUSTER=jp-prod
ECS_SERVICE_API=jp-api
ECS_SERVICE_WORKER=jp-worker
ECS_SERVICE_WEB=jp-web
ECS_SERVICE_AI=jp-ai
GITHUB_TOKEN=...
GITHUB_OIDC_ROLE_ARN=arn:aws:iam::****:role/GitHubActionsDeploy
```

---

# 15. TESTING STRATEGY

### 15.1 Unit Tests (Vitest)
- One spec file per service/repository.
- Mock Drizzle via `@drizzle-team/drizzle-test-utils` + Testcontainers-spun-up Postgres for repository tests.
- Coverage target: ≥80% statements, ≥75% branches.

### 15.2 Integration Tests (Supertest + Testcontainers)
- Spin up Postgres + Redis + LocalStack S3 + a mocked Razorpay server.
- Per-suite migration & seed.
- Critical flows tested end-to-end at HTTP level:
  - OTP login + role detection + view switch
  - Offline-sync batch (idempotency replay)
  - Niyam submission auto-approve + retroactive rejection (Punya reversal validated)
  - Attendance marking with concurrent updates
  - Donation order/verify/webhook idempotency
  - Critical notice fanout (push + SMS) — assert per-recipient jobs created

### 15.3 E2E Tests
- **Web (Playwright):** admin flows — login, create centre/batch, approve enrolment, post critical notice, configure 80G, generate exam.
- **Mobile (Detox):** parent flow — login, view children, mark Niyam upload, view ID card, switch to student view, take push quiz.

### 15.4 Queue Tests
- Vitest with BullMQ in-memory adapter (using a real Redis testcontainer).
- Assert: retries, DLQ routing, idempotency, ordering where required.

### 15.5 Offline Sync Tests
- Mobile Detox scenario:
  - Toggle airplane mode → mark attendance → toggle off → verify server-side persistence + UI sync indicator.
  - Same `client_op_id` submitted twice → only one persistence.

### 15.6 Performance / Load
- k6 scripts in `infra/load-tests/`:
  - 10k concurrent OTP requests (rate-limit verification)
  - 5k concurrent attendance submissions
  - 100 admins viewing live Shivir dashboard
- Targets: API p95 < 300ms (excluding PDF/Export jobs); leaderboard read p95 < 50ms; push-deliver throughput ≥1000/sec.

### 15.7 Security Tests
- Static: `npm audit`, Snyk in CI.
- Dynamic: OWASP ZAP baseline scan against staging weekly.
- Manual pen test before production launch.

---

# 16. SECURITY REQUIREMENTS

### 16.1 Transport & Network
- TLS 1.2+ only; HSTS preload eligible.
- CloudFront in front of ALB.
- AWS WAF managed rules: SQLi, XSS, Bot, Linux/Unix, Reputation lists.
- VPC: private subnets for API + workers + RDS + Redis; only ALB in public.

### 16.2 OWASP Top 10 Protections
- **Injection:** Drizzle parameterised queries everywhere; no raw SQL with interpolation.
- **Broken auth:** JWT + refresh rotation + reuse detection.
- **Sensitive exposure:** Donor PAN stored encrypted (AES-256-GCM via AWS KMS); never returned in API responses.
- **XXE / XML:** No XML parsing.
- **Broken access control:** ScopeGuard on every authenticated route; integration tests assert cross-tenant blocks.
- **Security misconfig:** `helmet()` enabled; CSP strict; no stack traces in prod responses.
- **XSS:** React escapes by default; user content sanitised via DOMPurify in admin where rich text appears (notices on website).
- **Insecure deserialization:** JSON only; class-validator on all DTOs.
- **Known vulnerabilities:** Renovate bot; CI fails on high+ vulns.
- **Logging/monitoring:** structured logs + Sentry; security events alerted.

### 16.3 CSRF
- Web admin: iron-session sets `SameSite=Lax`; mutating routes also require `X-Requested-With: jp-web` header.
- Mobile uses Authorization header (immune to CSRF).

### 16.4 Upload Validation
- MIME allowlist per kind; size enforced; checksum verified; EXIF stripped; virus scan optional flag.

### 16.5 RBAC Hardening
- Role + scope checks at controller (decorators) AND repository (`ScopedQueryBuilder` injects `WHERE` clauses).
- Integration tests assert no leaks across cities.

### 16.6 Audit Logging
- Every write logged with before/after.
- `audit_logs` is append-only; Postgres role for app has no UPDATE/DELETE grants on this table.

### 16.7 Encryption
- At rest: RDS encrypted via KMS; R2 server-side AES-256.
- In transit: TLS only.
- App-level encrypted fields: donor PAN, exam OTP (hashed), refresh tokens (hashed).

### 16.8 Secrets Management
- All secrets in AWS Secrets Manager.
- Tasks fetch via IAM role (no env-baked secrets in images).
- Rotation: JWT keys quarterly, DB credentials biannually, third-party API keys on demand.

### 16.9 OTP Abuse Prevention
- Sliding window rate limits (Section 7.10).
- Phone+IP combined keying to mitigate carrier-bypass attacks.
- After 5 failed verifications, OTP invalidated; new request requires 60s cool-down.

### 16.10 Device Trust
- New device → notification to all existing sessions ("New login from <device, location>").
- User can revoke any session immediately.

### 16.11 Refresh Token Revocation
- On logout, password-change-equivalent action (none in OTP), or reuse detection → all sessions revoked.

### 16.12 Signed Upload URLs
- Presigned URLs are time-limited (5 min PUT, 60 min GET).
- PUT URLs require client to send a precomputed checksum that server validates on finalize.

### 16.13 PII Minimisation
- Logs scrub phone, OTP, tokens via Pino redact paths.
- Sentry has scrubbing patterns for `authorization`, `phone`, `otp`, `razorpay_*`.

---

# 17. PERFORMANCE & SCALING

### 17.1 DB Optimisation
- Read replicas for analytics queries (separate `DATABASE_URL_READ`).
- Composite indexes per high-traffic query (see Section 5).
- `EXPLAIN` budgets in CI: any new query must justify > 50ms p95 in staging.
- Connection pooling via PgBouncer (transaction mode) in front of RDS.

### 17.2 Redis Caching
- Cache layers:
  - L1: per-instance LRU (small, 100 entries) for hot reads (config, roles).
  - L2: Redis (60s–1h TTLs).
- Invalidation: on write, service emits `cache.invalidate { keys[] }` event.
- Use namespaces: `cache:centres:list:{city_id}`, `cache:leaderboard:{scope}:{id}`, etc.

### 17.3 Leaderboard Optimisation
- Maintained as Redis sorted sets, updated incrementally on Punya emit.
- Periodic reconciliation against DB (Section 8.5).
- Reads: O(log N) for rank lookups + O(K) for top-K — sub-10ms even with millions of entries.

### 17.4 Notification Batching
- FCM supports `sendMulticast` (500/batch). Notification fanout worker chunks recipients.
- Per-recipient deliver job retries independent of batch.

### 17.5 Analytics Aggregation Jobs
- Heavy aggregations run nightly, never on request path.
- Pre-aggregated values served from materialised views.

### 17.6 Media Optimisation
- Thumbnails generated once; subsequent reads served via CDN.
- WebP/AVIF preferred for thumbnails.
- Library videos use YouTube/Vimeo CDNs (no backend bandwidth — Q7).

### 17.7 Horizontal Scaling
- API: stateless ECS tasks behind ALB; target tracking on CPU 60% + ALB request-count.
- Workers: separate service per worker-kind, scales on queue depth (CloudWatch alarms → ECS scaling policies).
- WebSocket: Socket.IO with Redis adapter; tasks pinned by ALB sticky cookies; clients reconnect across tasks.

### 17.8 Lazy Loading
- Web: route-level code splitting; admin panels lazy-load heavy charts.
- Mobile: navigation tabs lazy-mount; PDF preview lazy-imported.

### 17.9 Pagination & Query Limits
- Default `limit=20`, max `100`.
- Cursor-based for time-ordered reads (notifications, audit logs, attendance history).
- Page-based for admin grids.

### 17.10 Cost Optimisation
- R2 chosen for media (zero egress).
- ECS Fargate Spot for non-critical workers (analytics, exports).
- Reserved instances/savings plans after 3 months stable usage.
- CloudFront caching aggressively on public endpoints.

---

## 18. DEVOPS & DEPLOYMENT

### 18.1 Containerisation Strategy

Four distinct container images, each with a dedicated Dockerfile:

```
apps/api/Dockerfile          → NestJS HTTP server (port 3000)
apps/api/Dockerfile.worker   → NestJS in worker mode (no HTTP, BullMQ processors only)
apps/web/Dockerfile          → Next.js production server (port 3001)
apps/ai/Dockerfile           → FastAPI service (port 8000)
```

All Dockerfiles use multi-stage builds: a `builder` stage with full dev dependencies and a `runner` stage on `node:20-alpine` (or `python:3.12-slim` for AI) with only production artifacts. Run as non-root user `appuser` (UID 1001). Set `NODE_ENV=production`, expose health endpoints, and use `dumb-init` as PID 1 for proper signal handling.

**apps/api/Dockerfile** (illustrative structure):
```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY apps/api ./apps/api
COPY packages ./packages
RUN corepack enable && pnpm install --frozen-lockfile
RUN pnpm --filter @jp/api build

FROM node:20-alpine AS runner
RUN apk add --no-cache dumb-init tini
WORKDIR /app
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/apps/api/package.json ./
USER 1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://localhost:3000/healthz || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
```

The worker Dockerfile is identical except `CMD ["node", "dist/worker.js"]` (separate bootstrap entry that only registers BullMQ processors, no Nest HTTP listener).

### 18.2 Local Development — docker-compose.yml

`infra/docker/docker-compose.yml` runs the full stack locally:

```yaml
version: "3.9"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: jp
      POSTGRES_PASSWORD: jp_dev_pwd
      POSTGRES_DB: jainpathshala
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jp"]
      interval: 10s

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    ports: ["6379:6379"]
    volumes:
      - redisdata:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    volumes:
      - miniodata:/data

  mailhog:
    image: mailhog/mailhog:latest
    ports: ["1025:1025", "8025:8025"]

  api:
    build:
      context: ../..
      dockerfile: apps/api/Dockerfile
    env_file: ./env/api.dev.env
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
    ports: ["3000:3000"]

  worker:
    build:
      context: ../..
      dockerfile: apps/api/Dockerfile.worker
    env_file: ./env/worker.dev.env
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_started }
    deploy:
      replicas: 2

  web:
    build:
      context: ../..
      dockerfile: apps/web/Dockerfile
    env_file: ./env/web.dev.env
    ports: ["3001:3001"]
    depends_on:
      api: { condition: service_started }

  ai:
    build:
      context: ../..
      dockerfile: apps/ai/Dockerfile
    env_file: ./env/ai.dev.env
    ports: ["8000:8000"]

volumes:
  pgdata:
  redisdata:
  miniodata:
```

A separate `docker-compose.test.yml` overrides with ephemeral volumes and runs Testcontainers-backed integration suites.

### 18.3 CI/CD — GitHub Actions

Workflow files under `.github/workflows/`:

- `ci.yml` — runs on every PR
- `deploy-staging.yml` — runs on push to `main`
- `deploy-prod.yml` — runs on tag push `v*.*.*` with manual approval gate

**`.github/workflows/ci.yml`** structure:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck

  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter "@jp/*" test:unit -- --coverage
      - uses: codecov/codecov-action@v4

  integration-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env: { POSTGRES_PASSWORD: test, POSTGRES_DB: jp_test }
        ports: ["5432:5432"]
        options: --health-cmd pg_isready --health-interval 10s
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @jp/api db:migrate
      - run: pnpm --filter @jp/api test:integration

  security-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: snyk/actions/node@master
        env: { SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }} }
      - uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          severity: CRITICAL,HIGH
```

**`.github/workflows/deploy-staging.yml`** uses OIDC for AWS auth (no long-lived keys):

```yaml
name: Deploy Staging
on:
  push:
    branches: [main]
concurrency:
  group: deploy-staging
  cancel-in-progress: false
permissions:
  id-token: write
  contents: read
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [api, worker, web, ai]
    steps:
      - uses: actions/checkout@v4
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::ACCOUNT_ID:role/gh-actions-staging
          aws-region: ap-south-1
      - uses: aws-actions/amazon-ecr-login@v2
      - name: Build & push ${{ matrix.service }}
        run: |
          IMAGE=ACCOUNT_ID.dkr.ecr.ap-south-1.amazonaws.com/jp-${{ matrix.service }}:${{ github.sha }}
          docker build -f apps/${{ matrix.service == 'worker' && 'api/Dockerfile.worker' || format('{0}/Dockerfile', matrix.service) }} -t $IMAGE .
          docker push $IMAGE

  run-migrations:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
      - name: Run Drizzle migrations via one-off ECS task
        run: |
          aws ecs run-task --cluster jp-staging \
            --task-definition jp-migrate-staging:latest \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[...],securityGroups=[...]}"
          # poll until task exits 0

  deploy:
    needs: run-migrations
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service: [api, worker, web, ai]
    steps:
      - name: Update ECS service ${{ matrix.service }}
        run: |
          aws ecs update-service \
            --cluster jp-staging \
            --service jp-${{ matrix.service }}-staging \
            --force-new-deployment \
            --task-definition jp-${{ matrix.service }}-staging
          aws ecs wait services-stable --cluster jp-staging --services jp-${{ matrix.service }}-staging

  smoke-tests:
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - run: curl -fsS https://staging-api.jainpathshala.org/healthz
      - run: curl -fsS https://staging-api.jainpathshala.org/readyz
      - run: pnpm --filter @jp/web e2e:smoke -- --base-url=https://staging.jainpathshala.org
```

Production deploy (`deploy-prod.yml`) is identical structurally but adds an `environment: production` gate requiring manual approval from two reviewers, plus a Slack notification to `#deploys` channel before and after.

### 18.4 ECS Task Definitions

Task definitions live in `infra/ecs/task-definitions/` as JSON, version-controlled:

```
jp-api-staging.json
jp-api-prod.json
jp-worker-staging.json
jp-worker-prod.json
jp-web-staging.json
jp-web-prod.json
jp-ai-staging.json
jp-ai-prod.json
jp-migrate-staging.json
jp-migrate-prod.json
```

Each task definition specifies:
- CPU/memory: api 1024/2048, worker 512/1024 (per worker instance), web 1024/2048, ai 1024/2048
- Container definitions with image placeholder `IMAGE_TAG_PLACEHOLDER` rewritten by CI
- Secrets pulled from AWS Secrets Manager (never inline env)
- Log driver: `awslogs` → CloudWatch group `/ecs/jp-{service}-{env}`
- Sidecar: `aws-otel-collector` for OpenTelemetry traces/metrics
- Stop timeout: 30s (graceful BullMQ shutdown)
- Health check: `CMD-SHELL curl -f http://localhost:PORT/healthz || exit 1`

### 18.5 ECS Services & Auto-Scaling

| Service | Min Tasks | Max Tasks | Scaling Trigger |
|---|---|---|---|
| `jp-api-prod` | 4 | 30 | CPU 60% OR ALB requests/target > 1500/min |
| `jp-worker-notifications` | 2 | 20 | Queue depth `notifications.fanout` > 500 |
| `jp-worker-media` | 1 | 10 | Queue depth `media.processing` > 100 |
| `jp-worker-default` | 2 | 8 | CPU 70% |
| `jp-web-prod` | 2 | 12 | CPU 60% |
| `jp-ai-prod` | 1 | 6 | CPU 70% OR queue depth `ai.quiz.generate` > 20 |

Queue-depth scaling uses CloudWatch custom metrics published every 30s by a lightweight Lambda (`jp-queue-metrics-publisher`) that reads BullMQ counts from Redis.

Deployment strategy: ECS rolling update with `minimumHealthyPercent=100`, `maximumPercent=200` (api/web), and `minimumHealthyPercent=50`, `maximumPercent=200` for workers (workers tolerate partial-capacity windows).

### 18.6 Health Checks

NestJS uses `@nestjs/terminus` to expose:

- `GET /healthz` — liveness; returns 200 if process is up. No dependency checks. ALB uses this.
- `GET /readyz` — readiness; checks Postgres (`SELECT 1`), Redis (`PING`), and S3 reachability (HEAD on a probe object). Returns 503 if any dependency is down. ECS uses this to delay traffic during cold starts.
- `GET /metrics` — Prometheus exposition (protected by network policy; only scraped by OTEL collector inside the task).

Workers expose the same on port 3100 (separate from main HTTP) — needed for ECS health checks even though workers have no public traffic.

### 18.7 Database Migration Strategy

Migrations live at `apps/api/src/db/migrations/NNNN_descriptive_name.sql` (auto-numbered by `drizzle-kit`). Rules:

1. **One migration per PR maximum** to keep blast radius small.
2. **Backwards-compatible only**: never drop a column in the same release that stops writing to it. Pattern is: release N stops writing → release N+1 drops the column.
3. **No data migrations inside schema migrations**. Data backfills run as BullMQ jobs (`db.backfill.*` queue) so they can be paused, throttled, and retried without blocking deploys.
4. **Advisory lock guard**: the migration runner wraps execution in `SELECT pg_advisory_lock(987654321)` so two parallel runners cannot race. Released in a `try/finally`.
5. **Migrations run as a one-off ECS task**, not on API startup. The deploy pipeline runs `jp-migrate-{env}` task to completion before updating the `jp-api-{env}` service.
6. **Down migrations are not maintained** beyond development. In production, rollback is forward-only: write a new migration that reverses the change.

### 18.8 Rollback Strategy

ECS keeps the previous task definition revision available. Rollback procedure:

```bash
# 1. Identify last known-good revision
aws ecs describe-task-definition --task-definition jp-api-prod:LAST_GOOD_REV

# 2. Update service to that revision
aws ecs update-service \
  --cluster jp-prod \
  --service jp-api-prod \
  --task-definition jp-api-prod:LAST_GOOD_REV \
  --force-new-deployment

# 3. Wait for stability
aws ecs wait services-stable --cluster jp-prod --services jp-api-prod
```

A `scripts/rollback.sh` wraps this with safety checks (confirms target revision is < current, posts to Slack, runs smoke tests post-rollback).

**Database rollback**: never via reversed migrations. If a schema change is wrong, write a forward-fix migration. If data corruption occurred, restore from the most recent point-in-time recovery snapshot (RDS PITR enabled, 7-day retention prod, 1-day staging).

### 18.9 Environments

Three environments, fully isolated AWS accounts:

| Env | Purpose | URL pattern | Data |
|---|---|---|---|
| `dev` | Local docker-compose, no cloud | `localhost:*` | Seed only |
| `staging` | Pre-prod mirror | `staging-{api,admin}.jainpathshala.org` | Anonymised prod snapshot, refreshed weekly |
| `prod` | Live | `{api,admin,www}.jainpathshala.org` | Real |

Each env has dedicated VPC, RDS, Redis, S3 buckets, FCM project, and MSG91 sender ID. No cross-env data access. The staging refresh job (`scripts/refresh-staging.ts`) runs every Sunday 02:00 IST: takes RDS snapshot of prod, restores into staging, runs PII anonymisation script (replaces real phone numbers with `+91999XXXNNNN`, emails with `user-{id}@example.test`, names with faker-generated), then runs a sanity check.

### 18.10 Monitoring & Observability Stack

| Layer | Tool | Purpose |
|---|---|---|
| Metrics | CloudWatch + Grafana Cloud | ECS task metrics, RDS metrics, Redis metrics, custom app metrics |
| Logs | CloudWatch Logs → Grafana Loki | Structured Pino JSON logs, full-text search |
| Traces | OpenTelemetry → Grafana Tempo | Distributed tracing across api/worker/ai |
| Errors | Sentry | Exception aggregation with release tracking |
| Uptime | Better Stack (Uptime monitoring) | External probes every 30s on `/healthz`, public homepage, login endpoint |
| Real User Monitoring | Sentry Performance | Web and mobile RUM |

OTEL collector runs as a sidecar in every ECS task. Trace sampling: 100% on errors, 10% on healthy requests in prod, 100% in staging.

**Grafana dashboards** (provisioned as code in `infra/grafana/dashboards/`):
- `api-overview.json` — RPS, p50/p95/p99 latency, 5xx rate, ALB target health
- `worker-overview.json` — Queue depths, processing rate, failure rate, DLQ size per queue
- `db-overview.json` — RDS connections, slow queries, replication lag, CPU
- `business-metrics.json` — DAU/MAU, attendance check-ins/hour, Punya awards/min, notifications sent/hour
- `cost-tracker.json` — Daily AWS spend by service, projected monthly

### 18.11 Alerting Rules

Alerts route via PagerDuty (sev1/sev2) and Slack `#alerts` (sev3). Rules in `infra/grafana/alerts/`:

| Severity | Rule | Condition |
|---|---|---|
| sev1 | API down | `/healthz` failing on >50% targets for 2min |
| sev1 | DB down | RDS unreachable for 1min |
| sev1 | 5xx spike | 5xx rate > 5% for 5min |
| sev2 | Queue backlog | Any queue depth > 5000 for 10min |
| sev2 | DLQ growth | DLQ size > 100 for any queue |
| sev2 | Slow queries | p95 query time > 1s for 10min |
| sev2 | Memory pressure | ECS task memory > 85% for 10min |
| sev3 | OTP failure rate | OTP send-fail rate > 10% for 15min |
| sev3 | Push failure rate | FCM rejection rate > 5% for 15min |
| sev3 | Disk space | RDS free space < 20% |
| sev3 | Cert expiry | ACM cert expires < 30 days |

### 18.12 Logging Standards

Every log line is structured JSON with required keys:

```json
{
  "timestamp": "2026-05-24T08:33:21.142Z",
  "level": "info",
  "service": "api",
  "env": "prod",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "request_id": "01HF4ZK...",
  "user_id": "usr_abc123",
  "role": "shikshak",
  "centre_id": "ctr_xyz789",
  "msg": "attendance.checkin.success",
  "session_id": "sess_def456",
  "duration_ms": 47
}
```

PII redaction is centralised in `apps/api/src/observability/log-redactor.ts`. Banned fields (auto-redacted): `phone`, `email`, `pan`, `aadhaar`, `password`, `otp`, `token`, `authorization`. The redactor is registered as a Pino formatter and applied before any transport.

Log retention: CloudWatch 30 days hot, then exported to S3 Glacier with 7-year retention (donation audit requirement).

### 18.13 Secrets Management

All secrets stored in AWS Secrets Manager, organised as:

```
jp/prod/database/master           → { url, read_replica_url }
jp/prod/redis/master              → { url, password }
jp/prod/jwt/keys                  → { private_pem, public_pem, kid, rotated_at }
jp/prod/integrations/razorpay     → { key_id, key_secret, webhook_secret }
jp/prod/integrations/msg91        → { auth_key, sender_id }
jp/prod/integrations/fcm          → { service_account_json }
jp/prod/integrations/resend       → { api_key }
jp/prod/ai/openai                 → { api_key, org_id }
jp/prod/ai/hmac                   → { secret }
jp/prod/storage/s3                → { access_key, secret_key }
jp/prod/storage/r2                → { access_key, secret_key }
```

ECS tasks reference secrets by ARN in their task definition `secrets` block — values injected as environment variables at task start, never persisted to disk, never logged.

Rotation: JWT keys auto-rotate every 90 days via EventBridge → Lambda → SecretsManager → ECS service force-redeploy. Database master password rotates every 180 days (RDS-managed). Integration keys rotate manually per vendor cadence.

### 18.14 CloudFront & DNS Setup

Three CloudFront distributions:

| Distribution | Origin | Purpose |
|---|---|---|
| `cf-jp-web-prod` | ALB → Next.js (`apps/web`) | Public website + admin UI; SSR cached at edge for public routes only |
| `cf-jp-media-public-prod` | R2 (jp-prod-media-public) | Gallery thumbnails, public logos, ID card photos (signed URLs) |
| `cf-jp-media-private-prod` | R2 (jp-prod-media-private) | All other media; signed URLs with 1-hour TTL |

Custom cache policies:
- Public web routes: TTL 300s, vary on `Accept-Language` + `Cookie:lang`
- API routes: not cached at CDN (origin handles caching via Redis)
- Media: TTL 86400s, immutable for hashed filenames

Route53 hosted zones:
- `jainpathshala.org` (apex + www) → CloudFront web
- `api.jainpathshala.org` → ALB direct (no CDN for API)
- `media.jainpathshala.org` → CloudFront media

ACM certificates auto-renewed; wildcard cert `*.jainpathshala.org` covers staging/prod subdomains.

### 18.15 Backup & Disaster Recovery

| Asset | Backup mechanism | RPO | RTO |
|---|---|---|---|
| RDS Postgres | Automated daily snapshots + PITR continuous | 5 min | 30 min |
| ElastiCache Redis | Daily snapshot to S3 | 24 hr | 15 min (rebuild from RDS truth source) |
| R2 media (primary) | Cross-bucket replication to S3 ap-southeast-1 | 1 hr | 60 min (DNS cutover) |
| Audit logs | S3 Glacier (7-year retention) | 24 hr | N/A (read-only archive) |
| Secrets | Versioned in Secrets Manager | Instant | N/A |

DR runbook (`docs/runbooks/disaster-recovery.md`) documents the exact steps for region failover: promote read replica, update Route53 weighted records, force ECS redeploy in DR region.

### 18.16 Cost Guardrails

- AWS Budgets alert at 80% of monthly forecast → email to ops + Slack
- Daily cost report posted to `#ops-costs` Slack channel by Lambda
- Reserved capacity (1-year, no upfront) on RDS and ElastiCache after 3 months of stable usage
- ECS Fargate Spot used for `jp-worker-default`, `jp-worker-media`, `jp-worker-analytics` (interruption-tolerant)
- S3/R2 lifecycle policies move infrequently accessed objects to cheaper tiers automatically

---

## 19. BUILD ORDER

This is the engineering execution sequence. Each step lists its dependencies, what gets built, and the exit criteria that must be green before the next step starts. Treat this as the canonical Replit Agent task ordering — do not skip ahead, and do not parallelise steps marked `[BLOCKS]`.

The project is non-phased per product spec (Section 1), but the build is necessarily ordered because lower layers gate higher ones. Phases 1/2/3 in the BRD describe *feature delivery* groupings; the steps below describe *engineering construction* ordering.

---

### Step 1 — Repository & Tooling Foundation [BLOCKS everything]

**Dependencies:** None.

**Build:**
- Initialise pnpm monorepo with the folder structure from Section 4.
- Configure `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `.editorconfig`, `.gitignore`, `.nvmrc` (Node 20.x).
- Set up shared tooling: ESLint flat config, Prettier, Husky pre-commit (lint-staged), commitlint with Conventional Commits.
- Configure TypeScript project references between `packages/shared`, `packages/design-tokens`, `packages/i18n`, and each app.
- Wire up Turborepo (`turbo.json`) with `build`, `lint`, `typecheck`, `test`, `test:integration` pipelines.
- Create `infra/docker/docker-compose.yml` (Postgres, Redis, MinIO, MailHog) per Section 18.2.
- Create `.github/workflows/ci.yml` skeleton from Section 18.3.
- Add `README.md` with local dev quickstart.

**Exit criteria:** `pnpm install`, `pnpm lint`, `pnpm typecheck`, `docker compose up -d` all succeed on a clean clone. CI runs green on a noop PR.

---

### Step 2 — Shared Packages [BLOCKS api, web, mobile]

**Dependencies:** Step 1.

**Build:**
- `packages/shared`: Zod schemas for every DTO (auth, attendance, niyams, etc.), error codes enum, role enum, age-group enum, language enum, common types (`Result<T, E>`, `Paginated<T>`, `ApiEnvelope<T>`).
- `packages/design-tokens`: token JSON consumed by mobile and web (placeholder values — actual values come from the existing design system per Q9).
- `packages/i18n`: EN/HI translation key files (`en.json`, `hi.json`) with keyspace for every UI surface; helper functions `t(key, params)`, `tBilingual(record)`.
- Each package builds independently and emits `.d.ts`.

**Exit criteria:** Every package builds standalone. Importing from `@jp/shared` in a test file resolves and typechecks.

---

### Step 3 — Backend Foundation [BLOCKS auth, every API module]

**Dependencies:** Step 2.

**Build:**
- NestJS app at `apps/api` with modular structure per Section 4.
- Configure: Pino logger with PII redaction (Section 18.12), OpenTelemetry SDK, Sentry integration, global validation pipe (Zod), global exception filter (envelope error format), global request-id middleware.
- Drizzle setup: `drizzle.config.ts`, connection module with read/write pool separation (Section 17.1), migration runner CLI wrapped with advisory lock (Section 18.7).
- Redis connection module (separate clients for cache, BullMQ, pub/sub, Socket.IO adapter).
- Health module: `/healthz`, `/readyz`, `/metrics` per Section 18.6.
- Config module loading from env with Zod validation; fails fast on missing required vars.
- Bootstrap two entry points: `main.ts` (HTTP) and `worker.ts` (BullMQ-only).

**Exit criteria:** `pnpm --filter @jp/api dev` boots cleanly, `/healthz` returns 200, `/readyz` returns 200 with all dependencies green, `/metrics` exposes Prometheus output.

---

### Step 4 — Database Schema & Migrations [BLOCKS all data-touching work]

**Dependencies:** Step 3.

**Build:**
- Translate every table from Section 5 into Drizzle schema files under `apps/api/src/db/schema/` organised by domain (one file per module).
- All PostgreSQL enums declared once in `apps/api/src/db/schema/enums.ts`.
- Generate initial migration `0001_initial_schema.sql` via `drizzle-kit generate`.
- Add `0002_indexes.sql` with every composite and partial index from Section 5.
- Add `0003_audit_logs_role_grants.sql` creating the `audit_writer` Postgres role with INSERT-only grants on `audit_logs` (append-only enforcement per Section 16).
- Add `0004_seed_enums.sql` seeding `punya_features`, default `platform_settings` row (with `eighty_g_enabled=false`), default `registration_form_configs` for every persona.
- Write `apps/api/src/db/repositories/` thin query helpers per table (typed wrappers over Drizzle).

**Exit criteria:** Migrations run cleanly from a fresh database. All 60+ tables exist with correct columns, indexes, and foreign keys. `pnpm db:studio` (Drizzle Studio) opens and renders the schema correctly.

---

### Step 5 — Authentication & Authorisation [BLOCKS every authenticated endpoint]

**Dependencies:** Step 4.

**Build:**
- Auth module: `POST /v1/auth/otp/send`, `POST /v1/auth/otp/verify`, `POST /v1/auth/refresh`, `POST /v1/auth/logout`, `POST /v1/auth/switch-view`.
- OTP flow per Section 7.1: rate limiting (3/min/phone, 10/hour/phone, 30/hour/IP), Redis-backed OTP store with TTL, MSG91 integration (stubbed to console.log in dev), abuse-detection hooks.
- JWT issuance with RS256, key loading from Secrets Manager (or local file in dev), 15-min access + 30-day refresh, refresh-token rotation with family tracking and reuse detection (revokes whole family on reuse).
- `device_sessions` table populated per login; max 5 active per user enforced.
- `JwtAuthGuard` + `RoleGuard` + `ScopeGuard` (centre/batch/city scoping) per Section 7. Decorators: `@Roles()`, `@RequireScope()`, `@Public()`.
- Student-view toggle: `POST /v1/auth/switch-view` mints a new access token with `view_context: 'student' | 'parent'` claim; eligibility check (parent must be linked to a student where DOB makes them ≥13).
- Admin impersonation: `POST /v1/admin/impersonate/:userId` (super_admin only), writes two audit log entries per Section 7.
- Comprehensive unit + integration tests for the auth flows (happy path, OTP reuse, rate limit, expired refresh, reuse detection).

**Exit criteria:** OTP login works end-to-end for every role. Role/scope guards correctly block disallowed access. Refresh rotation works; reuse triggers family revocation. Audit log entries created for every auth event.

---

### Step 6 — Geography, Centres, Batches, Form Configs [BLOCKS enrolment]

**Dependencies:** Step 5.

**Build:**
- `geography` module: read endpoints for states/cities (cached aggressively per Section 17.3).
- `centres` module: CRUD scoped to city_admin+; GPS coordinate validation; centre photo upload via signed URL flow (defer media to Step 11 — for now accept a URL string).
- `batches` module: CRUD scoped to sanchalak+; capacity validation; shikshak assignment with `shikshak_batch_assignments` link table; timetable derived directly from batch fields (Gap C).
- `centre_holidays` module: CRUD; push fan-out hook (queued, processor lands in Step 12).
- `registration_form_configs` module: per-city, per-persona form definitions with custom fields (Section 19.4 of BRD spec); `GET /v1/form-configs/:persona`.
- Admin-only UI not yet built; API only.

**Exit criteria:** All centre/batch/form-config endpoints respond correctly. Integration tests cover create→read→update→deactivate for centres and batches. A seeded city has 3 centres, each with 4 batches.

---

### Step 7 — Background Jobs Infrastructure [BLOCKS notifications, media, reports, fanouts]

**Dependencies:** Step 5.

**Build:**
- BullMQ setup: `apps/api/src/queues/index.ts` declaring the `QUEUES` constant (30 named queues from Section 9.1).
- `apps/api/src/worker.ts` bootstrap: registers all processors, exposes `/healthz` on port 3100, graceful shutdown with 25s drain timeout.
- Processor base class with: structured logging, OTEL span propagation from job opts, automatic retry policy (exponential backoff: 3 retries for transient, 1 retry for non-idempotent), DLQ on final failure.
- `db.maintenance.dlq.drain` admin endpoint to inspect and replay DLQ jobs.
- Cron scheduler module registering the 10 scheduled jobs from Section 9 (birthday wishes, monthly reports, leaderboard reset, materialised-view refresh, OTP cleanup, etc).
- Queue depth metrics publisher (Lambda or in-process emitter) feeding CloudWatch / Grafana.
- One smoke processor (`debug.echo`) to validate end-to-end wiring.

**Exit criteria:** Worker boots, picks up `debug.echo` jobs, logs them with trace IDs, processes successfully. DLQ replay works. Cron jobs visible in the scheduler dashboard.

---

### Step 8 — Mobile Shell [BLOCKS mobile feature work]

**Dependencies:** Steps 2, 5 (only auth endpoints needed live).

**Build:**
- Expo app at `apps/mobile` with Expo Router v6, EAS Build config (`eas.json`), splash + icon + adaptive icon (placeholders from design tokens).
- Root layout with: theme provider (consumes `@jp/design-tokens`), i18n provider (consumes `@jp/i18n`, persists `preferred_language` in MMKV), auth context (token storage in Expo SecureStore, refresh interceptor in API client), error boundary, network-status listener.
- API client (`apps/mobile/src/api/client.ts`) with: base URL from env, automatic auth header, automatic refresh on 401, request/response interceptors, request idempotency-key generation for non-GET requests.
- Login flow: phone entry screen → OTP entry screen → role-based redirect to appropriate tab navigator.
- Eight tab navigators (one per role, including a `student-view` variant for the parent-with-13+-toggle case).
- MMKV stores from Section 11.1: `jp.auth`, `jp.queue.*`, `jp.cache.*`, `jp.profile`.
- Sync engine skeleton: queues empty operations and processes them on network restore (full processor implementations land per-module in later steps).
- Bilingual toggle in settings drawer; persisted per device and synced to server profile.

**Exit criteria:** App installs on Android emulator and iOS simulator via Expo Go. Login works end-to-end against a local API. Role-correct tab navigator renders. Language toggle persists across reloads.

---

### Step 9 — Web Shell + Admin Panel Skeleton [BLOCKS admin features]

**Dependencies:** Steps 2, 5.

**Build:**
- Next.js 15 app at `apps/web` (App Router, RSC where applicable, client components for interactive admin grids).
- Public site routes per Section 21 of BRD: `/`, `/about`, `/centres`, `/shivirs`, `/notices`, `/gallery`, `/library`, `/donate`, `/enquire`, `/msv`, `/contact` (mostly empty shells with copy placeholders for now).
- Admin routes under `/admin/*` with middleware-level auth check (redirects to `/admin/login` if no session cookie).
- shadcn/ui setup with design tokens; Tailwind config consumes `@jp/design-tokens`.
- Admin layout: top nav (role + impersonation indicator), left sidebar (modules conditionally shown by role), main content area, toast provider.
- i18n via `next-intl`, language toggle in header, EN/HI routing strategy (subpath: `/en/admin/...`, `/hi/admin/...`).
- API client (`apps/web/src/lib/api.ts`) mirroring the mobile client but using HTTP-only cookies for session storage on web.

**Exit criteria:** `pnpm --filter @jp/web dev` serves public site at `localhost:3001`. Admin login works for super_admin, city_admin, sanchalak. Language switching works on both public and admin routes.

---

### Step 10 — Student Enrolment & Approval [BLOCKS attendance, Punya, anything student-scoped]

**Dependencies:** Steps 6, 8, 9.

**Build:**
- Parent registration flow (mobile): captures parent + first child via dynamic form (renders fields from `registration_form_configs`).
- `POST /v1/enrolments` creates parent user (if new), student record, links them, sets `enrolment_status='pending'`.
- Approval flow: sanchalak/city_admin sees pending list in admin UI; Approve/Reject/Waitlist actions. Approval triggers ID card generation job (queue lands in Step 11 fully; here just enqueue).
- Duplicate-child detection: warn admin if a student with same name + DOB + parent phone already exists.
- Capacity check on approval: batch.capacity vs current active enrolments; 409 if over.
- MSV enrolment as a separate form (`POST /v1/msv/enrolments`); admin discretion only (Q1); no eligibility gates.
- Multi-child support: parent can add additional children from settings; each child's data scoped independently.

**Exit criteria:** A guest can sign up as a parent, submit a student enrolment, the city_admin sees it, approves it, and the parent receives a notification (Step 12 wires the actual delivery — here, the queued job logs success). MSV enrolment flow works end-to-end with admin approval.

---

### Step 11 — Media & File Architecture [BLOCKS Gallery, homework, library, ID cards]

**Dependencies:** Step 7.

**Build:**
- `media` module: `POST /v1/media/sign-upload` returns presigned PUT URL + asset record stub; `POST /v1/media/finalize` validates upload, kicks off processing job.
- `media_assets` table with status state machine (`pending` → `processing` → `ready` | `failed` | `rejected`).
- Storage abstraction (`StorageService`) with two adapters: `R2Adapter` (prod) and `MinioAdapter` (dev) — same interface.
- `media.processing` queue processor: downloads original from storage, runs `sharp` for thumbnails (sm 200px, md 600px, lg 1200px), strips EXIF, optionally calls AI moderation (off by default; behind feature flag), uploads variants, marks asset `ready`.
- Bucket structure per Section 10: `jp-prod-media-private`, `jp-prod-media-public`, `jp-prod-exports`, `jp-prod-receipts`.
- CloudFront signed-URL helper (`storage.getSignedReadUrl(assetId, ttl)`) for private bucket reads from mobile/web.
- ID card generation processor (`idcard.generation`): renders Handlebars template (`templates/id-card.hbs`) with student data, uses Puppeteer to produce PNG, uploads to `jp-prod-media-public`, updates `digital_id_cards` table.
- Auto-regenerate ID card on student transfer or MSV status change (triggered by a domain event).

**Exit criteria:** A parent can upload a profile photo from the mobile app; thumbnails appear; the photo renders in the admin panel. ID cards generate automatically on enrolment approval and are downloadable as PNG from both parent and admin views.

---

### Step 12 — Notifications & Realtime [BLOCKS engagement features]

**Dependencies:** Step 7.

**Build:**
- `notifications` module: `notifications.fanout` queue (computes recipient list from event + scope), `notifications.push` queue (FCM batched send, 500/batch per Section 17.4), `notifications.sms` queue (MSG91 with Devanagari segment math per Section 8), `notifications.email` queue (Resend).
- `device_tokens` table with token deduplication on registration, automatic prune on FCM-reported invalid token.
- `notifications` table for in-app notification feed; `GET /v1/notifications` with cursor pagination, `POST /v1/notifications/:id/read`, `POST /v1/notifications/read-all`.
- Templated notification payloads in `apps/api/src/notifications/templates/` keyed by event type, bilingual per recipient `preferred_language`.
- Critical-notice SMS fallback: when admin marks a notice critical, both push and SMS fan out; SMS guarded by per-day spend cap visible in super_admin dashboard.
- Socket.IO namespaces per Section 9.3: `/shivirs/:shivirId`, `/push-quizzes/:quizId`, `/admin-dashboard/:scope`. Redis adapter for multi-task fanout.
- Mobile push handler: FCM token registration on login, foreground notification rendering, background tap → deep link routing.
- Admin live dashboard widget (web) subscribing to `/admin-dashboard/:cityId` socket, updating attendance and check-in counts in real time.

**Exit criteria:** Marking attendance triggers a push to the parent within 5s. Posting a notice triggers a push to all batch parents. A critical notice also triggers SMS. The admin live dashboard updates without page refresh.

---

### Step 13 — Attendance & GPS Check-In [Phase 1 capstone]

**Dependencies:** Steps 10, 11, 12.

**Build:**
- Implement CLAUDE.md AT1–AT31 and the frozen route/cron/MV tables. Sessions materialised by `session.materialise` (AT7); check-in/out via `/v1/sessions/:id/check-in|check-out` with `submission_op_id` (AT16); bulk mark via `/v1/sessions/:id/attendance`.
- GPS: `centres.gps_radius_meters` default 250; `sessions.gps_flagged` + distance columns; `accuracy_m > 100` flags unverified, never rejects (AT13–AT15).
- Punya: reverse-then-award, guarded `ON CONFLICT DO NOTHING … RETURNING` balance credit, streak bonus every 4 attended sessions (AT17–AT22).
- Absences: `POST /v1/students/:id/absences`; auto-excused + `resolved_at` (AT4). Cancel embeds on `sessions` (AT11); `force_cancel` when marks exist (AT25).
- Offline: `POST /v1/sync/batch` only; MMKV drain uses `submission_op_id` / per-row `client_op_id` (AT19).
- UI: Present/Absent/Late/Excused; percentage from AT5 SQL only. Consecutive-absence at 02:00 IST → parent + Sanchalak + city_admin (AT27). Parent push 5-minute debounce; admin feed 10s aggregates (AT31).

**Exit criteria:** A shikshak can check in (GPS verified/flagged per AT15), mark attendance for 20 students (including offline), check out, and the parent receives a debounced notification. Attendance percentage matches the AT5 SQL function for holidays/cancelled/excused rules.

---

### Step 14 — Offline Sync Engine [hardens Step 13 and all subsequent mobile features]

**Dependencies:** Step 13.

**Build:**
- `POST /v1/sync/batch` accepts an array of client-generated operations, each with `submission_op_id`, `op_type`, `payload`, `client_timestamp`. Server processes idempotently using `sync_operations` unique `(user_id, submission_op_id)` (AT19).
- Conflict policy: last-write-wins by `client_timestamp` for non-critical fields; server-authoritative for state-machine transitions; explicit error returned for unresolvable conflicts (e.g. attendance for a cancelled session).
- `GET /v1/sync/bootstrap` returns user's full working set (their batches, current students, active niyams, recent notices) for first-launch hydration.
- Mobile sync engine (`apps/mobile/src/sync/`): triggered on network restore, app foreground, and every 60s while online. Drains queues in priority order: attendance > scans > niyam-submissions > acknowledgements.
- Retry policy: exponential backoff capped at 5 minutes; after 5 failed attempts, surface to UI as "Sync issue — tap to retry".
- UI indicators: top banner when offline, queued-count badge on tabs with pending operations, success toast after sync drain.

**Exit criteria:** Detox test passes the scenario: shikshak goes offline, marks attendance for 30 students across 2 sessions, submits a niyam rejection, comes back online, and within 30s all operations sync to the server with no duplicates and no losses.

---

### Step 15 — QR Scanning & Shivir Management [Phase 2]

**Dependencies:** Steps 11, 13.

**Build:**
- Digital ID card QR code generated as part of ID card image (Step 11) and also exposed as a separate scannable image in the parent's app.
- `shivir_events`, `shivir_sessions`, `shivir_registrations`, `shivir_volunteers`, `shivir_attendance_scans` modules.
- `POST /v1/shivirs/:id/scan` accepts `student_qr_code` + `session_id` + `scan_mode` (`in_out` or `present_only`) + `volunteer_id`. State machine enforces alternation in in/out mode (first scan = in, next = out, etc).
- Volunteer mobile UI: minimal-chrome scanner screen, camera permission flow, real-time scan feedback (success animation, fail toast with reason).
- Offline support: scans queue locally, sync per Step 14.
- Live attendance dashboard (web + socket per Step 12): registered, in, out, not-yet-arrived counters, filterable by session and centre.
- Export: `POST /v1/shivirs/:id/export` → enqueues `report.shivir.export` job → produces CSV + PDF in `jp-prod-exports`, signed-URL returned via notification.

**Exit criteria:** A city_admin creates a Shivir, assigns 3 volunteers, parents register 50 students, volunteers scan them in and out across 2 sessions (with airplane mode toggling mid-event), the live dashboard reflects accurate counts, and the post-event CSV/PDF export downloads correctly.

---

### Step 16 — Punya Engine & Leaderboards [Phase 2]

**Dependencies:** Step 13.

**Build:**
- `punya_features` seeded with the catalogue from BRD Section 7 (attending class 10pts, homework 15pts, streak bonus 20pts, etc).
- `punya_configs` for city-level overrides (city_admin can adjust point values within bounds set by super_admin).
- `punya_transactions` ledger (immutable, append-only) with unique `idempotency_key` index — prevents double-award on retried jobs.
- `punya_balances` projection table, updated by `punya.award` queue processor in the same transaction as the ledger insert.
- `POST /v1/punya/award` admin endpoint for manual awards (festival, seva, helping others) with mandatory reason and amount within configured bounds.
- `POST /v1/punya/reverse` for retroactive reversals (used by Niyam rejection in Step 17). Creates a transaction with `reversal_of` FK and negative amount; balance projection updated.
- Spiritual tier computation: stored on `punya_balances.tier_label` updated on every transaction; tier upgrade emits a domain event → celebration animation push + certificate generation job.
- Leaderboards: batch / centre / city / MSV — backed by Redis sorted sets (one set per scope per month). Updated incrementally by `punya.leaderboard.refresh` processor.
- Monthly reset cron at 1st of month 00:05 IST: archives prior-month ZSETs to `leaderboard_snapshots` table and clears.
- Reconciliation cron nightly 03:00 IST: scans `punya_transactions` and rebuilds `punya_balances` projection from scratch; alerts if drift detected.

**Exit criteria:** Marking a student present awards 10 Punya and updates the balance and batch leaderboard within 2s. A retroactive Niyam rejection (Step 17) cleanly reverses the points. Forcibly corrupting `punya_balances` and running the nightly reconciliation restores correctness and alerts ops.

---

### Step 17 — Niyams Module + Gallery [Phase 2]

**Dependencies:** Steps 11, 16.

**Build:**
- `niyams` module: CRUD scoped by assigning role (city_admin / sanchalak / shikshak); bilingual fields per Gap B; target audience filtering (all / MSV-only / age-group / batch).
- `POST /v1/niyams/:id/submissions` accepts photo or video media asset id; submission auto-approved (Q5); Niyam Punya awarded immediately via `punya.award` queue.
- `niyam_streaks` table updated per-submission; streak badges (7-day, 30-day, 4-week, 3-month per BRD Section 8.5) awarded as one-time badges.
- `POST /v1/niyams/submissions/:id/reject` (shikshak / sanchalak / city_admin only; within 30 days of submission per Q5); creates Punya reversal transaction, marks submission `rejected_at`, `rejected_by`, `rejection_reason`; pushes notification to parent.
- Streak recompute on rejection: `niyam.streak.recompute` queue job rolls back streak counters if the rejected day breaks the streak.
- `gallery_items` table populated automatically when a submission is approved AND the parent's `users.gallery_visibility_opt_in = true` (Q6).
- Toggling `gallery_visibility_opt_in` immediately hides/shows all of that parent's children's items in the Gallery (handled via a query-time filter, not a backfill).
- Parent profile settings UI (mobile): blanket Gallery visibility toggle with clear copy on what it means.
- Gallery UI (web public + mobile): paginated grid scoped to city, filterable by Niyam type and age group; featured items in a top carousel per BRD Section 8.4.
- Admin actions: feature item, unfeature, remove item (writes audit log with reason).

**Exit criteria:** Parent uploads a niyam photo, Punya is awarded within 3s, the streak counter increments, and (if opted in) the item appears in the city Gallery. A retroactive rejection within 30 days reverses Punya and streak. The same action attempted on day 31 is blocked with a clear error.

---

### Step 18 — Homework, Notices, Competitions [Phase 2]

**Dependencies:** Steps 11, 12, 16.

**Build:**
- `homework_assignments` + `homework_submissions` per BRD Section 9; lifecycle states `pending` → `starred` → `approved` | `late`. Punya awarded on `approved` per Section 7 of BRD.
- Shikshak homework UI: bulk-assign to batch or individual students, optional PDF/image attachment, due date.
- Parent homework UI: list across all children, mark as done, view feedback.
- `notices` module per Section 12 of this prompt — bilingual content, scope (batch / centre / city / national / MSV-only), pinning, scheduled posting, public flag (for guest visibility), critical flag (triggers SMS).
- `competitions` module: registration window, eligibility, results entry, Punya award on result declaration.
- All three modules wire into the notification system from Step 12 (new homework → push, new notice → push + maybe SMS, competition registration confirmation → push).

**Exit criteria:** A shikshak assigns homework to a batch, all parents receive a push within 5s, two parents mark complete, the shikshak approves both, Punya is awarded. A city_admin posts a critical notice; all city parents receive both push and SMS.

---

### Step 19 — Curriculum & Online Exams [Phase 3]

**Dependencies:** Steps 6, 16.

**Build:**
- `curriculum_templates` (super_admin master templates), `curricula` (city-level Standard curricula derived from templates or scratch), `curriculum_sections`, `curriculum_items` (bilingual).
- MSV curriculum tables share schema but `created_by_role = super_admin` enforced at service layer (Q2). City_admin attempts to write MSV curriculum return 403.
- `curriculum_assignments` links curricula to centres or batches; a centre/batch can have one active Standard + one active MSV curriculum.
- `student_curriculum_progress` per-student per-item competency level (`not_started` / `in_progress` / `completed` / `mastered`) with optional shikshak note.
- Shikshak UI: curriculum tree view, mark competency per student per item, bulk-update controls.
- Parent UI: read-only progress view per child.
- `online_exams` + `exam_questions` + `exam_question_options` + `exam_attempts` + `exam_answers` per BRD Section 14.
- Class-wide exam OTP enforced at attempt start; `exam_attempts.otp_used_at` recorded.
- Auto-grading for MCQ single/multi and true/false; admin-grading queue for free-text answers.
- Manual release flow: admin reviews aggregate stats then clicks "Release Results"; release triggers push notification to all attempters with individual scores and rank (if not hidden by admin).
- Punya awarded for completion and for top scores per exam config.

**Exit criteria:** A super_admin creates an MSV curriculum; a city_admin attempts to edit it and is blocked. A city_admin creates a Standard exam with 15 MCQ + 2 free-text questions; 40 students attempt it; auto-grade completes; admin reviews free-text; results release sends pushes to all 40 with correct rank ordering.

---

### Step 20 — Quizzes (Scheduled + Push) [Phase 3]

**Dependencies:** Steps 12, 19.

**Build:**
- `questions` bank with bilingual fields + `is_ai_generated` flag.
- `quiz_events` (super/state/city/centre scoped) with active window, eligibility, Punya config.
- `quiz_attempts` per student; idempotent answer submission.
- `push_quizzes` + `push_quiz_questions` + `push_quiz_attempts` for instant in-class quizzes initiated by shikshak.
- Real-time push quiz UX via Socket.IO `/push-quizzes/:quizId` namespace: shikshak starts → all batch parents (and 13+ students in student view) see an alert banner; tap to participate; live leaderboard during the quiz.
- AI quiz generation (Step 21 backend dependency; here, expose admin endpoint that enqueues `ai.quiz.generate` with topic + age group + count; results land in a review queue before publishing).

**Exit criteria:** A city_admin schedules a quiz for next Sunday; participating students see it at the scheduled time; submissions auto-grade; Punya awarded. A shikshak launches a push quiz mid-session; 15 students attempt it within 3 minutes; live results update on the shikshak's screen.

---

### Step 21 — AI Service & Donations [Phase 3]

**Dependencies:** Steps 7, 12.

**Build:**
- `apps/ai` FastAPI service per Section 3; endpoints `POST /ai/quiz/generate`, `POST /ai/moderation/image` (optional, behind feature flag).
- HMAC-signed requests between NestJS and FastAPI; IP allowlist enforced at security group level.
- OpenAI GPT-4o-mini integration for quiz generation; structured output via JSON schema; review-queue persistence in the API DB.
- `donations` + `donation_campaigns` + `donor_profiles` per BRD Section 18.
- Razorpay integration: checkout session creation, webhook handler with signature verification, idempotent order processing.
- Donation receipt PDF (`donation.receipt.generate` queue) using Handlebars + Puppeteer; stored in `jp-prod-receipts` with 7-year retention.
- 80G certificate: only generated if `platform_settings.eighty_g_enabled = true` AND `eighty_g_registration_number` is set (Q3). Separate template, separate generation job.
- Donor-side UX (web): donation form on `/donate`, optional account creation, donation history page; mobile parents can also donate from in-app.
- Super_admin settings UI: 80G toggle + registration number field with confirmation dialog (changing 80G state mid-year has compliance implications — surface a warning).

**Exit criteria:** A shikshak generates 10 quiz questions for "Tirthankaras (age 8-12)" via AI; reviews and publishes 7. A donor donates ₹501 via Razorpay UPI; receipt generates within 30s; donor downloads it. Super_admin enables 80G with registration number `AABTM1234E`; next donation receipt includes the certificate; toggling off reverts to plain receipts.

---

### Step 22 — Library, Service Requests, Reports, Analytics [Phase 3]

**Dependencies:** Steps 11, 12.

**Build:**
- `library_items` per Section 17 of BRD; 4 access tiers (public / student-parent / MSV-only / shikshak-only); video items store `embed_url` (Q7); PDFs/audio/images use signed S3 URLs.
- Library UI (mobile + web): filterable list, search, in-app PDF viewer (`react-native-pdf` mobile, `react-pdf` web), embedded video player for YouTube/Vimeo.
- `library_access_logs` writes on view/download for admin analytics.
- `service_requests` per BRD Section 16: parent submits with category + description; status state machine `submitted` → `in_review` → `resolved`; assigned to sanchalak by default with escalation to city_admin.
- `progress_reports` cron-generated monthly + termly per Section 5A.2 of BRD; PDF in `jp-prod-exports`; parent push when ready.
- Analytics module per Section 12 / CLAUDE.md frozen MV table: `mv_centre_engagement`, `mv_punya_distribution`, `mv_msv_funnel`, `mv_city_attendance_monthly`, `mv_niyam_completion`; refreshed nightly via `analytics.refresh_views`.
- Admin analytics dashboards (web): role-scoped views consuming the materialised views.
- Weekly digest email per Section 12 of this prompt: cron at Monday 07:00 IST → city_admins receive city summary, sanchalaks receive centre summary.
- Per-student PDF export and bulk ZIP export endpoints + queue processors.

**Exit criteria:** A parent browses the public library tier without login, downloads a PDF. A logged-in MSV parent accesses MSV-tier content; a non-MSV parent attempting the same gets 403. A parent submits a service request; sanchalak resolves it; parent receives notification. Monthly reports auto-generate on the 1st for all active students. Weekly digest emails arrive Monday morning.

---

### Step 23 — Hardening, Load Testing, Production Deployment

**Dependencies:** All previous steps.

**Build:**
- Run k6 load tests per Section 15: 10k concurrent OTP requests, 5k concurrent attendance writes, 50k concurrent leaderboard reads. Tune Redis sorted sets, PgBouncer pool sizes, and ECS auto-scaling triggers based on results.
- Run Detox E2E suite covering all critical flows on Android + iOS.
- Run Playwright web E2E on the admin panel and public website.
- Run OWASP ZAP DAST scan against the staging API; remediate every high-severity finding.
- Snyk dependency scan; upgrade any vulnerable transitive deps.
- Pen-test the auth flow specifically (OTP enumeration, refresh-token reuse, role confusion via JWT manipulation, IDOR on every scoped endpoint).
- Verify backup + restore drill: take an RDS snapshot, restore into a new instance, verify integrity by running a smoke test suite against it.
- Verify DR runbook: simulate primary-region outage in staging, execute failover, measure actual RTO.
- Finalise CloudFront caching policies based on traffic patterns observed in staging.
- Create runbooks in `docs/runbooks/` for: OTP outage, push-notification provider outage, payment-gateway outage, database failover, runaway BullMQ queue, leaderboard drift, suspected security incident.
- Final accessibility audit on web (WCAG 2.1 AA) and mobile (TalkBack / VoiceOver coverage on critical screens).
- Performance budget enforcement: web LCP < 2.5s on 3G Fast, mobile time-to-interactive < 3s on mid-tier Android.
- Deploy to production. Smoke-test. Hand over.

**Exit criteria:** All k6 SLOs met (p95 API latency < 300ms at target load; OTP success rate > 99.5%; attendance write success rate > 99.9%). Zero critical or high security findings. DR drill RTO measured ≤ 30 min. Production deployed, smoke tests green, ops handover complete with runbooks signed off.

---

## End of Specification

This document is the complete, authoritative engineering brief for the Jain Pathshala platform. All 14 BRD decisions are locked, all schemas defined, all queues named, all endpoints enumerated, all environments specified, and all build steps ordered with explicit dependencies and exit criteria.

The Replit Agent has everything required to begin Step 1 immediately. No further clarification rounds are needed before code generation can start.

**Enaa Creations | May 2026 | v1.0 — Implementation-Ready**

