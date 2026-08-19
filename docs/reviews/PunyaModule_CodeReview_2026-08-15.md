# Code review — Punya Points module

**Date:** 2026-08-15
**Structure:** persona → navigation → action → observed vs expected
**Companion to:** [`QuizModule_CodeReview_v2_2026-08-15.md`](./QuizModule_CodeReview_v2_2026-08-15.md)

## Scope reviewed

| File | Lines |
|---|---|
| `apps/api-server/src/lib/punya.ts` | 370 |
| `apps/api-server/src/lib/punya-award-limits.ts` | 141 |
| `apps/api-server/src/lib/punya-streak.ts` | 63 |
| `apps/api-server/src/lib/attendance-points.ts` | 231 |
| `apps/api-server/src/services/monthly-leaderboard-snapshot.ts` | 64 |
| `apps/api-server/src/jobs/derived-data-jobs.ts` | 246 |
| `apps/api-server/src/routes/v1/admin-resources.ts` (punya block) | 448–611 |
| `apps/api-server/src/routes/v1/admin-modules.ts` (punya configs) | 662–683 |
| `apps/api-server/src/routes/v1/admin.ts` (`/students/:id/punya`) | 561–608 |
| `apps/api-server/src/routes/v1/me.ts` (`/students/:id/punya`) | 310–341 |
| `lib/db/src/schema/punya.ts` | 171 |
| `apps/jain-pathshala-mobile/app/student/punya.tsx` | 168 |
| `apps/jain-pathshala-mobile/app/shikshak/punya.tsx` | 473 |
| `apps/jain-pathshala-mobile/app/student-detail/[id].tsx` (`AwardPunyaSheet`) | 460–762 |
| `apps/jain-pathshala/src/pages/admin/AdminListPages.tsx` (punya pages) | 900–1030 |
| `apps/api-server/test/punya-{award-limits,idempotency,standings}.test.ts` | 202 / 116 / 205 |

**Also read for cross-checks:** all 69 files in `lib/db/migrations/`, `lib/db/src/seed.ts`, `lib/db/src/schema/enums.ts`, `apps/jp-shared/src/constants.ts`, `apps/api-server/src/lib/scope.ts`, `notify.ts`, `{attendance,homework,exam,quiz,course,niyam}-points.ts`, `exam-punya.ts`, `niyam-badges.ts`, `services/{attendance-mark,attendance-post-process,niyam-approve,course-certify,session-lifecycle}.ts`, `routes/v1/{competitions,exams,homework,quizzes,niyam-submissions,certificates,progress}.ts`, `apps/jain-pathshala-mobile/lib/queries.ts`, `apps/jain-pathshala/src/{components/admin/sidebar-nav.ts,routes/AdminRoutes.tsx,pages/admin/{Progress,Analytics,Dashboard}Page.tsx}`, SPEC §5.7 / §6.9 / §8.5 / §8.16 / §13.4 / §17.3 / Step 16, BRD §7.1–7.6.

---

## Summary

The award engine at the centre of this module is the best-written code in it. `awardPunya` / `reversePunya` (`punya.ts:184-370`) compose the ledger insert, the balance upsert and the tier recompute into one caller-supplied transaction, with a partial unique index on `idempotency_key` and `ON CONFLICT DO NOTHING` making replays exactly-once. `creditBalance` moves the balance in a single statement. The attendance, homework, exam-completion, quiz and course paths all use it correctly, with revision-scoped keys and real reverse-then-award correction. That core is sound.

Almost everything built around it is not.

**The Guruji's only Punya screen has never worked.** `apps/jain-pathshala-mobile/lib/queries.ts:904` calls `GET /v1/admin/batches/:batchId/punya-standings`. That route does not exist — `grep -rn "standings" apps/api-server/src` returns zero hits across all 39 route files. `apps/api-server/test/punya-standings.test.ts` asserts `200` against it at `:146` and `:191`, so **two tests in this module fail on every CI run**, and the third (`:99`, expecting 404 for an out-of-scope batch) passes for the wrong reason. The module's test suite is red, which is why nothing below was caught.

**On a database built from migrations, marking a student present awards nothing.** `ATTENDANCE_FEATURE_KEY = "attendance"` (`attendance-points.ts:11`), but no migration in the 69-file set ever inserts an `attendance` row into `punya_features` or `punya_configs` — the twelve keys the migrations seed are `niyam_completion`, `attendance_streak`, `homework`, `homework_starred`, `exam_completion`, `exam_top_score`, `quiz_participation`, `quiz_win`, `push_quiz_completion`, `manual_award`, `course_section_certified`, `course_completed`. Unlike its three sibling resolvers, `resolveAttendanceAwardPointsForCity` has no hardcoded last resort: `feat?.max_points ?? feat?.min_points ?? 0` (`:183`) returns 0, `awardValueForStatus` returns 0, and `attendance-mark.ts:244` short-circuits on `amount <= 0` without writing a ledger row at all. It is invisible in development because `seed.ts:162` inserts `attendance` with `max_points: 10` — and `seed.ts:148` truncates the table first, so the two sources of truth have diverged in both directions (seed adds `attendance`, drops `attendance_streak`). Step 16's exit criterion — *"marking a student present awards 10 Punya"* — does not hold in production.

**A city_admin cannot set city point values, and trying rewrites the national default.** `createPunyaConfigSchema` (`admin-modules.ts:662-666`) has no `city_id` field, so `POST /v1/admin/punya/configs` always writes `city_id = NULL`. It is a bare `db.insert` with no `ON CONFLICT`, against a table with **no unique constraint on `(feature_key, city_id)`** — and every resolver reads with `.limit(1)` and no `ORDER BY`. So a Mumbai city_admin raising attendance to 15 inserts a second *global* row; which of the two wins is whatever Postgres returns first, can differ per API instance, and can flip after a restart or VACUUM. The route writes **no audit entry**, so the change that altered national point economics leaves no trace. `punya_features.key` has no unique constraint either.

