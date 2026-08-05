# Code review — Quiz module

**Date:** 2026-08-05
**Scope reviewed:**

| File | Lines |
|---|---|
| `lib/db/src/schema/quizzes.ts` | 188 |
| `apps/api-server/src/routes/v1/quizzes.ts` | 1239 |
| `apps/api-server/test/quizzes.test.ts` | 380 |
| `apps/jain-pathshala/src/pages/admin/QuizzesPage.tsx` | 723 |
| `apps/jain-pathshala-mobile/app/quizzes.tsx` | 370 |
| `apps/jain-pathshala-mobile/components/QuizRunner.tsx` | 132 |
| `apps/jain-pathshala-mobile/lib/queries.ts` (quiz hooks) | 927–1024 |

**Compared against:** the recently hardened Homework, Niyam and Exams modules (`homework.ts`, `niyam-submissions.ts`, `exams.ts`, `homework-points.ts`, `exam-points.ts`, migrations `0021`, `0026`, `0029`) and `CLAUDE.md` (AT21, AT23, bilingual, envelope, error codes, audit, design tokens, Socket.IO namespaces).

---

## Summary

The two submit paths are the strongest code in the module — the advisory lock plus conditional claim (`quizzes.ts:860`, `1189`) and the in-transaction `awardPunya` are correct, well-commented, and genuinely exactly-once. Everything around them has not kept pace with the enhancements landed in Homework, Niyam and Exams.

Three failures are severe enough to call this pre-release: **live push quizzes are broken for four of their five scopes and simultaneously open to the wrong students**, **an interrupted attempt locks a student out of a quiz permanently while displaying as "Completed"**, and **every quiz renders blank in Hindi** because the admin panel has no Hindi input at all and the mobile screens have no `?? _en` fallback.

Structurally, the module is missing the whole second half of a quiz lifecycle: no results view for any admin, no reversal or correction path, no notifications, no answer review for students, no history. Homework got `grade-all`, `ungrade`, overdue surfacing, curriculum linkage and completion rate in `mv_centre_engagement`. Quizzes got none of the equivalents.

**Verdict: Request changes.** C1–C4 are release blockers.

---

## Critical

### C1 — Push quiz submit is broken for every non-batch scope, and open to the wrong students

`POST /v1/quizzes/push/:id/submit` gates on legacy batch equality:

```ts
// quizzes.ts:1145
if (student.batch_id !== pq.batch_id) {
  fail(res, 403, "ERR_FORBIDDEN", "This quiz is not for the student's batch.");
  return;
}
```

But push quizzes accept all five scopes (`createPushSchema:928`, authorised via `authorizeQuizTargets:977`), and for anything other than `batch` the legacy column is deliberately left null:

```ts
// quizzes.ts:984
const primaryBatchId = auth.targets.batch_ids[0] ?? null;
```

`GET /push/active` correctly uses `quizMatchesStudent` (`:1066`). Submit does not. Two consequences, in opposite directions:

1. **Feature is dead for centre/city/state/national scope.** The student is offered the quiz, answers every question, taps submit, and gets a 403 that says the quiz is not for their batch. Answers discarded, no Punya, no retry path.
2. **Authorization hole.** A student with `batch_id = null` satisfies `null !== null → false` and passes the guard. Any unbatched student in the country can submit any non-batch-scoped push quiz — including one targeted at a different state — and be awarded its completion points.

**Fix:** delete the batch check and reuse `quizMatchesStudent(pq, student, cityId, stateId)` exactly as `/push/active` does, selecting the scope/target columns in the same query. Add the reciprocal test (national push quiz + batched student submits OK; out-of-scope student 403s).

### C2 — An interrupted attempt locks the student out forever and shows as "Completed"

`POST /events/:id/start` refuses any existing attempt row, regardless of whether it was submitted:

```ts
// quizzes.ts:764
if (existing) {
  fail(res, 409, "ERR_ALREADY_ATTEMPTED", "This quiz has already been started.");
  return;
}
```

