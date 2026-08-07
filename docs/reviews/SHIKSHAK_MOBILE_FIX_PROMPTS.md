# Shikshak mobile — Cursor fix prompts

**Date:** 2026-08-05
**Covers:** Guruji Punya standings, Niyam review density + bulk approve, manual Punya award on mobile.

Each block is a self-contained prompt — paste one at a time into Cursor (Composer, Agent mode), verify, commit, then move to the next. Ordered by dependency and risk: prompt 1 is a backend correctness fix that prompts 2 and 3 both build on.

Every prompt assumes Cursor has `CLAUDE.md` in context. If it doesn't, prefix with:

> Read `CLAUDE.md` (role hierarchy, AT21, AT23 tier thresholds, error-code enum, audit rules, bilingual rules, design tokens) before making any change.

---

## What was found first

Three things worth knowing before reading the prompts, because they change the shape of the work:

**The award route is gated one level too wide.** `POST /v1/admin/punya/award` (`admin-resources.ts:481`) calls `inScope(scope, student.centre_id)` — which is `inCentreScope`, marked `@deprecated` in `scope.ts:118`. A shikshak's scope resolves to their *tagged centres* for read and their *assigned batches* for write (`scope.ts:76-99`), so today a Guruji can already award Punya to any student in their centre, including batches they don't teach. Meanwhile `GET /v1/admin/students/:id/punya` sitting in the next file over (`admin.ts:462`) correctly uses `inBatchWriteScope`. Your ask ("from his/her batch") is therefore a tightening, not a widening — the mobile surface just makes an existing gap visible.

**The Niyam review screen ignores most of what the API already gives it.** `/v1/niyam-submissions/pending` returns signed `media[]` with `kind`/`mime`/`ordinal`, `period_key`, `created_at`, cursor pagination via `next_cursor`, and the Q5 `rejectionWindowFields`. The screen hardcodes `?limit=100`, drops the cursor, and opens proof through `Linking.openURL` into an external browser. Most of the density fix is spending data that's already on the wire.

**Every Guruji rejection currently sends the same sentence.** `rejectSchema` requires `reason` at 20–300 chars (`niyam-submissions.ts:986`), and `niyam-review.tsx:56` supplies a hardcoded fallback for every rejection. So the parent-facing feedback on a rejected Niyam is identical boilerplate regardless of what was wrong. Prompt 3 fixes this.

**Note (resolved Q12, 2026-08-05):** `POST /:id/approve` and `POST /:id/reject` now gate on
`inBatchWriteScope` (batch-bound for shikshak; centre reach for sanchalak+). `GET /pending` stays
centre-scoped and returns `can_decide`. Bulk-approve inherits the same gate via `approveNiyamSubmission`.
Sanchalak mobile access is required in the same release — see the Q12 prompt.

---

## 1 — Batch-scoped, config-capped manual Punya award (backend)

