# Code review — Quiz module (v2)

**Date:** 2026-08-15
**Supersedes:** [`QUIZ_MODULE_REVIEW.md`](./QUIZ_MODULE_REVIEW.md) (2026-08-05)
**Structure:** persona → navigation → action → observed vs expected

## Scope reviewed

| File | Lines | Δ since v1 |
|---|---|---|
| `apps/api-server/src/routes/v1/quizzes.ts` | 1,995 | +756 |
| `apps/api-server/src/lib/quiz-points.ts` | 163 | **new** |
| `apps/api-server/src/lib/quiz-scope.ts` | 161 | **new** |
| `apps/api-server/test/quizzes.test.ts` | 1,543 | +1,163 |
| `apps/jain-pathshala/src/pages/admin/QuizzesPage.tsx` | 1,138 | +415 |
| `apps/jain-pathshala-mobile/app/quizzes.tsx` | 387 | +17 |
| `apps/jain-pathshala-mobile/components/QuizRunner.tsx` | 137 | +5 |
| `apps/jain-pathshala-mobile/lib/queries.ts` (quiz hooks) | 1846–1953 | — |
| `lib/db/src/schema/quizzes.ts` | 190 | +2 |
| `lib/db/migrations/0031_quiz_punya.sql`, `0032_quiz_scope_indexes.sql` | — | **new** |

**Also read for cross-checks:** `lib/api-zod/src/contracts.ts`, `lib/api-zod/src/errors.ts`, `apps/api-server/src/lib/scope.ts`, `apps/api-server/src/lib/punya.ts`, `apps/jain-pathshala/src/components/admin/sidebar-nav.ts`, `apps/jain-pathshala-mobile/components/QuickActions.tsx`, `apps/jain-pathshala-mobile/app/_layout.tsx`, `apps/jain-pathshala-mobile/app/shikshak/punya.tsx`, `apps/api-server/src/routes/v1/progress.ts`.

---

## Summary

Ten days of work closed most of the v1 list, and closed it well. The resumable start (`quizzes.ts:1328-1368`), the AT21 points indirection (`quiz-points.ts`), the SQL scope predicate (`quiz-scope.ts`), the results rosters, the reset/force-delete correction path with Punya reversal, and the mobile `?? _en` fallbacks are all genuinely done — and the test file grew from 6 cases to 23, covering resume, concurrent start, non-batch push submit, age gating, and both reversal paths.

Three things went wrong in the process.

**The correction path shipped without a write gate.** `quizTargetsInAdminScope` was written to answer "may this admin *view results*" and is now the sole authorization check on `PATCH`/`DELETE`/reset/force-delete as well. It returns `true` unconditionally for national scope and existentially for state/city. Because `canAccessAdminPanel` admits shikshak and sanchalak, **any Guruji can rewrite the answer key of a national question, read the national attempt roster, reverse any student's Punya, and hard-delete a national quiz event.** The `allowedQuizScopes` role cap that blocks them from *creating* those objects is never re-applied to *mutating* them. No test covers any of it.

**The nullable-points migration was not carried through to either client.** `participation_points = null` now means "pay the platform default" (5 / 25 / 5 per migration `0031`). The mobile list reads the raw column, so a quiz that pays 30 Punya renders an explicit **"Practice / अभ्यास"** badge saying it pays nothing — and `points_earned` (`quizzes.ts:1236-1240`) reads the same raw column instead of the resolver, so the earned pill vanishes seconds after the result screen showed `+30`. The admin panel cannot send `null` at all (`Number('') || 0` → `0` = *disabled*), so every quiz authored on the web is permanently detached from `punya_features`.

**The admin panel's option editor stores the wrong correct answer.** `draftToPayload` (`QuizzesPage.tsx:320-326`) filters blank options out of `options` but derives `correct_indices` from the *unfiltered* array. One blank option above a ticked one silently shifts the answer key, passes the server's range check, and mis-grades every student who takes the quiz.

Separately, and a product problem rather than a bug: **the Guruji/Didi push quiz (SPEC §15.2) has no UI on any surface.** `sidebar-nav.ts:79` gates `/admin/quizzes` at `min: 'city_admin'`, and `/quizzes` appears only in `PARENT_ACTIONS` on mobile. The persona the feature was designed for cannot reach it — while the same persona *is* admitted by the API to the six routes they should not touch. The gate is on exactly the wrong side.

**Verdict: Request changes.** C1–C3 are release blockers. C1 is a security issue and should be fixed before the module is exposed to any shikshak account.

---

## Findings index

Severity is by blast radius × likelihood, not by how hard the fix is.

### Critical

| ID | Finding | Where |
|---|---|---|
| **C1** | Shikshak/sanchalak can read, alter and destroy national/state/city quiz data | `quizzes.ts:268-331` + 6 call sites |
| **C2** | A blank option silently shifts `correct_indices`; the wrong answer is stored | `QuizzesPage.tsx:320-326` |
| **C3** | Null point overrides are read as zero, so a scoring quiz is labelled "Practice" and earned Punya disappears | `quizzes.tsx:304,348-356`; `quizzes.ts:1236-1240` |