and `/events/available` reports attempt state the same way:

```ts
// quizzes.ts:665
const already_attempted = !!att;   // ignores att.submitted_at
```

which the app treats as terminal — `const done = quiz.already_attempted` (`quizzes.tsx:275`) hides the Start button and renders a "Completed" pill with a check icon.

So: a student taps Start, the app is backgrounded / the network drops / they hit the back gesture — and that quiz is over for them. Permanently. It shows in their list as completed with 0 punya earned, and the Guruji's roster (once C-H3 exists) will agree. Answers were never stored client-side either (see M5), so nothing survives.

Exams solved this properly: per-question `PUT /v1/exams/attempts/:attemptId/answers/:questionId` (`exams.ts:1014`) plus a resumable attempt.

**Fix:** make start idempotent-resumable. If an attempt exists with `submitted_at IS NULL`, return that same `attempt_id` plus the questions (and any saved answers) with 200. 409 only when `submitted_at` is set. Split the list flag into `already_attempted` (= `!!att.submitted_at`) and `in_progress`, and give the app a "Resume quiz" state.

### C3 — Concurrent start throws an unhandled unique violation

The same block is a read-then-insert against `quiz_attempts_event_student_unique` (`schema/quizzes.ts:116`) with no conflict handling:

```ts
// quizzes.ts:759–779
const [existing] = await db.select(…)          // check
…
const [attempt] = await db.insert(quiz_attempts).values(…)   // then insert
```

A double-tap on "Start quiz", or a client retry, races the check and the second insert raises `23505` → 500 with a Postgres error surfaced through the error middleware. The submit paths right below it were carefully hardened against exactly this; start was not.

**Fix:** fold this into C2 — `onConflictDoNothing().returning()`, and on empty return re-select the existing attempt and resume it.

### C4 — Every quiz is blank in Hindi

The admin panel has **no Hindi field anywhere in the module**. `draftToPayload` (`QuizzesPage.tsx:283`) emits `{ question_en, options: [{ text_en }], correct_indices }` — no `question_hi`, no `text_hi`. `CreateEventDialog` posts `title_en` only (`:424`). `CreatePushDialog` the same (`:566`).

The mobile screens then render the Hindi column with no fallback:

```ts
// quizzes.tsx:305
<Title>{hi ? quiz.title_hi : quiz.title_en}</Title>
// QuizRunner.tsx:88
{qi + 1}. {hi ? q.question_hi : q.question_en}
// QuizRunner.tsx:114
{hi ? opt.text_hi : opt.text_en}
```

A Hindi-locale student therefore sees an untitled card, a numbered list of blank questions, and blank options. There is no way to answer. `queries.ts:934` also types `title_hi: string`, when the API returns `null` — so TypeScript never flagged it.

Exams already do this correctly one file away: `hi ? exam.title_hi ?? exam.title_en : exam.title_en` (`exams.tsx:690`).

This violates CLAUDE.md's bilingual rule directly: *"All user-facing content must have `_en` and `_hi` variants"* and *"All API responses include both variants; client renders based on `preferred_language`."*

**Fix, in this order:** (a) add `?? _en` at all three render sites and correct the `queries.ts` types to `string | null` — this alone makes Hindi usable today; (b) add Hindi inputs to `QuestionEditor`, `CreateEventDialog` and `CreatePushDialog`; (c) show a "Hindi missing" badge in the bank list so existing content gets backfilled rather than silently staying English-only.

---

## High

### H1 — AT21 violation: quiz Punya is inlined per event, outside the feature catalogue

`participation_points`, `win_points` and `completion_points` are free-form integers on the row (`schema/quizzes.ts:66-67`, `:141`; validated only as `0..10000` at `quizzes.ts:460`, `:935`) and awarded directly:

```ts
// quizzes.ts:877
if (event.participation_points > 0) { await awardPunya({ featureKey: "quiz", points: event.participation_points, … }) }
```

