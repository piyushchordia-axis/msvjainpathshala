# Quiz module — Cursor fix prompts

Companion to [`QUIZ_MODULE_REVIEW.md`](./QUIZ_MODULE_REVIEW.md). Each block is a self-contained prompt — paste one at a time into Cursor (Cmd-K / Composer, Agent mode), verify, commit, then move to the next. They are ordered by dependency; running them out of order will produce conflicts on `quizzes.ts`.

Every prompt assumes Cursor has `CLAUDE.md` in context. If it doesn't, prefix with:

> Read `CLAUDE.md` (AT21, AT23, bilingual rules, audit rules, error-code enum, design tokens) before making any change.

---

## 1 — Hindi fallback (C4a)

```
Fix the blank-in-Hindi quiz bug. Quiz content is authored English-only, and the quiz
screens render the Hindi column with no fallback, so a Hindi-locale student sees blank
titles, blank questions and blank options.

In apps/jain-pathshala-mobile/lib/queries.ts:
- QuizEventRow.title_hi is typed `string` but the API returns null. Change to `string | null`.

In apps/jain-pathshala-mobile/app/quizzes.tsx:
- Line ~305: `{hi ? quiz.title_hi : quiz.title_en}` → `{hi ? quiz.title_hi ?? quiz.title_en : quiz.title_en}`
- ResultCard: `{hi ? result.titleHi : result.titleEn}` → same `??` fallback.

In apps/jain-pathshala-mobile/components/QuizRunner.tsx:
- Line ~88: `{hi ? q.question_hi : q.question_en}` → `{hi ? q.question_hi ?? q.question_en : q.question_en}`
- Line ~114: `{hi ? opt.text_hi : opt.text_en}` → `{hi ? opt.text_hi ?? opt.text_en : opt.text_en}`

Match the pattern already used in apps/jain-pathshala-mobile/app/exams.tsx:690.

Then grep the whole mobile app for `hi ? ` followed by a `_hi` field with no `??` and fix
any other sites the same way. Report which files you changed.

Run `pnpm typecheck`.
```

---

## 2 — Push quiz submit scope check (C1)

```
Read CLAUDE.md, then fix the push quiz submit authorization bug in
apps/api-server/src/routes/v1/quizzes.ts.

POST /v1/quizzes/push/:id/submit gates on `student.batch_id !== pq.batch_id` (line ~1145).
Push quizzes support national/state/city/centre/batch scope, and for every non-batch scope
`push_quizzes.batch_id` is null (line ~984). Two bugs result:
  (a) students in centre/city/state/national push quizzes always get 403 after answering;
  (b) a student with batch_id = null passes `null !== null` and can submit ANY non-batch
      push quiz in the country.

Fix:
- Widen the push_quizzes select in the submit handler to include scope, state_ids, city_ids,
  centre_ids, batch_ids and batch_id (mirror the select in GET /push/active, line ~1048).
- Replace the batch equality check with:
    const studentGeo = await geoForCentre(student.centre_id);
    if (!quizMatchesStudent(pq, student, studentGeo.city_id, studentGeo.state_id)) {
      fail(res, 403, "ERR_FORBIDDEN", "This quiz is not available for this student.");
      return;
    }
  Keep the existing expiry check after it.
- Delete the now-unused `@deprecated eventMatchesStudent` wrapper (line ~314) and change its
  two callers (lines ~645, ~747) to call quizMatchesStudent directly.

Add tests in apps/api-server/test/quizzes.test.ts:
- a centre-scoped push quiz can be submitted by a student at that centre (currently 403s);
- a national-scoped push quiz can be submitted by a batched student;
- a student outside the targeted centre gets 403;
- a student with batch_id = null gets 403 on a centre-scoped push quiz aimed elsewhere.

Run `pnpm typecheck` and `pnpm test -- quizzes`.
```

---

## 3 — Resumable, conflict-safe quiz start (C2 + C3)