### High

| ID | Finding | Where |
|---|---|---|
| **H1** | Per-quiz point overrides bypass the `punya_features` min/max bounds (AT21) | `quiz-points.ts:137,149,161`; `quizzes.ts:790-791` |
| **H2** | Admin panel can never send `null` — blank field means *disabled*, and 5/10/15 are inlined constants | `QuizzesPage.tsx:507-508,540-541,634,667` |
| **H3** | Delete and Reset fire with no confirmation; plain Delete silently destroys in-progress attempts | `QuizzesPage.tsx:1082,868-875`; `quizzes.ts:1104-1109` |
| **H4** | Editing a question in the admin panel wipes all Hindi option text | `QuizzesPage.tsx:425-429,448-453`; `quizzes.ts:722-724` |
| **H5** | No Hindi input anywhere in the admin panel; no missing-Hindi indicator | `QuizzesPage.tsx:258-262,291,564` |
| **H6** | "Resume quiz" restores nothing — no endpoint ever persists partial answers | `quizzes.ts:1465` (only write); `quizzes.tsx:147` |
| **H7** | Zero client-side persistence; background/kill/Cancel destroys all answers with no confirm | `QuizRunner.tsx:42-44,134` |
| **H8** | Submit unlocks at one answered question, no confirmation, irreversible | `QuizRunner.tsx:60,69,131` |
| **H9** | No countdown; push polling is paused during the attempt, so expiry is silent → dead-end 422 | `quizzes.tsx:121-126`; `quizzes.ts:1899-1902` |
| **H10** | Still zero notifications — `notify` is not imported; the mobile docblock claims a path that does not exist | `quizzes.ts` (no `notify` import); `quizzes.tsx:6-8` |
| **H11** | `POST /quizzes/questions` writes no audit entry | `quizzes.ts:555-605` |
| **H12** | Push quizzes have no correction path at all — no PATCH, DELETE, reset, or end-early | `quizzes.ts` (routes absent) |
| **H13** | `GET /push` applies the scope filter *after* the SQL limit | `quizzes.ts:1557-1583` |
| **H14** | Attempt rosters are N+1 and unbounded; the 5s admin poll multiplies it | `quizzes.ts:995,1827`; `QuizzesPage.tsx:773-779` |
| **H15** | Question bank still leaks across centres within a city | `quizzes.ts:620-632,829-834` |
| **H16** | Mobile collapses 403/409/422 into one generic, English-only alert | `queries.ts:1901,1910,1951` |
| **H17** | SPEC §15.2 push quiz is unreachable by its own persona on every surface | `sidebar-nav.ts:79`; `QuickActions.tsx:31-60` |

### Medium

| ID | Finding | Where |
|---|---|---|
| M1 | "Inactive" bank filter silently empties the event-create question picker | `QuizzesPage.tsx:904,911,948` |
| M2 | Deactivated questions are a one-way door — no Reactivate button | `QuizzesPage.tsx:467,1042-1050` |
| M3 | Inactive questions can still be attached to new events (no `is_active` check) | `quizzes.ts:821-834` |
| M4 | `GET /push/active` returns at most one quiz — overlapping push quizzes are unreachable | `quizzes.ts:1724-1725` |
| M5 | Push quizzes still have no `age_groups` column | `schema/quizzes.ts:123-144` |
| M6 | `countEligibleStudents` ignores `age_groups`, inflating the denominator | `quizzes.ts:334-384` |
| M7 | Students never see which answers were wrong; admins do | `quizzes.ts:1516-1523` vs `:980-983` |
| M8 | No history — quizzes vanish at `end_at` / `expires_at` | `quizzes.ts:1190-1191,1708` |
| M9 | Quiz results still absent from the student progress report | `progress.ts` (no quiz reference) |
| M10 | Mobile types `title_hi` / points as non-nullable, so the compiler can't catch a dropped `??` | `queries.ts:1853,1856-1857,1919` |
| M11 | `age_groups` and `difficulty` cannot be set from the admin panel; `difficulty` is displayed anyway | `QuizzesPage.tsx:363-369,1023` |
| M12 | No pagination, search or filters; `limit=200` truncates silently | `QuizzesPage.tsx:911-913,980` |
| M13 | `datetime-local` is read in the browser's timezone with no IST label | `QuizzesPage.tsx:538-539,588,1079-1080` |
| M14 | Shikshak Punya screen still maps the legacy `quiz` feature key | `app/shikshak/punya.tsx:27` |
| M15 | `ERR_WINDOW_CLOSED` catalogue copy is exam-specific but quizzes reuse the code | `errors.ts:203-206` |
| M16 | Client-side limits missing, so API caps surface as opaque 422s | `QuizzesPage.tsx:278,523,649` |
| M17 | Grading total still recounts at submit rather than using the start snapshot | `quizzes.ts:1334` vs `:1424-1430` |
| M18 | Empty answer key grades an empty answer as correct (legacy/seeded rows) | `quizzes.ts:1432-1435,1922-1925` |

### Low

