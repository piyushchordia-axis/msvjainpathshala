# Jain Pathshala — Module Audit (Developed / Stub / Missing)

_Last updated: 2026-06-14. Audited against the live workspace: API `artifacts/api-server`, web `artifacts/jain-pathshala`, mobile `artifacts/jain-pathshala-mobile`, DB schema `lib/db/src/schema`._

## TL;DR

The app is a **rewrite-in-progress**. A fuller legacy Nest.js codebase lives in `.migration-backup/`; the current stack is an Express + Drizzle + React/Expo rewrite that has ported only a **core subset**.

- Current code schema = **42 tables**. The previously-seeded local DB had **79** (legacy). Many client modules exist only in `.migration-backup/`, not in the current code.
- What's ported is **solid and production-shaped**: real DB queries, Zod validation, JWT/cookie auth, multi-tenant role scoping, bilingual (en/hi). No `TODO`/`FIXME`/stub markers in the ported code.
- The dominant gap is **write/transactional paths**: most authenticated flows are **read-only** (you can view attendance/exams/niyams but not mark/take/submit them).

## How to run locally

1. `pnpm install` (repo root)
2. Root `.env`: `DATABASE_URL=postgres://sumit@localhost:5432/jainpathshala`, `JP_AUTH_SECRET=...`, `NODE_ENV=development`
3. DB (reset+seed): `psql ... -c "drop schema public cascade; create schema public;"` → `pnpm --filter @workspace/db run push-force` → `pnpm --filter @workspace/db run seed`
4. API: `PORT=8080 pnpm --filter @workspace/api-server run dev` → http://localhost:8080
5. Web: `PORT=5173 BASE_PATH=/ VITE_API_BASE_URL=http://localhost:8080 pnpm --filter @workspace/jain-pathshala run dev` → http://localhost:5173

Login OTP `123456` for all seeded users: super_admin `+919800000001`, state_admin `..2`, city_admin `..3`, sanchalak `..4`, shikshak `..5`, parent `..6`, student `..7`.

---

## Client's 22 modules — status matrix

Legend: ✅ Implemented · 🟡 Partial · 🔵 Stub/shell only · ❌ Missing

| # | Module | DB | API | Web | Mobile | Overall |
|---|--------|----|----|-----|--------|---------|
| 1 | Authentication | ✅ | ✅ | ✅ | ✅ | **✅ Done** |
| 2 | Centre & Batch Management | ✅ | ✅ | ✅ | ✅ (admin) | **✅ Done** |
| 3 | Dynamic Registration Forms | ❌ | ❌ | ❌ | ❌ | **❌ Missing** |
| 4 | Digital ID Cards (QR + PNG) | ✅ table only | ❌ | ❌ | ❌ | **🔵 Schema only** |
| 5 | Attendance & GPS Sessions | 🟡 (no GPS) | 🟡 read-only | 🔵 mislabeled | 🔵 read-only | **🟡 View only, no marking, no GPS** |
| 6 | Punya Points Engine | ✅ | ✅ | ✅ | ✅ (view) | **✅ Done** |
| 7 | Niyams (Tasks) | ✅ | 🟡 no submit | ✅ admin | 🟡 view only | **🟡 Authoring done, submission missing** |
| 8 | Gallery | ✅ | ✅ | ✅ | ✅ | **✅ Done** |
| 9 | Homework | ❌ | ❌ | ❌ | ❌ | **❌ Missing** |
| 10 | Notices | ✅ | ✅ | ✅ | ✅ | **✅ Done** (read-tracking unused) |
| 11 | Shivirs (scanner, live dashboard) | 🟡 no scan table | 🟡 CRUD only | 🟡 CRUD only | ❌ | **🟡 Events only; scanner + live dashboard missing** |
| 12 | Competitions | ❌ | ❌ | ❌ | ❌ | **❌ Missing** |
| 13 | Curriculum (Standard + MSV) | 🟡 no progress | ✅ authoring | ✅ authoring | ❌ | **🟡 Authoring done; student progress/assignment missing** |
| 14 | Online Exams (OTP, auto+manual grading) | 🔵 no Q/A tables | 🔵 admin shell | 🔵 admin shell | ❌ | **🔵 Shell only; no questions, no taking, no grading** |
| 15 | Quiz System (events + push) | ❌ | ❌ | ❌ | ❌ | **❌ Missing** |
| 16 | Service Requests | ❌ | ❌ | 🔵 broken (wired to /sessions) | ❌ | **❌ Missing / broken** |
| 17 | Library / Resources | ✅ | ✅ | ✅ | ✅ | **✅ Done** (access logs unused) |
| 18 | Donations | ✅ | 🟡 read-only | 🟡 read-only | ❌ | **🟡 View only; no payments, public /donate stub** |
| 19 | MSV Programme Track | ✅ | 🟡 read-only | 🟡 read-only | ❌ | **🟡 View only; no workflow; public /msv stub** |
| 20 | Analytics / Reports / Audit / PDF Export | 🟡 no audit_logs | 🟡 | 🟡 | partial | **🟡 Analytics ok; Reports=sessions; Audit=punya feed; PDF export missing** |
| 21 | Birthday Wishes | ❌ (dob only) | ❌ | ❌ | ❌ | **❌ Missing** |
| 22 | Student Progress Reports | ❌ | ❌ | ❌ | 🔵 stub text | **❌ Missing** |

