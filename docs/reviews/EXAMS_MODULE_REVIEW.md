# Code review — Exams module

**Date:** 2026-08-04
**Scope reviewed:**

| File | Lines |
|---|---|
| `lib/db/src/schema/exams.ts` | 127 |
| `apps/api-server/src/routes/v1/exams.ts` | 961 |
| `apps/api-server/src/routes/v1/admin-modules.ts` (exam sections) | 152–236, 347–381 |
| `apps/api-server/test/exams.test.ts` | 737 |
| `apps/jain-pathshala/src/pages/admin/ExamBuilderPage.tsx` | 322 |
| `apps/jain-pathshala/src/pages/admin/AdminExtendedPages.tsx` (exam sections) | 455–560 |
| `apps/jain-pathshala/src/pages/public/ExamsPage.tsx` | 646 |
| `apps/jain-pathshala-mobile/app/exams.tsx` | 648 |

**Checked against:** `CLAUDE.md` (roles, Q1–Q11, envelope, error codes, bilingual, design tokens, idempotency), `SPEC.md` §5.14, §6.17, §8.9, §13.11.

---

## Summary

The take-flow core is careful work — the attempt-cap advisory lock, the skipped-answer backfill, and the `results_released` disclosure gate are all correct and commented with the reasoning. The problems are at the edges: **the module cannot complete its own primary workflow** (text questions can be authored and answered but there is no grading UI), **scoring is decoupled from the pass mark**, **the access code is predictable and unhashed**, and **the student take-flow assumes a `student` login that CLAUDE.md says does not exist**.

**Verdict: Request changes.** C1–C5 are release blockers.

---

## Critical

### C1 — Text exams can never be graded; there is no admin grading UI

`GET /v1/exams/:id/attempts/:attemptId` (exams.ts:295) and `POST /v1/exams/:id/attempts/:attemptId/grade` (exams.ts:389) are fully implemented and tested — and have **zero callers** anywhere in `apps/jain-pathshala`. The only exam admin screens are `ExamBuilderPage` (add/delete questions) and `AdminExtendedPages.ExamsPage` (create + release results).

Consequence: any exam containing one `text` question leaves *every* attempt at `status='submitted'`, `needs_grading=true`, `score=null`, forever. Releasing results then shows students `score: 0`.

**Fix:** build the grading screen, or hide the `text` question type in the builder until it exists.

### C2 — `pass_mark` / `total_marks` are decoupled from the real question marks

`online_exams.total_marks` defaults to 100 and `pass_mark` to 40 (schema exams.ts:22-23). Nothing anywhere validates them against `SUM(exam_questions.marks)`:

- `createExamSchema` (admin-modules.ts:347) validates each field in isolation.
- The create dialog (AdminExtendedPages.tsx:517) pre-fills `100` / `40`.
- The builder never shows a running marks total.
- The result route computes `passed = score >= passMark` (exams.ts:952) against a score bounded by the *actual* question total.

A 10-question × 1-mark exam left at the defaults **fails 100% of students**, and nothing in the UI hints at it.

**Fix:** compute `total_marks` from the questions (or validate `pass_mark <= SUM(marks)` on release-results and surface the running total in the builder).

### C3 — Exam access code: `Math.random()`, stored plaintext, compared unsafely, unthrottled

```ts
// admin-modules.ts:368
const otp = body.exam_otp ?? Math.random().toString(36).slice(2, 8).toUpperCase();
```
```ts
// exams.ts:640
if (!body.otp || body.otp !== exam.exam_otp) { … }
```

Four separate problems:

1. `Math.random()` is not a CSPRNG — V8's xorshift128+ state is recoverable from a handful of outputs.
2. SPEC §8.9 says "stored hashed". It is stored in plaintext.
3. `POST /v1/exams/:id/start` has **no rate limit**. `apps/api-server/src/lib/ratelimit.ts` exists and `niyam-submissions.ts:485` already uses it. A 6-character code with unlimited guesses is not a gate.
4. `GET /v1/admin/exams` returns `exam_otp` (admin-modules.ts:163) and the admin table renders it — to every admin-panel role, `shikshak` included.

