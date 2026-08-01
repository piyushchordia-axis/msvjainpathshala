# Verification — Niyam Module Fix Pass

**Date:** 2 Aug 2026
**Reviewed:** commits `5efe785` → `ae10b1a` (N1, N2a, N2b, N3) against `bfa17ff`
**Diff:** 50 files, +3051 / −629

> **Not verified in this pass:** `pnpm --filter @workspace/api-server run typecheck` and the test suite could not be executed — pnpm's symlinked store does not resolve in the review sandbox (`@types/node` unresolvable), and there is no Postgres available. **Run both locally before merging.** Everything below is static review of the committed source.

---

## Summary

All 24 findings from `NIYAM_MODULE_REVIEW.md` are genuinely closed, not papered over. The Q5 window is enforced in the service with the pinned error code, the submit path is now fully transactional, the gallery pipeline exists, and `feature_key` is clean with a real partial-unique `idempotency_key` behind it. The migration orders the backfill correctly — inspect, rewrite, *then* constrain. Test coverage tracks the specified cases closely, including the 29/31-day pair and the "notes byte-identical" assertion.

Seven new issues, one of which should be fixed before the badge feature reaches users.

**Verdict: Approve with follow-ups.** Nothing here blocks merge; item N1 below blocks the mobile badge row being trustworthy.

---

## Finding-by-finding verification

### Critical

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | 30-day rejection window absent | ✅ Closed | `lib/niyam-constants.ts` — `NIYAM_REVERSAL_WINDOW_DAYS = 30`, `canRejectSubmission`, `rejectionWindowFields`. Enforced in the service at `niyam-submissions.ts:868-879` before any write, returning 409 `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED`. Pending correctly exempt. `reversal_window_expires_at` + `can_reject` on every read; UI consumes them rather than recomputing 30. |
| 2 | Retroactive rejection unreachable in UI | ✅ Closed | `NiyamReviewPage.tsx:63-73` — three tabs, `useState<TabKey>('recent')` defaults to auto_approved + approved. Cursor "Load more" replaces the limit=100 wall. |
| 3 | Gallery never populated from submissions | ✅ Closed | `maybeInsertGalleryFromSubmission` called inside the submit transaction (`:524`) and the approve transaction (`:770`). Correctly skips when there is no photo. Query-time consent join left untouched, as instructed. |
| 4 | Punya/streak outside the transaction | ✅ Closed | `db.transaction` at `:456` now wraps insert → media → `awardPunya(…, tx)` → gallery → `recomputeStreak(…, tx)` → badges. Audit and push moved post-commit. Approve path matches. |
| 5 | `feature_key` overloaded as idempotency store | ✅ Closed | `punya.ts` rewritten to `INSERT … ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING … RETURNING`, with `reversal_of`, `source_entity_kind`, `source_entity_id` populated. Advisory lock correctly removed. Migration backfill splits composites *before* creating the unique index. |

### High

| # | Finding | Status | Evidence |
|---|---|---|---|
| 6 | Soft-deleted students could submit | ✅ Closed | `route-helpers.ts:38` — `ownedStudentId` now filters `isNull(deleted_at)` **and** `status = 'active'`, and is shared so the two copies cannot drift again. |
| 7 | Reason appended to parent's `notes` | ✅ Closed | Dedicated `rejected_at` / `rejected_by` / `rejection_reason` written at `:885-891`; `notes` untouched. Reason now required, min 20 / max 300. Test asserts notes is byte-identical. |
| 8 | No parent notification on rejection | ✅ Closed | `notifyParentOfRejection` post-commit at `:961`, inserts a bilingual `notifications` row then best-effort push — matches the birthday-cron pattern. |
| 9 | Streak badges missing | ✅ Closed | `niyam_badges` table + `lib/niyam-badges.ts` with the D1 ladder. Unique index makes awarding idempotent; bonus Punya keyed `badge:{student}:{niyam}:{key}`. Badges explicitly not revoked on rejection, with the comment. |
| 10 | No niyam date range | ✅ Closed | `start_date` NOT NULL / `end_date` nullable, enforced on submit against `submission_date` (not `now()`) per §8.4 step 6. |
| 11 | 24h signed-URL TTL | ✅ Closed | `file-tokens.ts:25` → 3600s default, with a per-call override retained for long-lived report PDFs. |
| 12 | Proof URL ownership unverified | ✅ Closed | New `upload_objects` table with `uploaded_by`; `uploads.ts:95` records it, submit verifies `row.uploaded_by === userId`. |

### Medium

| # | Finding | Status |
|---|---|---|
| 13 | Backdate window undocumented | ✅ `SUBMISSION_BACKDATE_DAYS = 1` in `niyam-period.ts:14` |
| 14 | Mixed IST/UTC date arithmetic | ✅ Single IST-aware helper exported and shared |
| 15 | No rate limiting | ✅ 20/hr + 5/min per user at `:321-327`, standard `ERR_RATE_LIMITED` |
| 16 | Unbounded recompute; longest could drop | ✅ 400-day lookback; `longest = max(stored, recomputed)` at `:195` |
| 17 | Forward-only streak bump | ✅ `bumpStreak` deleted; `recomputeStreak` on both paths |
| 18 | Missing indexes | ✅ `(status, submission_date desc)`, `gallery_items(submission_id)`, `(is_active, start_date)`, `feature_key`, partial `reversal_of` |
| 19 | No cursor pagination | ✅ `(submission_date desc, id desc)` cursor on both listings; test asserts determinism |
| 21 | Audience checked client-side only | ✅ `lib/niyam-audience.ts` shared predicate, re-applied on submit → 403 |
| 22 | Points bounds / city override ignored | ✅ `resolveNiyamAwardPoints(niyam.points, city_id)` |
| 23 | Dead `"any"` proof branch | ✅ Resolved with comment |
| 24 | Duplicated route helpers | ✅ `lib/route-helpers.ts`, adopted across ~20 route files |

