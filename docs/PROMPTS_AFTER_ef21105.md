# User prompts after commit `ef21105`

**Commit:** `ef21105b65191e967ad05effeba74713f496905a` — feat: hash exam access codes with argon2id  
**Committed at:** 2026-08-04 23:41:03 +0530

Chronological list of user prompts given in chat after that commit.

- Items with clock timestamps come from the parent agent transcript.
- Items marked **session** were given after conversation summarization and were reconstructed from the live session (full FIX #1–#3 text taken from `docs/NOTIFICATION_FIX_PROMPTS.md`).
- Boilerplate task-result notifications omitted; consecutive duplicate pastes deduped.

Also see: `docs/NOTIFICATION_FIX_PROMPTS.md`, `docs/reviews/EXAMS_REVIEW_FOLLOWUP.md`, `docs/reviews/QUIZ_FIX_CURSOR_PROMPTS.md`.

---

## 1. please restart all services

*Tuesday, Aug 4, 2026, 11:45 PM (UTC+5:30)*

```
please restart all services
```

## 2. on mobile i am getting coould not connect to development server

*Tuesday, Aug 4, 2026, 11:46 PM (UTC+5:30)*

```
on mobile i am getting coould not connect to development server
```

## 3. shikshak - new assignment creation in mobile is not coming as seen in web

*Tuesday, Aug 4, 2026, 11:58 PM (UTC+5:30)*

```
shikshak - new assignment creation in mobile is not coming as seen in web
```

## 4. homework submission with attachment is not getting submitted while it shows it is submitted

*Wednesday, Aug 5, 2026, 12:00 AM (UTC+5:30)*

```
homework submission with attachment is not getting submitted while it shows it is submitted
```

## 5. shikshak - on clicking on any student below details should be visible

*Wednesday, Aug 5, 2026, 12:06 AM (UTC+5:30)*

```
shikshak - on clicking on any student below details should be visible
1. id card of student
2. attendance history
3. contact details of student and parents
4. Punya points 
5. homework history 
6. Niyam history

show buttons and on click of each button show details but keep all options visible above so that it can be clicked and viewed
```

## 6. plan approved and lets build

*Wednesday, Aug 5, 2026, 12:11 AM (UTC+5:30)*

```
plan approved and lets build
```

## 7. shikshak - mark attendance need to be reworked from UX perspective, too much space taken per student. also for

*Wednesday, Aug 5, 2026, 12:17 AM (UTC+5:30)*

```
shikshak - mark attendance need to be reworked from UX perspective, too much space taken per student. also for now lets show only present and absent as an option. It should be handy
```

## 8. shikshak - punya wall

*Wednesday, Aug 5, 2026, 12:19 AM (UTC+5:30)*

```
shikshak - punya wall
this need to come up with required details
```

## 9. Build the missing admin grading screen. The API already exists and is tested:

*Wednesday, Aug 5, 2026, 12:22 AM (UTC+5:30)*

```
Build the missing admin grading screen. The API already exists and is tested:
  GET  /v1/exams/:id/attempts/:attemptId          → attempt detail with per-question answers
  POST /v1/exams/:id/attempts/:attemptId/grade    → { grades: [{ question_id, marks_awarded }] }
  GET  /v1/admin/exams/:id/attempts               → attempt list

Create apps/jain-pathshala/src/pages/admin/ExamGradingPage.tsx:
- Exam selector (reuse the pattern in ExamBuilderPage.tsx).
- Attempt list from GET /v1/admin/exams/:id/attempts, with a "Needs grading" filter and a
  visible needs_grading badge. Sort ungraded first.
- Clicking an attempt opens a detail panel: student name + code, each question in order, the
  student's answer (selected option labels for choice questions, the text body for text questions),
  and for text questions a marks input bounded 0..question.marks.
- Submit calls the grade route with only the text questions. Show the running
  auto_score + manual_score = total.
- After a successful grade, show whether the attempt finalized (status 'graded') or is still
  pending more grades, using the route's response.

Wire it into the admin router and nav next to "Exam builder", gated on canAdministerExams.
Use design tokens only — no raw Tailwind palette colours (see CLAUDE.md "Design system").
All labels sentence case. Address the user as "you". No emoji.

Run: pnpm typecheck && pnpm lint
```

## 10. Read CLAUDE.md ("Critical business rules") then fix the exam attempt lifecycle in

*Wednesday, Aug 5, 2026, 12:25 AM (UTC+5:30)*

```
Read CLAUDE.md ("Critical business rules") then fix the exam attempt lifecycle in
apps/api-server/src/routes/v1/exams.ts.

(a) Lock authoring once attempts exist (C6).
Add a helper `examHasAttempts(examId)`. In POST /:id/questions and DELETE /:id/questions/:qid,
if it returns true, respond 409 with a new error code ERR_EXAM_HAS_ATTEMPTS and the message
"Students have already attempted this exam — editing questions now would change their scores.
 Clone the exam instead." Add ERR_EXAM_HAS_ATTEMPTS to lib/api-zod/src/errors.ts.

(b) Enforce the window at submit (H1).
In POST /attempts/:attemptId/submit, load the parent exam and reject with 422 ERR_WINDOW_CLOSED
when Date.now() > exam.window_end. Grade and persist nothing.

(c) Abandoned attempts (H2).
- Add `abandoned` as a valid exam_attempts.status.
- Add a scheduled job that marks in_progress attempts as 'abandoned' once
  window_end + 2 hours has passed (mirror the AT12 auto-checkout pattern).
- Exclude status='abandoned' from the max_attempts count query in POST /:id/start, so an
  abandoned attempt does not permanently consume a student's only try.
- Add POST /v1/exams/:id/attempts/:attemptId/reset (EXAM_ADMIN_ROLES) that marks a single
  in_progress attempt 'abandoned' and writes an audit entry — the manual escape hatch.

(d) Result route (M9).
In GET /attempts/:attemptId/result, when attempt.status === 'in_progress', return
{ status: 'in_progress' } only — never a score or per_question payload.

Add tests for: 409 on editing an exam with attempts; 422 on submitting after window_end;
an abandoned attempt not counting against max_attempts.

Run: pnpm typecheck && pnpm test
```

## 11. Read CLAUDE.md role 7 ("student — accessed via student-view toggle on parent's account, NOT a

*Wednesday, Aug 5, 2026, 12:26 AM (UTC+5:30)*

```
Read CLAUDE.md role 7 ("student — accessed via student-view toggle on parent's account, NOT a
separate login"), Q4, and SPEC.md §6.17.

The Exams student routes currently require role === 'student' and resolve
students.user_id = auth.id with .limit(1) and no ORDER BY. That breaks multi-child parents and
contradicts the platform auth model. Fix it.

In apps/api-server/src/routes/v1/exams.ts, replace requireStudent with resolveStudentContext(req, res):
- Accept an explicit student_id: from req.body.student_id on POST routes, ?student_id= on GET routes.
- Allow role 'parent' when the requested student is one of their children (join through the
  existing parent→student link — reuse whatever helper the niyam or attendance routes already use;
  do not write a second one).
- Allow role 'student' when the requested student is their own row.
- Filter students by isNull(students.deleted_at) AND status = 'active' (Q11).
- If student_id is omitted and the caller has exactly one child, default to it; if they have more
  than one, return 422 ERR_VALIDATION_FAILED "Choose which child is taking this exam."
- Never use .limit(1) without an ORDER BY.

Apply to GET /available, POST /:id/start, POST /attempts/:attemptId/submit,
GET /attempts/:attemptId/result. On submit and result, verify the attempt's student_id matches
the resolved student (keep the existing 404-on-mismatch behaviour).

Update both clients to send it:
- apps/jain-pathshala-mobile/app/exams.tsx — pass activeStudentId from useSessionView() into
  every hook. Right now ChildSwitcher is rendered but its value is never sent, so switching
  children has no effect.
- apps/jain-pathshala/src/pages/public/ExamsPage.tsx — same.

Add tests: a parent with two children gets 422 without student_id, 200 with each valid child id,
and 403/404 for a child that is not theirs.

Run: pnpm typecheck && pnpm test
```

## 12. Read SPEC.md §6.17 (POST /v1/exam-attempts/:id/answer) and CLAUDE.md "Offline sync" for the

*Wednesday, Aug 5, 2026, 12:27 AM (UTC+5:30)*

```
Read SPEC.md §6.17 (POST /v1/exam-attempts/:id/answer) and CLAUDE.md "Offline sync" for the
idempotency doctrine.

Add PUT /v1/exams/attempts/:attemptId/answers/:questionId to
apps/api-server/src/routes/v1/exams.ts:
- Same student authorisation as submit (resolveStudentContext from prompt 6).
- 409 ERR_ALREADY_SUBMITTED when attempt.status !== 'in_progress'.
- 422 ERR_WINDOW_CLOSED when past window_end.
- Body: { selected_option_ids?: string[], text_answer?: string }.
- Validate selected_option_ids actually belong to that question — reject unknown ids with 422
  rather than persisting them.
- Upsert on the existing UNIQUE (attempt_id, question_id) index. Store the answer ONLY —
  leave is_correct and marks_awarded NULL. Grading stays at submit time so a partially saved
  attempt can never leak correctness.

In POST /attempts/:attemptId/submit, treat already-saved rows as the baseline: questions absent
from the submit body keep their saved answer instead of being overwritten with an empty one.
This is the behaviour change that makes autosave useful — write a test for it explicitly.

Client autosave (both apps/jain-pathshala/src/pages/public/ExamsPage.tsx and
apps/jain-pathshala-mobile/app/exams.tsx): debounce 2s after a change, fire-and-forget, show a
small "Saved" / "Saving…" indicator. A failed autosave must not block the student or surface an
alert — the submit call remains the source of truth.

Run: pnpm typecheck && pnpm test
```

## 13. Fix two data-integrity bugs in apps/api-server/src/routes/v1/exams.ts.

*Wednesday, Aug 5, 2026, 12:27 AM (UTC+5:30)*

```
Fix two data-integrity bugs in apps/api-server/src/routes/v1/exams.ts.

(a) H4 — POST /:id/attempts/:attemptId/grade is not transactional (lines ~440-519).
Wrap the whole thing — the per-answer UPDATEs, the manual_score recompute, the ungraded count,
and the exam_attempts UPDATE — in a single db.transaction. Take
pg_advisory_xact_lock(hashtextextended(attemptId, 0)) as the first statement so two graders
cannot interleave. Follow the pattern already used in POST /:id/start (lines ~650-670),
including a comment explaining why.
Replace the N-update loop with a single UPDATE ... FROM (VALUES ...) so grading N answers is
one round trip.

(b) H5 — autoScore accumulates outside its transaction.
`let autoScore = 0` is declared at line ~801 and mutated inside the db.transaction callback at
line ~828. If the callback is ever retried the score double-counts. Compute the full
per-question grading result (an array of rows plus the total) BEFORE opening the transaction,
then have the transaction perform pure writes with no accumulation.

Do not change any observable API behaviour. The existing tests must pass unmodified.

Run: pnpm typecheck && pnpm test
```

## 14. Cleanup pass on the Exams module. Read CLAUDE.md sections "API response envelope",

*Wednesday, Aug 5, 2026, 12:28 AM (UTC+5:30)*

```
Cleanup pass on the Exams module. Read CLAUDE.md sections "API response envelope",
"Bilingual requirements", "Design system".

(a) Error codes (M1). Add to lib/api-zod/src/errors.ts ERROR_CODES and the ErrorCode object:
ERR_WINDOW_CLOSED, ERR_OTP_INVALID, ERR_MAX_ATTEMPTS, ERR_ALREADY_SUBMITTED,
ERR_EXAM_HAS_ATTEMPTS, ERR_RATE_LIMITED. Change the `fail()` signature to accept ErrorCode
instead of string so raw strings stop compiling. Fix every call site the compiler flags.
Add ERROR_MESSAGES entries (en + Devanagari hi) for each new code, in the established voice:
state the problem AND the fix.

(b) Bilingual (M2). Add question_hi and option_hi inputs to
apps/jain-pathshala/src/pages/admin/ExamBuilderPage.tsx and send them (the API already accepts
them). Add title_hi and description_en/_hi to AddExamDialog in AdminExtendedPages.tsx and to
createExamSchema. Remove the `title_hi: body.title_hi ?? body.title_en` fallback in
admin-modules.ts:371 — never write Latin text into a Devanagari column; make title_hi required.

(c) Design tokens (M3). In ExamBuilderPage.tsx replace bg-emerald-500/10, border-emerald-500 and
text-emerald-700 (lines ~166 and ~236) with the project's success token from
apps/web tokens (green #166534). No raw Tailwind palette classes.

(d) Indexes (M4). Migration + lib/db/src/schema/exams.ts:
- Composite index on exam_attempts (exam_id, student_id) — SPEC §5.14. Keep the standalone
  student_id index; drop the standalone exam_id index it now subsumes.
- Composite index on online_exams (city_id, window_start) — SPEC §5.14.

(e) Admin list query (M5). In admin-modules.ts GET /exams, replace the
leftJoin(exam_attempts) + groupBy with a correlated subquery for attempt_count, matching the
section_count pattern at line ~78. The join fans out before aggregating.

(f) Payload bounds (M6). In exams.ts submitSchema add .max(200) to answers and .max(50) to
selected_option_ids.

(g) Dead import (M7). Remove the unused requireAdminPanel import at exams.ts:27 if prompt 1
did not already.

(h) Result payload (M10). Have GET /attempts/:attemptId/result include question_en, question_hi
and marks per entry in per_question, and render an answer-review list in both clients.

(i) Schema polish. Convert exam_attempts.status to a pgEnum
("in_progress" | "submitted" | "graded" | "abandoned") consistent with the rest of the schema,
and add admin_comment + graded_by_user_id to exam_answers per SPEC §5.14 (surface the comment
in the grading UI from prompt 4).

Run: pnpm typecheck && pnpm lint && pnpm db:generate && pnpm test
```

## 15. Read SPEC.md §5.14, CLAUDE.md AT20 ("guarded insert then balance"), AT21 ("points from

*Wednesday, Aug 5, 2026, 12:28 AM (UTC+5:30)*

```
Read SPEC.md §5.14, CLAUDE.md AT20 ("guarded insert then balance"), AT21 ("points from
punya_features") and AT23. Exams currently award no Punya at all.

Schema (lib/db/src/schema/exams.ts + migration): add completion_points int and top_score_points
int to online_exams, per SPEC §5.14. Do NOT inline the values as constants — resolve them from
punya_features at award time (city-scoped with global fallback), using the exam columns only as
a per-exam override.

Award on finalization — that is, when an attempt reaches status='graded', which happens in TWO
places: the auto-graded branch of POST /attempts/:attemptId/submit and the finalize branch of
POST /:id/attempts/:attemptId/grade. Both must route through one shared award function; do not
write the logic twice.

Idempotency key: `exam:{exam_id}:{student_id}:{attempt_id}:completion`. Follow AT20 exactly —
insert with ON CONFLICT DO NOTHING ... RETURNING and move the balance only by the amount
actually returned. Never increment the balance unconditionally alongside a guarded insert.

Top-score points, if enabled, are awarded by a separate job after results_released, keyed
`exam:{exam_id}:{student_id}:top_score`, so a re-grade cannot double-award.

Re-grades that change award-worthiness must be expressed as an explicit REVERSE-then-AWARD pair
(AT18), never a bare second award.

Add tests: submitting the same attempt twice awards once; re-grading an attempt does not
double-award; a reversal is written when a re-grade drops a student below the pass mark.

Run: pnpm typecheck && pnpm test
```

## 16. shikshak - niyam review 

*Wednesday, Aug 5, 2026, 12:29 AM (UTC+5:30)*

```
shikshak - niyam review 
it is taking too much space, need to rework on the same
```

## 17. we have different personas and ids get created . lets work on a plan which makes users easy to identify

*Wednesday, Aug 5, 2026, 1:01 AM (UTC+5:30)*

```
we have different personas and ids get created . lets work on a plan which makes users easy to identify
we have student , parent, shikshak , sanchalak , city admin , state admin. also variables like city and pathshala

ID generation should be very good so that identification is also easy and clean
```

## 18. your suggestions on encoding ? 

*Wednesday, Aug 5, 2026, 1:07 AM (UTC+5:30)*

```
your suggestions on encoding ? 
also we will correct and update all existing ids in all required tables and code
```

## 19. lets not append JP- to all , rest combination looks fine. re-share the plan

*Wednesday, Aug 5, 2026, 1:11 AM (UTC+5:30)*

```
lets not append JP- to all , rest combination looks fine. re-share the plan
```

## 20. Readable persona and Pathshala IDs

*Wednesday, Aug 5, 2026, 1:13 AM (UTC+5:30)*

```
Readable persona and Pathshala IDs

Implement the plan as specified, it is attached for your reference. Do NOT edit the plan file itself.

To-do's from the plan have already been created. Do not create them again. Mark them as in_progress as you work, starting with the first one. Don't stop until you have completed all the to-dos.
```

## 21. apps/api-server/src/lib/exam-punya.ts calls resolveExamCompletionPoints() as the first statement of

*Wednesday, Aug 5, 2026, ~1:28 AM (UTC+5:30) — session*

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

## 22. Autosave (PUT /v1/exams/attempts/:attemptId/answers/:questionId) writes answers the client can never

*Wednesday, Aug 5, 2026, ~1:29 AM (UTC+5:30) — session*

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

## 23. apps/jain-pathshala/src/pages/admin/AdminExtendedPages.tsx — AddExamDialog.

*Wednesday, Aug 5, 2026, ~1:30 AM (UTC+5:30) — session*

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

## 24. CRON_EXPRESSIONS.EXAM_TOP_SCORE fires runExamTopScoreAwards() with no examId every hour, which

*Wednesday, Aug 5, 2026, ~1:30 AM (UTC+5:30) — session*

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

## 25. apps/api-server/src/routes/v1/exams.ts — the PUT autosave route validates that every

*Wednesday, Aug 5, 2026, ~1:30 AM (UTC+5:30) — session*

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

## 26. apps/api-server/test/exams.test.ts is at 21 tests but three of the newest guards have no coverage.

*Wednesday, Aug 5, 2026, ~1:31 AM (UTC+5:30) — session*

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

## 27. Five small items from docs/reviews/EXAMS_REVIEW_FOLLOWUP.md.

*Wednesday, Aug 5, 2026, ~1:31 AM (UTC+5:30) — session*

```
Five small items from docs/reviews/EXAMS_REVIEW_FOLLOWUP.md.

(a) N4 — OTP rate limiter: count only FAILED OTP verifications; key on ${uid}:${student.id}.
(b) N6 — move exam cron/queue registration out of exams.ts into apps/api-server/src/jobs/.
(c) N7 — add exam.attempt_abandon and exam.top_score to CLAUDE.md cron table + queue list.
(d) N8 — add --> statement-breakpoint separators to 0028_exam_otp_hash.sql.
(e) M8 — PATCH /v1/admin/exams/:id + edit dialog; block marks edits after results_released.

Run: pnpm typecheck && pnpm lint && pnpm test
```

## 28. Fix the blank-in-Hindi quiz bug. Quiz content is authored English-only; Hindi locale shows blank titles/questi

*Wednesday, Aug 5, 2026, ~1:31 AM (UTC+5:30) — session*

```
Fix the blank-in-Hindi quiz bug. Quiz content is authored English-only; Hindi locale shows blank titles/questions/options. Add ?? English fallbacks in mobile quizzes.tsx, QuizRunner.tsx, queries.ts title_hi type; grep other hi ? _hi sites.

Run pnpm typecheck.
```

## 29. Fix push quiz submit authorization: replace batch_id equality with quizMatchesStudent + geoForCentre; delete e

*Wednesday, Aug 5, 2026, ~1:32 AM (UTC+5:30) — session*

```
Fix push quiz submit authorization: replace batch_id equality with quizMatchesStudent + geoForCentre; delete eventMatchesStudent; add scope tests.

Run pnpm typecheck and pnpm test -- quizzes.
```

## 30. Make quiz event attempts resumable: onConflictDoNothing start, resumed+answers, available already_attempted/in

*Wednesday, Aug 5, 2026, ~1:32 AM (UTC+5:30) — session*

```
Make quiz event attempts resumable: onConflictDoNothing start, resumed+answers, available already_attempted/in_progress, mobile Resume quiz + initialAnswers, tests.

Run pnpm typecheck and pnpm test -- quizzes.
```

## 31. Bring quiz Punya into feature catalogue (AT21): migration quiz_participation/quiz_win/push_quiz_completion, qu

*Wednesday, Aug 5, 2026, ~1:32 AM (UTC+5:30) — session*

```
Bring quiz Punya into feature catalogue (AT21): migration quiz_participation/quiz_win/push_quiz_completion, quiz-points.ts, resolve before tx, award key changes, tests.

Run pnpm db:migrate, pnpm typecheck, pnpm test -- quizzes.
```

## 32. SQL-filter quiz list routes: shared quizMatchesStudentSql, LIMIT 100/1, GIN indexes migration, tests (predicat

*Wednesday, Aug 5, 2026, ~1:33 AM (UTC+5:30) — session*

```
SQL-filter quiz list routes: shared quizMatchesStudentSql, LIMIT 100/1, GIN indexes migration, tests (predicate agreement + 45 push quizzes).

Run pnpm db:migrate, pnpm typecheck, pnpm test -- quizzes.
```

## 33. Admin quiz results surface: GET events/:id/attempts, GET push/:id/attempts, GET /push; QuizzesPage Push tab + 

*Wednesday, Aug 5, 2026, ~1:33 AM (UTC+5:30) — session*

```
Admin quiz results surface: GET events/:id/attempts, GET push/:id/attempts, GET /push; QuizzesPage Push tab + live poll; tests.

Run pnpm typecheck and pnpm test -- quizzes.
```

## 34. Quiz correction path: PATCH/DELETE questions, DELETE events force, POST attempts reset + reversePunya, is_acti

*Wednesday, Aug 5, 2026, ~1:34 AM (UTC+5:30) — session*

```
Quiz correction path: PATCH/DELETE questions, DELETE events force, POST attempts reset + reversePunya, is_active filter, UI, tests.

Run pnpm typecheck and pnpm test -- quizzes.
```

## 35. shikshak - in web able to assign punya points to student from his/her batch. same should be possible via mobil

*Wednesday, Aug 5, 2026, ~1:35 AM (UTC+5:30) — session*

```
shikshak - in web able to assign punya points to student from his/her batch. same should be possible via mobile app
```

## 36. Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #1, #2, #3, #4 — in that

*Wednesday, Aug 5, 2026, ~1:35 AM (UTC+5:30) — session*

```
Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #1, #2, #3, #4 — in that
order, which is deliberate. #1 is a one-line predicate fix with an obvious test. #2
routes the three rogue call sites through notifyUsers, which is the precondition for
#3 (receipt handling only has one place to live once all pushes go through one
function). #4 is the token-ownership change and is independent, so it goes last and
cannot destabilise the others.

One commit per fix. After each commit, stop and print a short diff summary so I can
review before you continue. Do not batch them into one commit.
```

## 37. FIX #1 — sendParentAttendancePush names an arbitrary child (correctness, blocking)

*Wednesday, Aug 5, 2026, ~1:37 AM (UTC+5:30) — session*

```
FIX #1 — sendParentAttendancePush names an arbitrary child (correctness, blocking)

File: apps/api-server/src/services/attendance-post-process.ts  (~lines 39-72)

PROBLEM
The function takes studentId and never uses it. The query is:

  .from(students)
  .innerJoin(attendance, and(eq(attendance.student_id, students.id),
                             eq(attendance.session_id, sessionId)))
  .innerJoin(sessions, eq(sessions.id, sessionId))
  .leftJoin(users, eq(users.id, students.parent_id))
  .limit(1)

Nothing constrains the row to studentId. For any session with more than one marked
student — every real session — Postgres returns an arbitrary row and .limit(1) takes
it. The debounced job then pushes THAT child's name and attendance status to THIS
child's parent.

The debounce jobId is `attn-parent:${studentId}:${sessionId}`, so the job is correctly
per-student. Only the query forgot.

TEST FIRST — apps/api-server/test/notifications.test.ts
  "the parent attendance push names the student it was queued for"
  Seed one session with at least THREE students marked, each with a DIFFERENT parent
  and a different status (present / absent / late). Call sendParentAttendancePush
  directly for the middle student. Assert:
    a) exactly one notifications row was inserted,
    b) its user_id is that student's parent_id,
    c) its body_en contains that student's full_name and no other student's.
  Then call it for each of the three in turn and assert each parent got their own
  child's name. A test with one student passes against the broken code — do not
  write that test.

CHANGE
  Add the missing predicate to the join:
    eq(attendance.student_id, studentId)
  and select students by id rather than relying on limit(1):
    .where(eq(students.id, studentId))
  Keep .limit(1) as a belt-and-braces guard. Do not otherwise restructure the query.

While you are in the file, check whether any OTHER function in it accepts an id it
does not use in its WHERE clause. Report what you find; do not fix it here.

COMMIT: fix: scope parent attendance push to the queued student
```

## 38. FIX #2 — Three call sites bypass the notification-preference gate (security, blocking)

*Wednesday, Aug 5, 2026, ~1:38 AM (UTC+5:30) — session*

```
FIX #2 — Three call sites bypass the notification-preference gate (security, blocking)

Files:
  apps/api-server/src/lib/notify.ts                     (notifyUsers, prefsAllowKind)
  apps/api-server/src/routes/v1/niyam-submissions.ts    (~line 428)
  apps/api-server/src/lib/niyam-badges.ts               (~line 154)
  apps/api-server/src/routes/v1/notifications.ts        (~line 258, birthday cron)

PROBLEM
prefsAllowKind lives INSIDE notifyUsers (notify.ts:17-23). It reads
users.notification_preferences and drops the user when prefs.push === false or
prefs[kind] === false.

The three files above call sendPush() directly. A parent who has turned push off in
the app still receives niyam-rejection, niyam-badge, and birthday pushes. CLAUDE.md's
"Common pitfalls" table requires checking users.notification_preferences before
enqueuing; right now exactly one of four paths does.

Note the niyam paths ALSO do something notifyUsers does not — they branch on
users.preferred_language for the push copy. Do not lose that behaviour. FIX #5 moves
language handling into notifyUsers; if you are running these prompts in order, do
FIX #5's language lookup as part of THIS commit rather than pushing English copy
through the niyam paths in the interim. Say which you did.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "a parent with push disabled gets no niyam-rejection push"
     Set the parent's notification_preferences to { push: false }. Trigger the niyam
     rejection path. Assert sendPush was not called with that parent's token.
  b) "a parent with niyam_badge disabled still gets birthday notifications"
     Set { niyam_badge: false }. Assert the badge push is suppressed and the birthday
     push is not — this proves per-kind gating, not a blanket mute.
  c) "a parent with push disabled gets no birthday push but still gets the inbox row"
     The durable inbox row is not a push and must survive the opt-out. If you decide
     the row should also be suppressed, STOP and ask — do not decide it silently.
  Stub the Expo transport at the lib/push module boundary; do not hit the network.

CHANGE
  1. In niyam-submissions.ts and niyam-badges.ts, replace the hand-rolled
     device_push_tokens query + sendPush with a notifyUsers call passing the correct
     kind ('niyam_rejected' / 'niyam_badge' — both already exist in
     NOTIFICATION_KINDS) and the data payload those sites currently send.
     notifyUsers does not yet forward `data` — add that parameter as part of this
     fix (it is FIX #7; pulling it forward is correct here because deleting the
     direct sendPush would otherwise drop the deep-link payload).
  2. In notifications.ts runBirthdayWishes, the inbox insert already happens inside
     the advisory-lock transaction and MUST stay there — do not move it into
     notifyUsers. Replace only the trailing sendPush block (~line 246-266) with a
     push that filters newlyNotifiedIds through the same prefsAllowKind check.
     Extract prefsAllowKind from notify.ts into an exported helper rather than
     copying it. A second copy will drift.
  3. Delete the now-dead device_push_tokens imports from the two niyam files.

CONSTRAINT
  After this commit, `rg "sendPush\(" apps/api-server/src` must return matches ONLY in
  src/lib/notify.ts and src/lib/push.ts. Paste that rg output as part of your
  completion report.

COMMIT: fix: route niyam and birthday pushes through the preference gate
```

## 39. FIX #3 — Dead push tokens are never reaped (reliability, blocking)

*Wednesday, Aug 5, 2026, ~1:39 AM (UTC+5:30) — session*

```
FIX #3 — Dead push tokens are never reaped (reliability, blocking)

Files:
  apps/api-server/src/lib/push.ts        (sendPush, ~lines 26-46)
  apps/api-server/src/lib/notify.ts      (the only remaining caller after FIX #2)
  apps/jp-shared/src/constants.ts        (new queue + cron name)
  apps/api-server/src/jobs/derived-data-jobs.ts   (handler registration)

PROBLEM
sendPush builds ExpoPushTicket[] and returns them. No caller reads the return value.
`rg "is_active: false" apps/api-server/src` shows writes in auth.ts and
admin-staffing.ts — never for device_push_tokens. So is_active is filtered on in four
places and set to false in zero.

Expo signals a dead token two ways:
  - Ticket (immediate): status 'error', details.error 'DeviceNotRegistered'
  - Receipt (async, fetched by ticket id): same shape, and this is where MOST
    DeviceNotRegistered results actually appear — the ticket is usually 'ok'
Handling only tickets catches a minority of cases. Handle both.

Expo throttles projects with a high invalid-token ratio, so this degrades delivery for
LIVE users, not just uninstalled ones.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "a DeviceNotRegistered ticket deactivates that token and no others"
     Register two tokens for two users. Stub the Expo transport to return
     [{ status:'error', message:'...', details:{ error:'DeviceNotRegistered' } },
      { status:'ok', id:'receipt-1' }]
     Send to both. Assert token 1 is_active === false and token 2 is_active === true.
  b) "a MessageRateExceeded ticket does NOT deactivate the token"
     Rate limiting is transient. Deactivating on it silently mutes a real device.
  c) "a DeviceNotRegistered receipt deactivates the token"
     Stub getPushNotificationReceiptsAsync to return that error for a stored ticket id.
  d) "sendPush still resolves when the Expo call throws"
     Push is best-effort — the existing never-throws contract must hold.

CHANGE
  1. sendPush must keep its "never throws" contract and its ExpoPushTicket[] return.
     Add: build the messages array so index i maps back to the token that produced it
     (the current code flattens p.to arrays and loses that mapping — fix it). On an
     'error' ticket with details.error === 'DeviceNotRegistered' or
     'InvalidCredentials', deactivate that token. Ignore every other error code.
  2. Persist 'ok' ticket ids for the receipt sweep. Add a small table via
     lib/db/src/schema/notifications.ts:
       push_receipts(id uuid pk, ticket_id text notNull unique, expo_token text
       notNull, created_at, checked_at nullable)
     Follow the timestamps() helper and index conventions already in that file.
  3. Add a queue + cron for the sweep in apps/jp-shared/src/constants.ts:
       NOTIFICATIONS_PUSH_RECEIPTS: "notifications.push_receipts"
       cron "*/30 * * * *"
     Register the handler in jobs/derived-data-jobs.ts alongside the existing ones.
     The handler chunks unchecked ticket ids via expo.chunkPushNotificationReceiptIds,
     calls getPushNotificationReceiptsAsync, deactivates on DeviceNotRegistered, and
     stamps checked_at. Delete rows older than 7 days in the same pass — Expo does
     not retain receipts beyond that and unbounded growth is its own bug.
  4. Deactivation is is_active = false. NEVER delete the row — it is the audit trail
     for which device stopped receiving, and it matches the soft-delete convention
     used everywhere else in this repo.

MIGRATION
  pnpm db:generate then pnpm db:migrate. Paste both outputs. Confirm the generated SQL
  in lib/db/migrations only ADDS a table — if it drops or alters anything else, stop
  and show me the diff before applying.

COMMIT: fix: deactivate push tokens on DeviceNotRegistered tickets and receipts
```

## 40. FIX #4 — Push-token registration re-points any token to the caller (security, blocking)

*Wednesday, Aug 5, 2026, 1:40 AM (UTC+5:30)*

```
FIX #4 — Push-token registration re-points any token to the caller (security, blocking)

File: apps/api-server/src/routes/v1/notifications.ts  (~lines 34-63)

PROBLEM
  .onConflictDoUpdate({
    target: device_push_tokens.expo_token,
    set: { user_id: req.authUser!.id, platform, is_active: true },
  })

The unique key is the token, and the update overwrites user_id with whoever called.
Anyone holding another user's Expo token — leaked log line, shared or resold device,
a debug build, a screenshot of dev tools — can POST it and become its owner. Their
notifications, including child names and attendance status, are then delivered to the
victim's physical device.

The existing comment frames this as reinstall/device-handover convenience. That use
case is real and must keep working. What must not keep working is a silent takeover by
someone who never held the device.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "user B cannot claim user A's active push token"
     A registers a token. B POSTs the same token. Assert the row's user_id is still A.
     Assert the response is 409 ERR_PUSH_TOKEN_CLAIMED (not 200 — a silent no-op would
     leave B's app believing it is registered and then silently receiving nothing).
  b) "re-registering your own token is idempotent and reactivates it"
     A registers, the token is deactivated by the receipt sweep, A registers again ->
     200, is_active true, same row id.
  c) "a token deactivated by DeviceNotRegistered can be claimed by a new user"
     This is the genuine device-handover / reinstall path and MUST still work.

CHANGE
  Split the upsert into an explicit read-then-write inside a transaction:
    - No existing row               -> insert, 200.
    - Existing row, same user_id    -> update platform + is_active true, 200.
    - Existing row, different user, is_active = false  -> reassign, 200.
      (A dead token means the app was uninstalled or the device wiped. That is a real
      handover and the only safe automatic reassignment.)
    - Existing row, different user, is_active = true   -> 409 ERR_PUSH_TOKEN_CLAIMED.
      Message per the error-copy rule: state the problem AND the fix. Something like
      "That device is registered to another account — sign out on that device first."
  Add ERR_PUSH_TOKEN_CLAIMED wherever this repo's error codes are declared; grep for
  an existing ERR_ constant to find the file rather than inventing a location.

  Wrap the read-then-write in db.transaction with a row lock (.for("update")) or an
  advisory lock keyed on the token. Two devices registering concurrently is a real
  check-then-act race — runBirthdayWishes in this same file shows the advisory-lock
  pattern this codebase already uses.

MOBILE FOLLOW-UP — report only, do not implement
  Find where apps/jain-pathshala-mobile posts to /v1/notifications/push-token and tell
  me whether it surfaces a 409 to the user or swallows it. Do not change mobile code in
  this commit.

COMMIT: fix: reject push-token claims on another user's active device
```

## 41. Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #5, #6, #7, #8 — in that

*Wednesday, Aug 5, 2026, 1:41 AM (UTC+5:30)*

```
Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #5, #6, #7, #8 — in that
order. #5 and #7 both widen the notifyUsers signature, so doing them adjacently keeps
the churn in one place. #6 changes error semantics and wants a clean base. #8 is a
migration and goes last so a schema rollback does not drag code changes with it.

If you already pulled #5's language lookup or #7's data payload forward into Phase 1
(both prompts allow it), say so and skip the duplicated work rather than doing it
twice.

One commit per fix. Stop after each and print a diff summary.
```

## 42. FIX #5 — Push always sends English (bilingual contract)

*Wednesday, Aug 5, 2026, 1:42 AM (UTC+5:30)*

```
FIX #5 — Push always sends English (bilingual contract)

Files:
  apps/api-server/src/lib/notify.ts       (~lines 46-87)
  apps/api-server/src/lib/niyam-badges.ts (~lines 146-152 — the correct reference)

PROBLEM
notifyUsers passes opts.title_en / opts.body_en to sendPush unconditionally. The inbox
row correctly stores both variants, so the in-app list renders fine — but the PUSH,
which is the notification most users actually read, is English for everyone.

niyam-badges.ts already does this right:
  const hi = parent?.preferred_language === "hi";
  title: hi ? titleHi : titleEn

CLAUDE.md "Bilingual requirements": all user-facing content ships _en and _hi and the
client renders per preferred_language. A push has no client-side render step, so the
server must pick.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "a Hindi-preference user receives the Devanagari push body"
     Two users, one preferred_language 'hi', one 'en', both with active tokens. One
     notifyUsers call. Assert the stubbed transport received the Devanagari strings
     for the first and the English for the second — from a SINGLE call, which is the
     part the current code cannot do.
  b) "a user with no preferred_language falls back to English"
     Null must not produce an empty push body.

CHANGE
  notify.ts already selects from users to read notification_preferences (~line 48).
  Add preferred_language to that same select — no new query. Build the sendPush
  payloads per user from the token rows joined back to that map.

  Note the current token query (~line 72) selects only expo_token, so it cannot map a
  token to a user. Add user_id to it, the way runBirthdayWishes already does at
  ~line 247.

  Keep the inbox insert storing BOTH variants unchanged. Language selection applies to
  the push transport only.

COMMIT: fix: send push notifications in the recipient's preferred language
```

## 43. FIX #6 — notifyUsers' catch hides durable-write failures (correctness)

*Wednesday, Aug 5, 2026, 1:43 AM (UTC+5:30)*

```
FIX #6 — notifyUsers' catch hides durable-write failures (correctness)

File: apps/api-server/src/lib/notify.ts  (~lines 46-91)

PROBLEM
The try block spans the preference read, the notifications INSERT, the token read, and
the push. The catch logs warn and returns.

Push being best-effort is correct and documented in the file header. The inbox row is
NOT best-effort — it is the durable record and the fallback when push does not land.
Today a failed insert returns normally, so the BullMQ job that called it records
success and never retries. The notification is gone with a single warn line.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "notifyUsers throws when the inbox insert fails"
     Stub the insert to reject. Assert notifyUsers rejects.
  b) "notifyUsers resolves when only the push transport fails"
     Stub the Expo transport to throw. Assert notifyUsers resolves AND the inbox row
     exists.
  c) "a caller in a fire-and-forget path is unaffected"
     Find the callers that do not await or that .catch() — gallery-wall-notify.ts
     wraps its own body in try/catch already. Confirm none of them now crash a request
     handler. List every notifyUsers call site and its await/catch posture in your
     report.

CHANGE
  Narrow the try/catch to the push section only. Let the preference read and the
  notifications insert propagate.

  Then check each caller. Anything running inside a BullMQ handler SHOULD propagate so
  the job retries — attendance-post-process.ts:63 is the important one and it already
  documents "Do not swallow — failed streak must surface on the queue job" for its
  sibling call, so this matches existing intent. Anything running inline in a request
  handler needs an explicit .catch() at the call site, not a swallow inside notifyUsers.

  Update the file header comment. It currently promises "Never throws." That will no
  longer be true and a stale contract comment is worse than none.

COMMIT: fix: let notifyUsers surface inbox insert failures to the queue
```

## 44. FIX #7 — notifyUsers sends no data payload (product completeness)

*Wednesday, Aug 5, 2026, 1:44 AM (UTC+5:30)*

```
FIX #7 — notifyUsers sends no data payload (product completeness)

Files:
  apps/api-server/src/lib/notify.ts   (~lines 25-43 signature, ~79-86 send)
  apps/api-server/src/lib/push.ts     (PushPayload.data already exists)

PROBLEM
PushPayload has an optional `data` field and niyam-submissions.ts uses it:
  data: { kind: "niyam_rejected", submission_id: opts.submissionId }
notifyUsers never passes one. So every attendance, homework, gallery and birthday push
opens the app at whatever screen it was last on, with no route to the thing the
notification is about.

SKIP THIS PROMPT if you already pulled the `data` parameter forward while doing FIX #2
— that prompt permits it because deleting the direct sendPush calls would otherwise
drop the niyam deep links. Say so and move on.

TEST FIRST — apps/api-server/test/notifications.test.ts
  "the push payload carries kind and entity id"
  Assert the stubbed transport received data.kind matching the notification kind and
  data.entity_id matching what the caller passed.

CHANGE
  1. Add an optional `data?: Record<string, unknown>` to the notifyUsers opts and
     forward it to sendPush, merged with a default { kind } so kind is always present
     even when the caller passes nothing.
  2. Populate it at the call sites that have an obvious target entity:
       attendance-post-process.ts  -> { kind:'attendance', session_id, student_id }
       homework-notify.ts          -> { kind:'homework', assignment_id }
       gallery-wall-notify.ts      -> { kind:'gallery', gallery_item_id }
     Read each file first — use the ids already in scope, do not add queries to fetch
     new ones.

MOBILE FOLLOW-UP — report only, do not implement
  Find the Expo notification response handler in apps/jain-pathshala-mobile and tell me
  which data.kind values it already routes on, so the strings above match rather than
  inventing a parallel vocabulary. If it routes on nothing, say that — it means these
  payloads are groundwork, not a working feature, and I need to know that.

COMMIT: feat: carry deep-link data payload on notification pushes
```

## 45. FIX #8 — title_hi / body_hi are nullable but always required (data model)

*Wednesday, Aug 5, 2026, 1:45 AM (UTC+5:30)*

```
FIX #8 — title_hi / body_hi are nullable but always required (data model)

File: lib/db/src/schema/notifications.ts  (~lines 36-38)

PROBLEM
  title_hi: text("title_hi"),      <- nullable
  body_hi: text("body_hi"),        <- nullable
while notifyUsers' signature requires both. So the type system enforces bilingual copy
at one call site and the database enforces it nowhere. Any direct insert — a future
service, a backfill script, a seed — produces a row that renders blank for a Hindi
user, with nothing to catch it.

CLAUDE.md: "All user-facing content must have _en and _hi variants."

TEST FIRST — apps/api-server/test/notifications.test.ts
  "an insert without Hindi copy is rejected"
  Attempt a raw db.insert(notifications) with title_hi omitted. Assert it rejects.
  This test is the whole point of the fix — if it passes before your change, the
  constraint is already there and you should stop and tell me.

CHANGE
  1. Backfill FIRST, in the migration, before the NOT NULL: any existing row with a
     null title_hi/body_hi gets the English text copied across. Losing an old
     notification to a failed migration is worse than an English string in a Hindi
     inbox.
  2. Add .notNull() to both columns.
  3. pnpm db:generate, inspect the generated SQL in lib/db/migrations, confirm the
     backfill UPDATE precedes the ALTER ... SET NOT NULL. Drizzle will NOT generate the
     backfill for you — hand-edit the migration to add it. Then pnpm db:migrate.
     Paste the generated SQL and both command outputs.
  4. Check whether any seed or script inserts notifications without Hindi copy:
       rg "insert\(notifications\)" --type ts
     Fix any that would now fail.

COMMIT: fix: require Hindi copy on notification rows
```

## 46. Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #9, #10, #11 — in that

*Wednesday, Aug 5, 2026, 1:45 AM (UTC+5:30)*

```
Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #9, #10, #11 — in that
order. #9 is a Postgres enum change and wants to land alone. #10 and #11 are additive
route work with no schema impact.

One commit per fix. Stop after each and print a diff summary.
```

## 47. list me all prompts which were given after commit ef21105b65191e967ad05effeba74713f496905a in md file

*Wednesday, Aug 5, 2026, 9:39 AM (UTC+5:30)*

```
list me all prompts which were given after commit ef21105b65191e967ad05effeba74713f496905a in md file
```