`punya_features` contains no `quiz` or `push_quiz` row — the catalogue is `attendance`, `niyam_completion`, `homework`, `homework_starred`, `exam_completion`, `exam_top_score` (`seed.ts:149-156`, migrations `0021_homework_punya_features.sql`, `0029_exam_punya.sql`). There is no FK on `punya_transactions.feature_key`, so the rows insert happily and are then **orphaned**: invisible to the admin Punya config page, no city-scoped override via `punya_configs`, no min/max clamp, and unreconcilable against the catalogue.

AT21 is explicit: *"point values resolve from `punya_features` at award time (city-scoped, global fallback), Redis-cached. Never inline a constant."* Exams model the correct shape — the per-exam column is an *override only*, defaults come from `resolveExamCompletionPoints` (`exam-points.ts:126`).

**Fix:** migration registering `quiz_participation`, `quiz_win`, `push_quiz_completion`; a `lib/quiz-points.ts` mirroring `exam-points.ts`; change the three columns to nullable overrides (`NULL` = feature default).

### H2 — No reversal or correction path exists anywhere in the module

Homework has `POST /submissions/:id/ungrade` (`homework.ts:1451`), Exams have `POST /:id/attempts/:attemptId/reset` (`exams.ts:679`), Niyam rejection reverses Punya and recomputes the streak (Q5). Quizzes have nothing — no PATCH, no DELETE, no reset, on any of questions, events, push quizzes or attempts.

The consequence is not theoretical. Nothing validates that `correct_indices` are actually correct, and there is no edit route, so a question authored with the wrong answer key **cannot be fixed**: every attempt is mis-scored, the wrongly-awarded win points stand, and the question cannot even be removed because `quiz_event_questions.question_id` is `onDelete: "restrict"` (`schema/quizzes.ts:83`).

**Fix:** `PATCH /questions/:id` (blocked once the question is linked to an event with attempts), `DELETE /questions/:id` → `is_active = false` (soft, per the DB conventions), `DELETE /events/:id` (blocked when attempts exist, or force-cancel + reverse per the AT25 pattern), and `POST /events/:id/attempts/:attemptId/reset` using `reversePunya` with the matching `quiz-award:{id}:participation:reversal` keys.

### H3 — No results surface for any admin persona

No route returns `quiz_attempts` or `push_quiz_attempts` to an admin. The admin page has two tabs — bank and events — and the event card shows only question count, points and the window (`QuizzesPage.tsx:697-717`).

A Guruji who just ran a live push quiz in class cannot see who answered or what anyone scored. That is the entire purpose of an in-class push quiz. Compare `GET /assignments/:id/submissions` (`homework.ts:848`) and `GET /:id/registrations` (`competitions.ts:230`).

**Fix:** `GET /v1/quizzes/events/:id/attempts` and `GET /v1/quizzes/push/:id/attempts` (scope-guarded, with per-question breakdown), a Results tab on the admin page, and a live monitor for the running push quiz.

### H4 — Both student-facing list routes are unindexed scans filtered in JavaScript

`/events/available` selects **every currently-open event platform-wide** with no scope predicate and no `LIMIT`, then filters in Node:

```ts
// quizzes.ts:641
.where(and(lte(quiz_events.start_at, now), gte(quiz_events.end_at, now)))
.orderBy(asc(quiz_events.end_at));
```

`/push/active` is worse in a different way — it caps at 40 rows *before* filtering:

```ts
// quizzes.ts:1062-1064
.where(gte(push_quizzes.expires_at, now)).orderBy(…started_at desc).limit(40);
```

so once 40 newer push quizzes are live anywhere in the country, a student silently stops seeing the one aimed at them. This is a correctness bug that only appears at scale, which is the worst kind.

**Fix:** push the scope predicate into SQL — `scope = 'national' OR (scope='city' AND city_id = ANY(city_ids)) OR …` with GIN indexes on `state_ids`/`city_ids`/`centre_ids`/`batch_ids` — then limit.

### H5 — The `quiz` notification kind is declared but never sent