| ID | Finding | Where |
|---|---|---|
| L1 | Push-quiz cards are mouse-only (no `role`, `tabIndex`, `onKeyDown`) | `QuizzesPage.tsx:1096-1105` |
| L2 | Correct-answer toggle has a static duplicated label and never announces state | `QuizzesPage.tsx:298-304` |
| L3 | Per-question result badges announce "Q1 Q2 Q3" with no outcome | `QuizzesPage.tsx:848-859` |
| L4 | Icon-only remove buttons have no accessible name | `QuizzesPage.tsx:307-309,714-716` |
| L5 | `window.confirm` for force-delete — unstyled and untranslatable | `QuizzesPage.tsx:934-940` |
| L6 | Admin poll never stops after an error; no backoff | `QuizzesPage.tsx:761-779` |
| L7 | Multi-city event stores only `city_ids[0]`, so a peer city_admin never sees it | `quizzes.ts:519-530,893` |
| L8 | Zod failures swallowed; the envelope's `details[]` is never populated | `quizzes.ts:563,806,1612,1862` |
| L9 | `""` passes Hindi validation and defeats the `??` fallback | `quizzes.ts:536,544,778` |
| L10 | `resumed` flag returned by the API and read nowhere | `queries.ts:1872` |
| L11 | `/admin/quizzes` route has no role guard while the nav does | `AdminRoutes.tsx:110` vs `sidebar-nav.ts:79` |
| L12 | `expires_at` has no upper bound — a push quiz can be set to expire in 2050 | `quizzes.ts:1554` |

---

## Persona walkthrough

The requested spine. Each row is one concrete journey. **Ref** links to the findings index.

### 1. Guest 🌐

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Public website | Browse quizzes | Nothing exists — `router.use(requireAuth)` (`quizzes.ts:54`) covers every route, and there is no public quiz page | ✅ Correct. Worth a product decision only: exams have `pages/public/ExamsPage.tsx`; quizzes have no marketing surface | — |

**Verdict: clean.** No changes needed.

---

### 2. Student (13+, student view) 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home → Quick actions → **Quizzes** | Open the list | Works. `/quizzes` is registered (`_layout.tsx:108`) and reachable via `PARENT_ACTIONS` (`QuickActions.tsx:37`) | ✅ | — |
| Quizzes list | Read a quiz card in Hindi | Falls back to English when `title_hi` is null — all five render sites carry `?? _en` | ✅ **v1 C4 fixed.** But `""` defeats `??` (`quizzes.ts:778` has no `.min(1)`), and no web-authored quiz has Hindi at all | L9, H5 |
| Quizzes list | Read the points on a card | A quiz with `participation_points = null, win_points = null` **pays 30 Punya** but renders no points pills and an explicit **"Practice / अभ्यास"** badge (`quizzes.tsx:304,348-356`) | Resolve through `resolveQuizParticipationPoints` / `resolveQuizWinPoints`, or return the resolved value from the API. Render `null` as the default, not as zero | **C3** |
| Card → **Start quiz** | Answer 3 of 10, background the app | Every answer is gone. State lives only in `useState` (`QuizRunner.tsx:42-44`); no MMKV, no AsyncStorage, no server autosave — `answers` is written exactly once, inside the submit transaction (`quizzes.ts:1465`) | Persist to MMKV keyed by `attempt_id` on each toggle; rehydrate on mount; clear on submit | **H7** |
| Card → **Resume quiz** | Tap Resume after an interruption | Blank form. The pill and CTA are correctly distinct (`quizzes.tsx:301-302,363-371`) and the API returns `resumed: true, answers` (`:1359-1364`) — but an in-progress row always has `answers = {}` by construction, so there is nothing to restore | Add a partial-save endpoint (exams have `PUT /attempts/:id/answers/:qid`), or rehydrate locally, or relabel to "Reopen" and warn | **H6** |
| In the runner | Tap **Cancel** | All answers discarded, no confirmation (`quizzes.tsx:236`; `QuizRunner.tsx:134`) | Confirm before discarding | H7 |
| In the runner | Tap **Submit** after 1 of 10 | Accepted. `disabled` is `answeredCount === 0` (`QuizRunner.tsx:131`); `allAnswered` (`:60`) is computed and used only to colour a pill. Scores 1/10 forever — re-submit is 409 | Confirm when `answeredCount < questions.length`, stating that submission is final | **H8** |
| In the runner (push quiz) | Keep answering past `expires_at` | Silent. Polling is deliberately paused during an attempt (`quizzes.tsx:121-126`, comment and all), so the student never learns it expired; Submit returns 422 `ERR_WINDOW_CLOSED` and the runner stays mounted with unsubmittable answers and no way out | Pass `expires_at` / `end_at` into the runner, show a countdown, warn at 60s, auto-submit at zero | **H9** |
| Submit fails (403 / 409 / 422) | Read the error | One alert: *"Could not submit quiz"* — English only, no `error.code` branching (`queries.ts:1910`). `ERR_NOT_ELIGIBLE`, `ERR_WINDOW_CLOSED` and `ERR_ALREADY_SUBMITTED` are indistinguishable. `ERR_WINDOW_CLOSED`'s catalogue copy says *"The exam window is closed"* | Branch on `error.code` with bilingual copy; add a quiz-specific `ERR_WINDOW_CLOSED` variant or a per-module override | **H16**, M15 |
| Result screen → Back | See what was earned | `+30 punya earned` on the result card, then the list refetches and the earned pill **disappears** — `points_earned` (`quizzes.ts:1236-1240`) reads the raw override columns instead of the resolver | Compute `points_earned` via the AT21 helpers, or return `pointsAwardedForAttempt` (already implemented at `:387-407`) | **C3** |
| Result screen | Review which answers were wrong | Impossible. Submit returns counts only (`quizzes.ts:1516-1523`). `question_results` is computed — but only on the two `requireAdminPanel` rosters (`:980-983`, `:1811-1814`) | Return `question_results` to the student. On a religious-education platform the review screen *is* the teaching moment | M7 |
| Quizzes list, next week | Find last week's quiz | Gone. `/events/available` filters `gte(end_at, now)` (`:1190-1191`); the result view is in-memory only | `GET /events/history?student_id=` with `question_results` | M8 |
| Live push quiz | Learn one started while on the home tab | Never. 20s poll (`queries.ts:1942`) only while `/quizzes` is mounted and idle. No notification is enqueued anywhere — `quizzes.ts` does not import `notify`, and `POST /push` only inserts rows and writes audit. The mobile docblock's *"a notification tap deep-links here too"* (`quizzes.tsx:6-8`) describes a path that does not exist | Enqueue on push create and on event open; implement the `/push-quizzes/:quizId` namespace CLAUDE.md already specifies | **H10** |