**BRD §7.6 — leaderboards — is not built.** There is no `/v1/leaderboard` route at any scope, no Redis sorted sets (`zadd`/`zincrby`/`lb:*` return zero hits repo-wide), no `punya.tier.recompute` queue, and no tier-display mode or Collective Punya Pool. What exists is `monthly_leaderboard_snapshots`, which **nothing ever reads**, populated by a job bound to `*/5 * * * *` (`constants.ts:57`) rather than monthly, from `punya_balances.total_points` — a **lifetime** cumulative total that is never reset. Every month's "monthly leaderboard" is a copy of the lifetime ranking with a month label on it.

**BRD §7.5 — recognition — is not built either.** No code anywhere detects a tier *transition*: `creditBalance` computes the new tier in SQL and then discards it (`returning total_points`, `punya.ts:114`), the bulk path has no `RETURNING` at all, `punya_balances` has no `tier_reached_at`, and there is no `punya`/`tier` notification kind in the enum. Crossing into Sadhak produces no animation, no parent push, and no certificate. The three named badges (Perfect Month, Seva Star, Paryushan Champion) return zero grep hits.

Separately, and squarely a product problem: **the manual award is a single undifferentiated bucket with an optional reason.** `punyaAwardSchema` (`admin-resources.ts:487-496`) accepts `{student_id, points, note?}` — no `feature_key`, and `note` is `.optional()`. BRD §7.2 defines five distinct manual categories and says amount **and reason** are mandatory for three of them. All five collapse into `manual_award`, and the web form labels the field *"Note (optional)"*.

**Verdict: Request changes.** C1–C3 are release blockers. C2 should be verified against the production database today — if it was built from migrations rather than `seed.ts`, no attendance Punya has ever been awarded.

---

## Findings index

Severity is by blast radius × likelihood, not by how hard the fix is.

### Critical

| ID | Finding | Where |
|---|---|---|
| **C1** | `punya-standings` route does not exist — the Guruji's only Punya screen 404s, and two tests assert 200 against it | `queries.ts:904`; `punya-standings.test.ts:146,191`; absent from `routes/v1/` |
| **C2** | No migration seeds the `attendance` feature — every attendance mark awards 0 and writes no ledger row | `attendance-points.ts:11,183`; `attendance-mark.ts:244`; `seed.ts:162` |
| **C3** | `POST /punya/configs` cannot write a city override, always INSERTs into an unconstrained table, and is unaudited | `admin-modules.ts:662-683`; `schema/punya.ts:43`; `attendance-points.ts:146-186` |

### High

| ID | Finding | Where |
|---|---|---|
| **H1** | "Monthly" snapshot stores lifetime totals, runs every 5 minutes, and nothing reads the table | `monthly-leaderboard-snapshot.ts:36`; `constants.ts:57`; `derived-data-jobs.ts:176-186` |
| **H2** | No leaderboard API, no Redis zsets, no tier-display mode, no Punya Pool — BRD §7.6 unbuilt | `routes/v1/` (absent); SPEC §6.9, §8.5, §17.3 |
| **H3** | Nightly reconcile never fixes `tier`, can't reach ledger-less balances, never alerts, and can create drift | `derived-data-jobs.ts:115-127` |
| **H4** | No tier-transition detection → no celebration, no parent push, no certificate | `punya.ts:114,153-176`; `enums.ts:129-144`; `certificates.ts` |
| **H5** | Web award sends no `idempotency_key` → double-award; and no reversal route exists from any client | `AdminListPages.tsx:970-974`; `admin-resources.ts:493-496` |
| **H6** | Manual award has no category and an optional reason — BRD §7.2's five categories unrepresentable | `admin-resources.ts:487-496`; `AdminListPages.tsx:1016` |
| **H7** | Daily award cap is read-check-write with no lock → concurrent bypass | `admin-resources.ts:549-583`; `punya-award-limits.ts:125-141` |
| **H8** | Streak bonus hardcoded at 20 while a live admin-editable config row is never read (AT21) | `attendance-post-process.ts:34,204,354`; migration `0012:282-286` |
| **H9** | Streak milestones are never reversed on retroactive correction → repeatable over-award | `attendance-post-process.ts:350-360`; `punya-streak.ts:26-55` |
| **H10** | `exam_top_score` has no reversal path — a re-grade pays two "top scorers" permanently | `exam-punya.ts:169-237`; `exam-jobs.ts:38` |
| **H11** | Competition awards have no reversal and rank edits are blocked once published | `competitions.ts:363-366,462-476` |
| **H12** | Niyam awards `niyam_submission`, a key in no catalogue → city override dead, analytics drop niyam Punya | `niyam-points.ts:8,72`; `niyam-approve.ts:159` |
| **H13** | Transaction history hard-capped at 50 with no pagination → balance never reconciles with the visible list | `me.ts:334`; `admin.ts:598` |
| **H14** | Raw lowercase tier enum and English feature keys on every family-facing surface | `student/punya.tsx:50,103`; `parent/home.tsx:137,246`; `[id].tsx:410,425` |
| **H15** | No UNIQUE on `punya_features.key` or `punya_configs(feature_key, city_id)` | `schema/punya.ts:23,43`; `0000_baseline.sql:267-274` |
| **H16** | `GET /punya/transactions` is centre-scoped for batch-restricted roles, has no cursor, and `hasMore` is always false | `admin-resources.ts:462-486`; `AdminListPages.tsx:908-921` |
| **H17** | Web award student picker silently truncates at 200 alphabetically, with no search | `AdminListPages.tsx:962`; `admin.ts:398,477` |
| **H18** | Web award page never calls `/award-limit`; `max` hardcoded to 500 | `AdminListPages.tsx:1009` |
| **H19** | Config writes invalidate only attendance + homework caches, and never clear Redis | `admin-modules.ts:678-681`; `attendance-points.ts:37,117-120` |

