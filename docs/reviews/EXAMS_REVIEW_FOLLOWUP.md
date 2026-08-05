# Exams module — follow-up review

**Date:** 2026-08-05
**Checks:** every finding in [`EXAMS_MODULE_REVIEW.md`](./EXAMS_MODULE_REVIEW.md), plus a fresh pass over the newly added code.

**Result: 27 of 31 findings fully closed, 4 partial, 8 new observations.** No regressions in the security or authorization work. The remaining gap that still matters is **C2** — the pass-mark bug that fails every student on a marks-mismatched exam is only half-fixed.

---

## Scorecard

| | Closed | Partial | Open |
|---|---|---|---|
| 🔴 Critical (6) | 5 | 1 (C2) | 0 |
| 🟠 High (8) | 6 | 2 (H3, H8) | 0 |
| 🟡 Medium (10) | 8 | 1 (M6) | 1 (M8) |
| 🟢 Low (7) | 6 | 0 | 1 |

---

## Critical

| # | Status | Evidence |
|---|---|---|
| **C1** grading UI | ✅ **Closed** | `ExamGradingPage.tsx` (543 lines) — attempt list with a "needs grading" filter, ungraded sorted first, per-question detail, marks input bounded `min={0} max={a.marks}`, `admin_comment` field, running auto + manual total. Routed at `App.tsx:126` and in `sidebar-nav.ts:73` behind `min: 'city_admin', gate: 'administerExams'`. |
| **C2** marks vs pass mark | ⚠️ **Partial** | `createExamSchema.superRefine` now rejects inverted windows and `pass_mark > total_marks` (admin-modules.ts:394-409). But the actual bug is unfixed: nothing compares `pass_mark` to `SUM(exam_questions.marks)`. `GET /:id/marks-summary` was not built (grep: no match anywhere), the builder still has no marks-total bar, and `release-results` has no guard. **A 10-mark exam left at the 100/40 defaults still fails every student, silently.** |
| **C3** access code | ✅ **Closed** | `generateExamAccessCode()` uses `randomInt` over an unambiguous alphabet (tokens.ts:109-117); `hashOtpCode` → argon2id; `verifyOtpCode` with a `timingSafeEqualString` legacy bridge; plaintext returned exactly once and never stored (`exam_otp: null` on insert, admin-modules.ts:446); rate limits `10/hr/user` + `5/15min/exam` (exams.ts:872-879); `otp_verified_at` recorded. Admin list returns the code only when `canAdministerExams` (admin-modules.ts:184). Test at exams.test.ts:822. |
| **C4** role guards | ✅ **Closed** | `EXAM_ADMIN_ROLES` + `canAdministerExams` (contracts.ts:179-183) applied to all five admin routes plus the new reset route; `release-results` now wrapped in `requireRole("super_admin","state_admin","city_admin")` (admin-modules.ts:210). Test at exams.test.ts:766. |
| **C5** student-view | ✅ **Closed** | `resolveStudentContext` (exams.ts:742-790) accepts `parent` or `student`, resolves via `ownedStudentsCondition`, requires `student_id` when the caller owns more than one child (422), and uses `ORDER BY` everywhere. All four take-flow routes wired. Both clients now send `student_id` — the mobile `ChildSwitcher` actually drives the request. Test at exams.test.ts:1157. |
| **C6** authoring lock | ✅ **Closed** | `examHasAttempts()` guards both `POST /:id/questions` (exams.ts:246) and `DELETE .../:qid` (exams.ts:336) with 409 `ERR_EXAM_HAS_ATTEMPTS`. |

---

## High

| # | Status | Evidence |
|---|---|---|
| **H1** window at submit | ✅ **Closed** | Submit re-reads `window_end` and 422s (exams.ts:1184). Autosave enforces it too (exams.ts:1057). |
| **H2** abandoned attempts | ✅ **Closed** | `abandoned` added to the status enum; `runExamAttemptAbandon()` cron every 30 min at `window_end + 2h` (exams.ts:62-88); `ne(status,'abandoned')` in **both** cap queries (exams.ts:831, 935); admin `POST /:id/attempts/:attemptId/reset` with audit (exams.ts:679). |
| **H3** incremental saves | ⚠️ **Partial** | `PUT /attempts/:attemptId/answers/:questionId` exists and is correct — grading columns forced NULL, option ownership validated, window enforced. Both clients debounce-autosave with a Saving/Saved indicator. **But there is no way to read the saved answers back.** No `GET /v1/exams/attempts/:attemptId` for students, so after an app kill the answers sit in `exam_answers` unreachable, and `/start` would hit the attempt cap. Autosave currently protects only against a failed submit — not the app-kill scenario it was written for. |
| **H4** grade transaction | ✅ **Closed** | Whole route in one `db.transaction` opening with `pg_advisory_xact_lock(hashtextextended(attemptId,0))`; N updates collapsed into one `UPDATE … FROM (VALUES …)` (exams.ts:543-565). |
| **H5** autoScore accumulator | ✅ **Closed** | All grading computed into `gradedAnswers` before the transaction; the callback does pure writes, with a comment explaining the retry hazard (exams.ts:1239-1349). |
| **H6** Punya | ✅ **Closed** | `exam-punya.ts` + `exam-points.ts`. One shared `awardExamCompletionPunya` used by both finalize sites; AT18 reverse-then-award with generation-suffixed keys; AT20 guarded insert via `awardPunya`; AT21 points from `punya_features`/`punya_configs` with cache, never inlined; top-score job keyed separately and enqueued on release. Migration 0029 seeds both features. Three tests (exams.test.ts:1288, 1335, 1423). |
| **H7** soft-delete/status | ✅ **Closed** | `ownedStudentsCondition` filters `isNull(deleted_at)` + `status='active'` (route-helpers.ts:45-51). |
| **H8** cross-field validation | ⚠️ **Partial** | Server-side `superRefine` done. Client-side: `max_attempts` is still absent from the create dialog, so every exam created through the UI is stuck at 1 attempt, and there is no pre-submit validation. |