`notify.ts:31` declares `"quiz"` in the notification kind union. `quizzes.ts` does not import `notify` at all and calls `notifyUsers` zero times.

So a live push quiz's only delivery mechanism is a 20-second poll (`queries.ts:1014`) on a screen the student must *already be looking at*. In a real class, a student on the home tab never learns a quiz started. The mobile file's own docblock claims *"a notification tap deep-links here too"* — that path does not exist.

Nothing fires when a scheduled event opens either, so national quiz events depend on students happening to check the tab.

**Fix:** `notifyUsers({ kind: "quiz", … })` to the target roster on push create and on event open (the latter via a scheduled job at `start_at`, or a `quiz.event_opening` cron alongside the frozen table).

### H6 — CLAUDE.md mandates a Socket.IO namespace that does not exist

CLAUDE.md's frozen namespace list includes `/push-quizzes/:quizId → participants of that push quiz`. The module is explicitly polling-only (`quizzes.ts:3`, `queries.ts:1013`).

Either implement it or amend CLAUDE.md. Leaving the two in disagreement is how the next implementer builds the wrong thing — and given H5, 20-second polling is a real product problem for a live in-class feature, not just a doc mismatch.

### H7 — `POST /v1/quizzes/questions` writes no audit entry

Event creation (`:538`) and push creation (`:1015`) call `auditFromReq`. Question creation does not. CLAUDE.md: *"All admin actions must write an audit entry."* Authoring the answer key for a scored, Punya-bearing question is precisely the action you want in an append-only log.

### H8 — A sanchalak sees and can reuse every question in their city, including other centres'

`allowedQuizScopes` correctly caps sanchalak/shikshak at `centre` and `batch` for *authoring* (`:168-173`). But the bank listing filters on the **legacy single `city_id` only**:

```ts
// quizzes.ts:411-417
whereClause = or(isNull(questions.city_id), inArray(questions.city_id, cityIds));
```

`primaryCityForTargets` sets `city_id` to the *city of the centre/batch* for centre- and batch-scoped questions (`:261-272`), so every centre-scoped question in Mumbai carries `city_id = Mumbai` and is visible to every sanchalak in Mumbai. They can then attach it to their own event — the event-create check only validates `q.city_id` against city scope (`:499-504`), never `centre_ids` / `batch_ids`.

Exams faced the same question and answered it explicitly with `EXAM_ADMIN_ROLES` (`contracts.ts:179`), with a comment telling future readers not to "fix" it back. Quizzes should make the same decision deliberately: either narrow the bank to a `QUIZ_ADMIN_ROLES` set, or filter on `centre_ids`/`batch_ids` for the narrower roles.

---

## Medium

**M1 — Grading total drifts from the snapshot.** `total_count` is written at start from the question list (`:777`) but grading recounts from the live link table at submit (`:837-843`). Today they can't diverge only because no edit route exists; add one (H2) and in-flight attempts silently re-score. Snapshot the question ids onto the attempt.

**M2 — `win_points` is all-or-nothing with no leaderboard.** `allCorrect = correctCount === totalCount` (`:849`). On a 20-question national quiz, effectively nobody wins. There is no threshold, no ranking, no tie-break, and nothing feeds `mv_monthly_leaderboard_city` despite it being in CLAUDE.md's frozen view list. Consider `win_threshold_percent` (default 100) and a per-event leaderboard.

**M3 — An empty answer key grades an empty answer as correct.** `sameIndexSet([], [])` → `true` (`:136-143`). New rows are protected by `.min(1)` (`:338`), imported/seeded rows are not. Add `if (q.correct_indices.length === 0) continue;` in both grading loops.

**M4 — A partial submit is accepted silently and is irreversible.** `QuizRunner` computes `allAnswered` (`:57`) and never uses it; Submit is enabled at `answeredCount > 0` (`:127`). One mistaken tap scores 1/10 forever, since re-submit is a 409. Add a confirm dialog when `answeredCount < questions.length`.