---

### 3. Parent — Abhivaavak 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home → Quick actions → **Quizzes** | Switch child, take a quiz on their behalf | Works. `ChildSwitcher` (`quizzes.tsx:247`) is correctly rendered **inside** the list branch only, so a parent cannot switch child mid-attempt and corrupt the submit payload. Ownership is enforced server-side by `ownedStudent` (`quizzes.ts:84-102`) | ✅ Good defensive placement | — |
| Quizzes list | See whether the child actually took it | Correct now. `already_attempted = !!att?.submitted_at` and a separate `in_progress` (`quizzes.ts:1230-1231`) | ✅ **v1 C2 fixed** | — |
| Quizzes list | Judge whether a quiz is worth their child's time | Inherits every student-facing defect above: false "Practice" badge, vanishing earned pill, no history, no review | See C3, M7, M8 | **C3** |
| Progress → monthly report | See quiz performance | Absent. `progress.ts` contains no quiz reference at all; the report covers homework and niyams | Add quiz attempt counts and average score, as homework already has | M9 |
| Any screen | Be told a live quiz started for their child | Never — same as the student. No notification, no SMS, no in-app feed entry | H10 | **H10** |

---

### 4. Shikshak — Guruji / Didi 📱🖥

This persona is the one the module was designed around (SPEC §15.2) and the one it serves worst.

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Admin sidebar | Find **Quizzes** | **Not there.** `sidebar-nav.ts:79` sets `min: 'city_admin'` | Either lower the gate to `shikshak` with a narrowed page, or build the mobile surface below. Today the persona has no entry point | **H17** |
| Mobile shikshak tab | Start a push quiz mid-session | **No screen exists.** `/quizzes` is in `PARENT_ACTIONS` only; `SHIKSHAK_ACTIONS` (`QuickActions.tsx:43-60`) has no quiz entry, and `app/shikshak/` has no quiz file | SPEC §15.2: *"Instant quiz created on-the-fly by Guruji/Didi during a session."* The API supports it (`POST /push` admits shikshak; the test at `quizzes.test.ts:692` proves it) — only the UI is missing | **H17** |
| — (API, direct) | Start a batch-scoped push quiz | Works correctly. `allowedQuizScopes` caps them at centre/batch (`:169`), `authorizeQuizTargets` validates targets | ✅ | — |
| — (API, direct) | `PATCH /questions/:id` on a **national** question | **200.** `quizTargetsInAdminScope` returns `true` unconditionally for national (`:283-284`), and `allowedQuizScopes` is never consulted outside the three create routes (`:576`, `:811`, `:1627`). They rewrite the answer key for every student in India | Re-apply the authoring cap on mutation; split the read gate from a narrower write gate | **C1** |
| — (API, direct) | `GET /events/:id/attempts` on a **city-wide** event | **200.** The `city` branch is existential — one centre inside the targeted city grants the whole set (`:300-313`). Returns every attempting student's name, centre, batch, score and per-question answers across all centres in that city | Containment, not existence: return only rows for centres the caller actually holds | **C1** |
| — (API, direct) | `DELETE /events/:id?force=true` on a national event | **200.** Hard-deletes every attempt row, every question link and the event (`:1119-1135`), reversing Punya nationwide. Contrary to the repo's soft-delete convention | Restrict to the creating scope; prefer soft-delete/cancel | **C1** |
| Admin panel (if the nav gate were lowered) | See who answered a live push quiz | The live monitor exists and polls at 5s (`QuizzesPage.tsx:756-779`) — genuinely good. But each poll runs `pointsAwardedForAttempt` once **per attempt** (`quizzes.ts:1827`), so 200 attempts = ~201 queries every 5s per open tab, and the poll never stops after an error | Batch into one grouped query; stop after N consecutive failures | **H14**, L6 |
| Admin panel | End a push quiz early or fix a wrong answer key | Impossible. There is no `PATCH`, `DELETE`, or reset route for push quizzes or their attempts — only events got the correction path | Mirror the event routes: `DELETE /push/:id`, `POST /push/:id/attempts/:attemptId/reset`, and an "end now" that sets `expires_at = now()` | **H12** |
| Mobile → Punya → sources | See a student's quiz Punya | Renders the raw key. `SOURCE_LABELS` (`app/shikshak/punya.tsx:27`) still maps the legacy `quiz`; awards now land under `quiz_participation` / `quiz_win` / `push_quiz_completion` | Add the three new keys | M14 |