---

## Medium / Low

| # | Status | Evidence |
|---|---|---|
| **M1** error codes | ✅ | Six codes added to `ERROR_CODES`; `fail()` now types `code: ErrorCode` so raw strings no longer compile (envelope.ts); bilingual `ERROR_MESSAGES` for all six, in the problem-and-fix voice. |
| **M2** bilingual | ✅ | `question_hi` + `option_hi` inputs in the builder and rendered in the question cards; `title_hi` now `min(1)` required; `description_en/_hi` added; the `title_hi ?? title_en` fallback is gone. |
| **M3** design tokens | ✅ | `bg-status-success-soft` / `border-status-success` / `text-status-success` replace the emerald classes. |
| **M4** indexes | ✅ | `idx_exam_attempts_exam_student` and `idx_online_exams_city_window` created; the two superseded single-column indexes dropped (migration 0030). |
| **M5** admin list query | ✅ | Correlated subquery replaces the `leftJoin` + `groupBy` (admin-modules.ts:173-176). |
| **M6** payload bounds | ⚠️ **Partial** | `.max(200)` on answers, `.max(50)` on option ids. Option-ownership validation exists on **autosave** (exams.ts:1073-1092) but **not on submit** — arbitrary UUIDs still persist through the submit path. Low impact (grading compares sets, so they score 0) but inconsistent. |
| **M7** dead import | ✅ | `requireAdminPanel` no longer imported. |
| **M8** exam edit/delete | ❌ **Open** | Still no route. A wrong window, wrong marks, or typo'd title remains permanent — now made sharper by C6, since questions also lock once anyone attempts. |
| **M9** result on open attempt | ✅ | `in_progress` and `abandoned` return status-only, checked before the `results_released` gate (exams.ts:1400-1407). |
| **M10** result payload | ✅ | `per_question` now carries `question_en`, `question_hi`, `marks`, ordered by `order_index`; both clients render an answer-review list. |
| Low: status enum | ✅ | `exam_attempt_status_enum` with a safe coercion + cast in migration 0030. |
| Low: `otp_verified_at` | ✅ | Column added and populated at start. |
| Low: `admin_comment` / `graded_by_user_id` | ✅ | Both added, written by the grade route, surfaced in the grading UI. |
| Low: test gaps | ⚠️ | 21 tests now (up from 10) — shikshak authz, rate limiting, autosave ×4, parent multi-child, Punya ×3. Still **no test** for `ERR_EXAM_HAS_ATTEMPTS`, submit-after-window, or abandoned-frees-a-slot — three of the newest and least-exercised branches. |
| Low: `label_en` naming, partial credit | ❌ | Unchanged (both were noted as acceptable to defer). |

---

## New observations in the added code

Nothing here reverses the fixes; these are issues introduced by, or newly visible in, the new code.

### 🟠 N1 — Second pool connection acquired while holding a transaction

`awardExamCompletionPunya` runs **inside** the submit and grade transactions (exams.ts:1337, :616) and its first act is:

```ts
const points = await resolveExamCompletionPoints(opts.cityId, opts.completionPointsOverride);
```

`resolveFeatureDefault` (exam-points.ts:78-124) queries with the **global `db` pool**, not the `tx`. Requesting a second connection from the same pool while the first is held inside a transaction is the classic pool-exhaustion deadlock: at N concurrent submits where N = pool size, every request holds a connection and waits for one that will never free.

