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

---

## Fix prompt — N1 to N7

One Cursor prompt. Run in **Agent mode** — N1 is the only item with real design content and it is scoped to one function plus one cron registration. Plan mode is optional here; nothing touches the ledger or rewrites existing rows.

````
@docs/NIYAM_MODULE_FIX_VERIFICATION.md
@apps/api-server/src/routes/v1/niyam-submissions.ts
@apps/api-server/src/lib/niyam-badges.ts @apps/api-server/src/lib/niyam-period.ts
@apps/api-server/src/lib/scheduler.ts @apps/api-server/src/routes/v1/notifications.ts
@lib/api-zod/src/contracts.ts @lib/db/src/schema/enums.ts
@lib/db/migrations/0006_niyam_rejected_kind.sql
@apps/jain-pathshala-mobile/lib/niyam-badges.ts

Follow-up pass on the Niyam module. Closes issues N1–N7 from
docs/NIYAM_MODULE_FIX_VERIFICATION.md. Work through them in order and report on
each by number — do not silently skip any.

## N1 — Streaks never lapse (HIGH, do this one properly)

recomputeStreak walks submissions and returns the run length ending at the LAST
submission, never comparing it to the current period. It also only runs on submit
and reject. So a child who completes 7 daily submissions and then stops keeps
current_streak = 7 in the database indefinitely, and the mobile badge row plus the
"3 more days to your 7-day badge" hint on niyam-submit.tsx both show a streak that
ended weeks ago.

Two changes, both required — the cron alone is not enough because even a manual
recompute currently returns the stale run.

1a. In recomputeStreak, after the walk completes:
    Let `todayKey = periodKey(niyamType, todayIstDate())` and
    `prevKey = previousPeriodKey(niyamType, todayKey)`.
    If the last submission's period_key is NEITHER todayKey NOR prevKey, the streak
    has lapsed → set current = 0 before writing.
    Keep last_submission_date / last_period_key as they are (they are history), and
    keep longest_streak = max(stored, recomputed) — a lapse must never lower a peak.
    Rationale for allowing prevKey: a daily streak is still alive at 9am today if
    yesterday was submitted; it only dies once today is also missed. Put that in a
    comment.

1b. Register the missing daily job. registerCron currently has exactly ONE call
    site in the whole app (notifications.ts:271, birthday-wishes) — follow that
    pattern exactly, including the exported testable handler.
    Name: "niyam-streak-lapse", expression "0 5 * * *" (spec ReplitAgent §9.5).
    Handler: find niyam_streaks rows where current_streak > 0 and last_period_key
    is neither the current nor the previous period for that niyam's type, and zero
    their current_streak. Batch it — do not load the whole table into memory, and
    do not call recomputeStreak per row (that is one query per student).
    Export the handler so a test can invoke it without starting the scheduler.

Badge AWARDING is unaffected — a new submission after a gap already resets the run
to 1, so there are no phantom badges. Do not change awardNewlyReachedBadges.

## N2 — Badge push is English-only and leaks raw badge keys

niyam-badges.ts:126-128 sends title "Streak badge earned!" and body
`${studentName} earned: daily_7`. The parent sees the internal enum value, in
English only.

The bilingual label map already exists but only on the client, at
apps/jain-pathshala-mobile/lib/niyam-badges.ts:34.

- Move it into lib/api-zod/src/contracts.ts, next to the existing
  `niyamPeriodLabel` helper under the "Display helpers mirrored from api-server"
  section — that is already the shared home for exactly this kind of map.
  Export `niyamBadgeLabel(key, lang)` and the ladder itself.
- api-server imports it for push copy; mobile's lib/niyam-badges.ts RE-EXPORTS
  from @workspace/api-zod rather than keeping a second copy.
- While you are here: notifyParentOfRejection (niyam-submissions.ts:~270) has the
  SAME bug in a subtler form — it stores a bilingual notifications row but then
  pushes `title: titleEn, body: bodyEn` regardless of the recipient. Read
  users.preferred_language for the parent and push in their language. Apply the
  same to badges.

## N3 — Badges create no notifications row

Rejection inserts a notifications row AND pushes. Badges only push, so a parent
with notifications off has no in-app record and the badge never reaches the inbox.

Mirror notifyParentOfRejection exactly: insert the bilingual notifications row
first, bail if the insert returned nothing, then best-effort push. The committed
inbox row is what gates the at-most-once push.

This needs a new notification_kind_enum value 'niyam_badge':
- add it to NOTIFICATION_KINDS in lib/db/src/schema/enums.ts
- migration 0008_niyam_badge_kind.sql, copying 0006_niyam_rejected_kind.sql
  verbatim in style: `ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS
  'niyam_badge';` plus the meta/_journal.json entry.
  Note: the new value must not be USED in the same transaction that adds it —
  0006 already respects this, keep the migration to the ALTER TYPE alone.

## N4 — Document the 400-day lookback cap

STREAK_RECOMPUTE_LOOKBACK_DAYS = 400 (niyam-period.ts:17) silently caps
current_streak for a daily niyam. longest_streak is protected by the max(). Add a
comment saying the cap sits well beyond the top badge (daily_100) so it is a bound,
not a bug. No behaviour change.

## N5 — Reversal amount read outside the transaction

sub.points_awarded is selected at niyam-submissions.ts:843 and used as the reversal
amount at :907 inside the transaction. The status guard in the UPDATE's WHERE
prevents double-reversal so exposure is narrow, but re-read points_awarded inside
the transaction (from the RETURNING of the status update) and reverse that value.

## N6 — Window check evaluated pre-transaction

canRejectSubmission runs at :868, before db.transaction opens. Either move the
check inside the transaction using a freshly read created_at, or add a comment
explaining why a day-30-boundary race is acceptable. Your call — but make it
deliberate rather than incidental.

## N7 — Silent catch blocks

niyam-badges.ts:131 and the push catch in notifyParentOfRejection both swallow
everything with a bare `catch { }`. Add logger.warn with the error and enough
context (user id, kind) to diagnose a systematically broken token store.
Note while you are there: sendPush documents that it never throws, so the only
real throw source in those blocks is the device_push_tokens SELECT. Narrow the try
accordingly rather than wrapping the whole body.

## Tests

Add to apps/api-server/test/niyam-submissions.test.ts:
- daily streak of 7 ending 10 days ago → recomputeStreak reports current_streak 0,
  longest_streak still 7, and the daily_7 badge row still exists
- streak whose last submission was YESTERDAY → current_streak preserved, not lapsed
- the niyam-streak-lapse handler zeroes a stale row and leaves a live one untouched
  (invoke the exported handler directly; do not start the scheduler)
- awarding a badge inserts a notifications row with kind 'niyam_badge' and a
  Devanagari title_hi
- a parent with preferred_language 'hi' gets Hindi push copy on rejection

## Verify — paste actual output

pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
psql: SELECT current_streak, last_period_key FROM niyam_streaks
      WHERE current_streak > 0 LIMIT 10;
psql: SELECT kind, title_en, title_hi FROM notifications
      WHERE kind = 'niyam_badge' LIMIT 5;

Report on all seven items by number, including anything you chose not to do and why.

Commit: fix(niyam): streak lapse job, bilingual badge notifications, review follow-ups
````