```
Read CLAUDE.md (AT21, AT23, role hierarchy, audit rules) and apps/api-server/src/lib/scope.ts,
then fix and harden POST /v1/admin/punya/award in
apps/api-server/src/routes/v1/admin-resources.ts (line ~481).

Three problems:
(a) It gates on `inScope(scope, student.centre_id)` — the @deprecated centre-level check. A
    shikshak can award Punya to students in batches they do not teach. GET /v1/admin/students/:id/punya
    (admin.ts:462) already uses inBatchWriteScope on the same entity — make them consistent.
(b) `points` is capped by a hardcoded `.max(500)` in the zod schema, identical for every role.
    500 points moves a student from Jigyasu to Sadhak in one tap (AT23 thresholds).
(c) featureKey "manual_award" is not registered in punya_features, so the award is invisible to
    the admin Punya config page and has no configurable ceiling. This is the AT21 pattern
    violation already fixed for homework (migration 0021) and exams (0029).

--- Migration ---
Create lib/db/migrations/00NN_manual_award_limits.sql (next free number):

1. Register the feature key, INSERT … WHERE NOT EXISTS (copy the idiom from 0029_exam_punya.sql):
     manual_award  'Manual admin award'  min 0  max 500

2. Create table punya_award_limits:
     id                    uuid pk default gen_random_uuid()
     role                  text not null
     max_points_per_award  integer not null
     max_points_per_day    integer            -- NULL = unlimited
     is_active             boolean not null default true
     created_at/updated_at timestamptz not null default now()
     UNIQUE (role)
   Seed rows (these are defaults, tunable without a deploy — that is the point):
     shikshak      10    50
     sanchalak     25   150
     city_admin   100   500
     state_admin  250  1000
     super_admin  500  NULL

Add the table to lib/db/src/schema/punya.ts next to punya_configs, export the type, and add
manual_award + the limit rows to the seed blocks in lib/db/src/seed.ts (~line 149).

--- Resolver ---
Create apps/api-server/src/lib/punya-award-limits.ts modelled on apps/api-server/src/lib/exam-points.ts
(same Redis-with-memory-fallback cache, same 60s TTL, same clear*Cache() export for tests):

  export interface AwardLimit { maxPerAward: number; maxPerDay: number | null }
  export async function resolveAwardLimit(role: string): Promise<AwardLimit>
  export async function pointsAwardedTodayBy(userId: string): Promise<number>
  export function clearAwardLimitCache(): void

resolveAwardLimit reads punya_award_limits by role where is_active, falling back to
punya_features.max_points for 'manual_award', falling back to 0. Never inline a constant.

pointsAwardedTodayBy sums punya_transactions.points where awarded_by = userId
AND feature_key = 'manual_award' AND points > 0 AND created_at >= start-of-today in
Asia/Kolkata (IST — match the AT26 convention, not UTC).

--- Route ---
In POST /v1/admin/punya/award:
- Select students.batch_id alongside centre_id, and replace the guard with
  `inBatchWriteScope(scope, student.batch_id, student.centre_id)`.
- Remove `.max(500)` from punyaAwardSchema; keep `.int().positive()`.
- After the scope check, resolve the caller's limit and reject before awarding:
    points > maxPerAward                       → 422 ERR_AWARD_LIMIT_EXCEEDED
    pointsAwardedToday + points > maxPerDay    → 429 ERR_AWARD_DAILY_LIMIT_EXCEEDED
  Error messages must state the problem AND the fix, per CLAUDE.md's error voice rule, e.g.
  "That is more than you can award at once — the limit is 10 Punya per award."
- Keep the existing idempotency_key handling and the audit entry exactly as they are; add
  max_per_award and points_awarded_today to the audit metadata.
- Register both new codes in lib/api-zod/src/errors.ts with EN + HI messages. Never return raw strings.

--- Expose the limit to clients ---
Add GET /v1/admin/punya/award-limit returning
  { role, max_points_per_award, max_points_per_day, points_awarded_today, remaining_today }
so the mobile and web UIs can render the ceiling instead of discovering it via a 422.

--- Tests ---
In apps/api-server/test/ (new punya-award-limits.test.ts, or extend an existing suite):
- a shikshak awarding to a student in their assigned batch succeeds;
- a shikshak awarding to a student in the same centre but a batch they do NOT teach gets 404
  (this currently passes — it is the bug);
- a sanchalak awarding anywhere in their centre still succeeds;
- points above the role's max_points_per_award → 422 ERR_AWARD_LIMIT_EXCEEDED;
- awards that cross max_points_per_day → 429, and the ledger shows only the accepted ones;
- replaying the same idempotency_key credits once (regression guard on existing behaviour).

Run `pnpm db:migrate`, `pnpm typecheck`, `pnpm test`.
```

---

## 2 — Award Punya from the mobile app (Guruji)