**M5 — No autosave, no timer.** Answers live only in React state (`QuizRunner.tsx:41`). Backgrounding the app loses everything — and with C2 unfixed, permanently. Push quizzes additionally have no countdown to `expires_at`; expiry mid-attempt produces a bare `Alert` and total loss of work.

**M6 — Push quizzes ignore age groups.** `push_quizzes` has no `age_groups` column, though both `questions` and `quiz_events` do. A centre-scoped push quiz hits Bal and Yuva identically.

**M7 — Students never see the correct answers.** `/submit` returns counts only; there is no per-question review and no route to fetch a past attempt. On a Jain religious-education platform the review screen *is* the teaching moment — this is the highest-value missing feature in the module, not merely a gap.

**M8 — No history.** `/events/available` returns only currently-open events (`:641`), so a completed quiz and its result vanish from the app at `end_at`.

**M9 — `is_active` on `questions` is dead.** Written (default true), returned to the admin panel, never filtered on, never settable. It reads as a working toggle and is not one.

**M10 — `difficulty` is unconstrained and unused.** Free-form `text` (`schema:35`) with `max(40)` validation, never set by the UI, never used for filtering or auto-assembly. Constrain to an enum and use it, or drop it.

**M11 — `shikshak_user_id` records whoever called the endpoint.** Set from `req.authUser!.id` (`:997`) behind `canAccessAdminPanel`, which includes `super_admin`. Rename to `created_by`, or gate push creation to shikshak/sanchalak and keep the name honest.

**M12 — Admin page has no pagination, search or filters.** Both lists fetch `?limit=200` (`:625-628`) against `clampLimit(…, 100, 300)`, and the event dialog renders the entire bank as a checkbox list. At a few hundred questions this is unusable; past 300 it silently truncates with no indication.

---

## Low

**L1** — `eventMatchesStudent` (`:314`) is marked `@deprecated` and is still the function called on both hot student paths (`:645`, `:747`). Delete it; call `quizMatchesStudent` directly.

**L2** — `cityScopeForUser` / `geoForCentre` are uncached; `/events/available` does 3–4 sequential round-trips before it has a single row.

**L3** — Every Zod failure is swallowed (`catch {}` at `:354`, `:476`, `:962`, `:1119`) and returns a generic message. The error envelope has a `details` array; other modules populate it.

**L4** — `primaryCityForTargets` stores `city_ids[0]` — an arbitrary member of a multi-select — as *the* city for all listing filters (`:265`). A Mumbai+Pune event is invisible to the Pune city_admin's list.

**L5** — `QuizzesPage.tsx` hardcodes `emerald-500` / `emerald-700` (`:253`, `:690`) instead of design tokens. CLAUDE.md: *"Never hardcode values."*

**L6** — 6 tests for a 1,239-line module (`quizzes.test.ts`, 380 lines) against 92 for homework. Uncovered: non-batch push scope, resume, concurrent start, cross-centre question reuse, Hindi fallback, window boundaries, zero-question events.

---

## Persona walkthrough

### super_admin / state_admin / city_admin

| | |
|---|---|
| Works | National→batch scope authoring with correct role caps (`allowedQuizScopes:168`); multi-select targeting; event + push audit entries. |
| Broken | Cannot fix a wrong answer key (H2). Cannot see a single result (H3). Multi-city events disappear from a peer admin's list (L4). Quiz Punya is outside the config page they use for every other feature (H1). |
| Missing | Results/leaderboard, edit + delete, question search and pagination, Hindi authoring (C4), bulk import, age-group and difficulty targeting in the UI. |

### sanchalak (centre head)

| | |
|---|---|
| Works | Capped at centre/batch scope for authoring. |
| Broken | Sees and can reuse every question in their city, including other centres' (H8). Push quizzes they start at centre scope cannot be submitted by anyone (C1). |
| Missing | Any view of what their centre's students scored; any notification that a Guruji started a push quiz. |

### shikshak (Guruji / Didi)