### C4 — `shikshak` and `sanchalak` can author, delete, grade and release results city-wide

Exam *creation* is correctly narrowed:

```ts
// admin-modules.ts:360
router.post("/exams", requireRole("super_admin", "state_admin", "city_admin"), …)
```

Everything else is not. `exams.ts` guards each admin route with `canAccessAdminPanel()`, which is all five of `ADMIN_PANEL_ROLES` (contracts.ts:148). And `POST /v1/admin/exams/:id/release-results` (admin-modules.ts:186) has no role guard at all beyond the router-level `requireAdminPanel`.

Net effect: a `shikshak` can add and delete questions on any exam in their city, grade any attempt, read every access code, and release results nationally-visible-in-city — while being unable to create an exam. SPEC §6.17 assigns grading and release to `city_admin`.

This is exactly the trap the codebase already documented for media:

> *"Deliberately NARROWER than canAccessAdminPanel — sanchalak and shikshak can open the admin panel but must NOT feature media. Do not 'fix' this by reusing ADMIN_PANEL_ROLES."* — contracts.ts:163

The same treatment is needed here.

### C5 — The student take-flow contradicts the platform's auth model

CLAUDE.md, role 7:

> `student` — age 13+, accessed via student-view toggle on parent's account (**NOT a separate login**)

But:

```ts
// exams.ts:535
async function requireStudent(req, res) {
  if (req.authUser?.role !== "student") { fail(res, 403, …); return null; }
  const student = await studentForUser(req.authUser.id);   // students.user_id = auth.id, limit(1)
  …
}
```

`POST /v1/auth/switch-view` does not exist in `apps/api-server` (grep: no match for `switch-view` or `student_view`). SPEC §6.17 lists these routes as `parent / student-view` with `student_id` in the body.

The mobile screen makes the mismatch visible: it renders `<ChildSwitcher />` and gates the whole screen on `activeStudentId` (exams.tsx:241, 562) — then never sends it. Switching children does nothing. A parent with two children gets whichever `students` row `.limit(1)` returns first (no `ORDER BY`), or a 403.

**Fix:** accept `student_id` and authorise it against the caller's children, matching SPEC §6.17 — or implement `switch-view` and issue a scoped token. Either way, `.limit(1)` with no ordering must go.

### C6 — Editing an exam that already has attempts silently corrupts scores

Two paths, both unguarded:

- **Delete.** `DELETE /:id/questions/:qid` (exams.ts:253) cascades `exam_answers` (schema exams.ts:108) and never recomputes `exam_attempts.auto_score` / `score`. Already-graded attempts keep a score that no longer matches their answers.
- **Add.** A `text` question added after submissions has no `exam_answers` row for existing attempts. The grade route counts ungraded work as *rows with NULL `marks_awarded`* (exams.ts:467) — a missing row isn't counted, so `ungraded === 0` and the attempt finalizes `status='graded'` with an understated score.

That second one is precisely the failure the submit-time backfill was written to prevent (see the comment at exams.ts:794-799) — it just isn't defended on the authoring side.

**Fix:** block question add/delete once `exam_attempts` exist for the exam (return 409), or require an explicit `force` that triggers a recompute job.

---

## High