### Medium

| ID | Finding | Where |
|---|---|---|
| M1 | Ledger missing `city_id`/`centre_id`/`batch_id`/`is_msv_track`/`awarded_at` → MSV track has no data model | `schema/punya.ts:81-121` vs SPEC §5.7 |
| M2 | `punya_balances` missing `msv_points` and `tier_reached_at` | `schema/punya.ts:123-134` |
| M3 | `punya_features` missing `default_points`/`is_manual`/`requires_reason`/`scope`; resolvers use `max_points` as the default | `schema/punya.ts:21-29`; `attendance-points.ts:183` |
| M4 | BRD §7.5 badges (Perfect Month, Seva Star, Paryushan Champion) not implemented | zero grep hits repo-wide |
| M5 | No `punya`/`tier` notification kind; `attendance_streak` kind is declared but never sent | `enums.ts:129-144`; `punya-streak.ts` |
| M6 | `reversePunya` trusts caller-supplied `points`, never verifies the original exists or is unreversed | `punya.ts:298-333` |
| M7 | Homework re-grade equality gate compares *current* config, not the ledger amount | `homework.ts:1355-1375` |
| M8 | `homework_starred` is a catalogue row that never reaches the ledger | `homework.ts:194,1413` |
| M9 | `GET /punya/configs` is unscoped across all cities and omits `city_id` from the response | `admin-resources.ts:448-459` |
| M10 | No PATCH/DELETE for configs — a bad row can only ever be shadowed by another insert | `admin-modules.ts:669` |
| M11 | Student Punya screen nests a `FlatList` in a `ListHeaderComponent` and renders all 50 rows eagerly | `student/punya.tsx:118-126,148-151` |
| M12 | Admin Punya routes have no role guard — the gate is nav-only | `AdminRoutes.tsx:112-114` vs `sidebar-nav.ts:82-83` |
| M13 | Reversals render as `+-20` in the positive colour on the web audit table | `AdminListPages.tsx:934` |
| M14 | Dashboard labels a rolling-30-day figure as "this month"; Analytics calls the same field "(30d)" | `DashboardPage.tsx:69`; `admin.ts:217` |
| M15 | Replay check is unscoped to student/awarder → skips limit checks and leaks an arbitrary transaction's points | `admin-resources.ts:534-541` |
| M16 | Snapshot writes every active student, not top-20 as BRD §7.6 specifies | `monthly-leaderboard-snapshot.ts:44-51` |
| M17 | "Financial-grade" ledger immutability is convention only — no trigger, rule or REVOKE | all migrations |
| M18 | No reversal/undo route for a manual award — a mis-targeted award is permanent | `routes/v1/` (absent) |
| M19 | Route shape drifts from SPEC §6.9 (`/punya/balance` + `/punya/transactions` merged; no `/v1/leaderboard`) | `me.ts:311`; `admin.ts:562` |
| M20 | Tier ladder conflict: code is 0/101/501/1501/5001; BRD §7.4 says 0/200/500/1000/2000 | `enums.ts:169-175` vs BRD §7.4 |

### Low

| ID | Finding | Where |
|---|---|---|
| L1 | Award note has no client-side `maxLength` → silent 422 at 500 chars | `AdminListPages.tsx:1017`; `admin-resources.ts:490` |
| L2 | All three web Punya pages are English-only (`useLocale` count: 0) | `AdminListPages.tsx` |
| L3 | Tirthankar tier pill is 2.25:1 against `muted`; Jigyasu 3.82:1 — both fail WCAG AA | `shikshak/punya.tsx:441-450` |
| L4 | Tier `Pill` is `fontSize: 11` with no `lineHeight` — clips Devanagari matras (CLAUDE.md floor is 22px) | `components/ui.tsx:284` |
| L5 | Award steppers, preset chips, batch chips and student rows have no accessibility role or label | `[id].tsx:631-727`; `shikshak/punya.tsx:176-197,318-338` |
| L6 | `void apiGet(...)` with no `.catch` → unhandled rejection and a permanently empty picker | `AdminListPages.tsx:962` |
| L7 | `c.primary + "14"` assumes the token is 6-digit hex | `[id].tsx:713` |
| L8 | `TIER_ORDER` duplicates the server enum client-side | `shikshak/punya.tsx:20` |
| L9 | `clearAttendancePointsCache` never calls `redisDel` — assigned at `:37`, never invoked | `attendance-points.ts:117-120` |
| L10 | `sourceFromKey` writes the feature key into `source_entity_kind` when no idempotency key is given | `punya.ts:56-64` |
| L11 | A parent not in student view has no route to the Punya ledger at all | `parent/home.tsx:225-252`; `QuickActions.tsx:31-39` |
| L12 | Error codes compared as string literals rather than the shared catalogue | `[id].tsx:542-543` |

---

## Persona walkthrough

The requested spine. Each row is one concrete journey. **Ref** links to the findings index.

### 1. Guest 🌐

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Public website | See any Punya content | Nothing exists. `routes/v1/public.ts` has zero Punya references, and both read routes sit behind `requireAuth` | ✅ Correct. Student point totals are personal data and should not be public | — |
| Public website | See a city leaderboard or top-student wall | Also nothing — but here it is absence by omission, not by design. BRD §7.6 and §7.5 (monthly top student, certificates) imply a recognition surface that was never built anywhere, public or private | Product decision, but note it is unreachable from *every* surface, not just this one | **H2** |

---