```
Read CLAUDE.md, then make quiz event attempts resumable in
apps/api-server/src/routes/v1/quizzes.ts.

Today POST /events/:id/start 409s on ANY existing attempt row (line ~764), even one with
submitted_at IS NULL, and /events/available reports `already_attempted = !!att` (line ~665)
ignoring submitted_at. So any interruption — app backgrounded, network drop, back gesture —
locks the student out of that quiz permanently while the app shows it as "Completed".
The start handler is also a read-then-insert against quiz_attempts_event_student_unique with
no conflict handling, so a double-tap raises 23505 → 500.

Fix POST /events/:id/start:
- Replace the read-then-insert with a single guarded insert:
    .insert(quiz_attempts).values({...}).onConflictDoNothing({
      target: [quiz_attempts.quiz_event_id, quiz_attempts.student_id],
    }).returning({ id: quiz_attempts.id })
- On empty returning, re-select the existing attempt.
    - If submitted_at IS NOT NULL → 409 ERR_ALREADY_SUBMITTED (not ERR_ALREADY_ATTEMPTED).
    - If submitted_at IS NULL → return 200 with the SAME attempt_id, the questions, and the
      persisted `answers` jsonb so the client can restore selections. Add `resumed: true`.
- Keep the age-group, scope and window checks ahead of the insert, unchanged.

Fix GET /events/available:
- `already_attempted` becomes `!!att?.submitted_at`.
- Add `in_progress: !!att && !att.submitted_at`.

In apps/jain-pathshala-mobile:
- queries.ts — add `in_progress: boolean` to QuizEventRow and `resumed?: boolean` +
  `answers?: Record<string, number[]>` to QuizStartResponse.
- app/quizzes.tsx — `done` stays `already_attempted`. When `in_progress` is true, show a
  "Resume quiz" / "प्रश्नोत्तरी जारी रखें" button instead of "Start quiz", and do not apply
  the dimmed/completed styling.
- components/QuizRunner.tsx — accept an optional `initialAnswers` prop and seed useState with it.

Add tests: start twice in a row returns the same attempt_id with resumed: true; start after
submit returns 409 ERR_ALREADY_SUBMITTED; two concurrent starts both succeed with the same
attempt_id and no 500; available reports in_progress for an unsubmitted attempt.

Run `pnpm typecheck` and `pnpm test -- quizzes`.
```

---

## 4 — AT21: quiz Punya from the feature catalogue (H1)

```
Read CLAUDE.md AT21 and apps/api-server/src/lib/exam-points.ts, then bring quiz Punya into
the feature catalogue. Today participation_points / win_points / completion_points are
free-form ints inlined on the row and awarded directly, and punya_features has no quiz key —
so quiz awards are invisible to the admin Punya config page, have no city-scoped override,
and no min/max clamp.

Create lib/db/migrations/00NN_quiz_punya.sql (next free number) mirroring 0029_exam_punya.sql:
- Register three feature keys, INSERT … WHERE NOT EXISTS:
    quiz_participation   'Quiz participation'    min 0 max 5
    quiz_win             'Quiz win'              min 0 max 25
    push_quiz_completion 'Push quiz completion'  min 0 max 5
- ALTER quiz_events ALTER COLUMN participation_points DROP NOT NULL, DROP DEFAULT;
  same for win_points and push_quizzes.completion_points. NULL now means "use feature default".
Add the same three rows to the punya_features block in lib/db/src/seed.ts (~line 149).
Update lib/db/src/schema/quizzes.ts to make those three columns nullable.

Create apps/api-server/src/lib/quiz-points.ts modelled exactly on exam-points.ts:
- export QUIZ_PARTICIPATION_FEATURE_KEY, QUIZ_WIN_FEATURE_KEY, PUSH_QUIZ_COMPLETION_FEATURE_KEY
- resolveQuizParticipationPoints(cityId, eventOverride)
- resolveQuizWinPoints(cityId, eventOverride)
- resolvePushQuizCompletionPoints(cityId, pushOverride)
- clearQuizPointsCache() for tests
Same city override → global config → punya_features.max_points chain, same Redis + memory cache.

In apps/api-server/src/routes/v1/quizzes.ts:
- In the events submit transaction, resolve points via the helpers using the student's city
  (geoForCentre) instead of reading event.participation_points / event.win_points directly.
- Same for the push submit transaction.
- Change the awardPunya featureKey strings from "quiz" / "push_quiz" to the new keys.
- In createEventSchema / createPushSchema, make the point fields `.optional()` (null = default)
  rather than `.default(0)`.

IMPORTANT: existing punya_transactions rows carry feature_key 'quiz' and 'push_quiz'. Do not
rewrite them; leave the historical ledger intact and note this in the migration comment.

Add tests proving: an event with NULL participation_points awards the punya_features default;
a city-scoped punya_configs row overrides it; an explicit 0 override disables the award.

Run `pnpm db:migrate`, `pnpm typecheck`, `pnpm test -- quizzes`.
```