| # | Issue | Location |
|---|---|---|
| H1 | **Submit is not bounded by the exam window.** The submit route never re-reads `window_end`. Start at 09:59 on the last day, submit a week later. No per-attempt duration, no auto-submit job. | exams.ts:733 |
| H2 | **Abandoned attempts permanently burn `max_attempts`.** "Leave" (mobile exams.tsx:505) drops local state; the row stays `in_progress` and still counts in the cap query. With the default `max_attempts=1`, one accidental tap locks a student out forever — and there is no admin reset route. | exams.ts:653; exams.tsx:505 |
| H3 | **Answers persist only at submit.** SPEC §6.17 specifies `POST /v1/exam-attempts/:id/answer` for incremental saves. As built, a dropped connection mid-exam loses every answer *and* burns the attempt (H2). Highest-value gap given patchy centre wifi. | exams.ts:733 |
| H4 | **The grade route is not transactional.** N separate `UPDATE exam_answers` in a loop, then a recompute, then `UPDATE exam_attempts` — no transaction. A mid-loop failure leaves marks awarded but `manual_score`/`status` stale; two concurrent graders interleave freely. Also an N+1 write. | exams.ts:440-519 |
| H5 | **`autoScore` mutates outside its transaction.** Declared at :801, mutated inside the `db.transaction` callback at :828. Any retry or replay of the callback double-counts. Move the accumulator inside, or compute before the transaction. | exams.ts:801, 828 |
| H6 | **No Punya integration.** SPEC §5.14 specifies `completion_points` and `top_score_points` on `online_exams`; neither the schema nor any route has them. Exams award nothing. When added, must use the guarded-insert + idempotency-key pattern (CLAUDE.md AT20 / "never award Punya without one"). | schema exams.ts:8-31 |
| H7 | **`studentForUser` ignores soft-delete and status.** Selects on `user_id` alone — no `isNull(students.deleted_at)`, no `status='active'`. Q11 says deactivated students must not appear in active flows. `admin-modules.ts:227` gets this right; `exams.ts` does not. | exams.ts:63-70 |
| H8 | **No cross-field validation on exam create.** No `window_start < window_end`, no `pass_mark <= total_marks`. An inverted window yields an exam that *lists* in `/available` (`window_end >= now`) but 422s forever on start. | admin-modules.ts:347-357 |

---

## Medium

| # | Issue | Category | Location |
|---|---|---|---|
| M1 | Error codes `ERR_WINDOW_CLOSED`, `ERR_OTP_INVALID`, `ERR_MAX_ATTEMPTS`, `ERR_ALREADY_SUBMITTED` are raw strings — none are in `ERROR_CODES`. CLAUDE.md: *"Always use the enum — never return raw strings."* Both clients string-match them, so a typo is a silent UX regression. | Maintainability | exams.ts:635,641,672,760; errors.ts:6 |
| M2 | Bilingual gaps. The builder captures **no Hindi at all** (no `question_hi` / `option_hi` inputs). Exam create falls back `title_hi: body.title_hi ?? body.title_en` — writing English into a Devanagari column, which CLAUDE.md forbids. `description_en/_hi` exist on the schema and are never read or written. | Correctness | ExamBuilderPage.tsx; admin-modules.ts:371 |
| M3 | Hardcoded colours: `bg-emerald-500/10 border-emerald-500 text-emerald-700`. Palette is saffron / maroon / gold / green `#166534`. | Design system | ExamBuilderPage.tsx:166,236 |
| M4 | Missing indexes vs SPEC §5.14: `exam_attempts` needs the `(exam_id, student_id)` composite (schema has two separate single-column indexes); `online_exams` needs `(city_id, window_start)`. Both are the exact query shapes at exams.ts:572 and :653. | Performance | schema exams.ts:29,94-95 |
| M5 | `GET /v1/admin/exams` `leftJoin`s `exam_attempts` and `groupBy`s to get `attempt_count` — fans out then re-aggregates. A correlated subquery (the pattern already used for `section_count` at admin-modules.ts:78) avoids the row multiplication. | Performance | admin-modules.ts:167-173 |
| M6 | Unbounded arrays: `submitSchema.answers` and `selected_option_ids` have no `.max()`, and `selected_option_ids` is never validated against the question's real options — arbitrary UUIDs are persisted. The 2 MB body limit caps the blast radius. | Security | exams.ts:720-730 |
| M7 | `requireAdminPanel` is imported and never used — dead import, and a hint that the intended guard was skipped (see C4). | Maintainability | exams.ts:27 |
| M8 | No exam edit or delete route. A wrong window, wrong marks, or typo'd title is permanent. | Correctness | — |
| M9 | `GET .../result` doesn't check the attempt is submitted. An `in_progress` attempt on a released exam returns `score: 0, passed: false`. | Correctness | exams.ts:898 |
| M10 | The result payload's `per_question` carries `question_id` only — no question text — so no client can render an answer review. Both clients ignore it entirely. | Correctness | exams.ts:953 |