### 2. Student (student view) 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Tab bar → **पुण्य** | Open the screen | Works. `/student/punya` is registered under `allowed={["student"]}` (`student/_layout.tsx:9`) | ✅ | — |
| Punya screen | Read the tier badge | Renders the **raw lowercase enum** — `shravak` — in 11px Latin. `Pill` prints the string verbatim (`ui.tsx:284`), and `student/punya.tsx:103` passes `summary?.tier` straight through. A correct bilingual `tierLabel()` exists at `shikshak/punya.tsx:68-78` but is file-local and unexported | Export `tierLabel()` to a shared module and use it on all five tier render sites. The tier badge is the emotional payload of the whole module | **H14** |
| Punya screen | Read the transaction list in Hindi | English. `humanize(feature_key)` (`:13-19,50`) title-cases the raw key → *"Attendance Streak"*, *"Manual Award"*. The heading, totals label and dates around it are all Devanagari. `SOURCE_LABELS` (`shikshak/punya.tsx:22-29`) already maps these bilingually — again file-local, and on the one screen that is dead | Move `SOURCE_LABELS` to shared i18n and render through it | **H14** |
| Punya screen | Understand a **−20** row | A red *"Niyam"* −20 sits next to a green *"Niyam"* +20, identical labels. `reversePunya` writes the same `feature_key` with negative points (`punya.ts:322-333`); nothing in the copy explains a reversal, and `rejection_reason` is not joined in | Label reversals distinctly and surface the reason. A child seeing points silently removed with no explanation is the worst possible version of this screen | **H14**, M6 |
| Punya screen | Scroll to their 51st transaction | Impossible. Both read routes hard-`limit(50)` (`me.ts:334`) with no cursor, offset or date filter, and the screen has no "load more" and **no truncation indicator**. Attendance alone reaches 50 rows in ~4 months | Cursor pagination, as SPEC §6.9 specifies (*"paginated"*). Until then the total and the visible list disagree with no explanation | **H13** |
| Punya screen | See how far to the next tier | Nothing renders it — and it cannot be built. No endpoint returns thresholds or next-tier distance, and no client hardcodes them (verified: zero hits for `101`/`501`/`1501`/`5001` in either app) | Return `next_tier` and `points_to_next` from the balance endpoint | **H4** |
| Cross 501 points into Sadhak | Get the celebration | Nothing happens. `creditBalance` computes the new tier in SQL then discards it (`returning total_points`, `punya.ts:114`); the old tier is never read, so old-vs-new is unavailable **by construction**. No animation, no push, no certificate | BRD §7.5 / Step 16: *"tier upgrade emits a domain event → celebration animation push + certificate generation job."* Add `RETURNING tier` plus the pre-image, and `tier_reached_at` to the schema | **H4**, M2 |
| Punya screen | See their rank in the batch | No rank anywhere. No leaderboard endpoint exists at any scope | BRD §7.6 defines four leaderboards | **H2** |
| Punya screen | See a badge | None. The three BRD §7.5 badges return zero grep hits. `niyam_badges` exists but is a different feature (streak lengths) and renders only under Niyams | — | M4 |
| Scroll a long list | — | The screen nests a `FlatList` with `scrollEnabled={false}` inside the `ListHeaderComponent` of an outer `FlatList` with `data={[]}` (`:118-126,148-151`). All 50 rows mount eagerly; virtualization is defeated | Render the transactions as the outer list's `data` | M11 |

---

### 3. Parent — Abhivaavak 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home | See the child's Punya total | The card renders (`parent/home.tsx:225-252`) — but it is a plain `<Card>`, not a `Pressable`, unlike the attendance card at `:157`. `/student/punya` is gated `allowed={["student"]}`, and `PARENT_ACTIONS` (`QuickActions.tsx:31-39`) has no Punya entry | **A parent has no route to the ledger at all.** Either open the screen to the parent role or add a Quick Action | L11 |
| Home card | Read the tier | Raw enum again, at `:137` and `:246` | | **H14** |
| Child switcher → second child | Compare | Ownership is enforced server-side by `ownedStudentId` (`me.ts:313`) — correct. The card reads per-child state properly | ✅ | — |
| Anywhere | Be told the child reached a new tier | Never. No notification kind for punya or tier exists in `NOTIFICATION_KINDS` (`enums.ts:129-144`), and `notify.ts` is never imported by any award path. Even `attendance_streak` is a declared kind that nothing ever sends — AT22 bonuses are awarded silently | BRD §7.5: tier upgrade → push to parent. Add the kind and emit it | **H4**, M5 |
| Notice a wrong award | Ask for it to be undone | There is no reversal route for a manual award on any surface, and no client exposes one. `reversePunya` exists in `lib/` and is unreachable over HTTP | Expose a scoped, audited reversal | M18 |

---

### 4. Shikshak — Guruji / Didi 📱🖥

