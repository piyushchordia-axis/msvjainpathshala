# Exams module — Cursor fix prompts

Companion to [`EXAMS_MODULE_REVIEW.md`](./EXAMS_MODULE_REVIEW.md). Each block is a self-contained prompt — paste one at a time into Cursor (Cmd-K / Composer, Agent mode), verify, commit, then move to the next. They are ordered by dependency; running them out of order will produce conflicts on `exams.ts`.

Every prompt assumes Cursor has `CLAUDE.md` in context. If it doesn't, prefix with:

> Read `CLAUDE.md` and `SPEC.md` §5.14, §6.17, §8.9 before making any change.

---

## 1 — Role guards (C4)

```
Read CLAUDE.md (role hierarchy) and SPEC.md §6.17, then fix the Exams authorization gaps.

In lib/api-zod/src/contracts.ts, next to FEATURE_MEDIA_ROLES, add:

  /**
   * Who may author exam questions, grade attempts, and release results.
   * Deliberately NARROWER than canAccessAdminPanel — sanchalak and shikshak can
   * open the admin panel but must NOT touch exam content or results (SPEC 6.17).
   * Do not "fix" this by reusing ADMIN_PANEL_ROLES.
   */
  export const EXAM_ADMIN_ROLES: Role[] = ["super_admin", "state_admin", "city_admin"];
  export function canAdministerExams(role: Role | null | undefined): boolean

Export both from lib/api-zod/src/index.ts.

In apps/api-server/src/routes/v1/exams.ts, replace every `canAccessAdminPanel(req.authUser?.role)`
check with `canAdministerExams(req.authUser?.role)` on these routes:
  GET    /:id/questions
  POST   /:id/questions
  DELETE /:id/questions/:qid
  GET    /:id/attempts/:attemptId
  POST   /:id/attempts/:attemptId/grade
Remove the now-unused `canAccessAdminPanel` and the unused `requireAdminPanel` import (line 27).

In apps/api-server/src/routes/v1/admin-modules.ts:
- Add requireRole("super_admin","state_admin","city_admin") to POST /exams/:id/release-results.
- In GET /exams, only include exam_otp in the response when canAdministerExams(req.authUser.role)
  is true; otherwise return `requires_otp: boolean` instead. Update ExamRow and the OTP column in
  apps/jain-pathshala/src/pages/admin/AdminExtendedPages.tsx to match.

Add tests in apps/api-server/test/exams.test.ts proving a shikshak gets 403 on: adding a question,
deleting a question, grading an attempt, and releasing results.

Run: pnpm typecheck && pnpm test
```

---

## 2 — Exam access code hardening (C3)

```
Read SPEC.md §8.9 and CLAUDE.md ("Security rules"). Harden the exam access code.

Migration lib/db/migrations/00XX_exam_otp_hash.sql:
- ALTER TABLE online_exams ADD COLUMN exam_otp_hash text.
- Backfill is NOT possible (argon2 is one-way) — leave existing rows NULL and have the API treat
  a NULL exam_otp_hash with a non-NULL exam_otp as "legacy plaintext", accepted for one release.
- ALTER TABLE exam_attempts ADD COLUMN otp_verified_at timestamptz.
Mirror all three in lib/db/src/schema/exams.ts.

In apps/api-server/src/routes/v1/admin-modules.ts (POST /exams):
- Replace Math.random() with crypto.randomInt over an unambiguous alphabet
  (no O/0/I/1/L), 6 characters, via node:crypto.
- Hash with argon2id (same helper the OTP auth flow uses — reuse it, do not add a second hasher)
  and store in exam_otp_hash. Keep exam_otp NULL for new rows.
- Return the plaintext code exactly once, in the create response. It is never readable again.

In apps/api-server/src/routes/v1/exams.ts (POST /:id/start):
- Verify with argon2.verify against exam_otp_hash; fall back to a timingSafeEqual comparison
  against exam_otp only when exam_otp_hash is NULL (legacy path).
- Set exam_attempts.otp_verified_at when the code is accepted.
- Add rate limiting using apps/api-server/src/lib/ratelimit.ts, following the pattern in
  routes/v1/niyam-submissions.ts:485 :
     rateLimit(`exam:start:user:${uid}`, 10, 3600)
     rateLimit(`exam:start:exam:${examId}:user:${uid}`, 5, 900)
  On breach return 429 with a new ERR_RATE_LIMITED code.

Add a test proving the 6th wrong code within 15 minutes returns 429, and that a correct code
after a rate-limit window returns 200 with otp_verified_at set.

Run: pnpm typecheck && pnpm db:generate && pnpm test
```

---

## 3 — Marks and window validation (C2, H8)

```
Fix the decoupling between online_exams.total_marks / pass_mark and the real question marks.

apps/api-server/src/routes/v1/admin-modules.ts — createExamSchema:
- Add a .superRefine that rejects window_start >= window_end with a clear message
  ("The exam must end after it starts — check the window dates.") and rejects
  pass_mark > total_marks.

apps/api-server/src/routes/v1/exams.ts:
- Add GET /:id/marks-summary (EXAM_ADMIN_ROLES) returning
  { question_count, sum_marks, total_marks, pass_mark, mismatch: boolean }.
- In POST /:id/questions, after insert, recompute SUM(exam_questions.marks) for the exam and
  return it in the response as `exam_sum_marks`.
- Add a guard to POST /v1/admin/exams/:id/release-results (admin-modules.ts): if
  SUM(exam_questions.marks) < pass_mark, return 422 ERR_VALIDATION_FAILED with
  "Pass mark (N) is higher than the total marks on this exam's questions (M). Fix the marks before
  releasing results." Do not release.

apps/jain-pathshala/src/pages/admin/ExamBuilderPage.tsx:
- Show a persistent summary bar above the question list:
  "Questions: N · Marks on questions: M · Exam total: T · Pass mark: P"
- When M !== T, render a warning using the design-token warning colour (not a raw Tailwind colour):
  "These questions add up to M marks but the exam is set to T. Students are scored out of M."

apps/jain-pathshala/src/pages/admin/AdminExtendedPages.tsx — AddExamDialog:
- Add a max_attempts field (number, min 1, default 1) and send it.
- Client-validate window_start < window_end and pass_mark <= total_marks before POST.

Run: pnpm typecheck && pnpm lint && pnpm test
```

---

## 4 — Admin grading UI (C1)

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

---

## 5 — Attempt lifecycle: authoring lock, window at submit, abandon/reset (C6, H1, H2, M9)

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

---

## 6 — Student-view resolution (C5)

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

---

## 7 — Incremental answer saves (H3)

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

---

## 8 — Transaction and concurrency fixes (H4, H5)

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

---

## 9 — Error codes, bilingual, tokens, indexes (M1–M7, M10, Low)

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

---

## 10 — Exam Punya (H6)

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

---

## Verification after each prompt

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration   # after prompts 1, 2, 5, 6, 8, 10
```

Commit per Conventional Commits, one commit per prompt:

```
fix: exams — narrow authoring/grading/release to city_admin+ (C4)
fix: exams — CSPRNG + hashed access code, rate-limited start (C3)
fix: exams — validate marks, pass mark and window (C2, H8)
feat: exams — admin grading screen for text answers (C1)
fix: exams — attempt lifecycle: authoring lock, window at submit, abandon (C6, H1, H2)
fix: exams — resolve student via parent/student-view context (C5)
feat: exams — incremental answer autosave (H3)
fix: exams — transactional grading, no accumulator across transaction (H4, H5)
chore: exams — error codes, bilingual fields, tokens, indexes (M1–M10)
feat: exams — Punya on completion with idempotency guard (H6)
```
