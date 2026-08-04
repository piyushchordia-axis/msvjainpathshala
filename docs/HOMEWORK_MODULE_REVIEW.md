# Code review — Homework module

**Date:** 2026-08-04
**Scope reviewed:**

| File | Lines |
|---|---|
| `lib/db/src/schema/homework.ts` | 63 |
| `apps/api-server/src/routes/v1/homework.ts` | 446 |
| `apps/api-server/src/services/homework-submit-sync.ts` | 70 |
| `apps/api-server/src/services/sync-batch.ts` (homework handler) | ~375–420 |
| `apps/jain-pathshala/src/pages/admin/HomeworkPage.tsx` | 298 |
| `apps/jain-pathshala-mobile/app/homework.tsx` | 232 |
| `apps/jain-pathshala-mobile/lib/queries.ts` (homework hooks) | 524–550 |
| `apps/api-server/test/homework.test.ts` | 272 |

Supporting libs read for context: `lib/scope.ts`, `lib/route-helpers.ts`, `lib/punya.ts`, `lib/file-tokens.ts`, `lib/validation.ts`, `lib/attendance-points.ts`, `lib/niyam-points.ts`, `lib/niyam-audience.ts`, `lib/offline/*` (mobile), migrations `0000`/`0001`.

---

## Summary

The grading path is the strongest code in the module — the compare-and-set claim plus in-transaction Punya award (`homework.ts:272–326`) is exactly the AT20 discipline, and it has a real test that proves it. Everything around that core is thinner: the read-side authorisation is a centre-wide leak, there are two divergent implementations of "submit homework", the offline path is wired end-to-end on the server but never reachable from the client, and the module has no edit, delete, or reversal story at all.

**Verdict: Request changes.** Four items are blocking; the rest is a prioritised backlog.

---

## Critical issues

| # | File | Line | Issue | Severity |
|---|---|---|---|---|
| 1 | `routes/v1/homework.ts` | 198 | Submission list is centre-scoped, not batch-scoped — cross-batch data leak | 🔴 Critical |
| 2 | `routes/v1/homework.ts` | 41–49 | Local `ownedStudentId` shadows the canonical one, dropping the Q11 filters | 🔴 Critical |
| 3 | `routes/v1/homework.ts` + `services/homework-submit-sync.ts` | 400–444 / 21–70 | Two divergent implementations of the same operation | 🔴 Critical |
| 4 | `routes/v1/homework.ts` | 287 | Grading a never-submitted `pending` row awards full Punya | 🔴 Critical |

### 1 — Submission reads leak across batches

`GET /assignments/:id/submissions` gates on `inScope(scope, assignment.centre_id)` — centre level. The grade route two functions down gates on `inBatchWriteScope(scope, sub.batch_id, sub.centre_id)` — batch level. A shikshak assigned to one batch can therefore **list every student in every batch at their centre**: full name, `student_code`, submission status, and a freshly signed URL to the child's uploaded work.

`signUploadUrl` does its job faithfully here — which is precisely the problem. The signature is minted for whoever asks, so the authorisation check *is* the access control.

`GET /assignments` (line 153) has the same shape: `scopedCentreFilter` only, so a shikshak sees the whole centre's homework list.

```ts
// homework.ts:198 — current
if (!assignment || !inScope(scope, assignment.centre_id)) {

// suggested
const [assignment] = await db
  .select({ id: …, batch_id: homework_assignments.batch_id, centre_id: batches.centre_id })
  …
if (!assignment || !inBatchWriteScope(scope, assignment.batch_id, assignment.centre_id)) {
```

Also add the batch filter to the list route when `scope.batchIds !== null`. Note `inScope` is marked `@deprecated` in `scope.ts` — this call site is one of the ones it was asking you to migrate.

### 2 — Q11 bypassed by a shadowed helper

`route-helpers.ts` exports an `ownedStudentId` that filters `deleted_at is null` **and** `status = 'active'`, with the comment "Soft-deleted and non-active students are treated as not found (Q11)". `homework.ts` imports `clampLimit`, `inScope`, `scopedCentreFilter` from that same file — and then defines its own `ownedStudentId` (lines 41–49) without either filter.

