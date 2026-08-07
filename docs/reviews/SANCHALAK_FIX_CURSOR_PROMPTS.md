# Sanchalak implementation — Cursor fix prompts

**Date:** 2026-08-06
Companion to [`SANCHALAK_IMPLEMENTATION_REVIEW.md`](./SANCHALAK_IMPLEMENTATION_REVIEW.md). Two prompts. Prompt 1 is a correctness fix and should ship before the monthly report is used with real recipients; prompt 2 is small.

Every prompt assumes Cursor has `CLAUDE.md` in context. If it doesn't, prefix with:

> Read `CLAUDE.md` (AT5, AT10, Q11) before making any change.

Next free migration number is **0043** (`0042_centre_monthly_reports` exists). Remember to append to `lib/db/migrations/meta/_journal.json`.

---

## 1 — Canonical per-batch rates (H1)

```
Read CLAUDE.md AT5 and AT10, then:
  lib/db/migrations/0017_derived_attendance_fix.sql  (attendance_percentage_for_centres, line ~48)
  lib/db/migrations/0026_homework_completion_rate.sql (homework_completion_rate_for_centres, line ~50)
  apps/api-server/src/lib/attendance-rate.ts
  apps/api-server/src/lib/homework-completion-rate.ts
  apps/api-server/src/lib/centre-monthly-report.ts   (per-batch queries, lines ~175 and ~220)

THE BUG
centre-monthly-report.ts gets the centre-level figures right — it calls getCentresAttendanceRate
and getCentresHomeworkCompletionRate. Both PER-BATCH figures re-implement the arithmetic inline,
and both copies are wrong in the same way.

Canonical (both functions):
    INNER JOIN students st ON st.id = a.student_id
    WHERE …
      AND (st.deactivated_at IS NULL OR <date> < ((st.deactivated_at AT TIME ZONE 'Asia/Kolkata')::date))

The copies:
    left join students st on st.id = a.student_id
      and (st.deactivated_at is null or <date> < ((st.deactivated_at at time zone 'Asia/Kolkata')::date))

The deactivation predicate sits in a LEFT JOIN ... ON instead of a WHERE behind an INNER JOIN. When
a student was deactivated before the session/due date the join fails and st.* is NULL — but the
attendance (or homework_submissions) row survives, and BOTH count(*) FILTER clauses read a.status /
hs.status, never anything from st. Nothing downstream discards it: the only WHERE predicates are on
b (b.centre_id, b.deleted_at).

Result: rows for deactivated students are counted per batch and excluded everywhere else. The
per-batch table in the PDF does not reconcile with the centre figure printed on the same page, nor
with mv_centre_engagement, the mobile screens, or the progress report. It is invisible until a batch
has a mid-year leaver and then silently wrong every month after.

AT5 names this consumer explicitly: "Mobile, admin panel and the PDF worker all read from this one
place and never compute their own."

DO NOT patch the copies into agreement. That leaves two implementations and resets the clock — the
copies were faithful when written; they drifted on a join type. The canonical family has no
per-batch member, which is why there was nowhere to call. Add one.

=== Migration: lib/db/migrations/0043_per_batch_rate_functions.sql ===

Two set-returning functions (set-returning, not scalar — the report needs one row per batch from a
single query, which a scalar function cannot give efficiently):

  CREATE OR REPLACE FUNCTION attendance_rate_by_batch(
    p_centre_id uuid,
    p_from date DEFAULT NULL,
    p_to   date DEFAULT NULL
  ) RETURNS TABLE (batch_id uuid, attendance_rate numeric)
  LANGUAGE sql STABLE AS $$ … $$;

  CREATE OR REPLACE FUNCTION homework_completion_rate_by_batch(
    p_centre_id uuid,
    p_from date DEFAULT NULL,
    p_to   date DEFAULT NULL
  ) RETURNS TABLE (batch_id uuid, homework_rate numeric)
  LANGUAGE sql STABLE AS $$ … $$;

Each body must be the corresponding _for_centres function verbatim — same INNER JOINs, same
predicates, same FILTER arithmetic — with `p_centre_ids uuid[]` replaced by a single `p_centre_id`
and `GROUP BY b.id` added. Copy the SQL across; do not retype it from memory. Include a header
comment naming them as AT5 canonical alongside the existing pair.

THREE THINGS NOT TO "FIX" WHILE YOU ARE IN THERE:

1. Neither function filters centre_holidays. That is deliberate — 0017 and 0026 both carry a comment
   explaining it, and AT10 requires that sessions inside a holiday range which already have
   attendance are NOT retro-excluded. Preserve the absence and preserve the comment.
2. count(*) FILTER (WHERE …), never COUNT(expr IN (…)) — in Postgres COUNT(boolean) counts every
   non-null row and returns 1.0 for everyone. AT5 calls this out by name.
3. These functions return a rate only for batches that have rows. The report needs a row for EVERY
   active batch, including ones with no attendance yet (they should show a blank rate, not vanish).
   Keep that LEFT JOIN in the report's query against the function result — that is the one place a
   left join is correct here.

=== TypeScript wrappers ===

apps/api-server/src/lib/attendance-rate.ts — add, in the style of the existing wrappers:

  export async function getBatchAttendanceRates(
    centreId: string, from?: string | null, to?: string | null,
  ): Promise<Map<string, number | null>>

apps/api-server/src/lib/homework-completion-rate.ts — add the equivalent
getBatchHomeworkCompletionRates. Reuse each file's existing asRate() helper for the numeric coercion.

Both files already open with a comment warning against re-implementing the arithmetic in TypeScript.
Extend it to say a per-batch caller must use these wrappers rather than writing its own SQL.

=== centre-monthly-report.ts ===

Delete the batchAttResult query (lines ~176-206) and the batchHwResult query (lines ~220-245)
entirely, along with their row-shape casts. Call the two new wrappers instead and look the rates up
by batch id when building batchRows.

The student_count subquery stays as it is — it correctly filters status='active' AND
deleted_at IS NULL per Q11.

=== Tests: apps/api-server/test/centre-monthly-reports.test.ts ===

The regression test that matters, stated so it fails on today's code:
  Seed one centre with ONE batch. Give a student attendance rows, then set deactivated_at to a date
  inside the report period and add attendance rows dated after it. Assert the per-batch
  attendance_rate returned by the report EQUALS attendance_percentage_for_centres for that centre
  over the same window. On the current implementation these differ; after the fix they must be equal.

Then:
  - the same reconciliation for homework, using a submission dated after deactivated_at;
  - a batch with zero attendance rows still appears in the report with a null rate (not dropped);
  - a batch whose only sessions are cancelled returns null, not 0 — a cancelled class is not a
    0% class;
  - a holiday-dated session that already has attendance still counts, per AT10.

Run `pnpm db:migrate`, `pnpm typecheck`, `pnpm test`.
```