**Scorecard:** ✅ Done = 6 (Auth, Centre/Batch, Punya, Gallery, Notices, Library) · 🟡 Partial = 8 · 🔵 Stub/shell = 1–2 · ❌ Missing = 6 (Registration Forms, Homework, Competitions, Quiz, Service Requests, Birthday Wishes, Progress Reports).

---

## Per-module detail

### ✅ Fully implemented
- **1. Authentication** — Phone→OTP flow (`/api/auth/login` send/verify), JWT access + refresh, device sessions, cookie (web) + Bearer (mobile). Role gating across 8 roles. Files: `api-server/src/routes/auth.ts`, `middlewares/auth.ts`, `lib/scope.ts`.
- **2. Centre & Batch Management** — Full CRUD + activate/deactivate, multi-tenant scoping. Web admin pages + mobile admin tabs + public centre browse.
- **6. Punya Points Engine** — Configs, manual award, transactions ledger, balances, tier computation (`tierForPoints`). Admin UI + mobile view.
- **8. Gallery** — Public feed + admin feature/unfeature of student niyam submissions.
- **10. Notices** — Bilingual, audiences (national/state/city/centre/batch/msv), pinned/critical flags. Public + admin CRUD. (Gap: `notice_reads` table exists but read-tracking not wired.)
- **17. Library / Resources** — Multi-tier access (public/student/msv/shikshak), content types (pdf/video/audio/image). Public + admin CRUD. (Gap: `library_access_logs` unused.)

### 🟡 Partial
- **5. Attendance & GPS Sessions** — `sessions`/`attendance`/`session_cancellations` tables exist. **API is read-only** (`GET /v1/admin/sessions`, `/v1/me/today`, `/v1/me/students/:id/attendance`) — there is **no endpoint to create a session or mark attendance**. **GPS is entirely absent**: the current `centres` schema has no `lat`/`lng`/`gps_radius_m` (legacy DB had them; the rewrite dropped them). No `absence_notifications` table. Mobile shikshak "Today" shows counts but can't mark.
- **7. Niyams** — Admin can create niyams and view submissions; students/parents can view catalog + own submissions. **No POST to submit a niyam** (with photo/video proof) and no grading/approval action. `niyam_streaks` table unused.
- **11. Shivirs** — `shivir_events`/`shivir_registrations`/`shivir_volunteers` tables + admin CRUD + public listing exist. **Missing the differentiators**: no `shivir_attendance_scans`/`shivir_sessions` tables, no QR volunteer-scanner endpoint, no live attendance dashboard, no mobile shivir admin.
- **13. Curriculum** — `curricula`/`curriculum_sections`/`curriculum_items` with kinds (standard/msv/shikshak/special), tree view, create. **Missing**: `curriculum_assignments`/`templates`/`student_curriculum_progress` — no assigning curriculum to students and no progress tracking.
- **18. Donations** — Campaigns + donations tables + admin read views. **No payment gateway integration**, analytics `donations_total_paise_ytd` hardcoded `0`, public `/donate` is a `PageStub`.
- **19. MSV Programme Track** — `msv_enrolments` table + admin read-only list; curriculum `msv` kind exists. **No application/approval workflow actions**; public `/msv` is a stub.
- **20. Analytics / Reports / Audit / PDF Export** — Analytics overview is real. "Reports" page just renders sessions. **"Audit log" reuses the punya transactions table — there is no `audit_logs` table or general audit trail.** **Per-Student PDF Export does not exist** (no `export_jobs`, no PDF/QR/image libs in deps).