---

### 5. Sanchalak — centre head 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Admin sidebar | Find **Quizzes** | Not there — `min: 'city_admin'` | Same decision as H17 | **H17** |
| — (API, direct) | Everything in the Shikshak rows above | Identical. `resolveAdminScope` returns a non-null `centreIds`, so line 271 does not short-circuit and line 284 fires | **C1** | **C1** |
| — (API, direct) | `DELETE /events/:id` on a **centre**-scoped event at a centre they hold | 200 — and reasonable for a sanchalak. But note `case "centre"` (`:316`) never consults `scope.batchIds`, so a *shikshak* assigned to one batch passes the same gate. Niyam solved this with `inBatchWriteScope`; quizzes have no equivalent | Consult `batchIds` in the centre branch for batch-restricted roles | **C1** |
| `GET /questions` | Browse the bank | Sees every question in their city, including other centres'. The listing still filters on the legacy single `city_id` (`:620-632`), and `primaryCityForTargets` (`:519-530`) stamps centre-scoped questions with the centre's city | v1 H8, unfixed. Decide it deliberately — either a narrower `QUIZ_ADMIN_ROLES` set (as exams did with `EXAM_ADMIN_ROLES` and a "do not fix this back" comment), or filter on `centre_ids`/`batch_ids` | **H15** |
| Event create | Attach another centre's question | Allowed — the check validates only `q.city_id` against city scope (`:829-834`), never `centre_ids`/`batch_ids` | Same fix as H15 | H15 |
| Anywhere | See what their centre's students scored | Only via the API. No UI. | H17 | H17 |

---