---

## 5 — SQL scope predicates for the student list routes (H4)

```
Read CLAUDE.md, then fix the two student-facing quiz list routes in
apps/api-server/src/routes/v1/quizzes.ts, which currently scan and filter in JavaScript.

GET /events/available (line ~621) selects EVERY currently-open event platform-wide with no
scope predicate and no LIMIT. GET /push/active (line ~1048) caps at 40 rows BEFORE filtering,
so a national push quiz becomes invisible once 40 newer live quizzes exist anywhere.

Fix:
- Add a shared SQL predicate builder that takes { centreId, batchId, cityId, stateId, ageGroup }
  and returns a drizzle `sql` condition equivalent to quizMatchesStudent:
      scope = 'national'
   OR (scope = 'state'  AND :stateId  = ANY(state_ids))
   OR (scope = 'city'   AND :cityId   = ANY(city_ids))
   OR (scope = 'centre' AND :centreId = ANY(centre_ids))
   OR (scope = 'batch'  AND :batchId  = ANY(batch_ids))
  plus the age_groups check (empty array = all ages) where the table has that column.
  Keep quizMatchesStudent as the single-row authority used by /start and /submit — the SQL
  predicate must stay behaviourally identical to it; add a test asserting they agree.
- Apply it to both routes, then ORDER BY and LIMIT (100 for events, 1 for push).

Create lib/db/migrations/00NN_quiz_scope_indexes.sql adding GIN indexes:
  quiz_events (state_ids, city_ids, centre_ids, batch_ids)
  push_quizzes (state_ids, city_ids, centre_ids, batch_ids)
  questions (centre_ids, batch_ids)
plus a btree on quiz_events (start_at, end_at) and push_quizzes (expires_at).

Add a test that creates 45 unrelated live push quizzes plus one targeted at the student, and
asserts the targeted one is still returned.

Run `pnpm db:migrate`, `pnpm typecheck`, `pnpm test -- quizzes`.
```

---

## 6 — Admin results + live push monitor (H3)

```
Read apps/api-server/src/routes/v1/homework.ts (GET /assignments/:id/submissions, line ~848)
for the scoping pattern, then add the missing results surface to the quiz module. Today no
route returns quiz_attempts or push_quiz_attempts to an admin — a Guruji who runs a live push
quiz cannot see who answered or what they scored.

In apps/api-server/src/routes/v1/quizzes.ts add:

GET /v1/quizzes/events/:id/attempts   (requireAdminPanel)
  - 403 if the event is outside the caller's scope (reuse cityScopeForUser / resolveAdminScope).
  - Returns: student id, full_name, centre name, batch name, started_at, submitted_at,
    correct_count, total_count, score, points_awarded (sum of punya_transactions where
    source_entity_id = attempt id), and per-question correctness derived from
    quiz_attempts.answers vs questions.correct_indices.
  - Plus meta: attempted_count, submitted_count, eligible_count, average_score.

GET /v1/quizzes/push/:id/attempts     (requireAdminPanel)
  - Same shape for push_quiz_attempts / push_quiz_questions.
  - Include `is_live: expires_at > now()` so the client can poll.

GET /v1/quizzes/push                  (requireAdminPanel)
  - Scoped list of push quizzes (live first), with question_count and submitted_count, so the
    admin page can list them at all — there is currently no way to see past push quizzes.

Envelope: ok(res, { items }, { count }) as elsewhere. Error codes from the shared enum only.

In apps/jain-pathshala/src/pages/admin/QuizzesPage.tsx:
- Add a third tab "Push quizzes" listing GET /v1/quizzes/push.
- Make event cards and push cards clickable → a results panel rendering the attempts table
  with a per-question correct/incorrect breakdown.
- When a push quiz is live, poll its attempts every 5s and show a submitted/eligible counter.
- Use design tokens, not emerald-*; sentence case for buttons and headings.

Add tests: a sanchalak gets 403 on another centre's event attempts; the roster returns one row
per attempt with correct per-question flags; average_score matches the attempts.

Run `pnpm typecheck` and `pnpm test -- quizzes`.
```