Result: a deactivated student's parent keeps full read access to the homework feed and can still submit work. Deactivated students also stay in `submitted`/`graded` counts because the fan-out row was never removed.

Fix is a deletion: remove lines 41–49 and add `ownedStudentId` to the existing `route-helpers` import on line 29. Worth a repo-wide grep for other local copies.

### 3 — Two implementations of "submit homework"

CLAUDE.md, offline sync §4: *"Each `op_type` handler calls the same service method as its direct online endpoint… Never a parallel offline-only implementation."*

`applyHomeworkSubmit` exists and is called only from `sync-batch.ts`. The online route re-implements it inline. They have already drifted:

| Behaviour | Online route (`homework.ts:400`) | Sync service (`homework-submit-sync.ts:21`) |
|---|---|---|
| URL validation | `httpUrl(1000)` — http(s) only | none; `file_url: z.string().optional()` accepts anything |
| Ownership | parent or self | parent, self, **or any `super_admin`** (line 47) |
| Missing URL | rejected by Zod | sets `submission_url = null` (line 62) — wipes prior work |
| `notes` | not accepted | accepted, then silently dropped |

The `?? null` on line 62 is the sharpest edge: a replayed op without `file_url` marks the row `submitted` while erasing the link to the child's actual work.

Recommendation: make `applyHomeworkSubmit` the single implementation, move the `httpUrl` validation and the conflict comparison into it, have the route call it, and either drop the `super_admin` branch or make it deliberate and audited.

### 4 — Punya for work never submitted

The claim predicate is:

```ts
sql`${homework_submissions.status} not in ('approved', 'starred')`
```

