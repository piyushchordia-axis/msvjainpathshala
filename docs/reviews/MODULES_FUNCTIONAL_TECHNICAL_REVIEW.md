# Module review — Niyam, Homework, Attendance, Courses, Notifications, Notices, Quiz, Exam, Competitions, Library

Functional and technical review of the running stack (Express + Expo + Drizzle), August 2026. Not Nest/Next SPEC targets.

---

## Cross-cutting picture

| Module | Maturity | Offline | Guest | Punya |
|--------|----------|---------|-------|-------|
| Attendance | Highest (AT1–AT32 largely coded) | Full sync chain | Holidays only | Yes (present/late + streak) |
| Courses | High (CU largely shipped) | Progress + certify queues | Catalogue + read-only outline | On certify |
| Homework | High | Submit / mark-done | No | On grade |
| Library | High (browse/play) | Audio + bookmarks (local) | Yes | No |
| Niyam | High domain rules | Queue exists; mobile never enqueues | No | Yes + badges |
| Notices | Solid feed/CRUD | Pull-only | Public notices | No |
| Notifications | Solid inbox/push | N/A | No | N/A |
| Quiz | Solid take + bank | No | No | Yes |
| Exam | Stronger than quiz (autosave) | No | No | Completion + top_score job |
| Competitions | Thin (register + ranks) | No | No | On publish-results |

Shared patterns: bilingual content; scope guards (centre/batch/city); response envelope; student context via `ChildSwitcher` / `activeStudentId`.

---

## 1. Niyam

**Functional**  
Parents/students browse a scoped catalogue, submit proofs, see streaks/badges. Shikshak sees centre pending; approve/reject is **batch-scoped** (Q12). Sanchalak reviews whole centre on mobile. City+ admins author definitions. Guests: none.

**Technical**

- API: `POST /v1/niyam-submissions`, pending/approve/reject/bulk, `/v1/me/niyam-catalog`, admin CRUD — `apps/api-server/src/routes/v1/niyam-submissions.ts`
- Schema: `lib/db/src/schema/niyams.ts` (niyams, submissions, media, streaks, badges)
- Mobile: `parent/student/niyams`, `niyam-submit`, `NiyamReviewScreen`

**Rules that matter**  
Q5 30-day reject window; Q6 gallery consent at read time; auto vs review from `approval_mode`; IST period keys; streak lapse cron at 05:00 IST.

**Risks**

1. Offline: `jp.queue.niyam_submissions` + server handler exist, but mobile submit is online-only — and the sync path is thinner than the HTTP path.
2. Mobile review is pending-centric; retro-reject of auto-approved is weaker on device than web.

---

## 2. Homework

**Functional**  
Guruji creates batch assignments → one pending row per eligible student. Parent/student submit file or mark-done. Guruji grades (approved / starred / returned) or grade-all. MSV assignments only for MSV-approved students.

**Technical**

- API: `/v1/homework/*` — `apps/api-server/src/routes/v1/homework.ts`
- Schema: `homework_assignments`, `homework_submissions` — `lib/db/src/schema/homework.ts`
- Offline: enqueue + media upload queue → `/v1/sync/batch` (reference offline path)
- Mobile: `homework.tsx`, `HomeworkAdmin`, `homework-assignment/[id].tsx`

**Risks**  
Titles/descriptions are **not** `_en`/`_hi`. Status enum `late` vs boolean `late` is easy to misuse. Staff cannot submit for a child (by design).

---

## 3. Attendance

**Functional**  
Shikshak: today’s sessions → optional GPS check-in/out → mark roster (AT32: mark does **not** require check-in). Parents: history + % + notify leave. Sanchalak+: alerts, holidays, timetable rematerialise. Guests: published holidays only.

**Technical**

- Frozen routes: check-in/out, bulk/single mark, cancel, today, student attendance/absences, holiday split (AT30), sync batch
- Schema: `sessions`, `attendance`, `absence_notifications`, `sync_operations` — `lib/db/src/schema/attendance.ts`
- Canonical % is **Postgres only** (AT5)
- Jobs: materialise, auto-checkout, no-show, consecutive absence (02:00 IST), post-process (AT31 5‑min parent push)

**Mobile**  
`shikshak/today.tsx`, `attendance/[id].tsx`, `my-attendance.tsx`, `admin/attendance.tsx`, `admin/holidays.tsx`

**Risks**

1. Roster UI is mostly present/absent — late/excused are API-first.
2. Holidays are one row per day (range expanded client-side), not a true range column.
3. `%` relies on not materialising holiday sessions; marked holiday sessions stay (AT10).

---

## 4. Courses

**Functional**  
City/super author → publish. Parents/students track progress; Guruji can mark/certify (batch-scoped). Guests: public catalogue + read-only outline (no Punya). MSV curriculum authoring: super_admin only (Q2).

**Technical**

- Learner: `/v1/courses`, tree, progress, certify; public: `/v1/public/courses`
- Admin: `/v1/admin/courses`, templates, publish, archive-impact
- Schema: `lib/db/src/schema/curriculum.ts` + `fn_course_progress`
- Offline: `course_progress` / `course_certification` queues
- Mobile: `courses.tsx`, `course/[id]/*`, `CourseAdmin`, `CourseLearnerOutline` (`readOnly` for guests)

**Risks**  
Legacy `/v1/curriculum` + `/v1/progress` still mounted beside courses. Public catalogue is all active courses (weaker than CU3 city/MSV filter). Missing `punya_configs` can zero awards (CU22).