```
Read apps/jain-pathshala-mobile/app/student-detail/[id].tsx (PunyaPanel, line ~347) and
apps/jain-pathshala-mobile/lib/queries.ts (useAdminStudentPunya, line ~426). Prompt 1 must be
merged first — this UI depends on GET /v1/admin/punya/award-limit and the batch-scoped guard.

Goal: a Guruji can award Punya to a student in their batch from the phone, with the same
governance the web panel has.

--- queries.ts ---
Add:
  qk.punyaAwardLimit = () => ["admin", "punya-award-limit"] as const
  export interface PunyaAwardLimit {
    role: string; max_points_per_award: number; max_points_per_day: number | null;
    points_awarded_today: number; remaining_today: number | null;
  }
  export function usePunyaAwardLimit()            // GET /v1/admin/punya/award-limit
  export function useAwardPunya()                 // POST /v1/admin/punya/award
On success invalidate qk.adminStudentPunya(studentId) AND qk.punyaAwardLimit().
Generate an idempotency_key client-side per award attempt using the existing ULID helper
(apps/api-server/src/lib/ulid.ts has the server one — use the mobile equivalent, or uuid from
expo-crypto) so a retry on a flaky connection never double-credits. Reuse the SAME key across
retries of one attempt; mint a new one only when the sheet is reopened.

--- UI: student-detail PunyaPanel ---
Add an "Award Punya" / "पुण्य दें" button at the top of PunyaPanel, visible only when the
signed-in user's role is in ADMIN_PANEL_ROLES. Opens a bottom sheet:
  - Points: a stepper plus quick chips (+1 / +2 / +5), hard-capped at max_points_per_award from
    the limit query. Never let the user type a number the server will reject.
  - Reason: free text, required, min 3 chars — it lands in punya_transactions.note and is the
    only record of why. Above it, offer tappable presets that fill the field:
      Helped in class / Excellent recitation / Kind act / Extra effort
      कक्षा में सहायता / उत्तम पाठ / दयालु कार्य / विशेष प्रयास
  - A footer line: "You can award N more today" / "आज आप N और दे सकते हैं", from remaining_today.
    Hide it when max_points_per_day is null.
  - Confirm button disabled while points is 0, reason is empty, or remaining_today is 0.
On success, show the returned total_points and tier in a toast, and let the panel refetch —
do not optimistically mutate the balance.
On 422 ERR_AWARD_LIMIT_EXCEEDED / 429 ERR_AWARD_DAILY_LIMIT_EXCEEDED, surface the server message
verbatim; it already states the fix.

Design rules: JPColors / tokens only, no raw hex. Sentence case on buttons. No emoji. Every
string bilingual with the `hi ? x_hi ?? x_en : x_en` pattern. Devanagari line-height >= 22.
Layouts must tolerate +35% string length in Hindi.

--- Reachability ---
Add a "Punya" entry to SHIKSHAK_ACTIONS in apps/jain-pathshala-mobile/components/QuickActions.tsx
pointing at the standings screen from prompt 4 if that is already merged; otherwise skip this
step and add it there.

Run `pnpm typecheck`. Verify on device that a Guruji sees the button on a student in their batch
and that the daily counter decrements across awards.
```

---

## 3 — Niyam review: compact rows, real reject reasons, bulk approve

