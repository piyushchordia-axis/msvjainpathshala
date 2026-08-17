# Exams Module — Full Code Review

**Date:** 2026-08-15 · **Branch:** `dev-setup` · **Reviewer:** Claude (Cowork)
**Format:** persona → navigation → action → observed vs expected

## Scope reviewed

| Layer | Files |
|---|---|
| API — take flow, authoring, grading | `apps/api-server/src/routes/v1/exams.ts` (1595 L) |
| API — exam CRUD, release, attempts list | `apps/api-server/src/routes/v1/admin-modules.ts` (exam block, L153–441) |
| Scoring / Punya | `lib/exam-points.ts`, `lib/exam-punya.ts`, `lib/exam-attempt-abandon.ts`, `jobs/exam-jobs.ts` |
| Schema + migrations | `lib/db/src/schema/exams.ts`, migrations `0028`–`0030` |
| RBAC contract | `lib/api-zod/src/contracts.ts` (`EXAM_ADMIN_ROLES`, `ADMIN_PANEL_ROLES`) |
| Web admin | `ExamBuilderPage.tsx`, `ExamGradingPage.tsx`, `AdminExtendedPages.tsx` (ExamsPage), `AdminRoutes.tsx`, `sidebar-nav.ts` |
| Web public | `pages/public/ExamsPage.tsx`, `PublicRoutes.tsx`, `TopNav.tsx` |
| Mobile | `app/exams.tsx`, `components/QuickActions.tsx` |
| Tests / CI | `test/exams.test.ts` (25 tests), `.github/workflows/ci.yml` |

Persona hierarchy used: `super_admin → state_admin → city_admin → sanchalak → shikshak → parent → student`.

---

## Verdict

The **backend take-flow is the strongest part of the module** — transactional grading with advisory locks, argon2id access codes, per-(caller, student) OTP rate limiting, results gated behind `results_released`, AT18-compliant reverse-then-re-award Punya, and idempotent autosave. Nearly every finding from the Aug 4–5 review round is genuinely fixed.

The failures are concentrated in three places:

1. **The web admin exam surface is non-functional.** The list page throws on render, and the edit route it calls was never built.
2. **The student's exam is not protected against the clock.** No countdown, no auto-submit, silent autosave failure at `window_end` — the whole attempt is lost with no warning on both web and mobile.
3. **Results are write-only for students.** There is no attempt-history endpoint, so once the window closes the score is unreachable forever.

**Headline count:** 6 Critical · 14 High · 21 Medium · 15 Low.

**Also: the API test suite is currently red.** `test/exams.test.ts:901` asserts `PATCH /v1/admin/exams/:id` returns 200; that route does not exist anywhere in `apps/api-server`, and `ERR_RESULTS_PUBLISHED` appears in no exam source file. CI runs this suite against a real Postgres (`.github/workflows/ci.yml` job `test`, vitest `include: test/**/*.test.ts`), so this cannot be passing.

---

# 1. Vidyarthi (Student) — `role: student`

**Entry points:** Web `TopNav → "My exams" → /exams` (`PublicRoutes.tsx:70`). Mobile `student/home → QuickActions → /exams` (`_layout.tsx:112`, `QuickActions.tsx:38`). Both reachable and correctly gated. ✅

### E-1 · Clock runs out mid-attempt — **CRITICAL**

| | |
|---|---|
| **Navigation** | `/exams` → Start exam → taking screen |
| **Action** | Student is writing a long text answer when `window_end` passes |
| **Observed** | No countdown, no warning, no auto-submit. Every autosave `PUT` now returns 422 `ERR_WINDOW_CLOSED` (`exams.ts:1177`) and is swallowed by a bare `.catch()` — the "Saving…" pill just disappears (web `ExamsPage.tsx:467-469`; mobile `exams.tsx:398-400`). Student taps **Submit** and gets a generic toast plus a raw English server sentence (`exams.ts:1308-1316`). **Every answer typed is gone**, the attempt sits `in_progress` until the abandon cron closes it 2 h later, and with `max_attempts` typically 1 there is no retry. |
| **Expected** | Countdown from `window_end` (already on the wire — web discards it at `ExamsPage.tsx:895-903`, mobile never reads `ResumeResponse.window_end` at `exams.tsx:69`), a warning at T-5 min, inputs disabled and **auto-submit at T-0**. |

### E-2 · Result can never be viewed again — **CRITICAL**