---

## Low

- `exam_question_options` uses `option_en` / `option_hi`; SPEC §5.14 names them `label_en` / `label_hi`. Naming drift between spec and schema.
- `exam_attempts.status` is `text` with a string default, not a pg enum — inconsistent with every other status column in the schema.
- `exam_attempts.otp_verified_at` (SPEC §8.9) is missing, so there's no record that the code was ever presented.
- `exam_answers` is missing `admin_comment` and `graded_by_user_id` (SPEC §5.14) — a grader can award marks but cannot leave feedback, and per-answer attribution is lost.
- Multi-choice is all-or-nothing. No partial credit, no negative marking, and the UI copy ("Select one or more options") never warns that a partially-correct answer scores zero.
- `cityScopeForUser` (exams.ts:35) duplicates `cityIdsForUser` (admin-modules.ts:46) and omits the latter's `isNull(centres.deleted_at)` filter.
- Test gaps: no coverage for the attempt-cap race, cross-city start, submit-after-window, or editing an exam that has attempts.

---

## What looks good

- **The attempt-cap advisory lock** (exams.ts:650-670). A real count-then-insert TOCTOU, correctly fixed with `pg_advisory_xact_lock` inside the transaction, and commented with *why* a plain count+insert is racy under READ COMMITTED. This is the right instinct.
- **The skipped-answer backfill** (exams.ts:794-851). Writing an `exam_answers` row for every question — answered or not — so the grade route can distinguish "skipped" from "not yet reached". The comment explains the exact premature-finalization bug it prevents, and there are two regression tests for it.
- **Partial grading keeps the attempt pending** rather than finalizing early (exams.ts:482, 510-519).
- **`is_correct` is stripped from the student `/start` payload** with an explicit comment (exams.ts:711).
- **Disclosure is gated on `results_released` even for auto-graded exams** (exams.ts:929-934) — the easy mistake would have been to release objective scores immediately.
- **`UNIQUE (attempt_id, question_id)` + `onConflictDoUpdate`** — the correct domain-level idempotency anchor, consistent with the offline-sync doctrine in CLAUDE.md §3.
- **10 integration tests** covering the happy path, the OTP gate, authorization, and two premature-finalization regressions.

---

## Recommended order of work

1. **C4** — role guards. Smallest diff, largest security delta.
2. **C3** — CSPRNG + hash the access code + rate-limit `/start` + stop returning it to non-city_admin.
3. **C2 + H8** — marks/pass-mark validation. Prevents shipping unpassable exams.
4. **C1** — grading UI (or hide the `text` type until it exists).
5. **C6 + H1 + H2** — attempt lifecycle: lock authoring once attempts exist, enforce the window at submit, add an abandon/reset path.
6. **C5** — student-view resolution. Largest design change; needs a decision on `student_id`-in-body vs a real `switch-view` token.
7. **H3** — incremental answer saves.
8. **H4, H5, H7, M1–M10** — cleanups.

Cursor prompts for each of these are in [`EXAMS_FIX_CURSOR_PROMPTS.md`](./EXAMS_FIX_CURSOR_PROMPTS.md).

---

## Note on stack drift (outside this review's scope)

CLAUDE.md mandates NestJS + `apps/api`, `packages/*`, and `@jp/*` package names. The reviewed code is Express in `apps/api-server` with `lib/*` and `@workspace/*`. This is repo-wide, not an Exams issue, but CLAUDE.md's "Stack — non-negotiable" table and the monorepo layout no longer describe the codebase — worth reconciling one way or the other so future reviews have a valid baseline.