This persona has the most Punya authority in the BRD and the least working software.

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Quick Actions → **पुण्य स्थिति** | Open batch standings | **404, every time, since it shipped.** `useBatchPunyaStandings` calls `GET /v1/admin/batches/:id/punya-standings` (`queries.ts:904`); the route exists nowhere in `apps/api-server/src`. The screen renders its error state and the retry loops forever. This is the *only* Punya oversight surface on mobile | Build the route. The 473-line screen, the query hook and 205 lines of tests are all written against a contract with no server side | **C1** |
| — | Trust CI to have caught it | It did not, because nobody is watching. `punya-standings.test.ts:146` and `:191` assert `200` and **fail on every run**; `:99` asserts 404 and passes for the wrong reason (route missing, not scope denied) | Fix C1, then treat a red module suite as a merge blocker | **C1** |
| Mark a full roster present | Award 10 Punya each | On a **migration-built** database: nothing. No `attendance` row in `punya_features` → `resolveAttendanceAwardPointsForCity` returns 0 (`attendance-points.ts:183`) → `awardValueForStatus` returns 0 → `attendance-mark.ts:244` returns before writing any ledger row. Silent. On a `seed.ts` database it awards 10 (`seed.ts:162`) | Add the `attendance` feature + config rows in a migration, and give the resolver a last-resort default like its three siblings. **Check production before anything else** | **C2** |
| 4 sessions attended | Earn the streak bonus | Awards 20 — from `STREAK_BONUS_POINTS = 20` hardcoded at `attendance-post-process.ts:34`. Migration `0012:282-286` inserts a `punya_configs('attendance_streak', 20)` row, and `admin-modules.ts:673` lets an admin edit it. **Nothing reads it.** Raising it to 30 updates the row, shows success, and changes nothing forever | Resolve through the catalogue. A control that looks functional and is inert is worse than a missing one | **H8** |
| Retroactively correct S2 to absent | Have the streak re-settle | **Over-awards, repeatably.** S1–S8 present → milestones at S4 and S8 → +40. Correcting S2 calls `reverseStreakBonusForSession` for *S2*, which never held a bonus, so nothing reverses (`punya-streak.ts:26-55`). Post-process recomputes from S3 (6 sessions → milestone at S6) and awards a **new** +20. Student now holds 60 where 20 is due — and it repeats on every correction | Reverse all milestone bonuses at or after the corrected session before recomputing | **H9** |
| Student detail → **Award Punya** | Give 10 for seva | Works, and this sheet is the best client code in the module: reason required (`[id].tsx:696`), limits shown pre-submit (`:624-628`, `:740-746`), idempotency key minted once on open and reused on retry (`:487-493`) | ✅ Genuinely good | — |
| Same sheet | Record *which* kind of seva | Impossible. `punyaAwardSchema` (`admin-resources.ts:487-496`) has no `feature_key`. BRD §7.2's five categories — festival 15, seva 10–50, helping others 10–30, competition, MSV shivir — all collapse into one `manual_award` row with a free-text note | Add `feature_key` validated against `punya_features`, with per-category min/max | **H6** |
| Submit twice on a flaky connection | — | Safe on mobile (key reused). **Not safe on web** — see the City Admin row | **H5** |
| Award 10, then 10 again, concurrently, at 40/50 used | Hit the daily cap | Both requests read `points_awarded_today = 40` (`admin-resources.ts:550`), both pass the check at `:559-567`, both commit → 60 against a 50 cap. No row lock, no advisory lock, no post-award verification, and no reconciliation would ever catch it | Enforce the cap inside the award transaction, or claim a daily-budget row | **H7** |
| Admin panel → Punya audit | Review their batch's ledger | Two problems. `GET /punya/transactions` filters by `scopedCentreFilter(scope, students.centre_id)` (`admin-resources.ts:466`), and `resolveAdminScope` gives a shikshak `centreIds` for their whole centre — so a batch-restricted role reads the **entire centre's** ledger. Niyam solved this with `inBatchWriteScope`; this route does not consult `batchIds` | Filter on `batchIds` for batch-restricted roles | **H16** |
| Same page | Page past row 200 | Cannot. The route returns `ok(res, {items}, {count})` with **no `next_cursor`**, while `useAdminList` derives `hasMore` from exactly that field — so the Load More button is permanently inert and the audit silently truncates | Cursor pagination on both sides | **H16** |
| Admin panel → Punya configs | Open the page | Renders. `AdminRoutes.tsx:112-114` has **no role guard** — only `sidebar-nav.ts:82-83` (`min: 'city_admin'`) hides the link. Typing the URL loads the page and the "New config" dialog; the GET succeeds (`admin-resources.ts:72` admits shikshak), only the POST 403s | Guard the route, not just the nav — the pattern CLAUDE.md Q2 forbids | M12 |

---

### 5. Sanchalak — centre head 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Mobile | Open batch standings | Cannot reach it at all. `roleAllowed` is a flat `includes` (`roles.ts:29-31`) and `shikshak/_layout.tsx:8` is `allowed={["shikshak"]}`; `SANCHALAK_ACTIONS` (`QuickActions.tsx:63-89`) has no Punya entry either. (Moot while C1 stands) | Make role gates hierarchical, or add the entry | **C1**, L11 |
| Student detail → Award | Award 25 for a centre-wide seva | Works. `inBatchWriteScope` falls back to centre membership when `batchIds` is null (`scope.ts:134`), and the seeded ceiling is 25/award, 150/day (`seed.ts`) | ✅ Correct scoping | — |
| Punya audit | Read the centre ledger | Correct for this role — `scopedCentreFilter` matches their actual scope. Still uncursored | H16 | **H16** |
| Anywhere | Reverse a wrong award made by their shikshak | No route exists | M18 | M18 |

---