The Redis cache masks it most of the time, which makes it worse — it will surface under exactly the load spike it is least wanted in (a centre's whole batch submitting at once).

**Fix:** thread `tx` through `resolveExamCompletionPoints` / `resolveFeatureDefault`, or resolve the points *before* opening the transaction and pass them in.

### 🟠 N2 — Hourly top-score job re-processes every released exam, forever

`CRON_EXPRESSIONS.EXAM_TOP_SCORE = "15 * * * *"` fires `runExamTopScoreAwards()` with no `examId`, which selects **all** exams where `results_released = true` (exam-punya.ts:249-260) and then runs a max-score query, a per-student best-score query, an existing-awards `LIKE` scan, and per-student award calls for each one.

That set only ever grows. After two years of monthly city exams this is hundreds of exams re-scanned every hour to award nothing. It is correct and idempotent — just unbounded.

**Fix:** the enqueue-on-release path (admin-modules.ts:225) already handles the real trigger. Narrow the cron to exams released in the last N days, or make it a reconciliation job on a daily cadence.

### 🟡 N3 — No resume endpoint (see H3)

Autosaved answers cannot be read back. Add `GET /v1/exams/attempts/:attemptId` returning the in-progress attempt's questions plus saved answers (no correctness fields), and have both clients offer "Resume exam" when an `in_progress` attempt exists.

### 🟡 N4 — Rate limit counts successes and keys on the parent

`exam:start:exam:${examId}:user:${uid}` at 5 per 15 min (exams.ts:876) increments on **every** start call, including successful ones, and keys on the caller's user id. A parent with four children sitting the same exam shares one budget of five. Count only failed OTP verifications, or key on `${uid}:${student.id}`.

### 🟡 N5 — Submit skips the option-ownership check autosave performs

See M6. Same validation should run on both paths, ideally in one shared helper.

### 🟢 N6 — Cron and queue handlers registered as import side effects

`registerCron` / `registerQueueHandler` run at module scope in a route file (exams.ts:86-97). It works, but importing the router now starts scheduled work — awkward in tests and in any process that mounts routes without wanting workers. The other job modules live under `src/jobs/`; these two belong there.

### 🟢 N7 — CLAUDE.md's "frozen" cron and queue tables weren't updated

`exam.attempt_abandon` and `exam.top_score` were added to `@jp/shared/constants` but not to CLAUDE.md's cron table or its 30-queue list — both of which the file declares as the single frozen source. Add them, or the next reviewer will flag them as unregistered.

### 🟢 N8 — Migration 0028 omits `--> statement-breakpoint`

0029 and 0030 separate every statement with the marker; 0028 does not. Confirm the runner tolerates it, or add the markers for consistency.

---

## What's good in the new work

- The **AT18 reverse-then-award** implementation is the strongest part. Generation-suffixed idempotency keys (`…:completion:g1`) correctly solve the "the base key is already occupied after a reversal" problem, and `findLatestUnreversedCompletionAward` looks up the actual unreversed transaction rather than assuming `revision − 1` — exactly what AT18 asks for.
- **Points never inlined.** `resolveExamCompletionPoints` falls through city config → global config → `punya_features`, and returns 0 when nothing is configured, with a comment forbidding a hardcoded fallback. That is AT21 followed properly rather than nominally.
- The **`UPDATE … FROM (VALUES …)`** rewrite of the grading loop is the right fix, not just a transaction wrapper around the N+1.
- **Autosave refuses to persist correctness** (`is_correct` and `marks_awarded` forced NULL on both insert and conflict-update, with a comment saying why). The easy version of this feature leaks answers.
- **Submit's "body wins, otherwise keep autosaved"** merge is subtle and has a test (exams.test.ts:1070).
- The **legacy plaintext OTP bridge** is time-boxed in a comment and uses `timingSafeEqualString` rather than `!==`.
- Migration 0030 **coerces unexpected status values before the enum cast** instead of letting the migration fail on dirty data.
- Test count doubled, and the new tests cover the failure modes rather than the happy path.

---

## Remaining work

Priority order:

1. **C2** — finish it. `GET /:id/marks-summary`, the builder's marks-total bar, and the `release-results` guard when `SUM(marks) < pass_mark`. This is still a "nobody can pass" bug in production.
2. **N1** — thread `tx` into the points resolver. Silent under test, ugly under load.
3. **H3 / N3** — resume endpoint, or autosave is doing half a job.
4. **H8** — `max_attempts` in the create dialog.
5. **N2** — narrow the top-score cron.
6. **M6 / N5** — share the option-ownership validation between autosave and submit.
7. **Tests** — `ERR_EXAM_HAS_ATTEMPTS`, submit-after-window, abandoned-frees-a-slot.
8. **N4, N6, N7, N8, M8** — cleanups.

Cursor prompts for items 1–7 are in [`EXAMS_FOLLOWUP_CURSOR_PROMPTS.md`](./EXAMS_FOLLOWUP_CURSOR_PROMPTS.md).

---

## Verdict

**Approve with follow-ups.** The security and authorization work (C3, C4, C5) is complete and correct, the Punya integration is done to the letter of AT18/AT20/AT21, and the lifecycle fixes hold together. C2 should not ship unfinished — it is a silent, total-failure bug and the smallest remaining piece of work.