```
Read apps/jain-pathshala-mobile/app/shikshak/niyam-review.tsx,
apps/api-server/src/routes/v1/niyam-submissions.ts (GET /pending line ~771, POST /:id/approve
line ~859, POST /:id/reject line ~993), and apps/api-server/src/routes/v1/homework.ts
(POST /assignments/:id/grade-all, line ~912) for the established bulk-action pattern.

Three problems:
(a) Each pending submission renders as a full Card with a full-width "Open proof" button and two
    full-size action buttons — roughly 200pt per row, so a Guruji sees two submissions per screen.
(b) Reject sends a HARDCODED canned reason for every rejection (niyam-review.tsx:56). rejectSchema
    requires 20-300 chars, so the screen satisfies the validator while giving every parent
    identical, meaningless feedback.
(c) There is no bulk approve. Homework has grade-all; Niyam review is still one-at-a-time, which
    is the single biggest time cost for a Guruji with a weekend backlog.

The screen also hardcodes `?limit=100` and discards `next_cursor`, and opens proof via
Linking.openURL into an external browser, even though /pending already returns signed media[]
with kind and mime.

--- Backend: bulk approve ---
Extract the body of POST /:id/approve into a reusable service function, e.g.
apps/api-server/src/services/niyam-approve.ts:

  export async function approveNiyamSubmission(opts: {
    submissionId: string; actor: User; scope: AdminScope;
  }): Promise<{ status: 'approved' | 'not_found' | 'not_pending'; … }>

It must keep the existing transaction intact and in order: claim the row with the
status='pending' predicate, awardPunya with idempotencyKey `submission:{id}`, write back
punya_transaction_id, maybeInsertGalleryFromSubmission, recomputeStreak, awardNewlyReachedBadges.
Do NOT reimplement any of this inline in the bulk route — a second copy of that sequence will
drift and silently break streaks or badges.

Rewrite POST /:id/approve to call it, so single and bulk share one path.

Add POST /v1/niyam-submissions/bulk-approve (requireAdminPanel):
  body: { submission_ids: string[] } — .uuid(), .min(1).max(50)
  Process each id independently in its own transaction. ONE failure must not fail the batch.
  Response: { results: Array<{ id, status: 'approved'|'skipped'|'failed', error?: {code,message} }> }
  Mirror the per-op result shape used by POST /v1/sync/batch.
  Write ONE audit entry for the bulk action recording the approved count and the ids, in
  addition to whatever the per-submission path writes.

--- Backend: pending list ---
Add optional query filters to GET /pending: `batch_id` and `niyam_type`, both scope-checked.
Return students.batch_id and the batch name on each row so the client can group and filter.

--- Mobile: rewrite the screen ---
Target roughly 72pt per row so 7-8 submissions fit on screen.

Row (collapsed, the default):
  [56x56 proof thumbnail or a placeholder tile] [student name · niyam title, 2 lines]
  [date, 11pt muted] [selection checkbox on the right]
Tap the row → expands in place to reveal notes, period_key, full media strip, and Approve /
Reject. Tap the thumbnail → in-app full-screen image viewer (a Modal + Image with pinch-zoom).
Do NOT use Linking.openURL — signed URLs must not leave the app.

Selection + bulk bar:
  Long-press or checkbox tap enters selection mode. A sticky bottom bar shows
  "Approve N" / "N स्वीकृत करें" and a Clear action. Confirm via Alert, then POST bulk-approve,
  then surface a summary: "12 approved, 1 skipped" with the skipped ids expandable.
  Bulk applies to APPROVE ONLY. Rejection must stay one-at-a-time — it reverses Punya, recomputes
  the streak, hides the gallery item, and requires a specific written reason. A bulk reject
  button is an invitation to send 30 identical rejections, which is the problem we are fixing.

Reject sheet (replaces the canned string):
  A required TextInput, minLength 20 enforced client-side with a live character counter so the
  Guruji never hits the server's 422. Above it, tappable presets that FILL the field and remain
  editable:
    "The photo does not clearly show the Niyam being performed — please retake and submit again."
    "This was submitted for the wrong date — please resubmit against the correct day."
    "The proof is missing — please attach a photo and submit again."
  Plus Hindi equivalents in Devanagari (not transliteration). Submit is disabled under 20 chars.
  If the API returns the Q5 window error (ERR_NIYAM_REVERSAL_WINDOW_EXPIRED), show it and disable
  Reject on that row — /pending already returns rejectionWindowFields; use them to grey out the
  Reject action past the 30-day window rather than letting the Guruji discover it via an error.

Pagination: consume next_cursor. Infinite scroll via useInfiniteQuery, page size 30.

Filters: a sticky chip row above the list for batch (from the shikshak's own batches via
useAdminBatches) and niyam type. Persist the last selection in AsyncStorage under
"jp.shikshak.niyamReview.filters", matching the jp.shikshak.selectedCentreId pattern in
app/shikshak/batches.tsx.

Design rules as in prompt 2: tokens only, sentence case, no emoji, bilingual with ?? fallback,
Devanagari line-height >= 22, +35% length tolerance.

--- Tests ---
- bulk-approve with a mix of pending / already-approved / out-of-scope ids returns per-item
  results and approves only the valid pending ones;
- bulk-approve awards Punya exactly once per submission (replay the same ids, assert the ledger
  is unchanged — the submission:{id} idempotency key must hold);
- streaks and badges after a bulk approve match what sequential single approvals produce;
- reject with a reason under 20 chars is rejected client-side (component test) and 422s server-side.

Run `pnpm typecheck`, `pnpm test`.
```

---

## 4 — Guruji Punya standings (batch view)