### 6. City Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Sidebar → **Punya configs** → New config | Set attendance to 15 for their city | **Rewrites the national default.** The Zod schema (`admin-modules.ts:662-666`) has no `city_id`, so the insert writes `city_id = NULL`. There is no `ON CONFLICT` and no unique index on `(feature_key, city_id)`, so a second global row now competes with the first, and `attendance-points.ts:163-174` picks one with `.limit(1)` and **no `ORDER BY`** — non-deterministic, and able to flip after a restart or VACUUM. Pune students start earning 15 | Add `city_id` to the schema and payload, add the unique index, and make it an upsert | **C3**, **H15** |
| Same action | Have it logged | **No audit entry.** `auditFromReq` is absent from the handler — while the niyam route immediately above it at `:653` does audit. Changing platform-wide point economics is the single action most deserving of an append-only log | Add `auditFromReq` | **C3** |
| Same action | Set 10,000 points | Accepted. Zod allows `0..10000` (`:664`) with **no clamp against `punya_features.min_points`/`max_points`**. This is the quiz review's H1, at its source | Clamp to the catalogue bounds or 422 | **C3** |
| Fix a config they got wrong | Edit or delete it | No PATCH, no DELETE. The only correction is another INSERT, which compounds the duplicate problem | Add PATCH/DELETE | M10 |
| Punya configs list | See which city a row belongs to | `GET /punya/configs` selects `id, feature_key, points, is_active` — **not `city_id`** — and is unscoped across all cities (`admin-resources.ts:448-459`). Global and city rows are indistinguishable in the UI | Return `city_id` and scope the list | M9 |
| Change attendance points | Have it take effect | Partially. `admin-modules.ts:678-681` clears only the attendance and homework caches — `clearExamPointsCache`, `clearQuizPointsCache` and `clearCoursePointsCache` are never called from anywhere. And `clearAttendancePointsCache` clears only the in-memory maps: `redisDel` is assigned at `attendance-points.ts:37` and **never invoked**, so with Redis on the old value survives the full 5-minute TTL on every instance | Clear all five caches and actually DEL the Redis keys | **H19**, L9 |
| Sidebar → **Award Punya** | Find a student | The picker requests `limit=500`; the server clamps to 200 (`admin.ts:398`) and orders `full_name ASC` (`:477`), returning a `next_cursor` the page discards. Over ~1,200 students, everyone alphabetically past #200 is unawardable — with no search box and no truncation notice | Typeahead search against the students endpoint | **H17** |
| Award form | Know their limit before submitting | The form hardcodes `max={500}` (`AdminListPages.tsx:1009`) and never calls `/v1/admin/punya/award-limit`. A shikshak on this page (nav `min: 'shikshak'`) types 50, submits, and gets *"the limit is 10 Punya per award"* — after the fact. The mobile sheet does all of this correctly with the same already-built endpoint | Call `/award-limit` and drive `max` and the daily remainder from it | **H18** |
| Award form | Submit on a flaky connection | **Double-awards.** `apiPost` sends `{student_id, points, note}` with **no `idempotency_key`** (`:970-974`) — the field the server author added for exactly this case (`admin-resources.ts:493-496`), and which mobile already sends (`[id].tsx:518`). The request commits, the response times out, she clicks again → 200 Punya, two indistinguishable ledger rows, no reversal UI anywhere | Send a key minted once per form open | **H5** |
| Award form | Leave the reason blank | Allowed — the label reads **"Note (optional)"** (`:1016`) and the server schema is `.optional()`. Mobile requires ≥3 chars. So web-originated rows show `—` in the audit | BRD §7.2: amount **and reason** mandatory. Make it required in the schema, backed by a `requires_reason` catalogue column | **H6**, M3 |
| Punya audit | Read a reversal row | Renders as **`+-20`** in the positive saffron colour — `+{t.points}` is unconditional (`:934`) while the route applies no sign filter | Branch on sign | M13 |
| Any Punya page | Read it in Hindi | English only. `grep -c useLocale AdminListPages.tsx` = **0**, while sibling admin pages are bilingual (`NiyamReviewPage.tsx:348`, `AnalyticsPage.tsx:49`) | | L2 |
| Dashboard | Read "Punya awarded — this month" | Mislabelled. The server computes a **rolling 30 days** (`admin.ts:217`); `DashboardPage.tsx:69` says "this month" while `AnalyticsPage.tsx:72` calls the same field "(30d)". The two pages contradict each other | Pick one and label it accurately | M14 |

---

### 7. State Admin 🖥

Inherits every City Admin row. State-specific:

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Punya configs | Set points for one city in their state | Same as C3 — impossible, and the attempt is national. For a state_admin the blast radius is identical to a city_admin's: both write `city_id = NULL` | **C3** | **C3** |
| Punya audit | Read the state's ledger | Works via `scopedCentreFilter` over `resolveAdminScope` state centres. Still capped at 200 with a dead Load More | H16 | **H16** |
| Anywhere | Compare cities in their state | No aggregate exists. `monthly_leaderboard_snapshots` holds per-city ranks but **nothing reads the table** — no route, no service, no page, no mobile query. It accumulates one row per active student per month, forever, with no consumer | Either expose it or stop writing it | **H1**, M16 |

---

### 8. Super Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Everything above | — | `resolveAdminScope` returns `centreIds: null`, so scope filters short-circuit. Every other defect applies unchanged | — | — |
| Punya features catalogue | Add or edit a feature | **No route exists.** SPEC §6.9 specifies `POST /v1/admin/punya/features` as super_admin-only; the catalogue is writable only by migration or `seed.ts`. And `punya_features.key` has **no unique constraint** (`schema/punya.ts:23`; `0000_baseline.sql:267-274`), so a second `attendance` row is insertable and would be picked non-deterministically | Build the CRUD, add the unique index | **H15**, M19 |
| Feature catalogue | Rely on `default_points` | The column does not exist. Resolvers fall back to **`max_points`** as the default (`attendance-points.ts:183`) — a feature's *ceiling* used as its normal value. `is_manual`, `requires_reason` and `scope` are also missing, so BRD §7.2's "reason mandatory" cannot be expressed as data | Add the four SPEC §5.7 columns | M3 |
| Platform settings | Confirm the leaderboard workers are running | There are none. No `zadd`/`zincrby`/`lb:*` anywhere; `QUEUE_NAMES` has only `PUNYA_LEADERBOARD_REFRESH` and `PUNYA_RECONCILE` (`constants.ts:21-22`) — `PUNYA_TIER_RECOMPUTE` from SPEC §9.1 is absent, and there is no `infra/queue/` directory at all | SPEC §8.5, §17.3 | **H2** |
| Check the monthly leaderboard job | Confirm the schedule | Bound to **`*/5 * * * *`** (`constants.ts:57`), not 1st-of-month 00:30 IST. ~8,640 runs/month; the first tick after midnight IST on the 1st wins the `ON CONFLICT DO NOTHING`, and the other ~8,600 are full-table window-function scans over `punya_balances ⋈ students ⋈ centres` | Move to a monthly cron | **H1** |
| Read a "monthly" leaderboard | Trust the ranking | It is a **lifetime** ranking with a month label. The query reads `pb.total_points` (`monthly-leaderboard-snapshot.ts:36`), a cumulative balance that is never reset, and ranks on it. A student who earned 5 points in November but holds 4,000 lifetime ranks #1 for November | BRD §7.6: centre and city leaderboards **reset monthly**. Rank on `SUM(points)` over the month's ledger rows | **H1** |
| Corrupt a balance, run the reconcile | Restore correctness and get alerted | Neither. `derived-data-jobs.ts:115-127` omits `tier` from the `DO UPDATE` and hardcodes `'jigyasu'` on insert (`:121`) — so a Tirthankar restored to 6,200 points keeps `tier='jigyasu'` forever. Students with a balance row but no ledger rows are unreachable by the `GROUP BY`. There is no drift comparison, no log, no notification. And because it **SETs** rather than increments from a statement-start snapshot, an award committing mid-statement has its ledger row kept and its balance delta erased — the job can create the drift it exists to remove | Step 16 exit criterion: *"restores correctness **and alerts ops**."* Recompute tier, use a full outer join, diff before writing, alert on any delta | **H3** |
| Audit the ledger | Trust it as append-only | Convention only. No production code UPDATEs or DELETEs it, but there is **no trigger, no rule, and no `REVOKE UPDATE, DELETE`** in any of the 69 migrations — unlike the audit log, which uses a dedicated INSERT-only role. A single stray `UPDATE` corrupts it, and the reconcile job then propagates that corruption into `punya_balances` and makes it authoritative | Enforce at the database | M17 |
| Tier thresholds | Confirm the ladder | **Three documents disagree.** Code: 0 / 101 / 501 / 1501 / 5001 (`enums.ts:169-175`). SPEC §5.7 cites AT23 as "0–100 … 5001+" — consistent with code. BRD §7.4 says 0–199 / 200–499 / 500–999 / 1,000–1,999 / 2,000+. No client hardcodes a ladder (verified), so the code is at least internally consistent — but it does not match the business document | Reconcile with the business owner and amend whichever document is wrong | M20 |
| MSV parallel track | Find it | No data model. `punya_transactions` has no `is_msv_track` and `punya_balances` has no `msv_points` (SPEC §5.7). BRD §7.5's MSV-specific tier labels and §7.6's MSV leaderboard have nothing to build on | Add the columns before promising the feature | M1, M2 |

