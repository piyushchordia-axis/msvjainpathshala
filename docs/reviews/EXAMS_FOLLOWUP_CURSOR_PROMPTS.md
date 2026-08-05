# Exams module — follow-up Cursor prompts

Companion to [`EXAMS_REVIEW_FOLLOWUP.md`](./EXAMS_REVIEW_FOLLOWUP.md). Ordered by priority. Paste one at a time, verify, commit.

---

## 1 — Finish C2: marks summary and the release guard

```
Read docs/reviews/EXAMS_REVIEW_FOLLOWUP.md finding C2. The superRefine on createExamSchema is
done; the actual bug is not. Nothing compares pass_mark to SUM(exam_questions.marks), so an exam
whose questions add up to 10 marks but is left at the 100/40 defaults fails every student silently.

apps/api-server/src/routes/v1/exams.ts — add:
  GET /v1/exams/:id/marks-summary   (canAdministerExams, same city-scope 404 as the other admin routes)
  → { question_count, sum_marks, total_marks, pass_mark, mismatch: sum_marks !== total_marks,
      unpassable: sum_marks < pass_mark }
Also return exam_sum_marks in the POST /:id/questions response so the builder can update without a refetch.

apps/api-server/src/routes/v1/admin-modules.ts — POST /exams/:id/release-results:
before setting results_released, compute SUM(exam_questions.marks) for the exam. If it is less than
pass_mark, return 422 ERR_VALIDATION_FAILED:
  "Pass mark is N but this exam's questions only add up to M marks — no student can pass. Fix the
   marks before releasing results."
Do not release and do not enqueue the top-score job.

apps/jain-pathshala/src/pages/admin/ExamBuilderPage.tsx:
- Fetch marks-summary on exam select and after every add/delete.
- Persistent bar above the question list:
  "Questions: N · Marks on questions: M · Exam total: T · Pass mark: P"
- When mismatch, warn with the status-warning tokens (not raw Tailwind colours):
  "These questions add up to M marks but the exam is set to T. Students are scored out of M."
- When unpassable, escalate to status-error:
  "Pass mark P is higher than the M marks available — no student can pass this exam."

Add tests: release-results 422s on an unpassable exam; marks-summary reports the right totals and flags.

Run: pnpm typecheck && pnpm lint && pnpm test
```

---

## 2 — N1: stop acquiring a second pool connection inside a transaction

```
apps/api-server/src/lib/exam-punya.ts calls resolveExamCompletionPoints() as the first statement of
awardExamCompletionPunya, which runs INSIDE the submit and grade transactions
(routes/v1/exams.ts:1337 and :616). resolveFeatureDefault in lib/exam-points.ts queries with the
global `db` pool, not the tx. Requesting a second connection while holding one inside a transaction
deadlocks the pool once concurrent submits reach pool size — which is exactly a whole batch
submitting at once. The Redis cache hides it until load.

Fix by resolving points BEFORE the transaction opens (preferred — keeps the cache read off the
transaction entirely):
- Give awardExamCompletionPunya a required `points: number` parameter and delete the internal
  resolve call.
- In routes/v1/exams.ts, call resolveExamCompletionPoints(cityId, override) before db.transaction
  in both the submit and grade paths, and pass the result in.
- Do the same for runExamTopScoreAwards if any of its resolve calls sit inside a transaction.

Alternative if you prefer to keep the signature: thread the tx through
resolveExamCompletionPoints → resolveFeatureDefault so every query uses the same connection.

Existing Punya tests must pass unchanged.

Run: pnpm typecheck && pnpm test
```

---

## 3 — H3/N3: resume an in-progress attempt

```
Autosave (PUT /v1/exams/attempts/:attemptId/answers/:questionId) writes answers the client can never
read back. There is no GET for an in-progress attempt, so after an app kill the saved answers are
unreachable and /start would hit the max_attempts cap. Autosave currently only protects against a
failed submit, not the app-kill case it was built for.

apps/api-server/src/routes/v1/exams.ts — add:
  GET /v1/exams/attempts/:attemptId   (resolveStudentContext; 404 when the attempt is not theirs)
Returns for an in_progress attempt: attempt_id, exam_id, exam title_en/title_hi, window_end,
questions in order with options (stripped of is_correct, same shape as /start), and saved answers
as { question_id, selected_option_ids, text_answer }. Never return is_correct or marks_awarded.
For a non-in_progress attempt return 409 ERR_ALREADY_SUBMITTED.

Also add to GET /v1/exams/available: an `open_attempt_id: string | null` per exam — the caller's
in_progress attempt for that exam, if any.

Clients (apps/jain-pathshala/src/pages/public/ExamsPage.tsx and
apps/jain-pathshala-mobile/app/exams.tsx): when an exam has open_attempt_id, replace the
"Start exam" button with "Resume exam", which GETs the attempt and rehydrates the local answer
state instead of calling /start.

Add tests: resume returns saved answers without correctness fields; resume on a submitted attempt
409s; available reports open_attempt_id.

Run: pnpm typecheck && pnpm test
```

---

## 4 — H8: max_attempts in the create dialog

