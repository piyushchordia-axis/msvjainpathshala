# Code review — Sanchalak implementation

**Date:** 2026-08-06
**Reviewing:** `30767da` *feat: monthly centre PDF reports and Sanchalak admin surfaces* and `d7f9770` *feat: session check-in journey and searchable homework curriculum*
**Against:** [`SANCHALAK_REVIEW.md`](./SANCHALAK_REVIEW.md), [`SANCHALAK_GAPS_CURSOR_PROMPTS.md`](./SANCHALAK_GAPS_CURSOR_PROMPTS.md), `CLAUDE.md` (AT5, AT6, AT7, AT10, AT30, AT32, Q11, Q12)

**Note:** `pnpm` is unavailable in this environment and `node_modules` is partial, so `typecheck` and the test suites could not be run. This is a static review. The commits add 1,395 lines of new tests (`holidays`, `attendance-alerts`, `centre-monthly-reports`, `analytics-overview`, `admin-students`, `session-lifecycle`, plus extensions to `gallery`, `niyam-submissions`, `service-requests`) — please confirm they pass before shipping.

---

## Summary

This is a strong implementation. All nine raised items and all six sweep gaps are addressed, the decisions taken in the Q&A are reflected accurately, and — unusually — the *reasoning* survived into the code. `contracts.ts` carries the "deliberately NARROWER than canAccessAdminPanel" comment on `DONATION_VIEW_ROLES` in the house idiom; the holiday DELETE explains why the row must be gone before re-materialising; `query-persist-keys.ts` states the denial as a standing rule rather than a one-off. That is the difference between a fix and a fix that survives the next refactor.

Two things stand out as genuinely good judgement rather than instruction-following:

**The donations decision was made properly.** Rather than inventing a join, the implementer checked and found `donations` carries no `centre_id` and only a nullable `campaign_id → donation_campaigns.city_id`, then withheld the field entirely and documented why. `donations_total_paise_ytd` became `.optional()` in the schema. That is the right call, and the comment means nobody re-adds it.

**A pre-existing bug was found and fixed en route.** `open_service_requests` was counting *pending enrolments* — the field had been mislabelled since it was written, so the web dashboard's "Open requests" and the analytics page's "Open service requests" have both been showing the wrong number. My own prompt told them to reuse that count; they checked instead of trusting it. Good instinct.

**One real defect found**, in the monthly report's per-batch attendance figure — the exact AT5 drift the rule exists to prevent, in the exact component AT5 names.

**Verdict: Request changes** — H1 only. Everything else is either correct or a suggestion.

---

## High

### H1 — The monthly report's per-batch attendance rate double-counts deactivated students (AT5 drift)

`centre-monthly-report.ts` gets the centre-level rate right — it calls `getCentresAttendanceRate`, the canonical AT5 wrapper (`:88`). The per-batch table does not; it re-implements the arithmetic inline (`:175-206`), and the copy is not equivalent.

The canonical function (`0017_derived_attendance_fix.sql:48-73`):

```sql
FROM attendance a
INNER JOIN sessions s ON s.id = a.session_id
INNER JOIN batches   b ON b.id = s.batch_id
INNER JOIN students st ON st.id = a.student_id
WHERE s.status <> 'cancelled'
  AND (st.deactivated_at IS NULL
       OR s.scheduled_date < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date))
```

The report's copy:

```sql
from batches b
left join sessions s   on s.batch_id = b.id and s.status <> 'cancelled' and …
left join attendance a on a.session_id = s.id
left join students st  on st.id = a.student_id
  and (st.deactivated_at is null
       or s.scheduled_date < ((st.deactivated_at at time zone 'Asia/Kolkata')::date))
where b.centre_id = … and b.deleted_at is null
```

The deactivation predicate sits in a **`LEFT JOIN … ON`** clause instead of a `WHERE` behind an `INNER JOIN`. When a student was deactivated before the session date the join simply fails — `st.*` comes back NULL — but **the `attendance` row `a` survives**, and both FILTER aggregates count `a.status`, not anything from `st`. Nothing downstream discards it: the only `WHERE` predicates are on `b`.

