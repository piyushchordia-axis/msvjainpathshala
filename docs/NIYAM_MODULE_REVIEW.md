# Code Review — Niyam Module (+ Gallery integration)

**Date:** 2 Aug 2026
**Scope reviewed:**

| Layer | Files |
|---|---|
| Schema | `lib/db/src/schema/niyams.ts`, `lib/db/src/schema/gallery.ts`, `lib/db/src/schema/punya.ts` |
| API | `apps/api-server/src/routes/v1/niyam-submissions.ts`, `gallery.ts`, `me.ts` (catalog), `admin-resources.ts` |
| Libs | `apps/api-server/src/lib/niyam-period.ts`, `punya.ts`, `file-tokens.ts`, `storage.ts`, `upload.ts` |
| Tests | `apps/api-server/test/niyam-submissions.test.ts`, `gallery.test.ts` |
| Clients | `apps/jain-pathshala/src/pages/admin/NiyamReviewPage.tsx`, `apps/jain-pathshala-mobile/app/niyam-submit.tsx`, `lib/queries.ts` |

**Reference specs:** `CLAUDE.md` Q5/Q6, `JainPathshala_FullSpec_v4.md` §7.3, §8.1–8.5, `JainPathshala_ReplitAgent_Prompt.md` §5.8, §6.10–6.11, §8.4.

---

## Summary

The core submission path is well engineered — period bucketing, the partial unique index, the advisory lock and the atomic balance upsert are all correct, and the concurrency test proves it. But the module implements the *happy path* of Q5 and almost none of its exception path. The 30-day reversal window does not exist in the codebase, the retroactive-rejection workflow is unreachable from the admin panel, and the gallery is never populated from submissions. Several supporting features from §8.5 (streak badges, rejection notifications, niyam date ranges) are absent, and the Punya idempotency mechanism has a design flaw that leaks internal keys into user-facing screens.

**Verdict: Request changes.** Items 1–5 are release blockers.

---

## Critical

### 1. Q5's 30-day rejection window is not implemented anywhere
`niyam-submissions.ts:562-662` — `POST /:id/reject` performs no date check. `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED` does not appear anywhere in the repository (verified by full-tree grep).

CLAUDE.md lists this as one of the three highest-risk business rules:

> A niyam submission can only be rejected within 30 days of submission. After 30 days, the reject button in admin UI is disabled AND the API returns `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED` (409).

Today an admin can reverse Punya on a submission from any point in history, silently altering a child's tier and leaderboard position months later. There is also no `NIYAM_REVERSAL_WINDOW_DAYS` constant and no disabled state or tooltip in `NiyamReviewPage.tsx`.

**Fix:** guard on `submitted_at >= now() - interval '30 days'` in the service (not the guard), return 409 with the pinned error code, add the constant to shared constants, disable the UI button past the window, and add the 29-day/31-day unit test pair the spec calls for.

### 2. Retroactive rejection is unreachable from the admin panel
`niyams.approval_mode` defaults to `'auto'` (`schema/niyams.ts:33`), so in the intended configuration essentially every submission is `auto_approved`. `NiyamReviewPage.tsx:146` loads only `/v1/niyam-submissions/pending?limit=100`, so those rows never render. `GET /v1/admin/niyam-submissions` (`admin-resources.ts:284`) does return all statuses but nothing consumes it.

Net effect: the Q5 exception workflow — the entire reason the reject endpoint exists — cannot be performed by a Sanchalak or City Admin through the UI.

**Fix:** point the review page at `/v1/admin/niyam-submissions` with a status filter (default `auto_approved` + `pending`), and add student/niyam/date filters. Add a `status` query param to that endpoint.

### 3. Gallery is never populated from niyam submissions
`gallery_items` is inserted in exactly two places: `gallery.ts:197` (manual admin upload from the `gallery` folder) and `lib/db/src/seed.ts:748`. No production path creates a gallery item when a submission is auto-approved.

§8.4 and Q6 require that an approved submission from an opted-in parent appears in the city Gallery. A parent can enable `gallery_visibility_opt_in` and nothing will ever show up. The reject handler (`niyam-submissions.ts:631-634`) diligently soft-deletes a gallery item that production code never creates.

**Fix:** insert a `gallery_items` row inside the submission transaction (or via the `gallery.evaluate` job the spec describes), carrying `submission_id`, `student_id`, `niyam_id` and the first media URL. The existing query-time consent join then handles visibility with no backfill needed.

### 4. Punya award and streak bump run outside the submission transaction
`niyam-submissions.ts:311-353` commits the submission, then `359-374` calls `awardPunya` and `bumpStreak` on the bare `db` handle after the transaction has already committed.

If the process dies or `awardPunya` throws in between, the submission row persists with `points_awarded = niyam.points` while no ledger row and no balance change exist. The parent's UI shows points that the ledger does not have, reconciliation cannot infer intent, and the period-uniqueness index blocks any retry of the same submission. The approve path at `506-539` gets this right by threading `tx`.

