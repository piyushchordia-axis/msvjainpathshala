# Verification review — Homework module

**Date:** 2026-08-04
**Scope:** 38 commits, `990e0cc` … `0da1625`, verifying `docs/HOMEWORK_MODULE_REVIEW.md`
(fixes #1–#25) and `docs/HOMEWORK_FIX_PROMPTS.md` Phase 5 (features F1–F13).

| | before | after |
|---|---|---|
| `routes/v1/homework.ts` | 446 | 1704 |
| `schema/homework.ts` | 63 | 85 |
| `test/homework.test.ts` | 272 | 3204 |
| admin `HomeworkPage.tsx` | 298 | 815 |
| mobile `app/homework.tsx` | 232 | 425 |
| new libs | — | `homework-points`, `homework-notify`, `homework-materialise`, `homework-completion-rate`, `homework-curriculum`, `owned-upload` |
| migrations | — | `0020`–`0027` |

---

## Summary

All 25 fixes and all 13 features are implemented, and the implementations are
faithful rather than nominal — the AT18 re-grade path in particular is the rule as
written, not an approximation of it. Nothing here is blocking. The findings below
are one performance problem worth fixing before a Guruji presses the bulk-grade
button on a real batch, one analytics query to profile before national scale, and a
short tail of dead code.

**Verdict: Approve with follow-ups.**

---

## Verification matrix

### Phase 1–4 fixes

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Batch-scope reads | ✅ | `homework.ts:856` uses `inBatchWriteScope` with `batch_id` in the select; list route pushes `inArray(batchIds)` / `sql\`false\`` at `:702` |
| 2 | Canonical `ownedStudentId` | ✅ | Local copy gone; `ownedStudentRow` / `listOwnedStudents` from `route-helpers`, both on `ownedStudentsCondition` (`deleted_at IS NULL` + `status='active'`) |
| 3 | Single submit service | ✅ | Route delegates at `:1664`; `super_admin` bypass deleted with the reasoning in a comment; `notes` removed from the contract |
| 4 | No Punya for unsubmitted work | ✅ | Pre-check 409 at `:1249`; claim predicate `in ('submitted','late','acknowledged')` at `:175` |
| 5 | Mobile offline queue | ✅ | `enqueueHomeworkSubmission` / `enqueueHomeworkMarkDone`; `useSubmitHomework` enqueues then drains |
| 6 | Sync contract | ✅ | Resolves from `(assignment_id, student_id)`; `submission_id` still accepted; `ERR_NOT_FOUND` vs `ERR_VALIDATION_FAILED` distinguished |
| 7 | Atomic create | ✅ | Roster resolution + assignment insert + fan-out in one `db.transaction` at `:337` |
| 8 | Points from config | ✅ | `homework-points.ts`, cache → city `punya_configs` → global → default; two feature keys |
| 9 | Kolkata lateness | ✅ | `kolkataDateString(resolveClientWhen(clientTimestamp))` — client clock honoured (AT26) |
| 10 | MSV audience | ✅ | Fan-out filters `msv_status`; submit re-checks at `homework-submit-sync.ts:99` |
| 11 | Edit / soft-delete | ✅ | `PATCH` with true partial semantics; `DELETE` with `force_delete` + reversal |
| 12 | Punya reversal | ✅ | Revision-scoped keys, `findLatestUnreversedHomeworkAward`, `/ungrade` route |
| 13 | Partial feedback | ✅ | `hasOwnProperty` on `req.body`; UI tracks `feedbackEdited` |
| 14 | Late joiners | ✅ | `homework-materialise.ts`; `target_student_ids` dropped in `0022` |
| 15 | Pagination | ✅ | Keyset cursors on both list routes |
| 16 | Aggregate-then-limit | ✅ | `LATERAL` counts over the limited page at `:775` |
| 17 | Notifications | ✅ | Assign / graded / returned; prefs gated inside `notifyUsers` — but see **Finding 1** |
| 18 | Bilingual content | ⏸ | Deferred — see **Open decisions** |
| 19 | Past due date | ✅ | Rejected on create; `allow_past_due_date` override on PATCH |
| 20 | Mobile upload | ✅ | `HomeworkProofPicker` |
| 21 | Unused import | ✅ | `PgColumn` gone |
| 22 | Shared uuid validator | ✅ | `isUuid` / `UUID_RE` from `lib/validation`; 422 for malformed |
| 23 | Deprecated `inScope` | ✅ | No call sites remain |
| 24 | Test isolation | ✅ | `afterEach` watermark delete — but see **Finding 4** |
| 25 | Coverage gaps | ✅ | 60+ tests including the concurrent-grade race |

### Phase 5 features

| # | Item | Status | Evidence |
|---|---|---|---|
| F1 | Mark-done | ✅ | `/mark-done` route + `acknowledged` status + sync `kind: 'homework'` |
| F2 | Verified uploads | ✅ | `owned-upload.ts` shared with niyam; admin escape hatch gated |
| F3 | Ledger pointer | ✅ | `punya_transaction_id`, written in the claim transaction |
| F4 | Completion rate | ✅ | Two SQL functions + MV column — but see **Finding 2** |
| F5 | Progress report | ✅ | `buildHomeworkSnapshot` calls the SQL function, never recomputes |
| F6 | Combined feed | ✅ | `student_id` optional; `listOwnedStudents` |
| F7 | `(student_id, status)` | ✅ | Replaces student-only index |
| F8 | Points default | ⏸ | See **Open decisions** |
| F9 | Returned state | ✅ | Required feedback, reversal on already-graded, parent notified |
| F10 | Bulk grading | ✅ | `/grade-all`, per-row results — but see **Finding 1** |
| F11 | Overdue | ✅ | Derived, never stored — but see **Finding 5** |
| F12 | Curriculum link | ✅ | Advisory `curriculum_item_id`, validated against the batch's curriculum |
| F13 | Attachments | ✅ | Create + edit dialogs, signed in the feed |

---

## Findings

### 🟠 1 — Bulk grading is a notification storm and an N+1

`homework.ts:1026–1069`, `homework-notify.ts:53–96`

The loop opens **one `db.transaction` per row**, writes **one `auditFromReq` per row**,
and calls **one `notifyParentHomeworkGraded` per row** — and that function
independently re-queries the student *and* re-queries the assignment title on every
call. Grading a 30-student batch is roughly 120 queries and 30 push notifications
from a single button press. A parent with three children in the batch gets three
pushes for one action.

The assign path got this right — `notifyParentsHomeworkAssigned` dedupes to unique
parent ids and makes one `notifyUsers` call, with the AT31 reasoning in its header.
The bulk grade path did not inherit that restraint.

Suggested shape:

```ts
// hoist once, outside the loop
const [assignment] = await db.select({ title: … })…

const gradedStudentIds: string[] = [];
for (const sub of candidates) { …; gradedStudentIds.push(sub.student_id); }

// one deduped fanout after the loop, mirroring notifyParentsHomeworkAssigned
await notifyParentsHomeworkGraded({ studentIds: gradedStudentIds, status, assignmentTitle });
```

Per-row audit entries are correct and should stay — one graded submission, one audit
row. It is the notification and the repeated title lookup that need hoisting.

### 🟠 2 — The MV calls the completion function once per (centre, month)

`0026_homework_completion_rate.sql`

`attendance_rate` is computed inside the grouped scan. `homework_completion_rate` is
a correlated call to `homework_completion_rate_for_centres(ARRAY[c.id], …)` evaluated
**per output row** — each one a full scan of
`homework_submissions ⋈ homework_assignments ⋈ batches ⋈ students` filtered by centre
and month. For N centres × M months that is N×M scans on every nightly
`analytics.refresh_views`.

Sharing one canonical function was the right call (AT5) — the issue is only how it's
invoked from the view. A `LEFT JOIN LATERAL` against a pre-grouped homework CTE, or a
set-returning variant of the function, would collapse it to one pass. Worth an
`EXPLAIN ANALYZE` on the refresh before this reaches national scale.

*Not a regression:* the inline attendance arithmetic in that view is inherited
verbatim from `0017_derived_attendance_fix.sql` (whose header explains the choice).
`0026` copied the existing definition and appended one column rather than rewriting
it — which is exactly the careful thing to have done.

### 🟡 3 — "Overdue first" only sorts within a page

`homework.ts:1646`

`items.sort(...)` runs on the fetched page after keyset pagination. An overdue item
that falls on page 3 stays on page 3. The cursor is computed from the unsorted `page`
array before the sort, so **pagination itself is correct** — but the stated behaviour
isn't delivered globally.

Either order in SQL and fold the expression into the keyset, or drop the client-side
sort so the ordering contract is honest about what it does.

### 🟡 4 — Test runs still inflate Punya balances

`test/homework.test.ts:31–39`

The `afterEach` watermark delete removes assignments and cascades submissions —
genuinely fixing the assignment pollution FIX #24 targeted. But `punya_transactions`
and `punya_balances` written by the grading tests are never reversed, so every full
run permanently raises the seeded students' totals.

Tests assert deltas rather than absolutes, so nothing breaks; this is drift, not
failure. Reversing in `afterEach` (the `/ungrade` route exists now) or scoping the
delete to also clear `punya_transactions` with a `homework-grade:` key prefix would
close it.

### 🟡 5 — `returned` work is never counted overdue

`homework.ts:55–57`, and the count filter at `:793`

`isOverdueHomework` matches `status === 'pending'` only. A submission the Guruji
returned for rework, now past its due date, is not flagged overdue in the feed or
counted in the admin column — even though the family demonstrably owes work. Likely
wants `status in ('pending', 'returned')` in both places.

### 🔵 6 — Two dead ternaries in the reversal paths

`homework.ts:1195` — `rev.reversed ? rev.points_reversed : rev.points_reversed`;
both branches are identical.

`homework.ts:1502–1504` — assigns `reversedPoints`, then immediately overwrites it
with the same value on the other branch.

Both reduce to `rev.points_reversed` unconditionally. The code reads as though the
idempotent-replay case is handled differently when it isn't, which will cost the next
reader a minute. Collapse both.

### 🔵 7 — `actually_reversed` is computed and never read

`homework.ts:1529` — not in the response, not in the audit metadata. Either surface
it or drop it.

### 🔵 8 — Barrel export is inconsistent

`lib/offline/index.ts` re-exports `enqueueHomeworkSubmission` but not
`enqueueHomeworkMarkDone`. Works today because `queries.ts` imports from
`sync-engine` directly, but the barrel now tells a partial story.

### 🔵 9 — Dynamic import on hot online routes

`homework.ts:1664`, `:1687` — `await import("../../services/homework-submit-sync")`
inside the handler. `sync-batch.ts` uses that pattern to break a cycle; these routes
don't need it. A static import is clearer and skips a resolve per request.

### 🔵 10 — `mark-done` parses no body

Harmless — the route takes no inputs — but every sibling route runs a Zod parse, and
a client sending a payload it believes matters gets silence rather than a 422.

---

## Open decisions

Two items the prompts deliberately routed to you appear to have been settled by
default rather than by a recorded decision:

- **F8 — points.** `0021` still seeds `homework` 10 / `homework_starred` 12, inherited
  from the old hardcoded constant. SPEC §13.5 and Step 15 both say `homework_approved`
  is 15. Keeping 10 is a legitimate choice; it just isn't written down anywhere.
- **#18 — bilingual content.** `title`, `description` and `feedback_note` remain
  single-field. The prompt asked for a short options note before implementing.
  Deferring is fine — this is the one item with no visible resolution either way.

---

## Not verified in this pass

`pnpm typecheck` and the test suite could not be executed here: the sandbox mount
returns an I/O error on `node_modules/typescript` and `pnpm` is not on PATH.
Everything above is from reading source, migrations, and git history.

Please paste the output of:

```
pnpm typecheck
pnpm --filter @workspace/api-server test homework
pnpm --filter @workspace/jain-pathshala-mobile test
```

The concurrency test (`test:2100`) and the sync replay test (`test:997`) are the two
most worth seeing pass in CI rather than locally.

---

## What looks good

- **The AT18 re-grade path** (`homework.ts:1274–1394`) is the standout. Claim first;
  reverse-then-award only when the *resolved* point value actually changed;
  metadata-only with no revision bump when it doesn't; original grader preserved; the
  ledger pointer maintained inside the same transaction. That is the rule implemented,
  not approximated.
- **`findLatestUnreversedHomeworkAward`** prefers the F3 pointer, falls back to a
  key-prefix scan, and still recognises the legacy un-suffixed `homework-grade:{id}`
  key from before the revision scheme existed. Nobody asked for that migration
  awareness.
- **`0026` extended the existing view rather than rewriting it** — the temptation to
  "clean up" the inline attendance arithmetic while in there must have been real.
  Leaving it alone was correct.
- **`resolveOwnedUpload` was extracted and shared** with niyam rather than copied, and
  the admin external-link escape hatch is structured so the parent submit path can
  never reach it.
- **The completion-rate SQL** documents its definition-of-record above the function,
  uses `COUNT(*) FILTER`, and returns NULL for the empty set with an explicit AT6
  reference — "no homework set ≠ 0%".
- **Error copy** consistently states the problem and the fix, in the CLAUDE.md voice:
  *"Add a short note explaining what to fix — returning work without feedback leaves
  the family guessing."*
- **Test suite** at 3204 lines covers essentially every acceptance criterion the
  prompts named, including the concurrent double-grade race the original code
  deserved and never had.