So every attendance row belonging to a student deactivated mid-period is counted in the per-batch rate and excluded from the canonical rate. The consequences:

- The per-batch rates in the PDF do not reconcile with the centre rate printed on the same page, which came from the canonical function.
- They also disagree with `mv_centre_engagement`, the mobile attendance screens, and the progress report — all of which route through the canonical definition.
- The disagreement is invisible until a batch has a mid-year leaver, then silently wrong for every subsequent month.

This is precisely the failure AT5 was written to prevent, and AT5 names this consumer explicitly: *"Mobile, admin panel and **the PDF worker** all read from this one place and never compute their own."*

**Fix.** Do not patch the copy into agreement — that leaves two implementations and just resets the clock. Add a per-batch member to the canonical family, since one does not exist today (only `attendance_percentage` and `attendance_percentage_for_centres`), which is why the implementer had nowhere to call:

```sql
CREATE OR REPLACE FUNCTION attendance_rate_by_batch(
  p_centre_id uuid,
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
) RETURNS TABLE (batch_id uuid, attendance_rate numeric)
LANGUAGE sql STABLE AS $$ … $$;
```

with the same INNER JOINs and predicates as `attendance_percentage_for_centres`, then have the report select from it. A set-returning function is needed rather than a scalar because the report wants one row per batch in a single query.

**Worth stating explicitly in the fix:** the copy is correct to *omit* a holiday filter — `0017` deliberately has none, per AT10's rule that sessions inside a holiday range which already have attendance are not retro-excluded, and there is a comment there saying so. Do not "fix" that while fixing the join.

Add a test asserting the per-batch rate for a batch with a mid-period deactivated student equals what `attendance_percentage_for_centres` reports when that batch is the only one at the centre.

**The same defect exists a second time, in the homework column.** `centre-monthly-report.ts:220-245` repeats the pattern exactly — centre level correctly calls `getCentresHomeworkCompletionRate`, per batch inlines the arithmetic with `left join students st … and (st.deactivated_at is null or ha.due_date < …)`. The canonical `homework_completion_rate_for_centres` (`0026_homework_completion_rate.sql:67-76`) uses `INNER JOIN students st` with the predicate in the `WHERE`. Identical failure: a deactivated student's submissions survive the failed join and keep counting, because both FILTER clauses read `hs`, not `st`.

Fix both together — one migration, two set-returning functions, two call sites deleted. Fixing only the attendance half would leave the report internally inconsistent in a new way.

---

## Medium

### M1 — Pending enrolments no longer counted anywhere

Fixing the `open_service_requests` mislabel was right, but it removed the only count of pending enrolments in the system. `SANCHALAK_ACTIONS` now badges Attendance with `alertCount` and Service requests with `openSr` (`QuickActions.tsx:224-227`) — Enrolments, the one genuinely queue-shaped thing a Sanchalak is expected to clear, has no badge at all. The mobile dashboard still shows an "Awaiting your approval" card with no number.

**Suggestion:** add `pending_enrolments` to the overview payload (the old query is right there in the diff) and badge the Enrolments tile with it.

### M2 — `student_code` search is unindexed

`0041_students_search_indexes.sql` is well-judged — `pg_trgm` GIN on `full_name` for the leading-wildcard ILIKE, plus a partial composite btree on `(full_name, id) WHERE deleted_at IS NULL` for the keyset walk, with a comment explaining both. The migration notes that `student_code` "already has a unique btree (exact / prefix)".

That is true but does not help the query as written, which applies `ILIKE '%q%'` to both columns — a leading wildcard cannot use a btree, so `student_code` matching is a sequential scan filtered by the `full_name` index's result set. In practice fine; if code lookup ever feels slow, either add a second trgm index or special-case an exact/prefix match on `student_code` when the query looks like a code.