---

## Cross-cutting: catalogue integrity

Three feature keys are awarded at runtime that exist in **no** catalogue — not in migrations, not in `seed.ts`:

| Key | Awarded at | Consequence |
|---|---|---|
| `niyam_submission` | `niyam-points.ts:8`, `niyam-approve.ts:159` | Both `punya_configs` lookups always miss, so `resolveNiyamAwardPoints` falls through to `return niyamPoints` (`:72`). The catalogue holds `niyam_completion`, used only for bounds validation — so a city override set against the key the admin UI shows has **zero effect on awards**. Every niyam ledger row joins to no feature, silently dropping niyam Punya from catalogue-joined analytics |
| `niyam_badge` | `niyam-badges.ts:75`, value hardcoded at `:17` | Same orphaning; AT21 not applied |
| `competition` | `competitions.ts:474` | No catalogue indirection at all — points come from `competitions.winner_points` / `participant_points` columns (`:465`) |

And two catalogue rows are dead: **`homework_starred`** exists but both grade paths award `featureKey: "homework"` regardless of starred status (`homework.ts:194,1413`), so no transaction is ever attributable to it; **`attendance_streak`** has a config row that no code reads (H8).

**Reversal coverage** by source:

| Source | Reversal on correction | Amount read from |
|---|---|---|
| Attendance mark | ✅ status change + force-cancel | Ledger ✅ |
| Attendance streak | ⚠️ session-scoped only — see **H9** | Ledger ✅ |
| Niyam | ✅ reject within 30 days | Stored `points_awarded` ✅ |
| Niyam badge | ❌ deliberate (documented at `niyam-badges.ts:4-5`) | — |
| Homework | ✅ un-grade / re-grade / force-delete | Ledger ✅ (but the *gate* recomputes — **M7**) |
| Exam completion | ✅ reverse-then-award | Ledger ✅ |
| **Exam top score** | ❌ **none** — **H10** | — |
| Quiz event | ✅ attempt reset | Ledger ✅ |
| **Push quiz** | ❌ none (carried from the Quiz review, H12) | — |
| Course certify | ✅ decertify | Ledger ✅ |
| **Competition** | ❌ **none**, and rank edits blocked post-publish — **H11** | — |
| **Manual award** | ❌ no route on any surface — **M18** | — |

`reversePunya` itself trusts the caller's `points` and never verifies the original exists or is unreversed (`punya.ts:298-333`); when the original is missing it writes an orphan debit with `reversal_of = null` rather than failing (**M6**).

---

## Test gaps

**11 cases across three files — and the suite does not pass.** `punya-standings.test.ts:146` and `:191` assert `200` against a route that does not exist (**C1**); `:99` asserts 404 and passes vacuously.

Covered well in `punya-award-limits.test.ts` (6 cases): the `/award-limit` response shape, shikshak in-batch success, shikshak out-of-batch 404, sanchalak centre-wide success, per-award ceiling 422, daily cap 429 with the ledger verified unchanged, and idempotent replay crediting once. `punya-idempotency.test.ts` (2 cases) covers double-award and double-reverse.

Not covered at all:

- **Concurrency — nothing anywhere.** No test issues concurrent requests. The daily-cap test drains the budget strictly sequentially in an `await` loop, so it cannot detect **H7** by construction.
- **Tier boundaries — zero.** No test in `apps/api-server/test` references `tierForPoints` or `creditBalance`. The 100/101, 500/501, 1500/1501 and 5000/5001 edges are untested, as is the SQL `CASE` ladder in `creditBalance` that *duplicates* that arithmetic — two implementations of the same rule with no test asserting they agree. Negative balances are untested too.
- **Config precedence — zero.** Nothing exercises the city → global → feature fallback, and nothing covers the duplicate-row non-determinism at its heart (**C3**).
- **Reversal beyond the happy path.** No test for reverse-then-award pairs, for targeting the most recent *unreversed* award, for a reversal whose original is absent, or for double reversal via different keys.
- **`POST /punya/configs` has no test at all** — its `requireRole` guard is unverified, and so is the missing-`city_id` defect.
- **Reconcile and snapshot jobs — zero.** No test references `PUNYA_RECONCILE`, `snapshotMonthlyLeaderboard` or `monthly_leaderboard_snapshots`. Step 16's exit criterion (corrupt a balance, run the reconcile, expect correctness + an alert) has no test — consistent with the job not meeting it.
- **Role negatives** beyond one shikshak scope case: no `parent`, `student`, unauthenticated, cross-city `city_admin` or `state_admin` case against `/punya/award`.
- **`creditBalancesFromReturned`** — the bulk attendance path — untested.