```
Read apps/api-server/src/routes/v1/admin.ts (GET /students/:id/punya, line ~446) for the
inBatchWriteScope pattern, lib/db/src/schema/punya.ts (punya_balances,
monthly_leaderboard_snapshots), and apps/jain-pathshala-mobile/app/shikshak/batches.tsx for the
centre-switcher + AsyncStorage pattern. Prompt 1 should be merged first.

Goal: a Guruji can see how their own students are doing on Punya — the public Punya Wall
(/gallery) is city_admin-curated (canFeatureMedia excludes shikshak) and shows other centres'
children, so it answers none of their questions.

--- Backend ---
Add GET /v1/admin/batches/:batchId/punya-standings?month=YYYY-MM to
apps/api-server/src/routes/v1/admin.ts (or admin-resources.ts, wherever batch routes live):

  Guard: resolveAdminScope + inBatchWriteScope(scope, batchId, batch.centre_id) → 404 otherwise.
  `month` optional, defaults to the current month in Asia/Kolkata.

  Per active student in the batch (exclude status='inactive' per Q11):
    student_id, full_name, student_code, age_group,
    total_points, tier            (from punya_balances; 0 / 'jigyasu' when absent),
    rank                          (dense_rank over total_points desc, WITHIN THE BATCH),
    month_points                  (sum of punya_transactions in the month, net of reversals),
    by_source                     ({ feature_key: points } for the month)
  meta: { batch_id, batch_name, month, student_count, batch_total, batch_average,
          tier_counts: { jigyasu: n, shravak: n, sadhak: n, shraman: n, tirthankar: n } }

  Use ONE query with window functions — do not N+1 per student. Net of reversals means summing
  points (which are negative on reversal rows), not filtering them out.
  Tier names and thresholds come from the AT23 configuration path, never from code constants.
  Order by rank, then full_name.

  Add a covering index if the EXPLAIN warrants it:
    punya_transactions (student_id, created_at)

--- Mobile: new screen app/shikshak/punya.tsx ---
Not a tab — the shikshak tab bar is already at five. Reach it from SHIKSHAK_ACTIONS in
components/QuickActions.tsx (icon "trophy-outline", "Punya standings" / "पुण्य स्थिति") and add
"punya" to the `hide` array in app/shikshak/_layout.tsx alongside niyams and niyam-review.

Layout, top to bottom:
  - Batch switcher chips when the Guruji has more than one batch (reuse the batches.tsx pattern;
    persist under "jp.shikshak.selectedBatchId").
  - Month switcher: back/forward arrows around the month label, no future months.
  - Summary card: batch total, average per student, and a tier distribution strip using the
    locked tier colours from CLAUDE.md (Jigyasu earth, Shravak green, Sadhak blue, Shraman
    maroon, Tirthankar gold) — from tokens, never inline hex.
  - Standings list, one compact row per student (~64pt):
      [rank] [name · student_code] [month delta, e.g. "+45 this month"] [tier pill] [total]
    Tap → router.push(`/student-detail/${id}`), landing on the Punya section so the Guruji can
    read the ledger and award from prompt 2 without a second navigation.
  - An expandable "Where points came from" block showing the batch's by_source totals
    (attendance / niyam / homework / quiz / manual), so a Guruji can see e.g. that niyam
    participation has collapsed this month.

Tone: this is a pastoral tool, not a scoreboard. Do not add medals, trophies-for-top-3, or
anything that frames the bottom of the list as failure. Rank is shown because a Guruji asked
"how is my batch doing", not to rank children against each other publicly. Keep the copy warm
and factual per CLAUDE.md's UI tone rules, address the Guruji as "you", and do not surface this
screen or its ranks to parents or students.

Design rules as in prompts 2 and 3.

--- Tests ---
- a shikshak gets 404 on a batch they are not assigned to;
- ranks are dense (two students on equal points share a rank, the next is not skipped);
- month_points is net of reversals (award 20, reverse 20 → 0, not 20 or 40);
- an inactive student does not appear (Q11);
- by_source sums equal month_points.

Run `pnpm typecheck`, `pnpm test`.
```

---

## Build order and why

| # | Prompt | Depends on | Why here |
|---|---|---|---|
| 1 | Award scope + config cap | — | Backend-only, closes a live over-permission, and both 2 and 4 assume it. Ship independently of any UI. |
| 2 | Award from mobile | 1 | Small surface on an existing panel. Highest value per line of code. |
| 3 | Niyam review rework | — | Independent of 1/2. Biggest daily time saving for a Guruji; the reject-reason fix is parent-facing and should not wait. |
| 4 | Batch standings | 1 | Largest new surface, one new route plus one new screen. Do last so it can link into the award sheet from 2. |

Prompts 1 and 3 have no overlap and can run in parallel if two people are working. Prompts 2 and 4 both touch `queries.ts` and `QuickActions.tsx` — run them sequentially to avoid conflicts.

## Open decision left on the table

Whether `POST /v1/niyam-submissions/:id/approve` and `/reject` should move from `inScope`
(centre) to `inBatchWriteScope` (batch), matching prompt 1. Arguments both ways:

- **Tighten it:** a Guruji approving proof for a child they have never taught cannot judge whether the Niyam was genuinely performed. Consistency with the award route.
- **Leave it:** a Sanchalak may want any Guruji at the centre to help clear a weekend backlog, and a batch-only gate means submissions from an unstaffed batch sit pending indefinitely.

If you want it tightened, add this to prompt 3 and pair it with a fallback so a Sanchalak still sees the whole centre's queue. Worth deciding before the bulk-approve route ships, since bulk makes whatever the scope is much easier to exercise at volume.