| | |
|---|---|
| **Navigation** | Submit → result screen → "Back to exams" |
| **Action** | Two weeks later the admin releases results; student opens the app to check their score |
| **Observed** | **No screen in either client can show it.** `GET /v1/exams/available` filters `window_end >= now` (`exams.ts:868`), so the finished exam is gone from the only list a student has. There is no attempt-history endpoint anywhere — `exam_attempts` is student-readable only via `/available`, `/attempts/:id` (in-progress only, `exams.ts:1076`) and `/attempts/:id/result`, and nothing hands the `attempt_id` back. Web has no `/exams/:id/result` route; mobile holds `attemptId` in `useState` only (`exams.tsx:361-364`) and clears it on `onDone` (`:588-591`). |
| **Expected** | `GET /v1/exams/attempts` (student's own history, all statuses) + a "Past exams / My results" section that survives window close and app restart. |

### E-3 · Released-but-ungraded shows a failing zero — **HIGH**

| | |
|---|---|
| **Navigation** | `/exams` → result screen |
| **Action** | Admin releases results while text answers are still ungraded |
| **Observed** | For a `submitted` attempt with `score = NULL`, `/result` passes the released gate and returns `score: attempt.score ?? 0`, `passed: false` (`exams.ts:1556, 1576-1583`). Both clients treat "score is a number" as final — web `ExamsPage.tsx:654`, mobile `exams.tsx:230` — and render a large **0 / 100** with a red **Not passed / अनुत्तीर्ण** badge. A child who wrote a good paper is told they failed. |
| **Expected** | Gate on `result.status === 'graded'`, and (root cause) block release while any attempt has `needs_grading = true` — see A-4. |

### E-4 · One mis-tap burns the only attempt — **HIGH**

| | |
|---|---|
| **Navigation** | Taking screen, scrolling to re-read a question |
| **Action** | Thumb / cursor lands on **Submit exam** |
| **Observed** | Submitted and auto-graded instantly, no confirmation, no "you have answered 4 of 20" check — `answeredCount` is already computed and only ever displayed (web `ExamsPage.tsx:488-491, 617`; mobile `exams.tsx:561-567, 706-712`). `already_attempted_count` hits `max_attempts` and the card reads "No attempts left". |
| **Expected** | Confirm dialog naming the unanswered count. The repo already uses `Alert` + `destructive` confirms in 7 other mobile places (e.g. `DeleteAccountButton.tsx:54`). |

### E-5 · "Saved" can be a lie — **HIGH**

| | |
|---|---|
| **Navigation** | Taking screen on patchy centre wifi |
| **Action** | Answer Q1 (save fails), answer Q2 (save succeeds) |
| **Observed** | `saveStatus` is a single global flag and `saveGen` a single global counter, so only the most recent PUT can update the pill — Q2's success masks Q1's failure. Failure resolves to `'idle'`, which renders **nothing**. There is no error state, no retry, no `navigator.onLine` / offline queue. Web `ExamsPage.tsx:449-471, 534-538`; mobile `exams.tsx:379-402, 604-608`. The student closes the app believing everything is stored. |
| **Expected** | Per-question save state with an explicit `failed` badge and retry; flush pending saves before unmount. |

### E-6 · Offline submit spins forever *(mobile)* — **HIGH**

| | |
|---|---|
| **Navigation** | Basement classroom, no signal |
| **Action** | Tap **Submit exam** |
| **Observed** | `query-client.ts:23-33` sets defaults for `queries` only, so React Query v5 mutations keep `networkMode: 'online'` and **pause** when NetInfo reports offline. `isPending` stays true → indefinite spinner, neither `onSuccess` nor `onError` fires (`exams.tsx:534-541`). Same for Start and Resume. Force-quit and nothing was submitted. Note the autosave path is a raw `fetch` and fails fast — the two paths behave oppositely under identical conditions. |
| **Expected** | `mutations: { networkMode: 'offlineFirst' }` plus an offline banner and a queued retry. |

### E-7 · Back gesture eats the last answer *(mobile)* — **HIGH**

| | |
|---|---|
| **Navigation** | Taking screen |
| **Action** | Finish a sentence, then swipe back / hardware back within 2 s |
| **Observed** | The unmount effect `clearTimeout`s every pending debounced save without flushing (`exams.tsx:372-377`). No `usePreventRemove` / `BackHandler` / `beforeRemove` exists anywhere in the mobile app. The "Leave" button (`:713`) is a bare `setActive(null)` with no confirm. On resume the older text appears with no indication anything was dropped. Web has the same 2 s hole on "Leave" / refresh with no unload guard (`ExamsPage.tsx:442-447, 614-616`). |
| **Expected** | Flush pending saves on unmount + a "you have unsaved changes" guard. |

### E-8 · Options are unlabelled buttons *(web)* — **HIGH**

| | |
|---|---|
| **Navigation** | Taking screen, screen reader on |
| **Action** | Tab through a single-choice question |
| **Observed** | Each option is a plain `<button type="button">` with no `role="radio"`/`aria-checked`, no `radiogroup`, and the question rendered as a bare `<p>` (`ExamsPage.tsx:557-559, 580-599`). Selection is conveyed by border colour plus a check icon hidden with `text-transparent`. A blind student hears "button, Ahimsa" four times with no indication of which is selected and no arrow-key navigation. Mobile is the same class of problem at Medium — `Pressable` with no `accessibilityRole`/`accessibilityState` (`exams.tsx:660-691`), which is a regression against 30+ other mobile files that do set them. |
| **Expected** | `role="radio"`/`"checkbox"` + `aria-checked` + `fieldset`/`aria-labelledby` tying options to the question. |

### Medium / Low — student

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| E-9 | M | `/exams` list at 09:55 for a 10:00 exam | `now` is captured once per render (web `:236`; mobile `:789-791`), so "Not open yet" persists past 10:00 until manual refresh — and stays *enabled* past `window_end`, producing a 422. Mobile also uses `toLocaleString` with no `timeZone`, against the repo's own `Asia/Kolkata` convention (`QuickActions.tsx:279`), so a mis-set phone clock disables Start entirely. **Expected:** 30 s ticker + IST-pinned formatting. |
| E-10 | M | Mistype the access code 5× | 429 is unhandled on both clients (web `:352-364`; mobile `:477-498`) → "Could not start the exam" + English "Too many requests." No mention of the 15-minute window, and the bad code is left in the field. `ERR_WINDOW_CLOSED` on submit likewise falls to the generic branch (web `:512-520`; mobile `:542-556`). **Expected:** distinct copy stating the problem *and* the fix, per CLAUDE.md error voice. |
| E-11 | M | Attempt was abandoned by the cron; tap **Resume** | `exams.ts:1076-1077` returns `ERR_ALREADY_SUBMITTED` for *any* non-`in_progress` status, so the student is told "This attempt was already submitted" and waits for a score that will never come. **Expected:** a distinct `ERR_ATTEMPT_ABANDONED` and copy pointing at the admin reset route. |
| E-12 | M | Result fetch fails on flaky network | `.catch(() => setResult(null))` (web `:649`) / `isError` unhandled (mobile `:245-249`) renders "Your result will appear here once it is released" — a network error presented as a fact about the exam. **Expected:** error state + retry. |
| E-13 | M | Multi-choice question, tick the 2 of 3 you are sure of | Hint reads only "Select one or more options" (mobile `:694-698`); grading is all-or-nothing (`exams.ts:1408`) → 0 marks. **Expected:** say so on the question. |
| E-14 | M | Hindi-locale student hits any error | Every fallback passes raw `ApiError.message` through (web `:182, 207, 362, 518`; mobile `:546`), so English server sentences appear inside a Hindi UI. **Expected:** map codes to bilingual strings. |
| E-15 | M | Two option clicks in one React batch *(needs verification)* | `toggleMulti` reads `answers.selected[qid]` from the render closure instead of a functional update (`ExamsPage.tsx:478`), so the stale set can be autosaved. `pickSingle`/`setText` do it correctly. Tight timing — plausible, not reproduced. |
| E-16 | L | Start an exam with no questions | Attempt is created and consumed; screen says "This exam has no questions", Submit is disabled, only exit is "Leave" (`ExamsPage.tsx:546-549`). |
| E-17 | L | Text answer past 10 000 chars | No client limit or counter; server caps at `z.string().max(10000)` (`exams.ts:1044, 1253`) → silent autosave 422s then "Invalid submit payload" naming no question. |
| E-18 | L | Exam with >200 questions | Client sends one entry per question unconditionally (`ExamsPage.tsx:502-507`); server caps at 200 → whole submit 422s. Chunking would work since omitted questions keep their autosaved rows. |
| E-19 | L | Review a graded text answer | `{marks_awarded ?? '—'} / {marks}` with no "awaiting grading" label (web `:716`), and `is_correct` null suppresses the verdict line entirely. |
| E-20 | L | Read a partially-credited answer | `is_correct: awarded > 0` (`exams.ts:537`) renders a green **Correct** above **3 / 10** (mobile `:296-317`), and red **Incorrect** for a 0/10 the grader commented on. Contradictory card; scoring itself is right. |

---

# 2. Abhibhavak (Parent) — `role: parent`

**Verified correct:** both clients resolve the child properly. Web fetches `/v1/me/children`, renders a `<Select>` when `children.length > 1`, and passes `student_id` on **all six** calls (`ExamsPage.tsx:178, 196, 347, 461, 501, 646`). Mobile uses `useSessionView().activeStudentId` on all six plus `<ChildSwitcher />` (`exams.tsx:117, 127, 137, 171, 183, 392`). The 422 "Choose which child" storm does **not** occur. ✅

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| P-1 | M | *(mobile)* Start an exam for child #2 → app is killed → reopen `/exams` | `activeStudentId` lives in memory only and defaults to `rows[0]` (`SessionViewContext.tsx:38, 48-56`). The list is silently scoped to child #1, showing no resumable attempt. Parent concludes the attempt was lost. **Expected:** persist the active child. |
| P-2 | M | *(web)* `/v1/me/children` blips once | `catch` clears children (`ExamsPage.tsx:779-783`) → terminal card "Your student profile is not ready yet" with no retry, no error text, and no distinction from the genuine zero-children case (`:852-863`). Only recovery is a full reload. `ExamList` right next to it *does* have a retry (`:218-227`). |
| P-3 | L | Three children each start their allowed attempts | `rateLimit('exam:start:user:${uid}', 10, 3600)` (`exams.ts:941`) is keyed on the **parent**, not per student, so one family shares a 10/hour budget. The OTP limiter correctly keys per `(uid, student)` at `:983` — the start limiter should match. |
| P-4 | L | Sign in as parent, open TopNav | "My exams" is shown to every signed-in role (`TopNav.tsx:27-29, 73-75`); a shikshak or city_admin clicking it lands on "This page is for parents and student view." **Expected:** gate `MEMBER_NAV_EXTRA` on parent/student. |

---

# 3. Shikshak (Guruji / Didi) — `role: shikshak`

`contracts.ts:179-185` is explicit: *"sanchalak and shikshak can open the admin panel but must NOT touch exam content or results (SPEC 6.17). Do not 'fix' this by reusing ADMIN_PANEL_ROLES."* Write paths honour this and are tested (`exams.test.ts:789-843`). ✅ The **read** paths do not.

### S-1 · Can read the whole city's exam results — **HIGH**

| | |
|---|---|
| **Navigation** | `GET /v1/admin/exams` then `GET /v1/admin/exams/:id/attempts` with a shikshak token |
| **Action** | List exams, then list any exam's attempts |
| **Observed** | Both routes sit behind the router-level `requireAuth, requireAdminPanel` only (`admin-modules.ts:38, 154, 223`) — no `canAdministerExams`, unlike `POST /exams` (`:404`) and `release-results` (`:205`) which both wrap `requireRole`. The attempts route returns `student_name`, `student_code`, `status` and **`score`** for every attempt on the exam. Only the OTP is withheld (`:179, 193-197`). Neither read is covered by the RBAC test. |
| **Expected** | Add `canAdministerExams` to both, or define an explicit read-only contract (`canViewExamResults`) if a teacher genuinely needs to see their own batch's marks. |

### S-2 · Exam pages render for a role that can do nothing on them — **MEDIUM**

| | |
|---|---|
| **Navigation** | Type `/admin/exams` (bookmark, shared link) |
| **Action** | Land on the page |
| **Observed** | The sidebar correctly hides all three exam items behind `gate: 'administerExams'` (`sidebar-nav.ts:71-73`), but the routes are registered unconditionally (`AdminRoutes.tsx:102-104`) and `ExamsPage` has no `useAuth` gate (`AdminExtendedPages.tsx:498`) — unlike `ExamGradingPage` (`:96-98, 283-285`) and `QueuesPage` (`:697-705`) which do. A fully populated exam table renders with **New exam**, edit and **Release** buttons, all of which 403 into `toast.error('Failed.')`. |
| **Expected** | Page-level `canAdministerExams` guard on `ExamsPage` and `ExamBuilderPage`, matching the grading page. |

*Note: `sidebar-nav.ts:136-140` returns from the `gate` branch before evaluating `min`, so `min: 'city_admin'` on the exam entries is dead code. Harmless today; will diverge silently if either list changes.*

---

# 4. Sanchalak (Centre head) — `role: sanchalak`

Inherits S-1 and S-2 above, plus:

### SN-1 · Sees students from centres they do not run — **HIGH**

| | |
|---|---|
| **Navigation** | `GET /v1/admin/exams/:id/attempts` |
| **Action** | Open any exam in their city |
| **Observed** | Scope resolution widens centre → city (`admin-modules.ts:54-58`), so a sanchalak assigned one centre gets `cityIds = [their city]` and passes the `cityIds.includes(exam.city_id)` check at `:231`. The attempts query then filters only `and(eq(exam_attempts.exam_id, id), isNull(students.deleted_at))` (`:247`) — **no centre predicate**. They receive every attempting student in the city, including other centres'. Contrast `PERSONAS_REVIEW.md:32`: sanchalak scope is "assigned centres". |
| **Expected** | Join `students → centres` and filter on the caller's `scope.centreIds` for non-city+ roles. |

---

# 5. City / State / Super Admin — authoring, grading, release

**Navigation:** sidebar → Exams (`/admin/exams`), Exam builder (`/admin/exam-builder`), Exam grading (`/admin/exam-grading`) — all three routed and gated (`sidebar-nav.ts:71-73`, `AdminRoutes.tsx:102-104`). ✅

### A-1 · `/admin/exams` throws on render as soon as one exam exists — **CRITICAL**

| | |
|---|---|
| **Navigation** | Sidebar → **Exams** |
| **Action** | Page loads with ≥ 1 exam in scope |
| **Observed** | `ExamRow` declares `title_hi: string`, `description_en`, `description_hi`, `max_attempts` (`AdminExtendedPages.tsx:43-60`) — **none of which `GET /v1/admin/exams` returns** (select `admin-modules.ts:157-177`, mapped `:182-198`). `EditExamDialog` renders inside every row (`:545`) and line **487** evaluates `disabled={busy \|\| !title.trim() \|\| !titleHi.trim() \|\| …}`. `busy` is `false` and `title` is non-empty, so nothing short-circuits: `undefined.trim()` → **`TypeError`, blank page / error boundary.** JSX props are evaluated at element creation, so Radix keeping the dialog closed does not save it. An empty list renders fine — which is why this survives a fresh-DB smoke test. |
| **Expected** | Add the four fields to the API select; defensively `?? ''` the form seeds. This one page is the only path to create an exam or release results, so the whole admin surface is down behind it. |

### A-2 · `PATCH /v1/admin/exams/:id` was never built — **CRITICAL**

| | |
|---|---|
| **Navigation** | Exams → pencil icon → change anything → **Save** |
| **Action** | Submit the edit dialog |
| **Observed** | `AdminExtendedPages.tsx:366` calls `apiPatch('/v1/admin/exams/${exam.id}')`. There is **no `router.patch("/exams/:id")` anywhere in `apps/api-server`** — the only exam routes on the admin router are `GET /exams`, `GET /exams/:id/attempts`, `POST /exams`, `POST /exams/:id/release-results`. `ERR_RESULTS_PUBLISHED` (which the dialog's `marksLocked` logic at `:308, 362-365` is written against) exists only in `competitions.ts:364`. Every save 404s into `toast.error('Failed.')`. |
| **Consequence** | `test/exams.test.ts:901-941` asserts this PATCH returns 200 → **the API test suite is red in CI** (`ci.yml` job `test` runs `pnpm run test` against a seeded Postgres; vitest includes `test/**/*.test.ts`). Also: `results_released` is one-way with no un-release route, and this dead PATCH was the only recovery affordance. |
| **Expected** | Ship the route (it is `M8`, open across two prior review rounds), or delete the UI + test. |

### A-3 · The one-time access code is unrecoverable — **CRITICAL**

| | |
|---|---|
| **Navigation** | Exams → **New exam** → Create |
| **Action** | Read the generated exam access code |
| **Observed** | `toast.success(\`Exam created. OTP: ${res.exam_otp}\`)` (`AdminExtendedPages.tsx:135`) — a self-dismissing toast, not copyable, fired while the dialog closes and the table reloads. The server stores only the argon2id hash and explicitly writes `exam_otp: null` (`admin-modules.ts:436`), so the list column shows `'Set'` forever (`:537-539`). Blink, alt-tab, or navigate and **the code is gone permanently.** No re-issue route exists. Students cannot enter the exam; the only remedy is creating a replacement exam. |
| **Expected** | A modal that stays open until explicitly acknowledged, monospace, with a Copy button and "this will not be shown again". |

### A-4 · Release is one irreversible click with no guards — **HIGH**

| | |
|---|---|
| **Navigation** | Exams → **Release** (sits directly beside the edit pencil in a dense row) |
| **Action** | Click once |
| **Observed** | `POST /v1/admin/exams/:id/release-results` (`admin-modules.ts:202-221`) is an 18-line handler: no confirmation in the UI (`AdminExtendedPages.tsx:546-549`), **no check that grading is complete**, no un-release route, and **no `auditFromReq` entry** (neighbouring mutations audit at `:364, 562, 650, 726, 792, 847`; `POST /exams` also doesn't). Every student's result is published instantly and permanently — and ungraded attempts publish as a failing zero (see E-3). Contrast: deleting a *single question* asks `window.confirm` (`ExamBuilderPage.tsx:228`). |
| **Expected** | Confirm dialog + "N attempts still need grading" block + audit entry + an un-release path. |

### A-5 · Grading page says "nothing to grade" for every exam — **HIGH**

| | |
|---|---|
| **Navigation** | Sidebar → **Exam grading** → pick an exam |
| **Action** | Look for attempts awaiting manual marks |
| **Observed** | `AttemptListRow` declares `needs_grading`, `auto_score`, `manual_score` (`ExamGradingPage.tsx:35-37`); `GET /v1/admin/exams/:id/attempts` sends **none** of them (`admin-modules.ts:236-244`). The "Needs grading" filter defaults **on** (`:104`) and does `attempts.filter(a => a.needs_grading)` → always `[]`. Ten students waiting on free-text marks show as **"Attempts (0) — No attempts need grading right now."** The amber badge (`:363-369`) never appears and the ungraded-first sort (`:169`) is a no-op, so even with the filter off nothing distinguishes pending from graded. |
| **Expected** | Return the three fields from the API; don't treat a missing field as `false` in the UI. |

### A-6 · Grading an abandoned attempt silently burns the student's retry — **HIGH**

| | |
|---|---|
| **Navigation** | Exam grading → untick "Needs grading" → open an abandoned attempt → enter marks → Submit grades |
| **Action** | Grade an attempt that was abandoned (admin reset, or the 2 h post-window cron) |
| **Observed** | The only status guard is `if (attempt.status === "in_progress")` (`exams.ts:503-506`) — `abandoned` falls straight through. The finalize path sets `status: 'graded'` with a real score and calls `awardExamCompletionPunya` (`:600-626`). Because both attempt-cap queries exclude only `abandoned` (`:881, 1012`), the row now **re-consumes the slot the abandon had freed** — the student's next Start returns 409 `ERR_MAX_ATTEMPTS`. **Irreversible:** `reset` requires `in_progress` (`:714-722`) and the cron only touches `in_progress`, so nothing can put it back. The Submit-grades button is gated only on `disabled={saving}` (`ExamGradingPage.tsx:526`). |
| **Worse** | If the abandoned attempt has **no `exam_answers` rows**, the `ungraded` count is 0 (`:586-596`) and the *first* call finalizes it as `graded` with `score = 0`. And since `textMax.get(...) === undefined → continue` (`:531-532`), a payload with one arbitrary UUID produces zero updates and still finalizes. The student's `/result` flips from `{status:'abandoned'}` to a real graded **0**. |
| **Expected** | Reject any status other than `submitted` (and `graded`, for re-grades) with 422. |

### A-7 · Unpassable exams can be created, and cannot be fixed — **HIGH**

| | |
|---|---|
| **Navigation** | New exam (total_marks 100, pass_mark 40) → Exam builder → author six 5-mark questions |
| **Action** | Publish |
| **Observed** | Nothing anywhere reconciles `online_exams.total_marks` with `SUM(exam_questions.marks)`. `createExamSchema.superRefine` checks only window ordering and `pass_mark <= total_marks` (`admin-modules.ts:386-401`); question creation validates per-question `marks` 1–100 only (`exams.ts:245-265`); `release-results` checks nothing. Maximum achievable is 30 against a pass mark of 40 → **every student fails**, `passed = score >= pass_mark` (`:1583`) is always false, and completion Punya is suppressed for the whole cohort (`exam-punya.ts:98`). Students see "27 / 100". The builder shows no running total. |
| **Unfixable after the fact** | Questions lock once any attempt exists (`exams.ts:235-243, 326-334`) and there is no PATCH route to change `total_marks`/`pass_mark` (A-2). |
| **Expected** | `GET /v1/exams/:id/marks-summary`, a running total in the builder, and a release-time guard. *(This is prior finding `C2` — open across two review rounds.)* |

### A-8 · Exam descriptions are silently discarded — **HIGH**

| | |
|---|---|
| **Navigation** | New exam → fill English + Hindi description → Create |
| **Action** | Reopen the exam |
| **Observed** | `createExamSchema` (`admin-modules.ts:374-385`) has **no `description_en` / `description_hi`**, so Zod strips both even though the columns exist (`schema/exams.ts:17-18`) and the dialog collects them (`AdminExtendedPages.tsx:125-126`). Separately `title_hi` is `.optional()` with `title_hi: body.title_hi ?? body.title_en` at `:429` — Latin text written into a Devanagari column, which CLAUDE.md forbids. Both were verified fixed in the Aug 5 follow-up and have **regressed**. |
| **Expected** | Restore `description_en/_hi` in the schema, make `title_hi` required, drop the `?? title_en` fallback. |

### Medium / Low — admin

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| A-9 | M | Exam grading → award 3/5 for a text question the student left blank | The detail is `exam_questions LEFT JOIN exam_answers` (`exams.ts:418-424`), so unanswered questions render with "No answer submitted" **and a live Marks input** (`ExamGradingPage.tsx:463-482`). The grade write is `UPDATE exam_answers … WHERE attempt_id AND question_id` (`exams.ts:559-569`) — no row, zero updates. The running total shows 3; the finalized score is 3 lower; the field is blank on refetch. Re-entering does nothing. |
| A-10 | M | Student's browser dies mid-exam; parent phones the centre | `POST /v1/exams/:id/attempts/:attemptId/reset` exists (`exams.ts:687`) and has **no caller anywhere in web or mobile**. The admin can see the `in_progress` attempt (after unticking the filter) but has no action; Submit grades returns 422 "Attempt not submitted." Only fix is a DB edit. |
| A-11 | M | Exam builder → select exam → write a full question → Add | `GET /v1/admin/exams` already returns `attempt_count`, but `ExamOption` keeps only `id` + `title_en` (`ExamBuilderPage.tsx:18-22`). Nothing warns the exam is frozen until the 409 `ERR_EXAM_HAS_ATTEMPTS` arrives after the whole question is typed. Delete stays enabled on every card. **Expected:** mark locked exams in the dropdown, disable authoring, show a banner. |
| A-12 | M | Exams list → "Allowed" column | Always blank — `max_attempts` is not in the API select (`admin-modules.ts:158-169`) though the column renders it (`AdminExtendedPages.tsx:541`). Same root cause as A-1. |
| A-13 | M | Edit an exam that has a description → Save *(latent behind A-2)* | Seeds `?? ''` from absent fields (`:300-301`) then submits `description_en: null, description_hi: null` (`:356-357`) — **opening Edit and saving wipes the description.** Bites the moment PATCH lands. Likewise `String(undefined)` → `"undefined"` for max_attempts makes `validateClient()` always reject with "Attempts allowed must be between 1 and 10." |
| A-14 | M | Create an exam, then add questions to it | No link between the three screens. The Actions column offers only Edit and Release; `attempt_count` is inert text; builder and grading both start from a bare `<Select>` of up to 50 exams showing `title_en` only, with no preselection and no `?exam=` param (`ExamBuilderPage.tsx:321-331`, `ExamGradingPage.tsx:294-322`). Also blocks deep-linking from a notification. |
| A-15 | M | Hard-refresh `/admin/exam-grading` *(needs verification)* | `canAdministerExams(user?.role)` with `user` still `undefined` during auth bootstrap → unconditional `<Redirect to="/admin" />` (`ExamGradingPage.tsx:97-98, 283-285`). Non-issue if `AdminLayout` blocks children until auth resolves — `useAuth` was not in scope. |
| A-16 | M | Release results 45 days after the window closed | Top-score Punya never lands. `release-results` does **not** enqueue `EXAM_TOP_SCORE` (zero `enqueueJob` refs in `admin-modules.ts`) even though `exam-punya.ts:166-167` says *"release-results is the primary trigger and passes exam_id explicitly"*. It also doesn't set `updated_at`, and `timestamps()` has no `$onUpdate` — so the cron's `or(gte(window_end, since), gte(updated_at, since))` 30-day filter (`exam-punya.ts:170, 184`) matches neither disjunct. Toppers get nothing, silently. *(Prior finding `H6` — regressed.)* |
| A-17 | L | Grade a Hindi-medium student's free-text answer | `question_hi` is fetched (`ExamGradingPage.tsx:58`) and never rendered (`:459`); `optionLabelById` maps `option_en` only (`:122`). The grader cannot see the question the student actually read. |
| A-18 | L | Blank an already-awarded mark | Skipped from the payload rather than cleared (`ExamGradingPage.tsx:240-251`) — there is no way to un-grade an answer. |
| A-19 | L | Any API failure in the admin exam screens | `toast.error('Failed.')` (`AdminExtendedPages.tsx:151, 509, 371`) — states neither the problem nor the fix. The server's real sentence goes to a second argument whose rendering depends on `toast-jp` *(not verified)*; no error code is ever branched on. |
| A-20 | L | City with 51+ exams | `limit=50` hardcoded with no pagination (`AdminExtendedPages.tsx:499`); the 51st is unreachable. |
| A-21 | L | Want unlimited practice attempts | Client caps `max_attempts` at 10 (`:105, 258, 336, 464`); `createExamSchema` has `.min(1)` and **no max** — the test suite itself creates an exam with 99. |
| A-22 | L | Clear the marks field when adding a question | `Number(marks) \|\| 1` (`ExamBuilderPage.tsx:119`) silently posts 1 mark. |
| A-23 | L | Screen reader in the question dialog | Correct-option toggle is an icon button with an identical `aria-label="Mark correct"` on every option, no `aria-pressed`, correctness by colour + glyph only (`ExamBuilderPage.tsx:176-183`); option inputs labelled by placeholder only (`:184-204`). |
| A-24 | L | Create an exam in another tab | Builder's exam dropdown is fetched once on mount and never refreshed (`ExamBuilderPage.tsx:288-292`); no loading state, so the Select briefly opens empty. Selecting an exam also clears a still-relevant error banner (`:296-297`). |

---

# 6. Platform / cross-cutting

| # | Sev | Area | Observed vs Expected |
|---|---|---|---|
| X-1 | **CRITICAL** | CI | `test/exams.test.ts:901-941` asserts `PATCH /v1/admin/exams/:id` → 200 and `ERR_RESULTS_PUBLISHED` → 409. Neither exists. `ci.yml` job `test` runs the suite against a seeded Postgres with `include: test/**/*.test.ts` and no skip — **the exams suite cannot be green.** Everything downstream of it is unverified. |
| X-2 | M | Punya | Top-score awards depend entirely on a daily cron with a 30-day lookback that `release-results` never triggers and never widens (A-16). |
| X-3 | L | Concurrency | `/submit` takes **no** advisory lock, unlike `/start` (`exams.ts:1003`) and `/grade` (`:552`), and the `status !== 'in_progress'` check is outside the transaction (`:1287`). **Benign in practice:** the Punya idempotency key makes `awardPunya` return `{awarded:false}` before crediting (`punya.ts:218-225`), and the `(attempt_id, question_id)` unique index serialises the answer upserts. Artifacts are a duplicate audit entry (`:1486`) and a second 200 whose `auto_score` may differ from what persisted. Low — but worth a lock for symmetry. |
| X-4 | L | Perf | `GET /v1/admin/exams` is back to `leftJoin(exam_attempts) … groupBy(online_exams.id, cities.name)` (`admin-modules.ts:169-175`) — the fan-out-then-aggregate pattern the Aug 5 follow-up replaced with a correlated subquery. The reference implementation is still in the same file at `:79`. Correct results, unnecessary work. *(Prior `M5` — regressed.)* |
| X-5 | L | Hygiene | `exam_questions` imported and never used (`admin-modules.ts:14`) — residue of the removed C2 guard. `cityScopeForUser` (`exams.ts:60-79`) duplicates `cityIdsForUser` and omits `isNull(centres.deleted_at)`; **unreachable today** (the fallback branch requires a role `canAdministerExams` excludes) but a live trap if the gate ever widens. |
| X-6 | L | Mobile i18n | `QuickActions.tsx:179` sets `lineHeight: 18` on a label that renders Devanagari (`:185`), overriding `Body`'s own 22 and CLAUDE.md's 22 px minimum — matras clipped on every Hindi home screen. `Pill` (`ui.tsx:284`) has the same gap, and `exams.tsx` renders Hindi pills throughout. |

---

# 7. Regression check against the Aug 4–5 reviews

30 of 38 prior findings are genuinely fixed — including all six criticals from the first pass except C2, plus the whole `N1`–`N8` follow-up set (pool deadlock, unbounded sweep, OTP rate-limit keying, cron-on-import side effect, migration breakpoints). Still outstanding:

| Prior | Status | Evidence |
|---|---|---|
| **C2** — marks/pass-mark decoupled from question sum | **STILL OPEN** (2 rounds) | No `marks-summary` route, no builder total, no release guard. See A-7. |
| **M8** — exam edit/delete route | **STILL OPEN, now actively breaking** | UI and test both call a route that was never built. See A-2. |
| **M5** — admin list query | **REGRESSED** | Correlated subquery reverted to `leftJoin` + `groupBy`. See X-4. |
| **M2** — bilingual (server half) | **REGRESSED** | `title_hi` optional + `?? title_en` restored; `description_en/_hi` dropped from the schema. See A-8. |
| **H6** — Punya (enqueue half) | **REGRESSED** | `release-results` no longer enqueues the top-score job. See A-16. |
| Low — `cityScopeForUser` dedup / `deleted_at` | Still open, unreachable | See X-5. |

**Accepted by design — do not re-report:** `option_en`/`option_hi` vs SPEC's `label_en`/`label_hi`; all-or-nothing multi-choice (no partial credit / negative marking); the one-release legacy plaintext `exam_otp` bridge; `exam_otp` in the admin list (gated, legacy rows only); autosave never writing correctness; gating disclosure on `results_released` even for auto-graded objective exams.

---

# 8. Suggested fix order

**Ship first — the module is down without these**

1. **A-1** — add `title_hi`, `description_en/_hi`, `max_attempts` to `GET /v1/admin/exams`; `?? ''` the form seeds. Unblocks the entire admin surface.
2. **A-2 / X-1** — build `PATCH /v1/admin/exams/:id` (with the `ERR_RESULTS_PUBLISHED` marks lock the test already specifies). Turns CI green and restores edit + un-release.
3. **A-3** — persistent copyable modal for the one-time access code.
4. **E-1** — carry `window_end` into the attempt state on both clients; countdown, T-5 warning, auto-submit at T-0.

**Then — correctness and data safety**

5. **A-6** — reject non-`submitted` statuses in the grade route.
6. **A-4 + E-3** — confirm dialog, `needs_grading` guard, and audit on release; gate the client result screen on `status === 'graded'`.
7. **A-5** — return `needs_grading` / `auto_score` / `manual_score` from the attempts list.
8. **A-7 (prior C2)** — marks-summary endpoint + builder running total + release guard.
9. **E-5 / E-7 / E-6** — per-question autosave state with retry, flush-on-unmount, `networkMode: 'offlineFirst'` for mutations.
10. **E-2** — student attempt-history endpoint + a "My results" entry point.

**Then — RBAC and scope**

11. **S-1 / SN-1** — `canAdministerExams` on the two admin read routes; centre-level filter on the attempts list.
12. **S-2** — page-level guards on `ExamsPage` and `ExamBuilderPage`.
13. **A-8** — restore `description_en/_hi`, require `title_hi`, drop the `?? title_en` fallback.
14. **A-16** — enqueue `EXAM_TOP_SCORE` on release (or correct the docstring and CLAUDE.md).

**Then** — E-4 submit confirmation, A-10 reset UI, A-11 authoring lock UX, E-8 option semantics, A-9 unanswered-question marks, and the remaining Medium/Low rows.

---

*Findings were verified line-by-line against source; every claim above carries a `file:line` citation. Items marked "needs verification" (E-15, A-15, A-19) depend on files outside the reviewed set.*