### 6. City Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Sidebar → **Quizzes** → Bank | Author a question | Works — and now supports edit and deactivate (`PATCH`/`DELETE`), which v1 lacked | ✅ **v1 H2 largely fixed** | — |
| Bank → **Add question** | Add a 3rd option, fill options 2 and 3, tick option 2, leave option 1 blank | **The wrong answer is stored.** `draftToPayload` (`:320-326`) sends the *filtered* `options` but indices into the *unfiltered* `d.options`. Sent: `options=[Ahimsa,Satya]`, `correct_indices=[1]` → points at **Satya**. `validateDraft` passes; the server's range check `1 >= 2` passes. Every student who picks Ahimsa is graded wrong and loses the win bonus | Map indices through the filtered array; reject blank-but-present options instead of silently dropping them. **Audit existing questions for this** | **C2** |
| Bank → **Edit** an existing question | Change only the topic | **All Hindi option text is destroyed.** The draft is built from `text_en` only (`:425-429`), `p.options` never carries `text_hi`, and the API overwrites the whole array (`quizzes.ts:722-724`) whenever `options` is present. (`question_hi` survives — the key is omitted entirely.) | Round-trip `text_hi` through the draft, or omit `options` when unchanged | **H4** |
| Bank → **Add question** | Enter the Hindi text | **No field exists.** `_hi` appears three times in 1,138 lines, all type declarations. `DraftQ` (`:258-262`) has no slot. Labels are hardcoded `"Question (English) *"` | Add `question_hi` / `text_hi` / `title_hi` inputs and a **Hindi missing** badge on the cards, so the gap is findable | **H5** |
| Bank → filter **Inactive** → Events → **New event** | Pick questions | *"No questions in the bank yet."* on a bank of 200 active questions — one `questions` state serves both surfaces and the dialog does `.filter(q => q.is_active)` (`:948`) on an all-inactive fetch. The causing filter is only rendered on the bank tab (`:990`), so it is off-screen | Fetch the picker's bank separately | M1 |
| Bank → a deactivated question | Reactivate it | No button. Edit is disabled (`:467`) and nothing else renders (`:1042-1050`) — even though `PATCH` accepts `is_active: true` (`quizzes.ts:671`). The 409 copy tells admins to *"deactivate it and author a new question"*, making that a permanent one-way door | Render a Reactivate button | M2 |
| Events → **New event** | Set participation / win points | Defaults to `'5'` / `'10'` — inlined constants with no relationship to `punya_features` — and sends `Number(x) \|\| 0`. **`null` can never be sent**, so every web-authored quiz opts permanently out of AT21. Clearing the field to mean "use the standard" silently yields **0 = disabled** | Empty → `null`; render `null` as `Default (N)` and `0` as `Disabled`; drop the literals | **H2** |
| Events → **New event** | Set the window | `datetime-local` is parsed in the *browser's* timezone with no label (`:538-539,588`), and read back via `toLocaleString('en-GB')` which fixes the format but not the zone. AT26 makes these windows Asia/Kolkata | Label `Start (IST)`, convert explicitly, pass `{ timeZone: 'Asia/Kolkata' }` | M13 |
| Events → **New event** | Target an age group / set difficulty | Neither field is in the payload (`:363-369`). Every web-authored question is `difficulty: "medium"`, `age_groups: []` — and the card renders that inert default as if it meant something (`:1023`). **Age-group targeting is unreachable from the admin panel** despite being fully implemented server-side | Add both to the editors | M11 |
| Events list → **Delete** | One click | No confirmation, and a hard delete. Worse: the API's 409 guard counts only *submitted* attempts (`quizzes.ts:1104-1109`), so an event with 30 students **mid-quiz** deletes silently and destroys their in-progress work. The *force* path does confirm (`:934`) — the ordinary path does not | Confirm on both; count unsubmitted attempts in the guard | **H3** |
| Results → **Reset** on a row | One click | No confirmation, rendered on every row regardless of state. Resetting an unsubmitted attempt blanks answers mid-quiz; resetting a submitted one reverses the student's Punya. One misclick in a 200-row roster is unrecoverable | Confirm, naming the student and the consequence; disable for unsubmitted rows | **H3** |
| Results tab | Open a large event's roster | `GET /events/:id/attempts` has **no limit and no pagination**, and calls `pointsAwardedForAttempt` once per attempt inside the loop (`:995`) | Paginate; batch the Punya sum into one grouped query | **H14** |
| Any list | Find something past row 200 | Impossible. `limit=200` (`:911-913`), no offset or cursor client- or server-side, no truncation indicator — the tab label reads `Question bank (200)` as if it were a true count. No search, no topic/difficulty/scope filter | Cursor pagination + search | M12 |
| Create a Mumbai+Pune event | Pune city_admin opens their list | Invisible. `primaryCityForTargets` stores `city_ids[0]` (`:519-530`) and `GET /events` filters on that single column (`:893`) | Filter on `city_ids` with the GIN index from `0032` | L7 |
| Any create/edit | Exceed an API cap (101 questions, 11 options, points > 10000) | *"Failed to create event." / "Invalid event data."* — every Zod failure is swallowed (`quizzes.ts:806`) and the envelope's `details[]` stays empty; the form retains a payload that will fail identically forever | Populate `details[]`; mirror the caps client-side | M16, L8 |

**Also correct and worth noting:** the scope picker (`QuizzesPage.tsx:102-107`) is a character-for-character match to `allowedQuizScopes` (`quizzes.ts:165-170`) — no scope is offered that the API rejects. Design tokens are clean: zero hardcoded palette classes or hex values across 1,138 lines.

---

### 7. State Admin 🖥

Inherits every City Admin row. State-specific:

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Events → **New event** → scope `state` | Pick targets | Correctly capped to their own state (`quizzes.ts:208-213`), and the UI filters the state/city lists to match (`QuizzesPage.tsx:216-220`) | ✅ | — |
| Same dialog | Pick a **centre** or **batch** | The centre and batch pickers are **not** narrowed client-side (`:230-231` take the lists raw). The API's centre check consults `resolveAdminScope(user).centreIds` (`:228-233`), which for state_admin is the centres in their state — so the API holds. The UI just offers options that will 403 | Narrow the pickers to match | M16 |
| Anywhere | Read audit for quiz question authoring | Nothing to read. `POST /quizzes/questions` (`:555-605`) writes no audit entry — `PATCH` and `DELETE` do (`:735`, `:763`), and event/push creation do (`:868`, `:1665`). Authoring a scored, Punya-bearing answer key is precisely the action that belongs in an append-only log | Add `auditFromReq` on create | **H11** |
| Admin push list | See push quizzes for their state | `GET /push` fetches `limit` rows globally ordered live-first, **then** filters by admin scope in JS (`:1557-1583`). Once 100+ newer push quizzes exist elsewhere, theirs stop appearing — with no way to page deeper | Push the scope predicate into SQL before the limit, as `/events/available` now does | **H13** |

---