---

## 7 — Edit, delete and attempt reset with Punya reversal (H2)

```
Read CLAUDE.md (soft-delete conventions, audit rules), apps/api-server/src/lib/punya.ts
(reversePunya), apps/api-server/src/routes/v1/homework.ts (POST /submissions/:id/ungrade,
line ~1451) and exams.ts (POST /:id/attempts/:attemptId/reset, line ~679).

The quiz module has NO correction path. A question authored with the wrong correct_indices
cannot be edited, cannot be deleted (quiz_event_questions.question_id is onDelete: "restrict"),
and the Punya it wrongly awarded cannot be reversed.

Add to apps/api-server/src/routes/v1/quizzes.ts:

PATCH /v1/quizzes/questions/:id            (requireAdminPanel, scope-checked)
  - Editable: question_en/_hi, options, correct_indices, difficulty, age_groups, topic, is_active.
  - 409 ERR_QUESTION_IN_USE if the question is linked to any event that has attempts. Editing an
    answer key under a graded attempt silently corrupts scores — block it and tell the admin to
    deactivate and re-author instead.
  - Re-validate correct_indices against options.length.
  - Audit entry.

DELETE /v1/quizzes/questions/:id           (requireAdminPanel, scope-checked)
  - Soft delete: is_active = false. Never hard-delete. Audit entry.

DELETE /v1/quizzes/events/:id              (requireAdminPanel, scope-checked)
  - Blocked when submitted attempts exist unless `force: true` is passed.
  - With force: reverse every awarded transaction (see reset below), delete the attempts and
    the quiz_event_questions links, then delete the event. Audit entry recording the count.

POST /v1/quizzes/events/:id/attempts/:attemptId/reset   (requireAdminPanel, scope-checked)
  - In one transaction: reversePunya for `quiz-award:{attemptId}:participation` and
    `quiz-award:{attemptId}:win` using idempotencyKey `<originalKey>:reversal`, then clear
    submitted_at/score/correct_count/answers so the student can retake.
  - Reverse only what was actually awarded — read punya_transactions by idempotency_key rather
    than assuming, and resolve the amount from the ledger row, not from the event columns
    (which may have changed since, or be NULL after prompt 4).
  - Audit entry.

Add GET /v1/quizzes/questions filtering: `?is_active=true|false|all` (default true), so the
soft-delete is visible in the admin panel. Add the corresponding filter + edit/delete actions
to apps/jain-pathshala/src/pages/admin/QuizzesPage.tsx.

Register any new error codes in lib/api-zod/src/errors.ts — never return raw strings.

Add tests: editing a question linked to an attempted event 409s; reset reverses exactly the
awarded points and is idempotent when called twice; reset then re-take awards again; deleting
an event with attempts requires force and leaves the ledger balanced.

Run `pnpm typecheck` and `pnpm test -- quizzes`.
```

---

## After these seven

The review's remaining items — H5/H6 (notifications and the Socket.IO decision), C4b/c (Hindi authoring fields), H7 (question audit), M1–M12, L1–L6 — are independent of each other and of the above. Two worth pulling forward on product value rather than severity:

- **M7 — student answer review.** Once prompt 6 exists server-side, exposing a read-only per-question review to the student who owns the attempt is a small addition and is the single most valuable missing feature in the module.
- **H5 — push quiz notification.** Without it, the live in-class feature depends on students already sitting on the quizzes tab.
