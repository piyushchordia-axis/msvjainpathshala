# Cursor prompt pack — Homework module fixes

Companion to `docs/HOMEWORK_MODULE_REVIEW.md`. Twenty-five prompts covering every
finding, grouped into four phases, each phase with an orchestration prompt.

**How to use**

1. Paste **§0 Shared context** into Cursor once per session (or save it as a
   `.cursor/rules` entry so it rides along automatically).
2. Run either the phase orchestration prompt (bigger diff, fewer round trips) or
   the individual fix prompts in order (small, reviewable commits).
3. Every prompt is test-first. Do not accept a "done" without pasted command output.

**Real commands in this repo**

| Purpose | Command |
|---|---|
| Typecheck everything | `pnpm typecheck` |
| API tests | `pnpm --filter @workspace/api-server test` |
| One API test file | `pnpm --filter @workspace/api-server test homework` |
| Mobile tests | `pnpm --filter @workspace/jain-pathshala-mobile test` |
| Generate migration | `pnpm db:generate` |
| Apply migration | `pnpm db:migrate` |

---

## Contents

- [§0 Shared context](#0--shared-context-paste-once)
- [Phase 1 — Blocking (#1–#4)](#phase-1--blocking)
- [Phase 2 — Contract correctness (#5–#9)](#phase-2--contract-correctness)
- [Phase 3 — Product completeness (#8, #10–#13, #17)](#phase-3--product-completeness)
- [Phase 4 — Data model, perf, hygiene (#14–#16, #18–#25)](#phase-4--data-model-performance-hygiene)
- [Phase 5 — Missing features (F1–F13)](#phase-5--missing-features)

---

## §0 — Shared context (paste once)

```
You are working in the Jain Pathshala monorepo (pnpm workspaces + TypeScript).

IMPORTANT — the running stack differs from CLAUDE.md in one respect. CLAUDE.md
describes NestJS in apps/api. The ACTUAL backend is Express 5 in apps/api-server,
with Drizzle exported from the @workspace/db package and Zod contracts in
@workspace/api-zod. Do NOT refactor toward NestJS, and do not "fix" imports to
match CLAUDE.md's directory table. Match the surrounding code.

Surfaces:
  apps/api-server              Express API (this is the backend)
  apps/jain-pathshala          Web admin panel (React)
  apps/jain-pathshala-mobile   Expo app
  lib/db                       Drizzle schema + migrations (@workspace/db)
  lib/api-zod                  shared Zod contracts + role helpers

Read before writing any code:
  1. CLAUDE.md at the repo root. It is authoritative over SPEC.md. Pay particular
     attention to Q11, AT18, AT20, AT21, AT26 and the section
     "Offline sync — canonical model".
  2. docs/HOMEWORK_MODULE_REVIEW.md — the review these fixes come from.
  3. The files named in the prompt AND their immediate neighbours, so your change
     matches the conventions already in use.

Conventions you must follow:
  - Responses go through ok(res, data, meta) / fail(res, status, CODE, message)
    from src/lib/envelope. Never res.json() directly.
  - Error codes are ERR_SCREAMING_SNAKE.
  - Error copy states the problem AND the fix, e.g.
    "Nothing has been submitted yet — ask the student to upload their work first."
    Not "Invalid state."
  - Never inline a Punya point value. Resolve from punya_features / punya_configs
    the way src/lib/attendance-points.ts and src/lib/niyam-points.ts already do.
  - Never hard-delete students or enrolments (Q11).
  - Drizzle query builder by default; only reach for sql`` where the surrounding
    code already does.
  - British spelling in schema names: centres, not centers.
  - No emoji in product UI. Sentence case for buttons and headings.
  - Jain terms stay untranslated: Pathshala, Punya, Guruji, Sanchalak, Niyam, Shivir.

Definition of done — every prompt, no exceptions:
  1. Write the failing test FIRST. Run it. Paste the FAILING output.
  2. Make the change.
  3. Re-run the test. Paste the PASSING output.
  4. Run `pnpm typecheck` from the repo root. Paste the output.
  5. Commit with the exact message given in the prompt.
Do not report a task complete without pasted, real command output. If a step is
blocked, say so explicitly rather than skipping it.
```

---

# Phase 1 — Blocking

Four security and correctness defects. None of these should reach a live centre.

### Phase 1 orchestration prompt

```
Work through docs/HOMEWORK_FIX_PROMPTS.md prompts FIX #1, #2, #4, #3 — in that
order, which is deliberate: #1 and #2 are pure deletions/substitutions, #4 is a
one-line predicate, and #3 is the refactor that touches both. Doing #3 last means
it absorbs the corrected behaviour from the other three rather than fighting it.

One commit per fix. After each commit, stop and print a short diff summary so I
can review before you continue. Do not batch them into one commit.
```

---

### FIX #1 — Batch-scope the homework submission reads

```
FIX #1 — Batch-scope homework reads (security, blocking)

File: apps/api-server/src/routes/v1/homework.ts

PROBLEM
GET /assignments/:id/submissions (~line 189) authorises with
  inScope(scope, assignment.centre_id)          <- CENTRE level
POST /submissions/:id/grade (~line 254) authorises with
  inBatchWriteScope(scope, sub.batch_id, sub.centre_id)   <- BATCH level

So a shikshak assigned to one batch can list every student in every batch at their
centre: full_name, student_code, status, and a freshly signed URL to that child's
uploaded work. signUploadUrl mints a valid signature for whoever asks, so the
authorisation check IS the access control — there is no second gate downstream.

GET /assignments (~line 150) has the same gap: it filters with scopedCentreFilter
only, so a shikshak sees the whole centre's assignment list.

Note src/lib/scope.ts marks inScope @deprecated in favour of inCentreScope. This
call site needs neither — it needs the batch-level gate.

TEST FIRST — apps/api-server/test/homework.test.ts
  a) "a shikshak cannot list submissions for a batch they are not assigned to"
     As super_admin, create an assignment against a batch that sits at the
     shikshak's centre but is NOT in their shikshak_batch_assignments.
     GET /v1/homework/assignments/:id/submissions as that shikshak -> 404.
  b) "the assignment list is limited to a shikshak's assigned batches"
     GET /v1/homework/assignments as the shikshak -> assert every returned
     batch_id is in that shikshak's assigned batch set.

If the dev seed has no second batch at the shikshak's centre, ADD ONE TO THE SEED.
Do not weaken the test to fit the fixture.

CHANGE
  1. In the submissions route, add batch_id to the select:
       batch_id: homework_assignments.batch_id
     and replace the guard with
       inBatchWriteScope(scope, assignment.batch_id, assignment.centre_id)
  2. In GET /assignments, when scope.batchIds !== null push
       inArray(homework_assignments.batch_id, scope.batchIds)
     onto `filters` — and sql`false` when that array is empty, mirroring how
     scopedCentreFilter handles the empty case in src/lib/route-helpers.ts.
  3. Drop the inScope import if nothing else in the file uses it.

Keep returning 404 rather than 403 on the read routes. The existing code
deliberately avoids handing out an existence oracle; preserve that.

COMMIT: fix: batch-scope homework submission and assignment reads
```

---

### FIX #2 — Remove the shadowed `ownedStudentId`

```
FIX #2 — Remove the shadowed ownedStudentId (Q11, blocking)

Files:
  apps/api-server/src/routes/v1/homework.ts   (local copy ~lines 41-49; import ~29)
  apps/api-server/src/lib/route-helpers.ts    (canonical version — read it first)

PROBLEM
route-helpers.ts exports an ownedStudentId that filters
  isNull(students.deleted_at)  AND  eq(students.status, "active")
with the comment "Soft-deleted and non-active students are treated as not found (Q11)".

homework.ts imports clampLimit / inScope / scopedCentreFilter from that exact file,
and then defines its OWN ownedStudentId with neither filter. Consequence: a
deactivated student's parent keeps full read access to GET /v1/homework/mine and
can still POST /v1/homework/submissions/:id/submit. Their rows also stay in the
submitted/graded counters.

CLAUDE.md Q11: students are deactivated (status='inactive'), never deleted, and
must not appear in active rosters or leaderboards.

TEST FIRST — apps/api-server/test/homework.test.ts
  a) "a deactivated student's homework feed returns 404"
  b) "a deactivated student cannot submit homework"
Deactivate through the existing admin deactivate route (find it — do not DELETE
the row, and do not write status directly from the test if a route exists).
Re-activate in a finally block so the suite stays rerunnable.

CHANGE
  Delete the local function (~41-49). Add ownedStudentId to the existing
  route-helpers import on ~line 29. No other edits.

THEN — audit only, do not fix in this commit:
  rg "function ownedStudentId" apps/api-server/src
Every hit outside route-helpers.ts is this same bug in another module. List them
in your summary with file:line so I can triage.

COMMIT: fix: use canonical ownedStudentId in homework (Q11)
```

---

### FIX #4 — Refuse to grade a submission that was never submitted

```
FIX #4 — Do not award Punya for work that was never submitted (blocking)

File: apps/api-server/src/routes/v1/homework.ts  (~line 287, and the count filter ~172)

PROBLEM
The compare-and-set claim predicate in the grade transaction is:
  sql`${homework_submissions.status} not in ('approved', 'starred')`
'pending' satisfies that. A shikshak can open the submissions dialog and press
Star on a student who submitted nothing; the student receives full Punya. There is
currently no reversal path (see FIX #12), so it is permanent.

The admin list has the matching hole: the `submitted` counter filters
  in ('submitted','approved','starred','late')
so a pending row graded straight to approved inflates the submitted count.

TEST FIRST — apps/api-server/test/homework.test.ts
  "grading a pending submission is rejected and awards no Punya"
   - create a fresh assignment (pending submission, nothing submitted)
   - record the student's Punya total
   - POST .../grade {status:"approved"} -> expect 409, error.code ERR_CONFLICT
   - assert the Punya total is unchanged
   - assert the submission is still status 'pending'

CHANGE
  1. Before the transaction, reject when sub.status is not 'submitted' or 'late':
       fail(res, 409, "ERR_CONFLICT",
         "Nothing has been submitted yet — ask the student to upload their work first.")
     Keep the wording in the CLAUDE.md error voice: problem AND fix.
  2. Tighten the claim predicate to
       sql`${homework_submissions.status} in ('submitted', 'late')`
     Keep it as a predicate inside the UPDATE — the pre-check is for a good error
     message, the predicate is what actually makes concurrent grades safe. Do not
     replace one with the other.
  3. Leave the count filter on line ~172 as it is; once (1) and (2) land, a
     pending row can no longer become approved, so the counter is correct again.
     Add a one-line comment saying so.

DO NOT restructure the surrounding transaction. The claim-then-award pattern in
lines ~272-326 is correct (AT20) and well commented — preserve it exactly.

COMMIT: fix: reject grading of unsubmitted homework
```

---

### FIX #3 — Collapse to one submit implementation

```
FIX #3 — One implementation of "submit homework" (blocking)

Files:
  apps/api-server/src/routes/v1/homework.ts               (~lines 395-444)
  apps/api-server/src/services/homework-submit-sync.ts    (whole file)
  apps/api-server/src/services/sync-batch.ts              (handleHomeworkSubmission)

PROBLEM
CLAUDE.md, "Offline sync — canonical model" §4:
  "Each op_type handler calls the SAME service method as its direct online
   endpoint... Never a parallel offline-only implementation."

applyHomeworkSubmit() exists and is called ONLY from sync-batch.ts. The online
route re-implements it inline. They have already drifted:

  behaviour        | online route              | applyHomeworkSubmit
  -----------------|---------------------------|----------------------------------
  URL validation   | httpUrl(1000), http(s)    | none — file_url: z.string().optional()
  ownership        | parent or self            | parent, self, OR any super_admin (~47)
  missing URL      | rejected by Zod           | sets submission_url = null (~62)
  notes            | not accepted              | accepted then silently dropped

The `?? null` on line ~62 is the sharpest edge: a replayed op without file_url
marks the row submitted while ERASING the link to the child's actual work.

Compare src/services/attendance-mark.ts and niyam-submit-sync.ts for the shape the
codebase already uses for a shared service method.

TEST FIRST — apps/api-server/test/homework.test.ts
  a) "an offline homework op with a non-http url is rejected"
     POST /v1/sync/batch with op_type homework_submission and
     file_url "javascript:alert(1)" -> result status 'failed',
     error.code ERR_VALIDATION_FAILED.
  b) "an offline homework op without a url does not erase an existing submission"
     Submit online, then replay a sync op with no file_url -> the stored
     submission_url is unchanged.
  c) "the online route and the sync path produce the same row"
     Same input via both entry points -> identical status and late flag.

CHANGE
  1. Make applyHomeworkSubmit the single implementation. Move into it:
       - the httpUrl(1000) validation (import from src/lib/validation)
       - the graded-lock 409
       - the late computation (FIX #9 will correct its timezone; if #9 has already
         landed, use the shared helper rather than re-deriving)
       - `submission_url` must only be written when a url was actually supplied.
         Never null out an existing value.
  2. Have POST /v1/homework/submissions/:id/submit call applyHomeworkSubmit and
     map HomeworkSubmitError -> fail(res, err.httpStatus, err.code, err.message).
     The route keeps its own Zod parse of the request body; the service validates
     the url again because the sync path does not go through that schema.
  3. Decide the super_admin branch explicitly. Either:
       (a) delete it — a super_admin submitting a child's homework is odd, or
       (b) keep it and write an audit entry via auditFromReq/audit lib on that path.
     State which you chose and why in the commit body. Do not leave it silent.
  4. Either honour `notes` (persist it) or remove it from the opts type and the
     sync-batch payload schema. Do not keep accepting a field you discard.

COMMIT: refactor: single homework submit service shared by route and sync
```

---

# Phase 2 — Contract correctness

Needed before the mobile offline release ships.

### Phase 2 orchestration prompt

```
Work through docs/HOMEWORK_FIX_PROMPTS.md prompts FIX #7, #9, #6, #5 in that order.
#7 and #9 are server-local; #6 changes the wire contract; #5 is the client half of
#6 and must land after it or the app will talk to an endpoint that doesn't accept
its payload yet.

One commit per fix. Stop after each for review. Before starting, confirm Phase 1 is
merged — #5 and #6 both assume the single submit service from FIX #3 exists.
```

---

### FIX #7 — Wrap assignment creation in a transaction

```
FIX #7 — Assignment creation must be atomic

File: apps/api-server/src/routes/v1/homework.ts  (~lines 116-136)

PROBLEM
Two independent statements: insert the assignment row, then insert the fan-out of
homework_submissions. A failure between them leaves an assignment with zero
submissions — invisible in every student feed, showing 0/0 in the admin table, and
currently unfixable because there is no edit or delete route (see FIX #11).

TEST FIRST
  "an assignment and its submissions are created atomically"
  Simplest honest version: assert that after a successful create, the returned
  submissions_created equals the count of homework_submissions rows for that
  assignment id, and that an assignment row never exists with zero submissions
  when the batch has active students. If you can inject a failure into the second
  insert cleanly, do that instead and assert no assignment row survives.

CHANGE
  Wrap the assignment insert + fan-out insert in db.transaction(async (tx) => ...).
  Move the target resolution queries inside the transaction too, so a student
  deactivated mid-request cannot slip into the fan-out.
  Keep the auditFromReq call OUTSIDE the transaction — that matches how the grade
  route already sequences audit writes.

Also guard the empty case: db.insert(...).values([]) throws. The existing
`if (targetIds.length > 0)` guard is correct — keep it, and make sure the
assignment still commits when a batch has no active students.

COMMIT: fix: create homework assignment and fan-out in one transaction
```

---

### FIX #9 — Evaluate late/on-time in Asia/Kolkata

```
FIX #9 — Late/on-time must be evaluated in Asia/Kolkata, not UTC

Files:
  apps/api-server/src/routes/v1/homework.ts             (~line 434)
  apps/api-server/src/services/homework-submit-sync.ts  (~line 56)
  (after FIX #3 these are one place — do #3 first if it is not merged)

PROBLEM
  const today = new Date().toISOString().slice(0, 10);   // UTC date
  const isLate = sub.due_date < today;
IST is UTC+5:30, so between 00:00 and 05:30 IST the UTC date is still yesterday.
A submission five hours past the deadline records as on-time.

CLAUDE.md AT26 already establishes Asia/Kolkata as the evaluation timezone for
exactly this class of bug, and AT26 further says the comparison should run against
the CLIENT's timestamp, not server receipt time — because an op queued offline and
drained two days later must not be judged by when it happened to reach the server.

Look for an existing Kolkata date helper before writing a new one:
  rg "Asia/Kolkata" apps/api-server/src lib
src/lib/attendance-* and src/services/attendance-mark.ts are the likely homes.
Reuse it. If none exists, add one to src/lib/ and use it from both places.

TEST FIRST
  a) "a submission made at 02:00 IST on the day after the due date is late"
     Freeze the clock (vitest fake timers) at a UTC instant that is the previous
     day in UTC but past midnight in IST. Assert status 'late' and late === true.
  b) "an on-time submission is not marked late" — regression guard.

CHANGE
  1. Replace both UTC derivations with the Kolkata-aware helper.
  2. Accept an optional client timestamp (marked_at / client_timestamp) on the
     service input and evaluate lateness against it when present, falling back to
     server now. Wire the sync path to pass op.client_timestamp through.
  3. Comment the AT26 reference at the comparison so the next reader knows why.

COMMIT: fix: evaluate homework lateness in Asia/Kolkata against client time (AT26)
```

---

### FIX #6 — Reconcile the sync payload contract

```
FIX #6 — The homework sync op contract does not match CLAUDE.md

File: apps/api-server/src/services/sync-batch.ts  (handleHomeworkSubmission)

PROBLEM
CLAUDE.md "Offline sync — canonical model" §1 defines:
  type PendingHomeworkSubmissionOp = {
    submission_op_id: string;
    assignment_id: string;
    student_id: string;
    proof_asset_id?: string;
    client_timestamp: string;
  };
There is no submission_id in that contract. But handleHomeworkSubmission accepts
everything as optional and then hard-fails:
  "submission_id is required for homework_submission ops."
A client written to the documented contract gets every op rejected. Because
4xx-other-than-409 is terminal under the retry policy (CLAUDE.md offline sync §7),
those ops go straight to `failed` and never retry — the exact silent data loss the
offline model exists to prevent.

RESOLUTION — resolve server-side, do not amend the doc.
The client should not need a server-minted id to queue work offline. That is the
same reasoning behind keying attendance on (batch_id, session_date) rather than a
client-minted session_id, stated in §1 "Session resolution key". The unique index
homework_submissions_assignment_student_unique (assignment_id, student_id) makes
the lookup a single query.

TEST FIRST — apps/api-server/test/homework.test.ts
  a) "a homework sync op resolves the submission from assignment_id + student_id"
     POST /v1/sync/batch with assignment_id + student_id and NO submission_id ->
     result status 'success', and the submission row is updated.
  b) "submission_id still works" — back-compat regression.
  c) "an unresolvable pair fails with ERR_NOT_FOUND, not ERR_VALIDATION_FAILED"
  d) "replaying the same submission_op_id returns the stored response and does not
     re-execute" — asserts the sync_operations replay path (§5).

CHANGE
  1. In handleHomeworkSubmission, when submission_id is absent but assignment_id
     and student_id are present, resolve the submission id via the unique pair.
  2. Fail with ERR_VALIDATION_FAILED only when NEITHER submission_id NOR the
     (assignment_id, student_id) pair is supplied.
  3. Ownership stays enforced inside the service (FIX #3) — do not duplicate the
     check here.
  4. Update lib/api-zod if the op payload has a shared schema there, so the client
     and server compile against the same type.
  5. Mirror the resolved shape into
     apps/jain-pathshala-mobile/lib/offline/types.ts PendingHomeworkSubmissionOp:
     make assignment_id and student_id REQUIRED and submission_id optional, so the
     documented contract is the one the type system enforces.

COMMIT: fix: resolve homework sync ops from assignment_id + student_id
```

---

### FIX #5 — Wire the mobile offline queue for homework

```
FIX #5 — Homework offline queue is unreachable from the client

Files:
  apps/jain-pathshala-mobile/lib/offline/sync-engine.ts
  apps/jain-pathshala-mobile/lib/queries.ts            (useSubmitHomework, ~line 542)
  apps/jain-pathshala-mobile/app/homework.tsx          (SubmitForm)

PROBLEM
Everything is in place except the line that would use it:
  - lib/offline/queue-keys.ts defines jp.queue.homework_submissions and includes
    it in DRAIN_ORDER                                            OK
  - lib/offline/types.ts defines PendingHomeworkSubmissionOp     OK
  - the server handles op_type homework_submission               OK
  - sync-engine.ts exports enqueueCheckIn, enqueueAttendance,
    enqueueCheckOut — AND NOTHING ELSE                           <-- gap
  - queries.ts useSubmitHomework calls apiPost directly          <-- gap

So an offline submit is a network error -> Alert.alert("Could not submit") -> the
parent's work is gone. The queue key exists but nothing ever writes to it.

REFERENCE IMPLEMENTATION — copy the shape, do not invent one:
  sync-engine.ts enqueueAttendance (~line 59)
  queries.ts useSubmitAttendance (~line 330) — enqueue, then drainQueues()

TEST FIRST — apps/jain-pathshala-mobile/lib/offline/__tests__/
  a) "a homework submission enqueues to jp.queue.homework_submissions"
  b) "queued homework ops drain in DRAIN_ORDER after niyam_submissions"
  c) "a failed homework op moves to the `failed` UI state and is not discarded"
     (CLAUDE.md offline sync §8 — `failed` must offer manual retry, never silently
     drop)
Extend the existing drain.test.ts rather than starting a new file.

CHANGE
  1. Add enqueueHomeworkSubmission(input) to sync-engine.ts, minting a ULID
     submission_op_id and a client_timestamp exactly as enqueueAttendance does.
     Export it from lib/offline/index.ts alongside the other three.
  2. Rewrite useSubmitHomework to enqueue then drainQueues(), matching
     useSubmitAttendance. Keep the optimistic query invalidation.
  3. Update app/homework.tsx so the success path says the work was saved and will
     sync — not that it was submitted — when the op is still queued. Use the
     §8 state vocabulary: queued / syncing / synced / duplicate / conflict / failed.
     Bilingual copy, Devanagari for Hindi (no Hinglish).

Do NOT add a second online-shaped retry path. CLAUDE.md §4: /v1/sync/batch is the
only transport, and the client must not have two sync code paths.

COMMIT: feat: queue homework submissions through the offline sync engine
```

---

# Phase 3 — Product completeness

### Phase 3 orchestration prompt

```
Work through docs/HOMEWORK_FIX_PROMPTS.md prompts FIX #11, #12, #8, #10, #13, #17.
Order matters at the top: #11 (edit/delete) and #12 (reversal) are related — an
assignment delete has to decide what happens to Punya awarded under it, and #12
gives it the mechanism. Do #11 and #12 as a pair, in that order, then the rest.

One commit per fix, stop after each. These change product behaviour, so include a
one-paragraph note in each commit body describing what an admin will now see.
```

---

### FIX #11 — Add edit and delete for assignments

```
FIX #11 — Homework assignments can be created but never edited or deleted

Files:
  apps/api-server/src/routes/v1/homework.ts
  apps/jain-pathshala/src/pages/admin/HomeworkPage.tsx

PROBLEM
lib/db/src/schema/homework.ts applies softDelete() to homework_assignments and
every query filters isNull(deleted_at) — but no route ever writes deleted_at, and
there is no PATCH. A wrong due date, a typo'd title, or an assignment created
against the wrong batch is permanent and visible to every parent in that batch.

TEST FIRST
  a) "an assignment can be edited within scope"     PATCH -> 200, fields updated
  b) "an out-of-scope shikshak cannot edit"         PATCH -> 404
  c) "a deleted assignment disappears from /mine and the admin list"
  d) "deleting an assignment with graded submissions is blocked without force"
     (see the decision below)

CHANGE
  1. PATCH /v1/homework/assignments/:id — title, description, due_date,
     attachment_url, is_msv. requireAdminPanel + inBatchWriteScope, 404 out of
     scope. Audit entry via auditFromReq. Partial update semantics: only write
     fields actually present in the body — do not `?? null` an absent key (that is
     the bug in FIX #13).
     Changing due_date must NOT retroactively re-evaluate `late` on rows already
     submitted; state that in a comment.
  2. DELETE /v1/homework/assignments/:id — soft delete only, set deleted_at.
     Never DELETE the row. Audit entry.
  3. DECISION REQUIRED — what happens to Punya awarded under a deleted assignment?
     Mirror the niyam precedent (Q5): reverse on removal, using the reversal from
     FIX #12. If any submission is already graded, require an explicit
     `force_delete: true` in the body — the same shape AT25 uses for cancelling a
     session that already has attendance marks. Without the flag, return 409 with
     a message naming how many graded submissions would be affected.
  4. Admin UI: edit dialog reusing NewAssignmentDialog's form, and a delete action
     with a confirm step that states the graded-submission consequence.

COMMIT: feat: edit and soft-delete homework assignments
```

---

### FIX #12 — Punya reversal for homework

```
FIX #12 — A mistaken homework grade can never be undone

Files:
  apps/api-server/src/routes/v1/homework.ts
  apps/api-server/src/lib/punya.ts   (reversePunya already exists — read it first)

PROBLEM
The award key is `homework-grade:${sub.id}` — permanent by design. So you cannot
un-grade, and even if a route existed, the key would block a corrected re-award.
Niyam has a documented 30-day reversal window (Q5) and reversePunya() already
implements the right semantics (negative ledger row, reversal_of pointer,
idempotent on the reversal key).

CLAUDE.md AT18 gives the shape to follow: award-worthiness changes are expressed
as an explicit REVERSE-then-AWARD pair, never a bare second award. And the key must
carry a revision component, because a key constant across corrections cannot
represent a state TRANSITION.

TEST FIRST
  a) "un-grading reverses the awarded Punya exactly once"
  b) "un-grading twice does not double-debit"
  c) "re-grading after an un-grade awards again" (this is the one the current key
     scheme makes impossible — it should fail before your change)
  d) "approved -> starred re-grade reverses the old value and awards the new"
     (AT18: both award-worthy but different point value -> reverse then award)

CHANGE
  1. Add a `revision` integer column to homework_submissions, default 0,
     incremented on every status change that alters award-worthiness or point
     value. Generate the migration with `pnpm db:generate`; do not hand-write SQL.
  2. Change the award key to include the revision:
       homework-grade:{submission_id}:{revision}
     and the reversal key to that key + ":reversal", which is what
     awardKeyFromReversal() in punya.ts already expects.
  3. Add POST /v1/homework/submissions/:id/ungrade — requireAdminPanel,
     inBatchWriteScope, reverses inside a transaction, bumps revision, resets
     status to 'submitted'/'late' (whichever it was), clears marked_by/marked_at,
     writes an audit entry.
  4. Make the existing grade route follow AT18 when a graded row is re-graded to a
     DIFFERENT point value: reverse the old, award the new. When the value is
     identical, write no transaction and do NOT bump revision.
  5. Decide whether a reversal window applies. Q5 gives niyam 30 days. If you adopt
     it, use error code ERR_HOMEWORK_REVERSAL_WINDOW_EXPIRED and say so in the
     commit body; if not, say why in a comment.

Preserve the claim-then-award transaction structure from lines ~272-326 (AT20).

COMMIT: feat: reversible homework grading with revision-scoped Punya keys
```

---

### FIX #8 — Resolve Punya points from configuration

```
FIX #8 — Homework Punya values are hardcoded

Files:
  apps/api-server/src/routes/v1/homework.ts  (~line 37 POINTS = 10, ~line 270 * 1.2)
  NEW: apps/api-server/src/lib/homework-points.ts
  REFERENCE: src/lib/attendance-points.ts, src/lib/niyam-points.ts

PROBLEM
  const POINTS = 10;
  const points = body.status === "starred" ? Math.round(POINTS * 1.2) : POINTS;
Homework is the only Punya-awarding module that ignores punya_features and
punya_configs. Points cannot be tuned per city without a deploy, and the 20% star
bonus is invisible to admins. attendance-points.ts opens with "AT21 — ... Never
inline a constant" and implements exactly the pattern needed here, including the
Redis cache with a memory fallback.

TEST FIRST
  a) "homework points come from punya_configs when a city override exists"
  b) "homework points fall back to the global config, then to the default"
  c) "the starred bonus is configurable and not a hardcoded multiplier"

CHANGE
  1. Create src/lib/homework-points.ts modelled on attendance-points.ts:
     feature key "homework", city-scoped punya_configs override, global fallback,
     cached with the same TTL and the same fail-open-to-DB behaviour.
  2. Represent approved vs starred as two resolvable values (e.g. feature keys
     "homework" and "homework_starred"), not a multiplier. A 20% bonus that only
     exists in code is not configurable.
  3. Resolve the city from the submission's centre, the way attendance-points.ts
     walks batch -> centre -> city.
  4. Seed sensible defaults (10 / 12) into punya_features so behaviour is unchanged
     on a fresh install. Migration via `pnpm db:generate`.
  5. Delete the POINTS constant.

COMMIT: feat: resolve homework Punya points from punya_features (AT21 pattern)
```

---

### FIX #10 — MSV assignments must respect MSV audience

```
FIX #10 — is_msv homework fans out to every student

Files:
  apps/api-server/src/routes/v1/homework.ts   (~lines 88-114)
  REFERENCE: apps/api-server/src/lib/niyam-audience.ts

PROBLEM
is_msv is stored, badged in the admin table, and returned in the feed — but target
resolution is `batch_id = ? AND status = 'active'` regardless of it. Non-MSV
students receive MSV homework and can earn Punya for it.

niyam-audience.ts already models this correctly:
  if (niyam.msv_audience === "msv"     && student.msv_status !== "approved") return false;
  if (niyam.msv_audience === "non_msv" && student.msv_status === "approved") return false;
and its header note is the point: "Catalog filtering alone is not enough — submit
must re-check the same rules."

TEST FIRST
  a) "an is_msv assignment only fans out to MSV-approved students in the batch"
  b) "a non-MSV student cannot submit against an is_msv assignment"  (the re-check)
  c) "a normal assignment still fans out to everyone active"

CHANGE
  1. Filter the target query on students.msv_status === 'approved' when is_msv.
  2. Re-check the same predicate in the submit service (FIX #3's shared method),
     not just at fan-out — same reasoning as the niyam comment.
  3. Consider widening is_msv to a three-value audience field matching niyam's
     msv_audience ('all' | 'msv' | 'non_msv') for consistency. If you do, migrate
     existing rows: is_msv=false -> 'all', is_msv=true -> 'msv'. If you don't, note
     why in the commit body.
  4. SEPARATE DECISION, do not change silently: is_msv is currently settable by any
     admin-panel role including shikshak. Q2 restricts MSV *curriculum* to
     super_admin at the SERVICE layer. Homework is not curriculum, so this may be
     intentional — surface the question in your summary and leave the behaviour
     alone until I answer.

COMMIT: fix: restrict MSV homework fan-out to MSV-approved students
```

---

### FIX #13 — Stop wiping feedback on re-grade

```
FIX #13 — Re-grading silently deletes feedback and the original grader

Files:
  apps/api-server/src/routes/v1/homework.ts            (~lines 280, 300)
  apps/jain-pathshala/src/pages/admin/HomeworkPage.tsx (~line 158)

PROBLEM
Both update branches do `feedback_note: body.feedback_note ?? null`, and the admin
UI sends `feedback.trim() || undefined` for an empty box. So a Guruji who approves
a submission without retyping the feedback silently DELETES the feedback already
there — which the parent may have already read. The second branch also overwrites
marked_by/marked_at, losing who originally graded it.

TEST FIRST
  a) "re-grading without a feedback_note key preserves existing feedback"
  b) "re-grading with feedback_note: null explicitly clears it"
  c) "the original grader is retained on the submission"

CHANGE
  1. Partial update semantics: build the update object and only include
     feedback_note when the key is PRESENT in the parsed body. Use
     `.optional().nullable()` in the Zod schema so an explicit null can still clear
     it, and distinguish absent from null.
  2. Keep the original grader. Either add first_marked_by / first_marked_at, or
     stop overwriting marked_by on the re-grade branch. The audit log records who
     re-graded, so preserving the first grader on the row is the cheaper fix.
  3. Admin UI: prefill the feedback input from submission.feedback_note (it already
     does) and stop coercing empty to undefined — send the field only when the user
     actually edited it, or add an explicit "clear feedback" control.

COMMIT: fix: partial-update semantics for homework feedback
```

---

### FIX #17 — Notify parents about homework

```
FIX #17 — No notification on assignment, no due-date reminder

Files:
  apps/api-server/src/routes/v1/homework.ts
  apps/api-server/src/lib/notify.ts     (read first)
  REFERENCE: src/routes/v1/niyam-submissions.ts, src/routes/v1/gallery.ts

PROBLEM
notification_kind_enum already contains 'homework' and the notifications.fanout
queue exists — neither is used by this module. Parents only discover homework by
opening the app. Attendance marking pushes to parents; homework does not.

TEST FIRST
  a) "creating an assignment enqueues one notification per target student"
  b) "grading a submission notifies that student's parent"
  c) "a parent who has opted out of push receives no push"
     (CLAUDE.md: check users.notification_preferences before enqueuing)

CHANGE
  1. On assignment create, enqueue a fanout to the target students' parents with
     kind 'homework'. Bilingual title/body — Devanagari for Hindi, no Hinglish.
     Address the parent as "you"; the teacher is Guruji or Didi, never "the teacher".
  2. On grade, notify that student's parent.
  3. Respect notification_preferences on both paths.
  4. Batch, do not loop-and-send. Look at how the attendance push is debounced
     (AT31, 5-minute settle window per student+session) and apply the same
     restraint here: one notification per assignment per parent, not one per child
     if a parent has three children in the same batch.
  5. Add a due-date reminder job ONLY if you also add it to the frozen cron table
     in CLAUDE.md in the same commit. That table is single-source; an entry that
     exists in code but not the table is the drift it was written to prevent.

COMMIT: feat: notify parents on homework assignment and grading
```

---

# Phase 4 — Data model, performance, hygiene

### Phase 4 orchestration prompt

```
Work through docs/HOMEWORK_FIX_PROMPTS.md prompts FIX #14, #15, #16, #18, #19, #20,
then the cleanup batch #21-#23, then the test work #24-#25.

#21, #22 and #23 are trivial and may share ONE commit — they are import hygiene.
Everything else gets its own commit. Stop after each for review.
```

---

### FIX #14 — Late joiners and the write-only `target_student_ids`

```
FIX #14 — Students who join a batch later never receive existing homework

File: apps/api-server/src/routes/v1/homework.ts  (~lines 88-136)
Schema: lib/db/src/schema/homework.ts  (target_student_ids)

PROBLEM
The fan-out at creation is the ONLY write to homework_submissions. A student
enrolled into the batch the next day sees nothing, forever. Meanwhile
target_student_ids is written but read by nothing: a uuid[] with no FK integrity,
no GIN index, and no reconciliation — so it drifts from the submission rows that
are the actual source of truth.

DECISION REQUIRED — pick one and state it in the commit body:
  (a) target_student_ids becomes the source of truth. Add a reconciliation that
      materialises missing submission rows on read of /mine (or a small job), plus
      a GIN index. Keeps late joiners covered for open assignments.
  (b) Drop the column. Fan-out rows are the record. Handle late joiners by
      materialising submissions for not-yet-due assignments when a student's
      batch_id changes.
Recommend (b) — it removes a whole class of drift and matches how the module
already behaves. But say which you chose.

TEST FIRST
  a) "a student moved into a batch receives its not-yet-due assignments"
  b) "a student moved out does not receive new ones and keeps their history"
  c) "past-due assignments are NOT back-created for a late joiner"

CHANGE
  Implement the chosen option. If (b), generate a migration dropping the column
  with `pnpm db:generate` and remove it from the create route's insert.

COMMIT: fix: materialise homework for students who join a batch later
```

---

### FIX #15 — Pagination

```
FIX #15 — Homework lists have no pagination

File: apps/api-server/src/routes/v1/homework.ts  (~lines 152, 361)

PROBLEM
Both the admin assignment list and GET /mine accept only `limit` (clampLimit,
default 50, max 200). There is no cursor and no offset, so older homework is
simply unreachable. A student in their second year cannot see last term's work.

Check how the other admin list routes in this repo paginate before inventing a
scheme — match whatever admin-resources.ts / students.ts already do, so the web
client's useAdminList hook keeps working.

TEST FIRST
  a) "the second page returns the next set with no overlap"
  b) "the meta block reports whether more rows exist"

CHANGE
  Add keyset pagination on (created_at, id) for the admin list and
  (due_date, id) for /mine — both already order by those columns. Return the
  cursor in the existing meta envelope. Update useAdminList and the mobile
  useHomework hook to follow it.

COMMIT: feat: paginate homework assignment and student lists
```

---

### FIX #16 — Aggregate-then-limit on the assignment list

```
FIX #16 — The admin assignment list aggregates every in-scope row before limiting

File: apps/api-server/src/routes/v1/homework.ts  (~lines 161-182)

PROBLEM
  LEFT JOIN homework_submissions ... GROUP BY assignment ... LIMIT n
Postgres must aggregate EVERY in-scope assignment before applying the limit. For a
super_admin at national scale that is a full scan plus hash aggregate on each page
load of the admin panel.

TEST FIRST
  A correctness test, not a benchmark: "the counts are identical before and after".
  Snapshot total/submitted/graded for a set of assignments, apply the change, assert
  identical numbers — including the zero-submission case that LEFT JOIN currently
  handles and a LATERAL subquery must keep handling.

CHANGE
  Select and order the limited set of assignments FIRST, then compute counts with a
  LATERAL subquery over just those ids. Verify with EXPLAIN ANALYZE and paste the
  before/after plans — the aggregate should no longer sit above the limit.
  Consider denormalised counters on the assignment row only if LATERAL is not
  enough; a counter needs its own consistency story, so do not reach for it first.

Do this AFTER FIX #15 — keyset pagination changes the shape of this query.

COMMIT: perf: compute homework submission counts over the limited set
```

---

### FIX #18 — Bilingual content fields

```
FIX #18 — Homework content is single-language

File: lib/db/src/schema/homework.ts  (title, description, feedback_note)

PROBLEM
CLAUDE.md, Bilingual requirements: "All user-facing content must have _en and _hi
variants (e.g. title_en, title_hi). All API responses include both variants;
client renders based on preferred_language."
homework_assignments.title / .description and homework_submissions.feedback_note
are single fields. The mobile screen's own chrome is correctly bilingual, which
makes the gap more visible: Hindi labels wrapping English content.

This is a DECISION, not a mechanical fix. Homework is admin-authored free text
typed by a Guruji in one language; forcing two fields may produce empty _hi columns
across the board, which is worse than one honest field.

DO THIS FIRST, before writing code:
  Write a short options note (3 paragraphs max) covering:
    (a) full _en/_hi columns, matching quizzes/niyams
    (b) keep one field, add a language tag column so clients can render correctly
    (c) documented exception for admin-authored free text
  Recommend one. Wait for my answer before implementing.

Once decided: migration via `pnpm db:generate`, update the create/edit routes, the
admin form, the mobile renderer, and add the exception to CLAUDE.md if (c).

COMMIT: (after decision) — message depends on the option chosen
```

---

### FIX #19 — Reject a due date in the past

```
FIX #19 — Assignments can be created with a due date already past

File: apps/api-server/src/routes/v1/homework.ts  (createAssignmentSchema, ~line 57)

PROBLEM
due_date is validated only as /^\d{4}-\d{2}-\d{2}$/. A Guruji who mistypes the year
creates an assignment where every student's first submission is instantly 'late'.

TEST FIRST
  a) "creating an assignment with a past due date is rejected"
  b) "today's date is accepted" (boundary — due today is not late)

CHANGE
  Validate due_date >= today in Asia/Kolkata, using the same helper as FIX #9.
  Return 422 ERR_VALIDATION_FAILED with copy that states the fix:
  "That due date has already passed — pick today or a later date."
  Allow a past date on PATCH (FIX #11) only with an explicit override flag, since
  correcting a wrong date backwards is a legitimate admin action.

COMMIT: fix: reject homework due dates in the past
```

---

### FIX #20 — File upload on mobile

```
FIX #20 — Parents can only paste a URL

File: apps/jain-pathshala-mobile/app/homework.tsx  (SubmitForm, ~lines 65-85)
REFERENCE: components/NiyamProofPicker.tsx, lib/upload-size-guard.ts

PROBLEM
The submit form is a single TextInput asking for "Link to your work (URL)". A
parent photographing their child's handwritten Navkar Mantra has no path — they
would need to upload it somewhere else first and paste a link. Niyam already
solves this properly with NiyamProofPicker (camera, library, audio, size guard,
offline-aware upload queue).

TEST FIRST
  a) "picking an image enqueues an upload and attaches the resulting asset"
  b) "an oversized file is rejected with a helpful message before upload starts"
  c) "an upload started offline resumes on reconnect"

CHANGE
  1. Reuse NiyamProofPicker — extract the shared parts rather than copying it. If
     it is too niyam-specific, lift the generic picker + upload-queue behaviour
     into a shared component and have both screens use it.
  2. Keep the URL field as a secondary option (a Guruji may legitimately share a
     link), but make photo/file the primary action.
  3. Wire the resulting asset through the offline queue from FIX #5, not a direct
     upload call.
  4. Bilingual copy, Devanagari for Hindi. Sentence case buttons. No emoji.

COMMIT: feat: photo and file upload for homework submissions on mobile
```

---

### FIX #21–#23 — Import and helper hygiene (one commit)

```
FIX #21-#23 — Homework route cleanup (may share one commit)

File: apps/api-server/src/routes/v1/homework.ts

#21  Line ~20: `import type { PgColumn } from "drizzle-orm/pg-core"` is unused.
     Remove it. Then check whether the lint config should have caught this —
     if noUnusedLocals / the eslint rule is off for type imports, say so; do not
     turn it on in this commit.

#22  Line ~34: UUID_RE is defined locally. Other route files do the same. Move a
     single uuid validator into lib/api-zod or src/lib/validation and use it here.
     Also: GET /mine currently returns 404 for a MALFORMED uuid. 404 is right for
     "not yours" (no existence oracle) but wrong for "that isn't a uuid" — return
     422 ERR_VALIDATION_FAILED for a malformed id, 404 only for a well-formed id
     the caller does not own.

#23  Line ~198: inScope is @deprecated in scope.ts in favour of inCentreScope.
     FIX #1 replaces this call site with inBatchWriteScope, so this item is
     satisfied by #1 — verify no inScope references remain in this file, and if
     the whole repo is now clean, delete the deprecated export.

TEST: `pnpm typecheck` plus the existing homework suite green is sufficient for #21
and #23. #22 needs one test: "a malformed student_id returns 422, not 404".

COMMIT: chore: homework route import and validator hygiene
```

---

### FIX #24 — Test isolation

```
FIX #24 — The homework tests permanently pollute the seeded database

File: apps/api-server/test/homework.test.ts  (~lines 39-60, freshSubmissionFor)

PROBLEM
freshSubmissionFor iterates the admin batch list and creates a real assignment
against EVERY batch until one yields a submission for the target student — and
never cleans up. Every CI run permanently adds assignment and submission rows to
the shared seeded database, and the junk grows with the batch table. The lifecycle
test at ~line 101 does the same thing.

TEST FIRST — n/a, this IS the test work. Instead: before changing anything, run
the suite twice and paste the row counts for homework_assignments before and
after. That number is the bug.

CHANGE
  1. Resolve the student's batch directly (students.batch_id) instead of
     brute-forcing every batch. One assignment per test, not N.
  2. Wrap each test in a transaction that rolls back, or add an afterEach that
     soft-deletes the assignments the test created (FIX #11 gives you the route).
     Prefer the transaction if the test harness supports it.
  3. Keep the suite rerunnable against a seeded dev database — that property is
     genuinely useful and the current tests were right to want it.

COMMIT: test: isolate homework tests from the shared seed database
```

---

### FIX #25 — Close the coverage gaps

```
FIX #25 — The two paths most likely to break have no tests

File: apps/api-server/test/homework.test.ts (+ a new sync test file)

PROBLEM
Nothing currently exercises: the /v1/sync/batch homework path, cross-batch or
cross-centre scope isolation, late computation, concurrent double-grade, or the
target_student_ids subset branch.

Several of these are covered by earlier prompts (#1 scope, #3 sync, #4 pending,
#9 late, #6 contract). This prompt closes what is left.

ADD
  a) "two simultaneous grade requests award Punya exactly once"
     Fire both with Promise.all against the same submission. Assert one 200 with an
     award and a total that moved by exactly one award. This is the test the
     claim-then-award transaction (~272-326) deserves and does not have — it is the
     best code in the module and currently only proven sequentially.
  b) "target_student_ids creates submissions only for the listed students"
     Plus: "a student id not active in the batch is rejected with 422".
  c) "a city_admin cannot grade a submission outside their city"
  d) "a sanchalak can grade across every batch at their assigned centre"
     (asserts inBatchWriteScope's null-batchIds fallback to centre membership)
  e) "an assignment for a batch with no active students creates zero submissions
      and still returns 200"

Follow the existing file's style: drive through real HTTP with supertest, assert on
the envelope, no mocking of the db.

COMMIT: test: cover homework concurrency, scope isolation, and targeting
```

---

# Phase 5 — Missing features

Phases 1–4 fix what is broken. Phase 5 builds what was specified and never built,
plus the gaps the module's own shape asks for. Sources are cited so you can check
the claim rather than take it on trust.

**Do not start Phase 5 until Phases 1–3 are merged.** F1, F9 and F2 all extend the
submit service that FIX #3 consolidates; building on two divergent implementations
would double the work.

### Phase 5 orchestration prompt

```
Work through docs/HOMEWORK_FIX_PROMPTS.md Phase 5 in sub-phase order:

  5A  student lifecycle   F1, F9, F2, F13
  5B  Guruji workflow     F10, F11
  5C  ledger + data       F3, F7, F8
  5D  reporting           F4, F5, F6
  5E  curriculum          F12

F1 and F9 both change homework_status_enum — do them back to back and in ONE
migration if the decisions in F1 land compatibly, so the enum is altered once.

One commit per feature otherwise. Stop after each sub-phase for review. These are
product changes, so each commit body needs a short paragraph on what a Guruji and
what a parent will now see.
```

---

## 5A — Student lifecycle

### F1 — Mark-done acknowledgement

```
F1 — Parents cannot mark homework done without uploading a file

SPEC: §6.12 lists  POST /v1/homework/:id/mark-done  | parent / student-view |
      "Acknowledgement" — never implemented.

PROBLEM
The only way a submission leaves 'pending' is POST /submissions/:id/submit with a
submission_url. But most Pathshala homework has no artefact: "learn the Navkar
Mantra", "read chapter 1", "recite before Guruji next class". Those students stay
'pending' forever, drag down every completion metric, and their parents have no way
to tell the Guruji the work was done.

This is also the only homework op that maps naturally onto the existing
jp.queue.acknowledgements offline queue (CLAUDE.md offline sync §1
PendingAcknowledgementOp { kind, entity_id }) — sync-batch.ts handleAcknowledgement
currently supports kind 'notice' only.

DECISION REQUIRED — answer before coding, do not pick unilaterally:
  Does mark-done set status='submitted' with a null url, or add a distinct
  'acknowledged' value to homework_status_enum?
  Argument for a distinct value: a Guruji grading a list needs to know whether they
  are looking at work they can inspect or a parent's word. Argument against: it
  widens an enum that SPEC §9 already lists with fewer values than the code has.
  My lean is a distinct value, but say which you chose and why.

TEST FIRST
  a) "a parent can mark a homework item done without a url"
  b) "marking done does not award Punya" — Punya is for the Guruji's grade, not the
     parent's assertion. Assert the balance is unchanged.
  c) "a graded submission cannot be marked done" -> 409
  d) "mark-done replays idempotently through /v1/sync/batch"
  e) "an acknowledgement op with kind 'homework' resolves the right submission"

CHANGE
  1. POST /v1/homework/submissions/:id/mark-done, going through the shared submit
     service from FIX #3 (same ownership check, same graded lock, same Kolkata
     lateness evaluation from FIX #9 — done late is still late).
  2. Extend handleAcknowledgement in services/sync-batch.ts to accept
     kind 'homework' / 'homework.mark_done', delegating to the same service method.
     Do not write a parallel implementation — CLAUDE.md offline sync §4.
  3. Mobile: add "Mark as done" beside "Submit work" in app/homework.tsx, routed
     through the acknowledgements queue via the enqueue helper. Bilingual copy,
     Devanagari for Hindi.
  4. Admin: the submissions dialog must visibly distinguish an acknowledgement from
     an uploaded submission — a Guruji approving 30 rows needs to see which ones
     have something to look at.

Note SPEC's route is /v1/homework/:id/mark-done keyed on the ASSIGNMENT. Key on the
submission id instead, matching every other route in this module, and note the
deviation in the commit body.

COMMIT: feat: parents can mark homework done without an upload
```

---

### F9 — A "returned" state so work can be handed back

```
F9 — There is no way to return homework for rework

PROBLEM
gradeSchema accepts only 'approved' | 'starred'. A Guruji looking at incomplete or
wrong work has three options: approve it (and award Punya for work that isn't
right), star it, or leave it untouched with no signal to the family. So
feedback_note is praise-only in practice — the feedback loop the module is built
around only runs in one direction.

Niyam has the precedent: niyam_submission_status_enum includes 'rejected', with a
30-day reversal window (Q5) and a documented consequence chain (Punya reversed,
streak recomputed, gallery item hidden).

TEST FIRST
  a) "returning a submission awards no Punya and reopens it for resubmission"
  b) "a returned submission can be resubmitted, then graded normally"
  c) "returning an already-approved submission reverses the awarded Punya"
     (this depends on FIX #12 — if #12 is not merged, this test is the reason to
      merge it first, not a reason to skip the assertion)
  d) "feedback_note is required when returning" -> 422 without it

CHANGE
  1. Add 'returned' to HOMEWORK_STATUSES in lib/db/src/schema/enums.ts and migrate
     via `pnpm db:generate`.
  2. Extend gradeSchema to accept 'returned', and require a non-empty feedback_note
     for it. Returning work with no explanation is worse than not returning it.
     Error copy in the CLAUDE.md voice.
  3. 'returned' must NOT be award-worthy. When returning an already-graded row,
     follow AT18: reverse the old award, award nothing, bump revision (FIX #12
     gives you the revision-scoped key).
  4. The submit path must treat 'returned' as re-submittable — it is not part of
     the graded lock alongside 'approved'/'starred'.
  5. Counters: 'returned' counts as submitted (the student did the work) but not as
     graded. Update the filters on the assignment list accordingly.
  6. Mobile: statusTone/statusLabel need a 'returned' case — tone "warning", labels
     "Returned" / "पुनः करें". The feedback block already renders; make sure it is
     visually prominent for this state rather than a muted footnote.
  7. Notify the parent on return (FIX #17's fanout), since the whole point is that
     someone acts on it.

COMMIT: feat: return homework for rework with required feedback
```

---

### F2 — Back submissions with real uploads, not arbitrary URLs

```
F2 — Homework accepts any https URL instead of a verified upload

SPEC: §5.9 specifies homework_submissions.submission_asset_id and
      homework_assignments.attachment_asset_id.
      Step 11 "Media & File Architecture" lists homework as a blocked consumer.

PROBLEM
The module validates submission_url with httpUrl() and stores the string. That is
all. Consequences: no content-type check, no size limit, no image normalisation, no
EXIF stripping, no moderation, no ownership proof, and nothing for
media.cleanup_unfinalized to collect. A parent can paste a link to anything at all
and it is stored verbatim and later handed to a Guruji as a clickable link.

THE PATTERN ALREADY EXISTS IN THIS REPO — read it before writing anything:
  apps/api-server/src/routes/v1/niyam-submissions.ts ~lines 120-145
    "Resolve each media URL against upload_objects owned by this user"
    — extracts the storage key, looks it up in upload_objects, checks uploaded_by
      matches the caller, derives the media kind from content_type.
  apps/api-server/src/routes/v1/uploads.ts
    — folderSchema ALREADY includes "homework". The plumbing is there and unused.
    — magic-byte check, ALLOWED_MIME_TYPES, sharp normalisation, metadata stripping.

IMPORTANT — do not take SPEC's `submission_asset_id` literally. There is no assets
table in this codebase. upload_objects is a key -> uploader registry keyed on the
storage key, not a uuid id. Keep storing the URL and VERIFY it against
upload_objects the way niyam does. Do not invent a new table; do not "fix" the
schema to match SPEC's column name.

TEST FIRST
  a) "a submission url not present in upload_objects is rejected"
  b) "a submission url uploaded by a different user is rejected"
  c) "a non-image, non-pdf upload is rejected with a helpful message"
  d) "an external https url is rejected" — this is the behaviour change; be explicit
     about it in the commit body, since it breaks anyone currently pasting Drive links

CHANGE
  1. Extract the niyam resolver into a shared helper (src/lib/) rather than copying
     it. Both modules call it.
  2. Apply it in the shared submit service from FIX #3, so the sync path is covered
     too — that path currently has NO url validation at all.
  3. Same treatment for homework_assignments.attachment_url on create/edit, scoped
     to the admin folders rule in uploads.ts.
  4. Decide whether to keep an escape hatch for admin-pasted external links (the
     library module allows them). If yes, gate it on canAccessAdminPanel and never
     allow it on the parent submit path.

COMMIT: feat: verify homework uploads against upload_objects ownership
```

---

### F13 — Let a Guruji attach the worksheet

```
F13 — Assignment attachments are supported everywhere except the UI

Files:
  apps/jain-pathshala/src/pages/admin/HomeworkPage.tsx  (NewAssignmentDialog)
  apps/jain-pathshala-mobile/app/homework.tsx           (feed rendering)

PROBLEM
homework_assignments.attachment_url exists, the create schema accepts it, the feed
returns it signed via signUploadUrl — and NewAssignmentDialog has no field for it.
So a Guruji cannot attach the worksheet, and no student has ever seen one.

TEST FIRST
  a) "an assignment created with an attachment returns a signed url in /mine"
  b) "the attachment is rejected if it is not an admin-owned upload" (uses F2)

CHANGE
  1. Add an attachment picker to NewAssignmentDialog (and the edit dialog from
     FIX #11), uploading through /v1/uploads with folder "homework".
  2. Render the attachment in the mobile feed as a tappable item, not a raw url
     string — the current submission_url rendering (a muted single-line Body) is a
     placeholder, not a design.
  3. Show it in the admin assignment row too, so a Guruji can confirm what they sent.

Small feature; bundle the mobile and web halves in one commit.

COMMIT: feat: attach worksheets to homework assignments
```

---

## 5B — Guruji workflow

### F10 — Bulk grading

```
F10 — Grading 30 students takes 30 round trips

File: apps/jain-pathshala/src/pages/admin/HomeworkPage.tsx (GradeButtons, per row)
      apps/api-server/src/routes/v1/homework.ts

PROBLEM
Every row has its own feedback input and Approve/Star pair, each firing a separate
POST. A Guruji with a full batch is doing thirty interactions to grade a set of
Navkar Mantra recitations that are mostly identical. Compare the attendance roster,
which was deliberately built as one submission for the whole batch.

TEST FIRST
  a) "bulk grading applies to every listed submission"
  b) "a bulk grade skips already-graded rows without erroring"
  c) "one failing row does not fail the batch" — per-row results, mirroring the
     /v1/sync/batch response shape
  d) "bulk grading awards Punya exactly once per student"

CHANGE
  1. POST /v1/homework/assignments/:id/grade-all, body
       { status, feedback_note?, only_ungraded?: boolean, exclude?: string[] }
     requireAdminPanel + inBatchWriteScope on the assignment's batch.
  2. Reuse the SAME per-submission claim-and-award transaction (homework.ts
     ~272-326). Loop over it inside one outer transaction; do not write a second
     award path. AT20's guarded-insert discipline must survive the batching.
  3. Return per-row results { submission_id, status, awarded } — never a bare
     success count. The Guruji needs to know which rows were skipped and why.
  4. Respect F1: acknowledgements and real uploads should be separable in the bulk
     action ("approve all uploaded work" is a different intent from "approve all").
  5. UI: a header action on the submissions dialog with a confirm step that names
     the count and the Punya total about to be awarded. Per-row override stays.

Load target: a batch is at most a few hundred students, so a straightforward loop
in one transaction is fine. Do not reach for a queue.

COMMIT: feat: bulk grade a homework assignment
```

---

### F11 — Make overdue work visible

```
F11 — Overdue and not-yet-due look identical

PROBLEM
A past-due submission that was never submitted stays 'pending' forever. Nothing in
the API, the admin table, or the mobile feed distinguishes "due next week, nothing
yet" from "due three weeks ago, never done". The `late` boolean is only ever set on
submission, so a student who never submits is never marked late. There is no
overdue filter for the Guruji and no nudge for the parent.

TEST FIRST
  a) "the assignment list reports an overdue count"
  b) "the student feed flags overdue items"
  c) "an overdue item that is later submitted is marked late, not overdue"
     (overdue is derived from due_date + status; late is a stored fact about a
      submission that happened — keep them distinct)

CHANGE
  1. Derive overdue — do NOT add a status value and do not run a job to backfill
     one. It is a function of due_date and status, and a stored copy will drift.
     Compute it in the query (Kolkata date, per FIX #9's helper) and return it as a
     boolean on the feed and the admin list.
  2. Add an `overdue` count to the assignment list alongside submitted/graded, and
     a filter on the admin page.
  3. Mobile: an "Overdue" pill, tone "error", and sort overdue items to the top of
     the feed. Do not use red for merely-approaching deadlines — CLAUDE.md's tone
     rules are warm and calm; overdue homework is not an emergency.
  4. IF you add a parent nudge job: it MUST also be added to the frozen cron table
     in CLAUDE.md in the same commit, with an IST time. A job in code but not in
     that table is exactly the drift the table exists to prevent. One nudge per
     assignment per parent, never a daily repeat.

COMMIT: feat: surface overdue homework to Guruji and parents
```

---

## 5C — Ledger and data model

### F3 — Link the submission to its Punya transaction

```
F3 — No pointer from a graded submission to its ledger row

SPEC: §5.9 homework_submissions ... `punya_transaction_id` — not implemented.

PROBLEM
Given a submission you cannot find the transaction that paid for it without
reconstructing the idempotency key by hand. Reversal (FIX #12), audit
reconciliation, and the punya.reconcile job all get harder than they need to be.
awardPunya already RETURNS transaction_id — it is simply discarded.

TEST FIRST
  a) "grading stores the punya transaction id on the submission"
  b) "un-grading clears it or points it at the reversal"  (decide which; state it)
  c) "a re-grade that awards nothing leaves it unchanged"

CHANGE
  1. Add punya_transaction_id uuid null, FK to punya_transactions, ON DELETE SET
     NULL. Migration via `pnpm db:generate`.
  2. Write it from the award result inside the SAME transaction as the claim. It is
     part of the atomic unit, not a follow-up update.
  3. Use it in FIX #12's reversal to find the row to reverse, instead of rebuilding
     the key — but keep the key-based idempotency as the safety net. AT18's rule
     applies: reference the most recent UNREVERSED award, not blindly the previous
     revision.

COMMIT: feat: link homework submissions to their Punya ledger row
```

---

### F7 — The specified index

```
F7 — Missing (student_id, status) index

SPEC: §5.9 homework_submissions — "Index: (student_id, status)".
Current schema has student_idx on (student_id) only.

GET /mine filters by student and the client filters by status; the counters filter
by status. The composite is the specified shape.

CHANGE
  Add it to lib/db/src/schema/homework.ts, generate the migration, and paste
  EXPLAIN ANALYZE for GET /mine before and after against a seeded database. If the
  plan does not change, say so — an index nobody uses is a write cost, and I would
  rather know than have it added on faith.

Roll this into whichever Phase 5 commit touches the schema next if it is small.

COMMIT: perf: add (student_id, status) index on homework submissions
```

---

### F8 — Decide the default point value

```
F8 — Seeded homework points (10) contradict SPEC (15)

Migration 0021_homework_punya_features.sql seeds:
  homework          10
  homework_starred  12
SPEC §13.5 seed data and Step 15 both state the feature catalogue default is
`homework_approved` 15, alongside `attendance_present` 10 and
`streak_bonus_4_sessions` 20.

The 10 was inherited from the hardcoded constant FIX #8 removed — it was never a
decision, it was the value that happened to be in the file.

DECISION REQUIRED — this is yours, not Cursor's. Ask, then implement:
  - 15 per SPEC, making homework worth more than a single class attendance, or
  - 10, matching attendance, on the view that showing up and doing the work are
    equally weighted?
Also confirm the starred bonus. 12 was Math.round(10 * 1.2) — likewise inherited.

Whatever is chosen, note that AT23 puts tier thresholds in configuration precisely
so these can move without a migration. Changing the seed does NOT retroactively
change awards already in the ledger, and it must not — say so in the commit body.

CHANGE (once decided)
  Update the seed migration or add a follow-up data migration. Do not change the
  resolution logic in homework-points.ts.

COMMIT: chore: align homework Punya defaults with SPEC
```

---

## 5D — Reporting and analytics

### F4 — Homework completion in the engagement view

```
F4 — mv_centre_engagement has no homework_completion_rate

SPEC: §12.2 defines the view as
  SELECT centre_id, academic_month, attendance_rate, homework_completion_rate,
         niyam_completion_rate, total_punya_awarded, active_students
Migration 0012_derived_attendance.sql builds it with attendance_rate and
active_students only. §12.3 also puts a homework completion trend chart on the
city-admin dashboard. Nothing feeds either.

CLAUDE.md's frozen materialised-view table lists mv_centre_engagement as canonical.
EXTEND that view. Do not create a new view name.

DEFINE THE METRIC BEFORE WRITING SQL — get this agreed:
  numerator:   submissions in ('submitted','approved','starred','late') — plus
               'acknowledged' if F1 adds it, plus 'returned'? (the work was done
               even if it came back)
  denominator: all submissions for assignments whose due_date falls in the month
  exclusions:  students from deactivated_at forward, per the AT5 precedent;
               soft-deleted assignments
Write the definition as a comment above the SQL, the way AT5 documents the
attendance formula.

FOLLOW AT5's ARCHITECTURAL RULE. Attendance has ONE canonical implementation as a
SQL function (attendance_percentage_for_centres) precisely so the materialised view
can call it and nobody re-implements the arithmetic in TypeScript. Homework
completion needs the same: a SQL function that the view, the admin dashboard, and
the progress report (F5) all call. Do not write it once in SQL and again in a
service.

Use COUNT(*) FILTER (WHERE ...), never COUNT(expr IN (...)) — CLAUDE.md AT5 spells
out why: COUNT(boolean) counts every non-null row and returns 1.0 for everyone.

TEST FIRST
  a) the function returns the hand-calculated rate for a known fixture
  b) a centre with no assignments returns NULL, not 0 — "no homework set" is not
     "nobody did their homework" (the AT6 silence-is-not-absence principle)
  c) the refreshed view matches the function called directly

CHANGE
  New migration adding the function and the view column, refreshed by the existing
  analytics.refresh_views job. Then wire the city-admin trend chart.

COMMIT: feat: homework completion rate in mv_centre_engagement
```

---

### F5 — Homework in the monthly progress report

```
F5 — The progress report silently omits homework

SPEC: §8.14 — the report worker "aggregates attendance %, homework completion,
niyam streaks, punya tier, top niyams, curriculum %".
apps/api-server/src/routes/v1/progress.ts contains ZERO references to homework. The
snapshot it builds (~line 328) is curriculum items only.

So a parent receives a PDF that presents itself as their child's progress and omits
a whole module. That is worse than not sending it.

TEST FIRST
  a) "the report snapshot includes homework completion for the period"
  b) "a student with no assignments in the period shows 'no homework set', not 0%"
  c) "the rendered PDF contains the homework section" (assert on the template data
     if PDF assertion is impractical — do not skip the check entirely)

CHANGE
  1. Extend the snapshot builder with a homework block: completion rate for the
     period (calling F4's SQL function — do NOT recompute), counts by status, and
     the count of starred submissions, which is the bit a parent will actually care
     about.
  2. Add the section to the Handlebars template, bilingual per §8.14.
  3. Check whether attendance and niyam are also missing from the snapshot. §8.14
     names five aggregates and I only see curriculum. Report what you find; fix
     only homework in this commit.

COMMIT: feat: include homework completion in the progress report
```

---

### F6 — One feed across all of a parent's children

```
F6 — Parents check homework one child at a time

SPEC: Step 18 — "Parent homework UI: list across all children, mark as done,
view feedback."

PROBLEM
GET /v1/homework/mine requires student_id, so a parent with three children switches
context three times to answer "what does anyone owe this week". The ChildSwitcher
in app/homework.tsx makes that navigable, not solved.

TEST FIRST
  a) "the combined feed returns items for every child the parent owns"
  b) "it excludes children who are deactivated" (Q11, via ownedStudentId)
  c) "a parent with one child gets the same rows as the per-student feed"

CHANGE
  1. Make student_id OPTIONAL on GET /v1/homework/mine. When absent, resolve every
     student the caller owns and return their items with a student_id and
     student_name on each row. Reuse the ownership query — do not hand-roll a
     second one.
  2. Keep pagination coherent across children (FIX #15's keyset needs a tiebreak
     that is stable across students).
  3. Mobile: an "All children" option in the ChildSwitcher, with each card labelled
     by child name when in combined mode. Group overdue first (F11).
  4. Do not break the existing per-student call — the mobile app and any cached
     query keys depend on it.

COMMIT: feat: combined homework feed across all of a parent's children
```

---

## 5E — Curriculum

### F12 — Link homework to curriculum items

```
F12 — Homework is disconnected from the curriculum

PROBLEM
lib/db/src/schema/curriculum.ts has curricula -> curriculum_sections ->
curriculum_items and student_curriculum_progress. homework_assignments links to
none of them. So SPEC §8.14's "curriculum %" cannot be informed by homework, a
Guruji cannot see which topics have practice attached, and there is no path from
"this child is behind on chapter 3" to "assign chapter 3 homework".

This is the largest of the Phase 5 items and the least urgent. Do it last, and
scope it deliberately.

DECISION REQUIRED before coding:
  Is the link advisory (a tag, for reporting and filtering) or does completing
  homework ADVANCE student_curriculum_progress? The second is a much bigger
  commitment — it makes homework a writer to a table another module owns, and needs
  its own reversal story when a grade is undone (FIX #12).
  Recommend starting advisory. Say what you chose.

TEST FIRST (advisory version)
  a) "an assignment can be linked to a curriculum item within the same curriculum"
  b) "a curriculum item from another curriculum is rejected" -> 422
  c) "the link survives assignment edit and appears in the feed"

CHANGE (advisory version)
  1. curriculum_item_id uuid null on homework_assignments, FK ON DELETE SET NULL,
     indexed. Migration via `pnpm db:generate`.
  2. Optional selector in the create/edit dialog, filtered to the batch's curriculum.
  3. Surface the topic name in the admin list and the student feed — for a parent,
     "Chapter 3: Navkar Mantra" is more meaningful than a bare title.
  4. Report, do not build: what would it take for homework to feed curriculum %?
     Write that as a short note in the commit body so we can scope it separately.

COMMIT: feat: link homework assignments to curriculum items
```

---

## Cross-cutting notes for whoever runs these

- **FIX #3 is load-bearing.** #5, #6, #9, #10 and #19 all assume a single submit
  service exists. If Phase 1 slips, those prompts need rewriting to touch two files.
- **Three prompts ask for a decision before code:** #3 (super_admin bypass),
  #10 (who may set `is_msv`), #14 (keep or drop `target_student_ids`), #18
  (bilingual). Expect Cursor to want to decide unilaterally — the prompts tell it
  not to, but check.
- **Two prompts touch CLAUDE.md itself:** #17 (cron table) and #18 (bilingual
  exception). That file is authoritative, so those edits are part of the change,
  not an afterthought.
- **The root `test:integration` script is broken** — it filters `@jp/api`, which
  does not exist; the package is `@workspace/api-server`. Unrelated to homework,
  but you will hit it.

### Phase 5 specifically

- **Five prompts stop for a decision:** F1 (new enum value or reuse `submitted`),
  F8 (10 or 15 points), F4 (the completion-rate definition), F12 (advisory link or
  progress writer), and F2's external-link escape hatch. These are product calls,
  not implementation details — the prompts are written to refuse to guess.
- **F1 and F9 both alter `homework_status_enum`.** Sequence them together and ship
  one migration.
- **F2 is a breaking change for anyone pasting external links.** It should be
  called out in release notes, not just a commit body.
- **F4 sets the pattern for F5.** Write the completion rate once as a SQL function
  per AT5, and have the view, the dashboard, and the progress report all call it.
  If F5 recomputes the number in TypeScript, the two will drift and the PDF will
  disagree with the dashboard — which is the exact failure AT5 exists to prevent.
- **SPEC deviations you should expect to keep:** SPEC routes homework under
  `/v1/admin/homework` and keys mark-done on the assignment; this codebase uses
  `/v1/homework/*` keyed on the submission. The codebase is more consistent —
  don't let Cursor "correct" it toward SPEC.