`pending` satisfies that. A shikshak can open the submissions dialog, hit **Star** on a student who never submitted anything, and the student receives 12 Punya. There is no reversal path (see #12), so it is permanent.

The admin list's `submitted` counter has the same hole — its filter includes `'approved','starred'`, so a `pending → approved` row inflates the submitted count.

```ts
// suggested
sql`${homework_submissions.status} in ('submitted', 'late')`
```

…returning 409 `ERR_CONFLICT` with a message that states the fix, per the error-voice rule ("Nothing has been submitted yet — ask the student to upload their work first").

---

## High priority

### 5 — Offline homework is unreachable from the client

Everything is in place except the one line that would use it:

- `lib/offline/queue-keys.ts` defines `jp.queue.homework_submissions` and puts it in `DRAIN_ORDER` ✓
- `lib/offline/types.ts` defines `PendingHomeworkSubmissionOp` ✓
- `services/sync-batch.ts` handles `homework_submission` ✓
- `lib/offline/sync-engine.ts` exports `enqueueCheckIn`, `enqueueAttendance`, `enqueueCheckOut` — **and nothing else**
- `lib/queries.ts:545` `useSubmitHomework` calls `apiPost` directly

So offline submission = network error = `Alert.alert("Could not submit")` and the work is gone. Compare `useSubmitAttendance` (`queries.ts:330`), which does the enqueue-then-drain dance correctly. Add `enqueueHomeworkSubmission` and route the mutation through it.

### 6 — Server sync contract does not match the documented client contract

CLAUDE.md §1:

```ts
type PendingHomeworkSubmissionOp = {
  submission_op_id: string;
  niyam_id: …            // (assignment_id, student_id, proof_asset_id)
  assignment_id: string;
  student_id: string;
  payload: Record<string, unknown>;
};
```

`sync-batch.ts` accepts all of those as optional and then hard-fails unless `submission_id` — a field the documented contract does not have — is present:

```ts
if (!submissionId) {
  return { …, error: { code: "ERR_VALIDATION_FAILED",
    message: "submission_id is required for homework_submission ops." } };
}
```

A client written to the spec gets every homework op rejected. Since 4xx-other-than-409 is terminal under the retry policy, those ops go straight to `failed` with no auto-retry. Either resolve `(assignment_id, student_id) → submission_id` server-side (the unique index makes this a one-line lookup) or amend CLAUDE.md §1. The lookup is the better fix — the client shouldn't need a server-minted id to queue work offline, which is the same reasoning behind `(batch_id, session_date)` for attendance.

### 7 — Assignment creation is not transactional

`homework.ts:116–136` does two independent statements: insert the assignment, then insert the fan-out. A failure between them leaves an assignment with zero submissions — invisible in every student feed, showing `0/0` in the admin table, and unfixable because there is no edit or delete route (#11). Wrap both in `db.transaction`.

### 8 — Punya value hardcoded

```ts
const POINTS = 10;                          // homework.ts:37
const points = body.status === "starred"
  ? Math.round(POINTS * 1.2) : POINTS;      // homework.ts:270
```

The repo already has `attendance-points.ts` ("AT21 — never inline a constant", with Redis caching and city-scoped `punya_configs` fallback) and `niyam-points.ts` (bounds from `punya_features`, city override from `punya_configs`). Homework is the only Punya-awarding module that ignores both tables. Points cannot be tuned per city without a deploy, and the 20% star bonus is invisible to admins.

Add a `homework-points.ts` following the `attendance-points.ts` shape, with `punya_features.key = 'homework'`.

### 9 — Late/on-time decided in UTC

```ts
const today = new Date().toISOString().slice(0, 10);   // UTC
const isLate = sub.due_date < today;
```

Present in both implementations (`homework.ts:434`, `homework-submit-sync.ts:56`). Between 00:00 and 05:30 IST the UTC date is still yesterday, so a submission 5 hours past the deadline records as on-time. AT26 already establishes Asia/Kolkata as the evaluation timezone for exactly this class of bug. Same helper, same treatment.

The related question the code doesn't answer: should `late` be evaluated against the client's timestamp (as AT26 does for attendance) rather than server receipt? For an offline-queued submission drained two days later, receipt time is the wrong clock.

### 10 — `is_msv` assignments fan out to everyone

`is_msv` is stored, rendered as a badge in the admin table, and returned in the feed — but the target resolution (`homework.ts:108–114`) is `batch_id = ? AND status = 'active'` regardless. Non-MSV students receive MSV homework and can earn Punya for it.

`niyam-audience.ts` already models this correctly (`msv_audience === 'msv' && student.msv_status !== 'approved' → false`). Reuse that predicate.

Separately worth a decision: `is_msv` is currently settable by any admin-panel role including `shikshak`. Q2 restricts MSV *curriculum* to super_admin at the service layer. Homework isn't curriculum, so this may be fine — but it should be a recorded decision rather than an accident.

### 11 — No edit, no delete

The schema carries `softDelete()` and every query filters `isNull(deleted_at)`, but there is no `PATCH` and no `DELETE` route. Nothing ever writes `deleted_at`. A wrong due date, a typo'd title, or an assignment created against the wrong batch is permanent and visible to every parent in that batch.

When you add the delete, decide what happens to Punya already awarded under it — the current cascade would leave orphaned balances.

### 12 — No Punya reversal for homework

`idempotencyKey: \`homework-grade:${sub.id}\`` is permanent by design, which makes a mistaken grade unrecoverable: you cannot un-grade, and even if you could, the key would block a corrected re-award. Niyam has a documented 30-day reversal window (Q5) and `reversePunya` already exists in `lib/punya.ts` with the right semantics. Homework should follow AT18's reverse-then-award shape, with a revision component in the key.

---

## Medium priority

| # | File | Line | Issue |
|---|---|---|---|
| 13 | `homework.ts` / `HomeworkPage.tsx` | 280, 300 / 158 | Re-grading wipes feedback and the original grader |
| 14 | `homework.ts` | 108–136 | Late-joining students never receive existing assignments; `target_student_ids` is write-only |
| 15 | `homework.ts` | 152, 361 | No pagination — limit only, no cursor or offset |
| 16 | `homework.ts` | 161–182 | Aggregate-then-limit on the assignment list |
| 17 | `homework.ts` | 138–146 | No notification on assignment creation, no due-date reminder |
| 18 | `schema/homework.ts` | 16–17, 44 | `title` / `description` / `feedback_note` are single-language |
| 19 | `homework.ts` | 57 | Past `due_date` accepted at creation |
| 20 | `mobile/app/homework.tsx` | 65–85 | URL text field only — no file upload |

**13.** `feedback_note: body.feedback_note ?? null` on both update branches, and the admin UI sends `feedback.trim() || undefined` — so approving a submission without retyping the feedback box silently deletes existing feedback. The second branch also overwrites `marked_by`/`marked_at`, losing who originally graded it. Either make `feedback_note` a genuine partial update (only set when the key is present) or prefill and always resend from the UI.

**14.** The fan-out at creation is the only write to `homework_submissions`. A student enrolled into the batch the next day sees nothing. `target_student_ids` is written but read by nothing — a `uuid[]` with no FK integrity, no GIN index, and no backfill job, so it will drift from the submission rows that actually matter. Either make it the source of truth with a reconciliation job, or drop the column.

**16.** `LEFT JOIN homework_submissions … GROUP BY assignment … LIMIT n` forces Postgres to aggregate every in-scope assignment before applying the limit. For a super_admin at national scale that's a full scan plus hash aggregate on each page load. A `LATERAL` count subquery over the limited set, or denormalised counters on the assignment row, fixes it.

**17.** `notification_kind_enum` already contains `'homework'` and the `notifications.fanout` queue exists — neither is used. Parents currently only discover homework by opening the app. Attendance marking pushes to parents; homework doesn't.

**18.** CLAUDE.md: *"All user-facing content must have `_en` and `_hi` variants."* Homework is admin-authored free text, so a `_hi` column may be more burden than benefit — but the rule is explicit and the deviation is currently silent. Make it a recorded decision either way. (The mobile screen's own chrome is correctly bilingual.)

---

## Low priority

- **21.** Unused `import type { PgColumn }` — `homework.ts:20`.
- **22.** `UUID_RE` redefined locally (`homework.ts:34`); `/mine` returns 404 for a malformed uuid where 422 is more accurate.
- **23.** `inScope` is `@deprecated` in favour of `inCentreScope` — see #1, which supersedes both at this call site.
- **24.** Test hygiene — `freshSubmissionFor` (`homework.test.ts:45–58`) creates an assignment against *every* batch until one yields the target student, and never cleans up. Every CI run permanently adds junk assignments and submission rows to the seeded database, and the count grows with the batch table.
- **25.** Coverage gaps: nothing exercises the sync path, cross-batch scope isolation, late computation, concurrent double-grade, or the `target_student_ids` subset branch. The two paths most likely to break are the two with no test.

---

## What looks good

- **The grade transaction (`homework.ts:272–326`).** Conditional `UPDATE … RETURNING` as a compare-and-set, the award composed into the *caller's* transaction rather than a second connection, and a submission-scoped idempotency key as a second line of defence. This is the "guarded insert, then move the balance by what was actually returned" discipline from AT20, applied correctly — and the comment explains the reasoning rather than restating the code.
- **The re-grade test (`homework.test.ts:185–233`)** asserts the thing that actually matters (`afterStar === afterApprove`), not just that the call returned 200.
- **`UNIQUE (assignment_id, student_id)`** is the right domain idempotency anchor, matching the reasoning in the offline sync §3 note about attendance.
- **Every URL leaving the API goes through `signUploadUrl`**, `httpUrl()` guards the online input, and the admin table renders through `safeHref`. The URL handling is consistent and correct.
- **Ownership failures return 404, not 403** — no existence oracle for probing other families' submission ids.
- **The mobile screen** follows the documented state ladder (session-loading → no-child → query-loading → error → empty → data), keeps Jain terms untranslated, and uses tokens rather than hex.

---

## Suggested order of work

**Blocking — before this ships to a real centre**

1. #1 batch-scope the submission reads
2. #2 delete the shadowed `ownedStudentId`
3. #4 refuse to grade `pending`
4. #3 collapse to one submit implementation

**Contract correctness — before the mobile offline release**

5. #7 wrap creation in a transaction
6. #9 Asia/Kolkata for late
7. #6 reconcile the sync payload contract
8. #5 wire `enqueueHomeworkSubmission`

**Product completeness**

9. #11 edit/delete, #12 reversal, #8 configurable points, #10 MSV audience, #13 partial feedback update, #17 notifications

**Then** #14–#16, #18–#20, and the test gaps in #24–#25.