| | |
|---|---|
| Works | Can start a batch-scoped push quiz with inline questions. |
| Broken | This is the persona C1 hurts most — anything above batch scope is dead on submit. |
| Missing | **A live monitor.** No answers view, no who-has-submitted count, no per-question breakdown, no ability to end a quiz early or extend it, no results after the fact (H3). The feature currently ends the moment they tap Start. Also: no notification reaches students who aren't already on the quizzes tab (H5), so in-class delivery depends on the Guruji telling everyone to open the app and wait up to 20 seconds. |

### parent (Abhivaavak)

| | |
|---|---|
| Works | Child switcher on the quizzes screen; ownership correctly enforced via `ownedStudent` (`:75`). |
| Broken | Sees "Completed" for a quiz their child never actually took (C2). |
| Missing | Everything else. No quiz results in the progress report (`progress.ts` covers homework only), no history, no notification when a quiz opens, no visibility of what was answered wrong. Homework got a combined cross-child feed and progress-report integration; quizzes got neither. |

### student (13+, via student view)

| | |
|---|---|
| Works | Clean take-flow, multi-select answering, immediate score, punya pill. |
| Broken | **Blank quiz in Hindi (C4).** Locked out after any interruption (C2). Accidental partial submit is permanent (M4). Push quiz expiry mid-attempt destroys the work (M5). |
| Missing | Answer review (M7), history (M8), resume, timer, upcoming-quiz preview. |

### guest

Correctly excluded — `router.use(requireAuth)` (`:45`). Nothing to change. Worth noting there is no public marketing surface for quizzes the way there is for exams (`pages/public/ExamsPage.tsx`), if that is wanted.

---

## What looks good

- The submit-claim pattern in both flows (`:860`, `:1189`) — advisory lock, conditional `setWhere`/`isNull` claim, award composed into the same transaction, attempt-scoped idempotency key. The comments explain *why*, which is exactly right for code this subtle.
- Student-safe question loading — `loadEventQuestionsForStudent` (`:693`) and the push equivalent (`:1074`) never select `correct_indices`. No answer key ever crosses the wire to a student.
- `sameIndexSet` grading is order-independent and set-based, matching the multi-select UI.
- `authorizeQuizTargets` (`:179`) validates existence *and* scope for every target type, and checks `deleted_at` on centres.
- `QuizRunner` is properly presentational — no grading logic client-side.
- Scope role caps (`allowedQuizScopes`) mirror the same function in the admin UI, so the picker never offers a scope the API will reject.

---

## Recommended order of work

1. **C4a** — `?? _en` fallbacks + `queries.ts` type fix. One-line-per-site; unblocks Hindi users immediately.
2. **C1** — push submit scope check. Self-contained, no schema change.
3. **C2 + C3** — resumable, conflict-safe start; split `already_attempted` / `in_progress`; app "Resume" state.
4. **H1** — `quiz-points.ts` + migration registering the three feature keys; columns become nullable overrides.
5. **H4** — SQL scope predicates + GIN indexes on the target arrays (do before H3, which will query the same shapes).
6. **H3** — attempts endpoints + admin Results tab + push live monitor.
7. **H2** — edit/delete/reset with `reversePunya`.
8. **H5 / H6** — notifications, then the Socket.IO decision (implement or amend CLAUDE.md).
9. **C4b/c** — Hindi authoring fields + missing-Hindi badge.
10. **H7, M1–M12, L1–L6** — as capacity allows; M7 (answer review) is worth pulling forward on product value alone.

Prompts for steps 1–7 are in [`QUIZ_FIX_CURSOR_PROMPTS.md`](./QUIZ_FIX_CURSOR_PROMPTS.md).

---

## Note on stack drift

As with the exams review: this repo is Express + `apps/api-server` + `lib/db`, while CLAUDE.md specifies NestJS + `apps/api` + `packages/shared`. That gap is out of scope here and is not counted against the module — but the AT21, audit, bilingual, error-code and design-token rules cited above are stack-independent and do apply.