---

## 5. Notifications (push + inbox)

**Functional**  
Authenticated users: inbox + Expo token. Parents get attendance/homework/niyam/gallery/birthday-style alerts. Staff get operational alerts (GPS, no-show, consecutive absence). Guests: none.

**Technical**

- Routes: `POST /push-token`, `GET /`, read / read-all — `routes/v1/notifications.ts`
- Pipeline: `lib/notify.ts` → inbox + `lib/push.ts`
- Crons: birthday 06:00 IST; receipt sweep every 30m
- Admin Socket.IO feed is **attendance aggregates**, not user push

**Risks**  
No in-app prefs UI. Many enum kinds unused. Deep links ignore `kind` and usually open `/notifications`. Do not confuse with **notices** or **push quizzes**.

---

## 6. Notices

**Functional**  
Scoped announcements (`batch|centre|city|state|national|msv`). Guests see public live notices. Members get a scoped feed with read receipts. Admins CRUD; national/MSV: super_admin. **Publish does not send push** — critical/pinned are feed flags only.

**Technical**

- `GET /v1/notices/public|feed`, admin CRUD — `routes/v1/notices.ts`
- Schema: `notices`, `notice_reads`
- Mobile: `NoticesFeedScreen` (auto mark-read on load), `admin/notices.tsx`

**Risks**  
Auto mark-read kills unread usefulness. Hard delete. No push on critical publish. Hindi “सूचनाएँ” collides with notifications naming.

---

## 7. Quiz (scheduled + push)

**Functional**  
Admins build question bank + events / push quizzes. Parents/students take scheduled quizzes and polled live push quizzes; Punya on submit. Guests: none. No mobile “fire push” for Guruji (web authoring).

**Technical**

- `/v1/quizzes/*` — `routes/v1/quizzes.ts`
- Schema: `lib/db/src/schema/quizzes.ts`
- Mobile: `quizzes.tsx` + `QuizRunner`; push poll ~20s
- CLAUDE Socket.IO `/push-quizzes` is **not** how push quizzes work today (polling)

**Risks**  
No offline. Mid-attempt answers only persist on **submit** (weaker than exams).

---

## 8. Exam

**Functional**  
City_admin+ author/grade/release. Parent/student: available → OTP start → answer → submit → result when released. Auto-grade MCQ; subjective needs grading. Jobs abandon stale attempts and award top-score Punya.

**Technical**

- `/v1/exams/*` + `/v1/admin/exams`
- Schema: `lib/db/src/schema/exams.ts`
- Mobile: `exams.tsx` (autosave PUTs)

**Risks**  
No offline queue — wifi drop mid-exam is the main product risk. Stronger recovery than quizzes because of incremental answer saves.

---

## 9. Competitions

**Functional**  
Admins create city-scoped competitions, open/close, record ranks, publish-results (Punya). Parents/students register for open ones. No in-app attempt — registration + offline event.

**Technical**

- `/v1/competitions` — `routes/v1/competitions.ts`
- Schema: `competitions`, `competition_registrations`
- Mobile: `competitions.tsx`

**Risks**  
No results/history screen for students. Thin vs quiz/exam. Online register only.

---

## 10. Library

**Functional**  
Browse sections (item lists, panchang, deeplinks). Guests use public tree; login-gated sections are shells until sign-in. Join Pathshala tile: guests only. Courses deeplink works without login (read-only). Local bookmarks + offline audio. Super_admin publishes.

**Technical**

- Member `/v1/library*`, public `/v1/public/library*`, admin `/v1/admin/library*`
- Schema: sections / subsections / items + draft/publish — `lib/db/src/schema/library.ts`
- Mobile: `LibraryView`, `[sectionId]`, `bookmarks.tsx`, `downloads.tsx`
- Bookmarks: AsyncStorage `jp.library.bookmarks` — **not** server-synced
- Audio offline is local FS, not `/v1/sync/batch`

**Risks**  
Bookmarks die on reinstall; guest↔login share one device set. Publish is super_admin-only.

---

## Priority gaps (fix order)

1. **Niyam offline** — wire enqueue to the full submit service, or remove the incomplete sync path.
2. **Notifications deep links + prefs** — product usefulness of push.
3. **Notices push (or drop “critical” expectations)** + stop auto mark-read.
4. **Quiz mid-attempt persistence** (exam pattern).
5. **Attendance mark UX** for late/excused.
6. **Homework bilingual fields**.
7. **Library bookmarks** cloud sync if multi-device matters.
8. **Retire or fence** legacy curriculum/progress routes vs courses.

---

## Suggested reading map

| Module | Start here |
|--------|------------|
| Niyam | `niyam-submissions.ts`, `schema/niyams.ts`, `.cursor/rules/20-niyam-fix-pass.mdc` |
| Homework | `homework.ts`, `homework-submit-sync.ts`, `offline/sync-engine.ts` |
| Attendance | `CLAUDE.md` AT1–AT32, `attendance-mark.ts`, `session-lifecycle.ts` |
| Courses | `docs/CURRICULUM_ENHANCEMENT.md`, `courses.ts`, `course-progress.ts` |
| Notifications | `notify.ts`, `push.ts`, `notifications.ts` |
| Notices | `notices.ts`, `NoticesFeedScreen.tsx` |
| Quiz/Exam/Comp | `quizzes.ts`, `exams.ts`, `competitions.ts` |
| Library | `library-tree.ts`, `LibraryView.tsx`, `public.ts` |

*Last updated: August 2026*