### 8. Super Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Everything above | — | Bypasses `quizTargetsInAdminScope` at line 271 (`centreIds === null`), so C1 does not apply. Every other City Admin defect does | — | — |
| Punya configs → set `quiz_win` bounds | Enforce a ceiling | **Not enforced.** `punya_features` seeds `quiz_win` with `max_points = 25` (migration `0031`), but the per-event override path is `if (override != null) return Math.max(0, override)` (`quiz-points.ts:149`) with Zod allowing `0..10000` (`quizzes.ts:791`). A city_admin can award 10,000 Punya per quiz win. `punya.ts` contains no clamp either | Clamp overrides to `[min_points, max_points]`, or reject out-of-bounds at 422. AT21: *"point values resolve from `punya_features` at award time"* | **H1** |
| Punya configs page | See quiz features | ✅ Fixed. `quiz_participation`, `quiz_win`, `push_quiz_completion` are registered with `punya_configs` global defaults (migration `0031`) | ✅ **v1 H1 fixed** | — |
| AI question generation | Generate a question bank by topic | Not built. SPEC §15.1 lists it as a Super Admin exclusive with a review queue; `questions.source` exists (default `"manual"`) and `ai_review_status` does not | Out of scope for this review — flagging the gap | — |
| Platform settings | Reconcile the Socket.IO namespace list | CLAUDE.md still mandates `/push-quizzes/:quizId`; the module remains explicitly polling-only (`quizzes.ts:3`) | Implement it or amend CLAUDE.md. Given H10, 20s polling is a real product problem for a live in-class feature, not just a doc mismatch | H10 |

---

## Status of the 2026-08-05 findings

| v1 ID | Was | Now |
|---|---|---|
| C1 — push submit broken for non-batch scopes | Critical | ✅ **Fixed.** `quizMatchesStudent` on submit (`:1893`); tests at `quizzes.test.ts:767,800,832,873` cover centre + national submit and both negatives |
| C2 — interrupted attempt locks the student out | Critical | ✅ **Fixed.** Resumable start (`:1341-1366`), `already_attempted` / `in_progress` split (`:1230-1231`), mobile Resume state (`quizzes.tsx:363-371`). ⚠️ But resume restores nothing — **H6** |
| C3 — concurrent start throws 23505 | Critical | ✅ **Fixed.** `onConflictDoNothing().returning()` (`:1336-1339`); test at `:446` |
| C4 — every quiz blank in Hindi | Critical | 🟡 **Partial.** (a) `?? _en` at all five mobile sites — done. (b) Hindi authoring inputs — **not done (H5)**. (c) Missing-Hindi badge — **not done (H5)**. Degrades to English rather than blank, but no Hindi content can be authored, and editing now *destroys* Hindi options (**H4**) |
| H1 — quiz Punya outside the catalogue (AT21) | High | 🟡 **Mostly fixed.** `quiz-points.ts` + migration `0031` + nullable overrides. ⚠️ Overrides bypass min/max bounds (**H1 new**), and neither client can send `null` (**H2**, **C3**) |
| H2 — no reversal or correction path | High | 🟡 **Partial.** Events got `PATCH`/`DELETE` questions, `DELETE /events/:id` with force, and attempt reset — all with Punya reversal and tests. ⚠️ Push quizzes got **none of it** (**H12**), and no `PATCH /events/:id` exists |
| H3 — no results surface for any admin | High | ✅ **Fixed.** Both rosters + Results tab + 5s live monitor. ⚠️ N+1 and unbounded (**H14**) |
| H4 — unindexed scans filtered in JS | High | 🟡 **Mostly fixed.** `quizMatchesStudentSql` + GIN indexes (`0032`) on the student paths, with a JS/SQL agreement test (`:973`). ⚠️ `GET /push` still filters after the limit (**H13**) |
| H5 — `quiz` notification kind never sent | High | ❌ **Open.** `quizzes.ts` still does not import `notify`; zero `notifyUsers` calls (**H10**) |
| H6 — mandated Socket.IO namespace missing | High | ❌ **Open.** Still polling-only |
| H7 — question create writes no audit | High | ❌ **Open.** `PATCH` and `DELETE` audit; `POST` still does not (**H11**) |
| H8 — sanchalak sees every question in their city | High | ❌ **Open.** Listing still filters on legacy `city_id` (**H15**) |
| M1 — grading total drifts from snapshot | Med | 🟡 Mitigated by absence — no route edits an event's question set. Still recounts at submit (**M17**) |
| M2 — `win_points` all-or-nothing, no leaderboard | Med | ❌ Open |
| M3 — empty answer key grades empty as correct | Med | ❌ Open for legacy/seeded rows (**M18**) |
| M4 — partial submit accepted silently | Med | ❌ Open (**H8**, upgraded — it is irreversible) |
| M5 — no autosave, no timer | Med | ❌ Open (**H7**, **H9**, upgraded) |
| M6 — push quizzes ignore age groups | Med | ❌ Open (**M5**) |
| M7 — students never see correct answers | Med | ❌ Open (**M7**) |
| M8 — no history | Med | ❌ Open (**M8**) |
| M9 — `is_active` dead | Med | ✅ **Fixed.** Filterable (`:628-630`), settable via `PATCH`/`DELETE`. ⚠️ New bugs around it — **M1**, **M2**, **M3** |
| M10 — `difficulty` unconstrained and unused | Med | ❌ Open (**M11**) |
| M11 — `shikshak_user_id` records the caller | Med | ❌ Open (`:1647`) |
| M12 — no pagination, search or filters | Med | ❌ Open (**M12**) |
| L1 — deprecated `eventMatchesStudent` | Low | ✅ **Fixed.** Removed; `quizMatchesStudent` called directly |
| L2 — uncached geo lookups | Low | 🟡 `resolveAdminScope` is memoized per request; `geoForCentre` is not |
| L3 — Zod failures swallowed | Low | ❌ Open (**L8**) |
| L4 — multi-city event invisible to peer admin | Low | ❌ Open (**L7**) |
| L5 — hardcoded `emerald-*` | Low | ✅ **Fixed.** Zero hardcoded palette values remain |
| L6 — 6 tests for the module | Low | ✅ **Largely fixed.** 23 tests. ⚠️ See the gaps below |