```
apps/jain-pathshala/src/pages/admin/AdminExtendedPages.tsx — AddExamDialog.
The API accepts max_attempts (createExamSchema, default 1) but the dialog never sends it, so every
exam created through the UI is permanently single-attempt.

- Add a "Attempts allowed" number field (min 1, max 10, default 1) and include it in the POST body.
- Add client-side validation before submit mirroring the server superRefine: window_start must be
  before window_end, and pass_mark must not exceed total_marks. Show the message inline rather than
  waiting for the 422.
- Show max_attempts in the exams table column set.

Run: pnpm typecheck && pnpm lint
```

---

## 5 — N2: narrow the hourly top-score job

```
CRON_EXPRESSIONS.EXAM_TOP_SCORE fires runExamTopScoreAwards() with no examId every hour, which
selects EVERY exam with results_released = true and re-runs a max-score query, a per-student
best-score query, a LIKE scan over punya_transactions, and per-student award calls for each. That
set only grows. The real trigger — enqueueJob on release-results (admin-modules.ts:225) — already
covers the actual event.

In apps/api-server/src/lib/exam-punya.ts, when runExamTopScoreAwards is called with no examId,
restrict the exam selection to those whose window_end or updated_at falls in the last 30 days, and
change CRON_EXPRESSIONS.EXAM_TOP_SCORE in apps/jp-shared/src/constants.ts from hourly to daily
(e.g. "15 3 * * *") — it is a reconciliation sweep, not the primary path.

Keep the explicit-examId call path unrestricted so release-results still processes any exam.

Run: pnpm typecheck && pnpm test
```

---

## 6 — M6/N5: share option-ownership validation between autosave and submit

```
apps/api-server/src/routes/v1/exams.ts — the PUT autosave route validates that every
selected_option_id belongs to the question (lines ~1073-1092); POST submit does not, so arbitrary
UUIDs still persist through the submit path.

Extract a helper:
  async function assertOptionsBelongToQuestions(
    pairs: Array<{ question_id: string; selected_option_ids: string[] }>
  ): Promise<{ ok: true } | { ok: false; question_id: string }>
One query over exam_question_options for all pairs — do not loop per question.

Call it from both routes. On failure return 422 ERR_VALIDATION_FAILED
"One or more selected options do not belong to this question."

Add a test: submit with a foreign option id returns 422 and persists nothing.

Run: pnpm typecheck && pnpm test
```

---

## 7 — Tests for the three unexercised new branches

```
apps/api-server/test/exams.test.ts is at 21 tests but three of the newest guards have no coverage.
Add:

1. "editing an exam that has attempts returns 409" — create an exam, add a question, have a student
   start an attempt, then assert POST /v1/exams/:id/questions and DELETE .../questions/:qid both
   return 409 ERR_EXAM_HAS_ATTEMPTS.

2. "submitting after window_end returns 422" — start inside the window, move window_end into the
   past (direct db update), then assert submit returns 422 ERR_WINDOW_CLOSED and that
   exam_attempts.status is still in_progress with no exam_answers rows written.

3. "an abandoned attempt frees a max_attempts slot" — max_attempts = 1, start an attempt, run
   runExamAttemptAbandon() (or POST the admin reset route), then assert a second start succeeds and
   that GET /available reports already_attempted_count 0.

Follow the existing test file's setup helpers — do not add a new harness.

Run: pnpm test
```

---

## 8 — Cleanups (N4, N6, N7, N8, M8)

```
Five small items from docs/reviews/EXAMS_REVIEW_FOLLOWUP.md.

(a) N4 — apps/api-server/src/routes/v1/exams.ts POST /:id/start: the rate limiter increments on
every call including successful starts, and keys on the caller's user id, so a parent with four
children sitting the same exam shares one budget of five per 15 minutes. Move the per-exam limiter
so it counts only FAILED OTP verifications, and key it on `${uid}:${student.id}`.

(b) N6 — move registerCron / registerQueueHandler for EXAM_ATTEMPT_ABANDON and EXAM_TOP_SCORE out of
the route module (exams.ts:86-97) into apps/api-server/src/jobs/, alongside the other job modules.
Importing a router should not start scheduled work.

(c) N7 — add `exam.attempt_abandon` and `exam.top_score` to CLAUDE.md's frozen cron table and its
queue-name list. CLAUDE.md declares that table the single source; it currently omits both.

(d) N8 — add `--> statement-breakpoint` separators to lib/db/migrations/0028_exam_otp_hash.sql for
consistency with 0029 and 0030.

(e) M8 — add PATCH /v1/admin/exams/:id (super_admin, state_admin, city_admin) allowing title_en,
title_hi, description_en, description_hi, window_start, window_end, total_marks, pass_mark and
max_attempts to be edited. Reuse createExamSchema's superRefine rules. Block edits to
total_marks/pass_mark once results_released is true. Write an audit entry. Wire an edit dialog into
the exams admin table.

Run: pnpm typecheck && pnpm lint && pnpm test
```

---

## Commit messages

```
fix: exams — marks summary, builder warning, release-results guard (C2)
fix: exams — resolve Punya points outside the award transaction (N1)
feat: exams — resume an in-progress attempt (H3, N3)
feat: exams — max_attempts in the create dialog (H8)
perf: exams — narrow the top-score reconciliation sweep (N2)
fix: exams — validate option ownership on submit as well as autosave (M6, N5)
test: exams — authoring lock, submit-after-window, abandoned slot release
chore: exams — rate-limit keying, job placement, docs, migration style, edit route
```