**Fix:** move `awardPunya` and the streak update inside the existing `db.transaction` callback, passing `tx`.

### 5. `feature_key` is overloaded as the idempotency store
`punya.ts:59` writes `niyam_submission#submission:<uuid>` into `punya_transactions.feature_key` because "there is no dedicated idempotency column". Four consequences:

- **Reporting breaks.** Every niyam award has a unique `feature_key`, so `GROUP BY feature_key`, per-feature analytics and `mv_niyam_completion`-style aggregates see one bucket per submission instead of one bucket per feature.
- **City point overrides silently never apply.** `punya_configs.feature_key` will never match `niyam_submission#submission:…`.
- **Internal keys are shown to users.** `me.ts:235` (parent Punya ledger) and `admin-resources.ts:332` (admin transaction list) select `feature_key` and return it raw. A parent sees `niyam_submission#submission:8f2c1e0a-…` in their child's history.
- **Unindexed hot-path lookup.** The de-dupe `SELECT … WHERE student_id = ? AND feature_key = ?` has no index on `feature_key` and no unique constraint. Correctness rests entirely on the advisory lock, and cost grows linearly with ledger size on every submission.

**Fix:** add `idempotency_key text` with a unique index (and `reversal_of uuid` while you're there — both are in the spec at §5.7), keep `feature_key` as the clean enum value, and replace the select-then-insert with `ON CONFLICT (idempotency_key) DO NOTHING`.

---

## High

### 6. Soft-deleted students can still submit and earn Punya
`niyam-submissions.ts:55-63` — `ownedStudentId` omits `isNull(students.deleted_at)`. The identical helper in `me.ts:49` includes it. Q11 requires deactivated students to disappear from Punya leaderboards; this lets them keep accruing.

### 7. Rejection reason is appended to the student's own `notes` field
`niyam-submissions.ts:598-600` concatenates the admin's reason onto `niyam_submissions.notes` — parent-authored content. This is destructive, mixes two authorship domains in one column, and surfaces the admin's words back to the parent as if they wrote them. The spec's `rejected_at`, `rejected_by_user_id` and `rejection_reason` columns are all missing from the schema (`reviewed_by`/`reviewed_at` are reused instead, so an approval and a rejection are indistinguishable at column level).

The reason is also optional with no minimum length; §8.4 and the build prompt require it mandatory, min 20 characters.

### 8. No parent notification on rejection
The spec requires a `niyam.rejected` push with the reason (§7.3, §8.3). The reject route touches nothing in `notifications`. Punya simply vanishes from the child's balance with no explanation — the worst possible UX for a trust-sensitive religious-education app.

### 9. Streak milestone badges are entirely missing
No badge award, no bonus Punya, no push notification on any milestone. `niyam_streaks` lacks the `badge_awarded` / `badge_kind` columns from §5.8. §8.5, `PersonaFeatures.md:58` and the Step 17 prompt all treat these as user-facing features.

> **Spec conflict to resolve first:** `FullSpec_v4 §8.5` defines 7-day / 30-day / 4-week / 3-month badges. `PersonaFeatures.md:58` and both build-prompt docs say 7/14/30/60/100 day. These are incompatible. Lock the thresholds before implementing.

### 10. Niyams have no `start_date` / `end_date`
The schema has only `is_active`. §5.8 requires `start_date` and nullable `end_date`, and §8.4 step 6 specifies checking `submitted_at` against `niyam.end_date`. Dated campaigns (Paryushan, a monthly drive) currently require manual activation and deactivation.

### 11. Signed-URL TTL is 24 hours; spec says 1 hour — on photos of minors
`file-tokens.ts:24` — `UPLOAD_URL_TTL_SECONDS ?? 24 * 60 * 60`. §10.3 and the Step 17 prompt both specify a 60-minute TTL, explicitly so that "even if the URL is shared, it expires". The public gallery endpoint hands these URLs to *anonymous* callers. A screenshot-and-paste of a gallery link stays live for a full day.

**Fix:** default to 3600s, at minimum for the `niyam-proof` and `gallery` key prefixes.

### 12. Proof URL ownership is not verified
`isNiyamProofUrl` (`niyam-submissions.ts:77-87`) only checks that the path starts with `niyam-proof/`. Any authenticated user who obtains another family's proof URL can attach it to their own child's submission. Storage keys are random UUIDs so this needs a leak first, but the check is cheap.

**Fix:** persist `uploaded_by` on upload and verify the caller owns the key (or that it is unclaimed) before accepting it.

---

## Medium

| # | Location | Issue | Category |
|---|---|---|---|
| 13 | `niyam-submissions.ts:269-274` | Backdating is hardcoded to today-or-yesterday, undocumented and not configurable. A parent who forgets over a weekend cannot back-fill a weekly niyam. | Correctness |
| 14 | `niyam-submissions.ts:65-69` | `todayIstDate()` adds a fixed +5.5h offset; `previousDate()` does UTC arithmetic. Correct for IST today, fragile if a non-IST centre is ever added. Use a tz library. | Correctness |
| 15 | `niyam-submissions.ts:241` | No rate limiting on `POST /v1/niyam-submissions`, which accepts 10 media rows and drives a Punya award. The auth limiter is the app's only one. | Security |
| 16 | `niyam-submissions.ts:137-221` | `recomputeStreak` loads *every* non-rejected submission for the pair, unbounded — O(n) per rejection, growing for years. It also recomputes `longest_streak` from scratch, so a rejection can lower a longest streak the child legitimately reached. Consider `max(stored, recomputed)`. | Performance / Correctness |
| 17 | `niyam-submissions.ts:89-134` | `bumpStreak` only walks forward, so a backdated submission (allowed for yesterday) can under-count. `recomputeStreak` is the correct call on both paths. | Correctness |
| 18 | `schema/niyams.ts:76-79` | No index on `niyam_submissions.status`. `GET /pending` and the admin listing both filter on it before joining students. Add `(status, submission_date desc)`. | Performance |
| 19 | `niyam-submissions.ts:444`, `admin-resources.ts:303` | Limit-only pagination with no cursor, and `orderBy(desc(submission_date))` has no tie-break — pages are non-deterministic across equal dates. | Correctness |
| 20 | mobile | No offline support at all: no MMKV queue, no `client_op_id`, no `sync_operations` table anywhere in the repo. `useSubmitNiyam` (`queries.ts:423`) is a plain mutation that fails offline. CLAUDE.md's queue-priority rule has nothing behind it. | Feature gap |
| 21 | `niyam-submissions.ts:250-265` | `msv_audience` / `scope` filtering exists only in `GET /v1/me/niyam-catalog` (`me.ts:341-350`). The submit endpoint re-validates nothing — a non-MSV student can claim an MSV-only or other-city niyam by posting its id directly. Q2's "service layer, not just UI" principle applies. | Security |
| 22 | `niyam-submissions.ts:307` | Points are taken straight from `niyams.points` with no bounds check against `punya_features` min/max, and city-level `punya_configs` overrides never apply. | Correctness |
| 23 | `niyam-period.ts:102-111` | `allowedMediaKinds` handles a `"any"` proof type not present in `PROOF_TYPES`; meanwhile the deprecated `proof_url` fallback (`niyam-submissions.ts:278-281`) can synthesise an `audio` kind that `either` then rejects. Dead and contradictory branches. | Maintainability |
| 24 | `gallery.ts:40`, `niyam-submissions.ts:39-53` | `inScope`, `clampLimit`, `scopedCentreFilter` are copy-pasted across route files (`gallery.ts:40` even comments on it). One divergence has already appeared — the `deleted_at` omission in finding #6. Extract to a shared module. | Maintainability |

---

## What looks good

- **Period-uniqueness design is genuinely solid.** `period_key` + partial unique index `where status <> 'rejected'` + `pg_advisory_xact_lock` + an in-transaction duplicate check, with a concurrency test proving one winner (`niyam-submissions.test.ts:357`). Allowing re-submission after a rejection falls out naturally and is tested.
- **Punya balance updates are correctly atomic** — `INSERT … ON CONFLICT DO UPDATE SET total_points = total_points + delta … RETURNING`, with the tier recomputed in the same transaction. No read-modify-write race.
- **No N+1 in the pending queue** — media is fetched in one `inArray` query and grouped in memory (`niyam-submissions.ts:447-460`).
- **Gallery consent gate is the right design.** Resolving the owner via `coalesce(parent_id, user_id)` and joining `gallery_visibility_opt_in` at query time makes the toggle instant and needs no backfill — cleaner than the backfill approach the spec proposed, and well tested (`gallery.test.ts:134`).
- **Public gallery response is properly minimised** — first name only, no full name, no parent data, no centre for anonymous readers.
- **Media URLs are validated as our own uploads and signed on every read**; `verifyUploadAccess` uses `timingSafeEqual`. Admin-only upload folders are enforced server-side (`uploads.ts:50`).
- **Scope enforcement is consistent** across approve / reject / gallery, and returns 404 rather than 403 for out-of-scope rows, avoiding existence leaks.
- **Test coverage is above average for this codebase** — 14 backend cases covering period duplicates for all three frequencies, reversal-exactly-once, media validation and a concurrency race.

---

## Suggested order of work

1. 30-day window + error code + UI disabled state (finding 1)
2. Move Punya/streak into the submission transaction (4)
3. Point the review page at the all-status endpoint (2)
4. `idempotency_key` column + unique index; stop polluting `feature_key` (5)
5. Gallery insert on approved submission (3)
6. `deleted_at` guard, dedicated rejection columns, rejection notification (6, 7, 8)
7. Lock the badge thresholds, then implement streaks/badges (9)
8. `start_date` / `end_date` on niyams (10)
9. TTL to 1h, audience re-validation on submit, rate limit (11, 21, 15)