---

## 2 — Pending enrolment count and badge (M1)

```
Read apps/api-server/src/routes/v1/admin.ts (GET /analytics/overview, line ~208) and
apps/jain-pathshala-mobile/components/QuickActions.tsx (line ~218).

Fixing the open_service_requests mislabel was right — it had been counting pending ENROLMENTS since
it was written, so "Open requests" on the web dashboard and "Open service requests" on the analytics
page were both showing the wrong number. But that removed the only count of pending enrolments in
the system, and Enrolments is the one genuinely queue-shaped thing a Sanchalak is expected to clear.
It is now the only quick-action tile without a badge, while Attendance and Service requests have one.

- In GET /v1/admin/analytics/overview, add `pending_enrolments` alongside open_service_requests. The
  query is the one that was just replaced — enrolments where status = 'pending', filtered by
  scopedCentreFilter(scope, enrolments.requested_centre_id). Add it to the existing Promise.all
  rather than issuing a separate round trip.
- Add `pending_enrolments: z.number()` to overviewSchema in lib/api-zod/src/contracts.ts, and to the
  EMPTY / default objects in apps/jain-pathshala/src/pages/admin/DashboardPage.tsx and
  AnalyticsPage.tsx so the web dashboards do not read undefined.
- Badge the "/admin/enrolments" tile in SANCHALAK_ACTIONS with it, following the alertCount / openSr
  pattern already at QuickActions.tsx:224-227.
- On apps/jain-pathshala-mobile/app/admin/dashboard.tsx, show the number on the existing "Awaiting
  your approval" card — it currently has a button and no count.
- Surface it on the web dashboard too; "Pending enrolments" is more actionable than most of what is
  on that page.

Extend apps/api-server/test/analytics-overview.test.ts: pending_enrolments is centre-scoped (an
enrolment at another centre does not appear), and open_service_requests and pending_enrolments move
independently — seed one of each and assert both counts, which is the guard against the two fields
being conflated again.

Run `pnpm typecheck`, `pnpm test`.
```

---

## Not doing

**M2 (`student_code` search index)** — the ILIKE `'%q%'` on `student_code` can't use the existing unique btree, so code matching rides on the `full_name` trgm index's result set. Fine at current scale. Revisit only if code lookup measurably slows; the fix then is either a second trgm index or special-casing an exact/prefix match when the query looks like a code.

**M3 (`countRestorableSessions`)** — withdrawn, my error. It is wired at `admin-resources.ts:705`: the holidays *list* returns `restorable_session_count` per row, so the number is on screen before the Sanchalak taps delete. Better than the pre-flight call I originally specified. No change.