**Net: 8 fixed, 6 partial, 12 open, plus 17 new findings** (3 of them Critical) introduced by the fixes themselves.

---

## Test gaps

23 cases (`quizzes.test.ts`), up from 6. Covered well: resume, concurrent start, non-batch push submit (both directions), age gating, question-edit-blocked-when-attempted, force-delete with reversal, attempt reset with reversal and idempotent re-reset, and a JS/SQL scope-agreement test.

Not covered at all:

- **Any non-super-admin against a national/state/city-scoped object.** `loginAs("sanchalak")` appears once (`:1136`) against a *centre*-scoped event; `loginAs("shikshak")` once (`:693`) creating a *batch*-scoped push quiz. The national/state/city branches of `quizTargetsInAdminScope` have **zero** assertions in either direction — which is why C1 shipped, and why fixing it will break **no existing test**.
- **Window boundaries.** Zero occurrences of `ERR_WINDOW_CLOSED`. No start or submit outside the window, no expired push submit, no `now === start_at` / `now === end_at` equality case.
- **Bilingual.** Zero occurrences of `_hi`, `question_hi`, `title_hi`. No test authors bilingual content or asserts fallback.
- **Points resolution.** No test asserts that a `null` override resolves to the `punya_features` default, that `0` disables, or that a city config overrides the global.
- **Scope listing** for a non-super admin (`GET /questions`, `GET /events`), and the create-time role cap itself (no test expects a 403 from `allowedQuizScopes`).

---

## What looks good

- **The submit-claim pattern**, both flows (`:1456-1506`, `:1943-1976`) — advisory lock, conditional claim, award composed into the same transaction, attempt-scoped idempotency key. The comments explain *why*. Unchanged from v1 and still the best code in the module.
- **`nextQuizAwardRevision`** (`:450-479`) — the reset path reverses ledger rows but keeps the original keys, so a retake mints a new revision rather than being silently swallowed by `ON CONFLICT`. Subtle, correct, and the test at `:1396` proves it.
- **`quiz-scope.ts`** — one JS authority and one SQL predicate, explicitly documented as needing to stay behaviourally identical, with a test (`:973`) that asserts exactly that. This is the right shape for a rule that must hold in two languages.
- **Student-safe question loading** — `loadEventQuestionsForStudent` (`:1260-1272`) and the push equivalent (`:1732-1742`) never select `correct_indices`. No answer key crosses the wire to a student, on any path.
- **Design tokens** — 1,138 lines of admin panel with zero hardcoded colours. The v1 `emerald-*` finding was fixed properly rather than patched.
- **`ChildSwitcher` placement** (`quizzes.tsx:247`) — rendered inside the list branch only, so a parent cannot switch child mid-attempt. Someone thought about that.

---

## Recommended order of work

1. **C1** — split `quizTargetsInAdminScope` into a read gate and a write gate; re-apply `allowedQuizScopes` on `PATCH`/`DELETE`/reset; make `national` require `centreIds === null`; make `state`/`city` containment rather than existence; consult `batchIds` in the `centre` branch. Add the six negative tests. *No existing test changes.* **Do this before any shikshak account touches production.**
2. **C2** — fix `draftToPayload`, and audit existing `questions` rows for answer keys corrupted by a dropped blank option.
3. **C3 + H2** — resolve `points_earned` through the AT21 helpers; render `null` as the default and `0` as disabled on both clients; let the admin panel send `null`.
4. **H1** — clamp overrides to the `punya_features` bounds.
5. **H3** — confirmations on Delete and Reset; count unsubmitted attempts in the delete guard.
6. **H4 + H5** — stop wiping `text_hi` on edit, then add the Hindi inputs and the missing-Hindi badge. (H4 first — H5 is not durable until it lands.)
7. **H6 + H7 + H8 + H9** — the take-flow integrity set: partial-answer persistence, incomplete-submit confirmation, countdown and expiry handling. These are one coherent piece of work.
8. **H10** — notifications on push create and event open, then the Socket.IO decision (implement `/push-quizzes/:quizId` or amend CLAUDE.md).
9. **H12 + H17** — the push-quiz correction path, and a surface the Guruji can actually reach. Decide H17 first: it determines whether the correction path belongs in the admin panel or in mobile.
10. **H11, H13, H14, H15, H16**, then M/L as capacity allows. **M7** (answer review) is worth pulling forward on product value alone.

---

## Note on stack drift

Unchanged from v1: this repo is Express + `apps/api-server` + `lib/db`, while CLAUDE.md specifies NestJS + `apps/api` + `packages/shared`. Out of scope here and not counted against the module — but the AT21, AT26, audit, bilingual, error-code and design-token rules cited above are stack-independent and do apply.