`escapeIlike` correctly escapes `\`, `%` and `_` so a typed `%` cannot widen the pattern. Postgres treats backslash as the default LIKE escape, so no explicit `ESCAPE` clause is needed. Correct as written.

### ~~M3 — `countRestorableSessions` appears unused~~ — withdrawn

Incorrect on my part. It is wired at `admin-resources.ts:705`, where the holidays **list** returns `restorable_session_count` per row. That is better than what I specified: the count is on screen before the Sanchalak taps delete, rather than being fetched as a separate pre-flight call. No change needed.

---

## Verified correct

Spot-checked against the specifications, all confirmed:

| Item | Finding |
|---|---|
| **C1 donations** | Withheld via `canViewDonations`, query skipped entirely for non-eligible roles, schema field `.optional()`, rationale documented in `contracts.ts`. Correct. |
| **Q12 niyam scope** | `inBatchWriteScope` on both approve (`niyam-approve.ts`) and reject; `inScope` import removed; `/pending` stays centre-scoped and returns `can_decide`; bulk approve inherits the gate through the shared service. Matches the rule exactly. |
| **Q12 mobile access** | `NiyamReviewScreen.tsx` extracted and shared; `app/admin/niyam-review.tsx` is a one-line re-export, not a fork. `canDecide` disables selection, long-press and both action buttons, and shows an explanatory row rather than hiding it (`:313-440`) — the visible-but-disabled behaviour asked for. |
| **AT32 / C4 sentinel GPS** | `0040_null_sentinel_checkin_gps.sql` nulls the fabricated `(0,0)` rows, sets `gps_flagged=false` and `gps_unverified=true`, states it is data-only, and warns against auto-running without ops review. Correct per AT32.2/32.3. |
| **AT10 holiday delete** | Row deleted *before* `rematerialiseCentreBatches`, with a comment explaining why; relies on `ON CONFLICT DO NOTHING` against the AT7 unique constraint so attendance-bearing sessions are not duplicated; audit entry records the restored count. Correct. |
| **AT30 holiday PATCH** | Publish/unpublish only, does not touch sessions. Correct — publication governs the public read, not whether class happens. |
| **Gallery safeguards** | All five present: opt-out badge, `cachePolicy="memory"` with a comment noting the literal is `"memory"` not `"memory-only"`, long-press absorbed, default filter `needs_attention`, no share/save. `query-persist-keys.ts` denies `["admin","gallery"]` explicitly *and* documents the denial as surviving future widening of the allow-list. Better than specified. |
| **Gallery API** | Keyset cursor plus `is_public` / `opt_in` / `since` filters added; `consent_opt_in` is null for non-student items rather than false, so "no consent recorded" and "consent withheld" stay distinguishable. Field name matches the mobile type. |
| **Attendance monitor** | `app/admin/attendance.tsx` header states the read-only intent; no `useMarkAttendance`, no mark affordance anywhere. `findConsecutiveAbsenceCandidates` is reused, not re-implemented. Parent phone included for the Call action. |
| **Enrolment reject reason** | Canned string gone; required 10–300 char field with live counter, editable presets, and the label "shown to the parent". |
| **Notices audience** | `type AudienceKind = "centre" | "batch"` — the picker cannot offer an audience `authorizeWrite` would refuse. |
| **Homework parity** | Extracted to `components/HomeworkAdmin.tsx` and shared; `app/shikshak/homework.tsx` dropped 794 lines. No fork. |
| **Q11** | The report's `student_count` subquery filters `status='active' AND deleted_at IS NULL`. Correct. |

---

## Recommended order

1. **H1** — canonical `attendance_rate_by_batch` + report switched to it, with the reconciliation test. Do this before the monthly report is used in anger; a PDF sent to trustees whose numbers disagree with the app is expensive to walk back.
2. **M1** — `pending_enrolments` on the overview and the Enrolments badge. Small.
3. **M3** — wire up or remove `countRestorableSessions`.
4. **M2** — only if code search proves slow in practice.

Then run `pnpm typecheck` and the full suite, which I could not do here.