### 🔵 Stub / shell only
- **4. Digital ID Cards** — `digital_id_cards` table with `qr_token` exists and is seeded, but **no QR generation, no PNG rendering, no API, no UI** anywhere. Deps lack `qrcode`/`sharp`/`canvas`/`puppeteer`.
- **14. Online Exams** — Admin can create an exam (auto-generates OTP), view attempt summaries, release results. **No `exam_questions`/`exam_question_options`/`exam_answers` tables, no student endpoint to start/take/submit, and no grading logic (auto or manual).** It's an admin shell.

### ❌ Missing (present in `.migration-backup/` legacy, not in current code)
- **3. Dynamic Registration Forms** — no `registration_form_configs`/`registration_form_responses` in current schema.
- **9. Homework** — no `homework_assignments`/`homework_submissions` in current schema.
- **12. Competitions** — no `competitions`/`competition_registrations` in current schema.
- **15. Quiz System** — no `quiz_events`/`questions`/`push_quizzes`/`*_attempts` in current schema.
- **16. Service Requests** — no `service_requests`/`service_request_messages` table or endpoint. **Bug:** the web "Service requests" page (`AdminListPages.tsx` ~L1023) is wired to `/v1/admin/sessions` and shows batch sessions instead.
- **21. Birthday Wishes** — `students.dob` exists for data, but no birthday job/notification/UI.
- **22. Student Progress Reports** — no progress table/endpoint; mobile parent home only has static "track progress" text.

---

## Cross-cutting themes & known bugs

1. **Read-only system.** The biggest theme: ported authenticated flows view data but can't mutate it. Missing write paths: mark attendance, create/schedule sessions, submit niyams, take/grade exams, MSV apply/approve, service-request threads.
2. **GPS removed in rewrite.** Geofenced attendance (a headline client feature) is not in the current schema at all.
3. **Bugs to fix:**
   - Web "Service requests" page → calls `/v1/admin/sessions` (mislabeled/wrong endpoint).
   - "Audit log" page → shows punya transactions, not a real audit trail (no `audit_logs` table).
   - Analytics `donations_total_paise_ytd` hardcoded to `0`.
4. **Public marketing stubs:** `/about`, `/contact`, `/donate`, `/enquire`, `/msv` are `PageStub` (no forms/API).
5. **No QR / PDF / image tooling** in dependencies — blocks Digital ID Cards, PDF export, and shivir scanner.
6. **Legacy reference:** `.migration-backup/apps/api` contains prior implementations of homework, registration forms, competitions, quizzes, progress reports, and PDF export — useful as a porting reference.

## Suggested implementation order (highest leverage first)

1. **Attendance marking + sessions write API** (+ GPS geofence) — core daily-use feature, currently view-only.
2. **Niyam submission flow** (student POST with proof, shikshak approval) — feeds Punya + Gallery, which are already built.
3. **Online Exams end-to-end** — question/answer schema, student take flow, auto+manual grading (admin shell already exists).
4. **Digital ID Cards** — add `qrcode`+`sharp`, generation endpoint, render in mobile/web (table + token already exist).
5. **Service Requests** — real table + threaded API; fix the mislabeled page.
6. **Dynamic Registration Forms**, **Homework**, **Quiz System**, **Competitions** — port from `.migration-backup`.
7. **Donations payments**, **MSV workflow**, **Progress Reports + PDF export**, **Birthday Wishes**, **public forms**.