Every defect from H1 to H19 could be introduced today without turning a single assertion red. And because the file is red regardless, nobody would notice.

---

## What looks good

- **`awardPunya` / `runAward`** (`punya.ts:184-266`) — the ledger insert, balance upsert and tier recompute compose into a caller-supplied transaction, with a partial unique index and `ON CONFLICT DO NOTHING` giving true exactly-once semantics. The docblock at `:17-26` explains precisely *when* a caller needs a key and when an upstream row-claim already guarantees it. That distinction is subtle and correctly drawn.
- **`creditBalance`** (`:79-118`) — upsert plus tier in one statement, thresholds injected from `TIER_THRESHOLDS` rather than inlined, and a `delta === 0` short-circuit that avoids a pointless write.
- **`creditBalancesFromReturned`** (`:124-177`) — the comment *"balance moves ONLY by SUM of returned rows, never by attempted points"* is exactly the right invariant for a bulk path, and the `unnest` implementation honours it.
- **`reverseStreakBonusForSession`** (`punya-streak.ts:26-55`) — one CTE that finds the prior award, checks no reversal exists, inserts the debit, and returns the amount actually written; the balance then moves by that returned value only. The self-deadlock warning at `:15-17` is the kind of comment that saves an afternoon.
- **The mobile `AwardPunyaSheet`** (`[id].tsx:460-762`) — required reason, per-award and daily limits surfaced *before* submit, idempotency key minted once on open and reused across retries. Every one of these is missing from the web equivalent; this is the version to port.
- **Exam completion's reverse-then-award** (`exam-punya.ts:105-137`) — generation-suffixed keys plus an advisory lock, reversal amount read from the ledger. The correct pattern, and the one `exam_top_score` should have followed.
- **`mv_monthly_leaderboard_city` retirement** — created in `0012:257`, dropped in `0017:168` with the rationale documented at `0017:4,166`, and correctly excluded from `CANONICAL_MVS`. A clean removal rather than an orphan.

---

## Recommended order of work

1. **C2 first, today.** Determine whether production was built from migrations or `seed.ts`. If migrations: no attendance Punya has ever been awarded, and the backfill question is bigger than the fix. Then add the `attendance` feature + config rows in a migration and give `resolveAttendanceAwardPointsForCity` a last-resort default like its three siblings.
2. **C1** — build `GET /v1/admin/batches/:batchId/punya-standings` to the contract the 205-line test file and the 473-line screen already specify. Then make a red module suite a merge blocker.
3. **C3 + H15** — add `city_id` to the config schema and payload, add the unique indexes on `punya_features(key)` and `punya_configs(feature_key, city_id)`, convert the insert to an upsert, clamp to catalogue bounds, and add `auditFromReq`. Add `ORDER BY` to every `.limit(1)` resolver as defence in depth. **Audit existing `punya_configs` for duplicates before adding the constraint.**
4. **H5 + H18 + H17 + H6** — the web award form. Send an idempotency key, drive `max` from `/award-limit`, make the reason required, add typeahead search. Port the mobile sheet's behaviour rather than reinventing it. Add `feature_key` to the API and the five BRD categories behind it.
5. **H7** — move the daily-cap check inside the award transaction.
6. **H8 + H9** — read the streak bonus from the catalogue, then fix the milestone reversal to cover all sessions at or after the corrected one. H9 needs H8 first or the reversal amount is wrong.
7. **H10 + H11 + M18** — the missing reversal paths: exam top score, competitions, and a scoped audited reversal route for manual awards. H12 (niyam key) belongs here too — it is a one-line change plus a data migration for existing rows.
8. **H3** — make the reconcile actually reconcile: recompute `tier`, full-outer-join so ledger-less balances are reachable, diff before writing, alert on drift. This is the safety net under everything above; it should be trustworthy before the ledger grows further.
9. **H1 + H2** — decide the leaderboard story. Either build it (rank on the month's ledger sum, move the job to a monthly cron, add the four scoped routes) or stop writing `monthly_leaderboard_snapshots`. Half-built is the worst state: it reads as delivered.
10. **H4 + M2 + M5** — tier transitions: `RETURNING tier` with the pre-image, `tier_reached_at`, a `punya_tier` notification kind, then the celebration and certificate. This is the feature families will actually notice.
11. **H13 + H14** — pagination on the ledger, and shared `tierLabel()` / `SOURCE_LABELS`. H14 is a two-hour fix that changes how the module *feels* to every family using it; it is the best effort-to-value ratio in this list.
12. **H16, H19**, then M/L as capacity allows. **M20** (the tier ladder conflict) needs a decision from the business owner, not an engineer — raise it early since it is a one-line change once decided but invalidates every screenshot if decided late.

---

## Note on stack drift

Unchanged from the Quiz review: this repo is Express + `apps/api-server` + `lib/db`, while CLAUDE.md specifies NestJS + `apps/api` + `packages/shared`. SPEC §5.7 also describes a Redis-sorted-set leaderboard architecture and a `punya.award` queue processor that this implementation does not use — the awards are synchronous and in-transaction, which is arguably *better* than the specified queue-based design and should be treated as a deliberate deviation to document rather than a defect to fix. Out of scope here and not counted against the module — but the AT21, AT22, AT23, audit, bilingual, error-code and design-token rules cited above are stack-independent and do apply.