**Finding 20 (offline queue)** — correctly out of scope, still open.

### Migration review

`0005_niyam_module_fixes.sql` is ordered correctly: columns → FKs → backfill → **unique index last**, so a duplicate fails loudly during migration rather than silently at runtime. The composite split relies on Postgres evaluating all `SET` expressions against the old tuple, which is correct — `source_entity_kind = split_part(feature_key, '#', 1)` at line 148 reads the pre-update value. The reversal-linking `UPDATE … FROM` at line 172 is safe because `idempotency_key` is globally unique. `0006` and `0007` follow the same conventions with journal entries.

---

## New issues

### N1. Streaks never lapse — `current_streak` goes stale 🟠 High

`recomputeStreak` (`niyam-submissions.ts:124-217`) walks submissions and returns the run length ending at the **last submission**, never comparing it to the current period. And it only runs on submit or reject.

A student who completes 7 consecutive days and then stops keeps `current_streak = 7` in the database indefinitely. The new mobile badge row and the "3 more days to your 7-day badge" hint on `niyam-submit.tsx` will both show a live streak months after it lapsed.

The spec's `niyam-streak-reset.job` (`0 5 * * *` IST, ReplitAgent §9.5) is still unimplemented — `registerCron` has exactly one call site in the whole app (`notifications.ts:271`, birthday wishes).

Two fixes, both needed:

1. In `recomputeStreak`, after the walk: if the last `period_key` is neither the current period nor the immediately previous one, set `current = 0`. Without this, even a manual recompute won't lapse a streak.
2. Register the daily cron to recompute streaks with a stale `last_period_key`.

Badge *awarding* is unaffected — a new submission after a gap correctly resets the run to 1 — so no phantom badges. This is a display and progress-hint correctness bug.

### N2. Badge push is English-only and leaks raw badge keys 🟡 Medium

`niyam-badges.ts:126-128` sends `title: "Streak badge earned!"` and `body: "${studentName} earned: daily_7"`. Every other notification in this codebase is bilingual (`title_en` / `title_hi`), and the parent sees the internal enum value rather than "7-day streak".

The bilingual label map exists — but only at `apps/jain-pathshala-mobile/lib/niyam-badges.ts:34`. Lift it into a shared package and use it server-side.

### N3. Badges create no `notifications` row 🟡 Medium

Rejection inserts a `notifications` row *and* pushes. Badges only push. A parent with notifications disabled, or who simply misses it, has no in-app record — and the badge never appears in the notification inbox. Inconsistent with the rejection path immediately adjacent to it.

### N4. 400-day lookback silently caps `current_streak` 🔵 Low

A daily niyam streak longer than 400 days reports 400. `longest_streak` is protected by `max(stored, recomputed)`. Beyond the top badge (100) so practically harmless — but add a comment at `niyam-period.ts:17` so the cap isn't mistaken for a bug later.

### N5. Reversal amount read outside the transaction 🔵 Low

`sub.points_awarded` is selected at `:843` and used as the reversal amount at `:907` inside the transaction. The status guard in the UPDATE's `WHERE` prevents double-reversal, so exposure is narrow — but re-reading inside the transaction would make it airtight.

### N6. Window check evaluated pre-transaction 🔵 Low

`canRejectSubmission` runs at `:868`, before `db.transaction` opens. A day-30-boundary race is theoretically possible and practically irrelevant. Noting only for completeness.

### N7. `notifyBadgesPush` swallows all errors silently 🔵 Low

`catch { }` with only a comment (`niyam-badges.ts:131`). Other best-effort paths in this repo log. Add a `logger.warn` so a systematically broken push token store is visible.

---

## What looks good

- **The transaction rewrite is exactly right.** Everything that mutates points, streaks or gallery state is inside `tx`; audit and push are post-commit and best-effort. The approve path mirrors the submit path rather than diverging.
- **`punya.ts` is materially better than the spec asked for.** Dropping the advisory lock once the partial unique index exists is the correct call, and `awardKeyFromReversal` deriving the original key is a neat touch.
- **The migration's backfill ordering** — inspect, rewrite, then constrain — is the detail most likely to have been shuffled, and it wasn't.
- **Tests match the specified cases closely**, including the ones easiest to skip: the 29/31-day pair, "notes byte-identical", "daily_7 exactly once across day 7 and day 8", and deterministic pagination on equal dates.
- **`route-helpers.ts` was adopted broadly** (~20 route files), not just in the two files the finding named — which is what actually prevents the `deleted_at` class of drift recurring.
- **Reject-window state is server-computed** and consumed by the UI, so no client hardcodes 30.

---

## Before merge

1. Run `pnpm --filter @workspace/api-server run typecheck` and the test suite — not verifiable here.
2. Run migration `0005` against a **snapshot** of production first and confirm the unique index builds without a duplicate-key failure. That failure, if it comes, is the signal that the historical composite keys were not as uniform as assumed.
3. Spot-check post-migration: `SELECT feature_key, count(*) FROM punya_transactions GROUP BY 1;` — expect a handful of clean keys, zero containing `#`.
4. Fix N1 before the mobile badge row ships, or it will show streaks that ended weeks ago.
