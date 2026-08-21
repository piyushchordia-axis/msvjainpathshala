# Courses module — fix prompts

Companion to [`COURSES_MODULE_REVIEW.md`](./COURSES_MODULE_REVIEW.md) and the new "Courses module —
binding decisions" section in `CLAUDE.md`. Each block is a self-contained prompt — paste one at a
time (Cursor Agent mode, or any coding agent), verify, commit, then move to the next. They are
ordered by dependency; running them out of order will produce conflicts on `courses.ts` and
`course-progress.ts`, which several blocks touch.

Every prompt assumes `CLAUDE.md` (including the new Courses section) is in context. If it isn't,
prefix with:

> Read `CLAUDE.md`'s "Courses module — binding decisions" section and `docs/CURRICULUM_ENHANCEMENT.md`
> before making any change.

Two findings are **already fixed** by unrelated recent work and only need a regression test, not a
re-fix: **C6** (`public.ts` already excludes `kind='msv'`) and **H6** (`scope.ts`'s
`inBatchWriteScope` already resolves `batchIds === null` before the `!batchId` guard). Prompt 4 adds
the missing regression tests for both.

---

## 1 — Certification integrity (C1, C2, H26, H27, M15-certify, M21, L1, L7, L8, L26)

```
Read CLAUDE.md's Courses section (CU17, CU19, CU21) and fix the certification-correction bugs in
apps/api-server/src/services/course-certify.ts and course-certificates.ts.

C1 — course-certify.ts: `wasCourseComplete` is computed (line ~629) before the correction's update
and then used unconditionally to reverse the course bonus and void the course certificate (line
~691). Guard that whole block behind `input.nodeKind === "section"`. A sub-section correction must
reverse only its own progress row — sub-sections carry no Punya under CU21 and are not part of
CU25's course-complete predicate, so there is nothing course-level to touch.

C2 — course-certificates.ts: `findExistingCertificate` (lines 49-73) has no `voided_at` filter, so
re-certification after a correction returns the voided row as `created:false` and the certificate
stays void forever. Add `isNull(voided_at)` to the "is there a live cert" lookup. Add a SEPARATE
lookup for a voided row at the same (student_id, course_id|section_id). When re-certifying finds a
voided row and no live one, UPDATE it in place: clear voided_at/voided_by, refresh scope_snapshot and
issued_at, set storage_key = NULL, and re-enqueue the PDF job on report.generation — do not insert a
second row (the partial unique indexes forbid it and a migration isn't needed).

H26 — the CU19 correction service itself (not just the courses.ts route at line ~1066) must check
the caller is super_admin and 403 otherwise — Q2's house rule puts role checks on value-minting
operations in the service layer. Read actorRole from req.authUser in both audit entries (lines
~645, 743, 762) instead of hardcoding "super_admin".

H27 — insertCertificateWithCodeRetry's 23505 retry (course-certificates.ts:105) runs inside the
caller's already-aborted tx. Wrap each attempt in `tx.transaction(async (savepointTx) => ...)` so a
collision doesn't poison the parent transaction.

M21 — replace bare `db` calls made inside `db.transaction` blocks (course-certify.ts:160,415) with
the `tx` handle — two pool connections per certify today.

M15 (certify half) — certifyCourseNode's completeness check should treat a legacy `status='mastered'`
row as already-completed, not 409 ERR_COURSE_NODE_NOT_COMPLETE.

L1 — drop the internal Punya idempotency key from the certify response (courses.ts:1055).

L7 — the second CU19 audit entry should carry only what the first doesn't (drop the
acting_super_admin_id duplication of actor_id).

L8 — the idempotent-replay path should return the real reused transaction id and its actual point
value, not a synthetic zero.

L26 — course-certify.ts:584,594 node resolution should apply isNull(deleted_at), matching the route.

Add tests to apps/api-server/test/courses.test.ts and course-certificates.test.ts:
- Correct a certified sub-section on a fully-certified course: assert the course bonus is untouched
  and the course certificate is NOT voided.
- Correct a certified section, then re-certify, then GET /v1/certificates/verify/:code: assert it
  reports `valid`, not `void`.
- Call the correction as a non-super_admin directly against the service (or route): assert 403.

Run: pnpm typecheck && pnpm --filter @workspace/api-server run test -- course
```

---

## 2 — Service-layer write correctness (C3, H8, H9, H25, M7–M11, M14, M15-bulk, M20, M26, M38)

```
Read CLAUDE.md's Courses section (CU9, CU10, CU13, CU14) and the Offline sync section (course_progress
conflict rule). Fix apps/api-server/src/services/course-progress.ts, apps/api-server/src/routes/v1/
sync.ts, and apps/jain-pathshala-mobile/lib/offline/sync-engine.ts.

C3 — course-progress.ts:206-207's upsert `set` clause unconditionally writes
`client_op_id: input.clientOpId ?? null, client_marked_at: input.clientMarkedAt ?? null`, nulling
the columns CU31's newest-wins rule compares against on every online write. Omit these keys from
`set` when the input doesn't carry them (coalesce pattern: keep the stored value), and move the
newest-wins comparison into the upsert's `setWhere` so Postgres arbitrates atomically instead of a
read-then-write race. Update the ONLINE client call sites (not just offline) to send
`marked_at`/`client_op_id` too — CU9/CU31: "the online path is governed by it too."

H8 — sync.ts's /v1/sync/batch handler must process every op independently and always return a
per-op result entry (per CLAUDE.md's offline §4) — verify this holds for course ops specifically,
not just attendance. Then fix sync-engine.ts:129 so a 422 on one op only marks that op failed, not
every op in the batch.

H9 — sync-engine.ts:64-72's `if (!result)` branch (server dropped this op from `results`) must
consult MAX_ATTEMPTS/shouldRetry like every other branch, terminal-failing after 10 attempts instead
of retrying forever.

H25 — the bulk course-progress route accepts `submission_op_id` in the body and records it via
sync_operations exactly like every other write; wire the mobile bulk call (queries.ts:2281-2289) to
send one.

M7 — wrap bulk (course-progress.ts:409) and reset (:536)'s per-student loop in one db.transaction
each, so a mid-loop failure doesn't half-apply.

M8 — align bulk and reset on the same Q11 deactivated-student exclusion (:379 vs :510).

M9 — reset's writeAudits (:576-593) must run inside the same transaction as the writes (pass `tx`),
not after and silently swallowed on failure.

M10 — omit `note` from the `set` clause when `input.note` is undefined; do not write NULL over an
existing note (:195).

M11 — a bulk/reset request naming an unknown or deactivated student id should report that distinctly
from a scope violation (:382) — different code/message.

M14 — gate the sync-batch course-progress/certify handlers with the same admin-panel-equivalent
check the online routes use (courses.ts:933,970,1013 vs sync.ts:10).

M15 (bulk half) — course-progress.ts:315's statusRank should map 'mastered' alongside 'completed' so
bulk doesn't silently skip legacy rows.

M20 — a repeated client_op_id on a DIFFERENT node should return status='duplicate', not 500 (:242).

M26 — the mobile bulk write should invalidate the admin progress query cache (queries.ts:2290-2292).

M38 — allowCertifiedWrite (:225) should clear the certified pair in the same UPDATE statement rather
than hitting the certified_requires_completed CHECK (23514 → 500 trap).

Add tests: full POST /progress/reset exercise (regression applied, certified rows skipped, one audit
row per student, deactivated excluded); bulk by batch_id excludes a deactivated student; {} and
{batch_id, student_ids} both 422; a same-day online write followed by an older offline replay does
NOT clobber the newer client_marked_at.

Run: pnpm typecheck && pnpm --filter @workspace/api-server run test
```

---

## 3 — Mobile offline client (C4, C5, H17, H20, H21, M22–M24, L27)

```
Read CLAUDE.md's Courses section (CU15, CU16) and Offline sync section. This module's client-side
offline layer is the least-tested part of the codebase — write tests alongside the fix, not after.

C4 — DELETE apps/jain-pathshala-mobile/lib/course-progress-cascade.ts entirely and remove every call
site (search CourseTree.tsx and peers). It writes a `completed` row for every uncertified sub-section
when a section closes, and auto-completes a section when its last sub-section closes — CU15 says a
row exists only once someone acted on that node, CU16 says never auto-correct one from the other.
Instead, render the five derived_status/status_diverges/etc. fields the API already returns
(apps/api-server/src/routes/v1/courses.ts:473-481) in both the shikshak tree view and a sanchalak
divergence panel — this closes the mobile half of H16 too.

C5 — three sites report loss as success:
- apps/jain-pathshala-mobile/lib/queries.ts's useCertifyCourseNode/useSetCourseNodeProgress
  (~2839-2949) resolve the mutation as success regardless of the drained op's result status. Throw
  when result.status is 'conflict' or 'failed' so onError actually fires.
- hooks/useCourseSyncOps.ts:87-101 promotes an op to `synced` purely because it disappeared from the
  queue. Derive `synced` only from an actual status:"success" result.
- lib/offline/storage.ts:26's readQueue returns [] silently on any JSON parse failure. On parse
  failure, move the corrupt payload to a `<key>.corrupt` MMKV entry and log an error instead of
  discarding it.

H17 — wire useBulkCourseNodeProgress to enqueue into the EXISTING jp.queue.course_progress MMKV
queue when offline. Its `marks: Array<...>` shape already carries a roster (CLAUDE.md offline §1) —
this is routing the bulk call through the existing queue, not inventing a new one.

H20 — CourseLearnerOutline.tsx:36 and app/[sectionId].tsx:43 hardcode `{ offline: false }` for
parent/student writes. Drop it and route through the same queue path as the shikshak; the identical
tap must not be online-only for one persona and offline-capable for another (CU31 scopes offline
parity by op type, not persona).

H21 — CourseTree.tsx:93-100 refetches immediately after a tap instead of showing a pending state, so
an offline tap looks like it didn't register. Add an onMutate optimistic patch showing "queued"/
pending, per CLAUDE.md offline §8's failure-state table.

M22 — a `duplicate` result should render as "already up to date", never "synced".

M23 — the conflict fallback message must be bilingual and state the next step (CLAUDE.md error-voice
rule), not an English-only literal.

M24 — resolved by C4's deletion (no cascade, no N sequential round trips). No separate change needed
— just confirm no cascade write remains after C4.

L27 — remove the dead `duplicate` branch in useCourseSyncOps.ts:52 and the no-op transport
indirection in sync-engine.ts:40.

Add unit tests for: corrupt-queue quarantine (storage.ts), conflict/failed surfacing as non-success
(queries.ts hooks), the bulk enqueue routing (offline path used when offline), and a regression test
proving no cascade write happens on section close now that the file is deleted.

Run: pnpm typecheck && pnpm --filter @workspace/jain-pathshala-mobile run test
```

---

## 4 — Reachability, scope, visibility (H1, H2, H4, H30, M13, M19, L16) + close C6/H6

```
Read CLAUDE.md's Courses section (CU3, CU8) and Q12. Fix apps/api-server/src/routes/v1/courses.ts,
admin-courses.ts, progress.ts, and apps/api-server/src/services/course-access.ts.

H1 — courses.ts:69-78's cityIdsForAuthor returns [] for shikshak/sanchalak (compiles to WHERE false
at :312), while admin-courses.ts:41-57's cityIdsForUser resolves the same roles' cities correctly
from centre assignments. Do not fix the copy in place — extract ONE shared helper (e.g. into
apps/api-server/src/lib/scope.ts) both files import, so the two implementations can't diverge again.

H2 — none of resolveNodeKind (courses.ts:128-144), the certify lookup (course-certify.ts:257), or
resolveNode (course-progress.ts:80) check the parent course's status/deleted_at/city/MSV gate. Join
`courses` in all three and reject a write when courses.status <> 'active', deleted_at IS NOT NULL,
the caller's city doesn't match, or (for MSV) the student's msv_status <> 'approved' — a write must
not be reachable where the CU3 read is not. In the same pass, drop `state_admin` from the national
author set at curriculum.ts:74's NATIONAL_AUTHOR_ROLES (CU8 — Q2 wins).

H4 — admin-courses.ts:343-360's PATCH validates only the course's OLD city_id; validate the
DESTINATION city_id against cityIdsForUser too, so a course can't be PATCHed into a city its real
city_admin can't see.

H30 — point the legacy progress.ts route (:141,284) at inBatchWriteScope, matching CU21/Q12, instead
of the deprecated inScope.

M13 — course-access.ts duplicates courses.ts's online-route gate and is unused by it. Wire it into
courses.ts so there's one gate, or delete it if genuinely dead.

M19 — re-run the CU4 publish gate on every PATCH to an active course (admin-courses.ts:298-306,356) —
reject a PATCH that nulls name_hi or academic_year on a live course.

L16 — drop punya_points from the public/guest catalogue payload (public.ts:195, and stop reading it
in apps/jain-pathshala/src/pages/public/CoursesPage.tsx:16).

Add tests:
- loginAs("state_admin") and loginAs("sanchalak") coverage in courses.test.ts: national create, MSV
  create rejected for state_admin, MSV re-kind by PATCH rejected, section authoring under a national
  course rejected for state_admin, sanchalak certify path succeeds.
- C6 regression: create a kind='msv' course, assert a non-approved student/guest sees it in none of
  GET /v1/courses, GET /v1/courses/:id/tree, or GET /v1/public/courses.
- H6 regression: a student with no batch_id can still be written/certified by shikshak+ (sanchalak,
  city_admin, super_admin) via inBatchWriteScope's null-batchIds fallback.

Run: pnpm typecheck && pnpm --filter @workspace/api-server run test
```

---

## 5 — Punya correctness (H3, H7, M6, M12)

```
Read CLAUDE.md's Courses section (CU21, CU22) and AT20/AT21. Fix apps/api-server/src/lib/
course-points.ts and the completion check in course-certify.ts.

H3 — resolveFeature (course-points.ts:64-65) defaults max_points to 0 when the punya_features row is
missing or inactive, and the clamp (:86) is `if (cfg.max_points > 0 && points > cfg.max_points)` — so
when max_points is 0 the clamp condition is FALSE and the award goes out UNCLAMPED. Restructure so a
missing/inactive punya_features row short-circuits the whole award to 0 points BEFORE any clamp
check — never "clamp skipped because max_points defaults to 0."

H7 — allSectionsCertified is read-then-decide with no lock, so two concurrent last-section
certifications can both observe "not complete" and both skip the course bonus. Wrap the check in
`pg_advisory_xact_lock(hashtext(student_id || ':' || course_id))` (or SELECT ... FOR UPDATE over the
student's section rows) inside the certify transaction.

M6 — allSectionsCertified (:180) is N sequential queries; collapse to one (`NOT EXISTS` over
uncertified sections in the course) — natural to do alongside H7's lock.

M12 — move the multiplier cache in course-points.ts from a per-process Map to Redis (AT21), and wire
clearCoursePointsCache() to the admin multiplier-update path so it's actually invalidated.

Add tests:
- Exact numeric award assertion (not toBeGreaterThan(0)) for a known punya_points × multiplier,
  including the min/max clamp.
- An inactive (is_active=false) punya_features row awards exactly 0.
- A missing punya_features row (no seed) awards exactly 0.
- Concurrency: certify the last two sections of a course from two simultaneous requests; assert
  exactly one course-bonus transaction exists afterward.

Run: pnpm typecheck && pnpm --filter @workspace/api-server run test
```

---

## 6 — DB/migration safety + delete/undelete (H10-server, H29, M1–M5, L2, L6, L10–L15)

```
Read the migration-safety note: DO NOT edit lib/db/migrations/0051, 0052 or 0058 in place — a
previously-run environment may already have the un-guarded version, and editing history causes
migration-chain drift. Every fix here is a NEW migration starting at 0098 (check
lib/db/migrations/ for the current highest number first — it may have advanced since 0097).

H29 — first in this phase, flagged "before the next deploy": migration 0058 hardcodes
order_index = 3 / draft_order_index = 3 for the Courses library section against two partial unique
indexes, which aborts a deploy where those slots are taken. Add a new migration that makes this
insert either derive the slot (MAX(order_index)+1 WHERE deleted_at IS NULL) or use
ON CONFLICT DO NOTHING.

M1 + M2 — new migration: CREATE OR REPLACE FUNCTION fn_course_progress to (a) join `students` and
exclude students from deactivated_at forward (Q11 — currently the function never mentions students
at all), and (b) move the childless-section NULL roll-up (currently patched only at
apps/api-server/src/routes/v1/courses.ts:435,480) into the function itself so the PDF worker and
mobile get it without their own patch.

M3 — apps/api-server/src/services/course-admin.ts:184-195's softDeleteCourseNode claims to
soft-delete progress rows but is a no-op (no deleted_at column path is actually hit). Either
implement it for real or remove the misleading comment/dead branch — make the code match what it
claims to do.

M4 — move the CU20 certification-exists check inside the SAME transaction as the delete
(course-admin.ts:140-172), closing the check-then-delete race.

M5 — apps/api-server/src/routes/v1/courses.ts:399-402,430's GET /:id/tree calls fn_course_progress
once per section over an unbounded history select. Replace with one set-based call (pass a section
list, or a lateral join) instead of N round trips.

H10 (server half) — admin-courses.ts's DELETE /admin/courses/:id (currently :410-414) gets: the
CU20 certification guard (block deleting a course with any certified section, same as node delete),
an impact-count in the response, and a companion POST /admin/courses/:id/undelete (admin-only,
audited, clears deleted_at) per CU29.

L2 — allow archiving a draft course (today the only exit from draft is the unguarded DELETE).

L6 — publishCourse (course-admin.ts:61,103) runs inside a transaction with a status='draft' guard
on the UPDATE.

L10 — collapse the two implementations of status ranking (course-progress.ts:306,312) into one
shared function.

L11 — new migration splitting 0051's NOT VALID / VALIDATE CONSTRAINT pairs across two migration
files so they commit as separate transactions (today drizzle-kit runs both halves of 0051 in one
transaction, holding the ACCESS EXCLUSIVE lock through both).

L12 — new migration: DROP CONSTRAINT (not DROP INDEX IF EXISTS) for the old composite unique that
actually backs a UNIQUE constraint — DROP INDEX IF EXISTS silently no-ops against it.

L13 — new migration: UNIQUE (key) on punya_features, UNIQUE (feature_key, city_id) on punya_configs.

L14 — align the Drizzle schema's declared default for student_course_progress.status with the real
SQL default (lib/db/src/schema/curriculum.ts:180 vs the migration).

L15 — new migration for the CU §11 open item: Q11 FK cascades on progress_reports.student_id and
punya_transactions.student_id (cascade → RESTRICT), which was deliberately deferred out of 0052 and
never given a home since.

Add DB-level tests: duplicate (student_id, section_id) rejected; certified_at on a non-'completed'
row raises 23514; a malformed client_op_id is rejected; fn_course_progress excludes soft-deleted
nodes AND now excludes deactivated students (this one will fail against the OLD function — that's
the point). Run against a clean DB (see the local-verification-toolchain approach), not a
long-lived dev DB that may already have drifted.

Run: pnpm db:generate && pnpm db:migrate && pnpm typecheck && pnpm --filter @workspace/api-server run test:integration
```

---

## 7 — Web admin correctness & UX (H10-UI, H11–H16, M28–M32, M39, M40, M42, L9, L17-admin, L22–L25, L29)

```
Read CLAUDE.md's UI tone rules and Courses section (CU4, CU16, CU18, CU20, CU25, CU33). Fix
apps/jain-pathshala/src/pages/admin/CoursesAdminPage.tsx and
apps/jain-pathshala/src/routes/AdminRoutes.tsx.

H11 — CoursesAdminPage.tsx:436 has a duplicated Punya-prefill effect that lacks the `|| section`
guard its correct sibling at :430 has, so re-opening a section editor overwrites the authored Punya
value with the prefill. Delete the duplicate effect.

H12 — add an AlertDialog confirm (already imported, already used elsewhere on this page) before
deleting a section or sub-section, naming the section/sub-section count and the in-progress work at
stake.

H13 — the archive-impact fetch's catch block (`catch { setArchiveCount(0) }`, :1429) must render an
error state and disable the archive action, never a factual-looking "0 students affected."

H14 — render the server's publish-gate {reasons, fixes} payload as a visible checklist (all four
preconditions are locally computable from `tree`) instead of one concatenated toast.

H15 — add the missing route guard to /admin/courses in AdminRoutes.tsx:100, matching sidebar-nav.ts's
city_admin gate (the server-side H2 fix from prompt 4 is the real backstop; this closes the UI hole).

H16 (web half) — add a certify action with the CU18 confirm (student name, node title, the actual
CLAMPED Punya value the server will award) and the CU16 divergence indicator to the web admin course
view. (Mobile half is prompt 3's C4 fix.)

M28 — per CU25, active courses stay editable. Remove the isDraft over-gate (:643) on section/
sub-section controls — CU20's certification guard (already server-enforced) is the real limit, not
draft status.

M29 — constrain academic_year entry to a parseable format (4-digit year or YYYY-YY, regex or picker)
so CU33's staleness nudge stays computable.

M30 — build a SubsectionDialog-pattern UI for template rename/delete (routes already exist:
admin-courses.ts:121,174,758,893,930) instead of two sequential window.prompt calls; add an
age_group input.

M31 — distinguish an empty Punya field from the number 0 on both the course field and the template
field — Number('') currently silently becomes 0 and saves.

M32 — client-side Devanagari validation (/[ऀ-ॿ]/) on all four Hindi inputs, error-voice message
("problem AND the fix"), no transliteration accepted.

M39 — the archive confirm states the action is one-way.

M40 — add a confirm before deleting a draft course too (today only H12's targets get one).

M42 — aria-labels on nudge buttons, announced toggle state, announced archive count.

L9 — give template routes a place in the CU §8 route table (doc-only, pairs with M30's reorder
addition for template sub-sections).

L17 (admin half) — replace raw enum copy ("msv", "STANDARD", "Super_admin masters", "CU4 gate") with
bilingual labels.

L22 — sub-section descriptions write null, not '', when empty.

L23 — add an in-flight guard on the publish button (disabled while pending) so a double-click can't
show success then error.

L24 — fix the >15-active-courses warning to count national + city courses together for that city's
view, not bucket them separately.

L25 — keep the CU33 staleness banner mounted/reachable on narrow screens while editing.

L29 — add a status filter (minimum) to the admin course list; admin-courses.ts:472 has no LIMIT —
add pagination or at least a sane cap with a "load more" affordance.

Run: pnpm typecheck && pnpm --filter @workspace/jain-pathshala run build
```

---

## 8 — Certificates & PDF (H5, H31, H32, M43, M44)

```
Read CLAUDE.md's Courses section (CU26, CU27) and Security rules. Fix apps/api-server/src/routes/v1/
certificates.ts, apps/api-server/src/lib/course-certificate-pdf.ts,
apps/api-server/src/services/course-certificates.ts, and apps/api-server/src/lib/pdf.ts.

H5 — certificates.ts:17-21,38's verification rate limit keys on the first x-forwarded-for entry,
which a client controls. Key on req.ip using the same Express trust-proxy configuration the rest of
the codebase already relies on.

H31 — course-certificate-pdf.ts:62,70,90 applies firstName() to the certificate PDF artefact. CU27's
first-name-only rule is scoped to the public verify endpoint (certificates.ts:86, already correct),
not the family's own PDF — print the student's full name on the PDF.

H32 — course-certificates.ts:265-274 swallows PDF enqueue failures with no way to re-trigger. Record
the failure (don't swallow) and make it re-triggerable via an admin action or the existing
report.generation retry path.

M43 — pdf.ts:29's prepare() strips every non-WinAnsi glyph when the string contains no Devanagari,
which blanks Gujarati names. Fall through to the embedded Devanagari-covering face (Mukta) for any
non-WinAnsi text instead of stripping it.

M44 — validate certified_at from the client against a sane bound server-side (not in the future, not
implausibly old) — same posture completed_at already gets from the server clock.

Run: pnpm typecheck && pnpm --filter @workspace/api-server run test -- certificate
```

---

## 9 — Client UX parity, mobile + web (H18, H19, H22–H24, M25, M27, M33–M37, M41, L17-client, L18–L21)

```
Read CLAUDE.md's UI tone rules, Design system (Devanagari line-height, hit targets) and Courses
section (CU13, CU17, CU18, CU21, CU32). Fix apps/jain-pathshala-mobile/components/{CourseTree,
CourseDetailScreen,CourseLearnerRow,CourseAdmin}.tsx, apps/jain-pathshala-mobile/app/{courses,
[sectionId]}.tsx, apps/jain-pathshala/src/pages/public/{CoursesPage,CourseDetailPage}.tsx, and add
course_id to the certificate payload in apps/api-server/src/routes/v1/courses.ts.

H18 — CourseDetailScreen.tsx's applyStudent (:63-70) builds the query from pickerBatchId alone; fall
back to the student's own batch_id when no chip is set, matching CourseAdmin.tsx:143's already-
correct behaviour. CourseTree.tsx:293 should render the bulk overflow whenever a resolvable batch_id
exists, not only when the chip is truthy.

H19 — expose a certify control for sub-sections in CourseTree.tsx (today only
nodeKind: "section" is ever passed anywhere in the app) — the CU21 "recognition without currency"
path shikshak need for a child who did the work at sub-section level.

H22 — the CU18 confirm sheet (CourseTree.tsx:477,519) shows the raw section.punya_points instead of
the clamped/multiplied value the server will actually award. Compute and display the real number
(reuse or expose the course-points resolution) before the confirm.

H23 — branch on error.code (CU32's six ERR_COURSE_* codes) across all five error handlers
(CourseTree.tsx:101,140,206; CourseLearnerOutline.tsx:62; [sectionId].tsx:79) — bilingual title AND
body, problem-and-fix copy, including the CU21 handoff-to-Sanchalak case for
ERR_COURSE_STUDENT_OUT_OF_SCOPE.

H24 — add course_id to CourseCertificateRow's API payload (small server change) and match
certificates by (student_id, course_id) on both clients instead of by course.name_en string
(courses.tsx:38-43, CoursesPage.tsx:176) — a title match both misses renamed courses and
false-positives across academic years.

M25 — the certificate ribbon (courses.tsx:39-43) should consult row.status/row.pdf_url — 'issuing'
renders differently from 'ready' and 'void'.

M27 — wire fetchNextPage in both student pickers (CourseAdmin.tsx:91, CourseDetailScreen.tsx:52) so
the list doesn't silently cap at 50.

M33 — add the web ChildSwitcher (mobile already has the pattern) to CoursesPage.tsx instead of
pinning studentId to res.items?.[0]?.id.

M34 — CourseDetailPage.tsx:52 should fetch /v1/courses/:id/tree?student_id= when signed in, not the
guest /v1/public/courses/:id/tree unconditionally.

M35 — raise Devanagari line-height to >=22px and widen the honorific's maxWidth
(CourseLearnerRow.tsx:178-183 and the ~9 other cited sites) per the design-system minimum — the part
naming who certified the child is currently the part getting clipped.

M36 — rename the dismiss action in [sectionId].tsx:312 to "Cancel"/"रद्द करें" so "Close" means only
completion everywhere in the app (CourseTree.tsx:369's meaning wins).

M37 — add a "Start" action to the sub-section sheet ([sectionId].tsx:285-308) that stamps started_at
via the existing progress route.

M41 — add accessibility props and raise hit targets to >=44pt on CourseTree.tsx, CourseBrowseOutline.
tsx and peers (bulk Start/Close controls are currently ~18pt with no hitSlop).

L17 (client half) — replace raw enum fallback copy in CoursesPage.tsx:25 and CourseAdmin.tsx:246 with
bilingual labels.

L18 — fix the reverse-fallback bug in [sectionId].tsx:274 and CourseBrowseOutline.tsx:265 so an
English reader never silently receives Hindi body text.

L19 — swap the CJK full stop for the Devanagari danda in app/course/[id]/index.tsx:70.

L20 — replace the ✓ dingbat in CourseLearnerRow.tsx:238 with the icon set.

L21 — route the guest data path (CoursesPage.tsx:60, CourseDetailPage.tsx:52) through the shared API
client instead of hand-rolled envelope unwrapping.

Run: pnpm typecheck && pnpm --filter @workspace/jain-pathshala-mobile run test && pnpm --filter @workspace/jain-pathshala run build
```

---

## 10 — Reporting: CU30 (H28)

```
Read CLAUDE.md's Courses section (CU28, CU30). Fix apps/api-server/src/routes/v1/progress.ts and
lib/db/src/schema/curriculum.ts.

Add a snapshot_version integer NOT NULL DEFAULT 1 column to progress_reports (new migration, same
numbering batch as prompt 6 if that hasn't shipped yet) and a Zod schema for the versioned shape in
@jp/shared. progress.ts:378's snapshot payload gains a `courses: [{ course_id, coverage, mastery,
section_certified, section_total, certified_nodes[] }]` block for every course the student has any
progress on, read from fn_course_progress (CU28) — never recomputed in the report worker. Readers
must branch on snapshot_version; pre-change snapshots are version 1 and have no courses key, and
must not crash when read.

Add a test asserting a generated monthly report's snapshot contains the courses block with correct
coverage/mastery for a student with mixed progress across two courses.

Run: pnpm db:generate && pnpm db:migrate && pnpm typecheck && pnpm --filter @workspace/api-server run test
```

---

## 11 — Validation & error-envelope hardening (M16–M18, L3–L5)

```
Read CLAUDE.md's API response envelope section. Fix apps/api-server/src/routes/v1/courses.ts and
admin-courses.ts.

M16 — UUID-guard every :id/:nodeId param (reuse the UUID_RE already used elsewhere in these files)
before it reaches SQL; validate ?status= query enums with Zod so a bad value 422s instead of raising
a raw Postgres 22P02.

M17 — wrap the two unwrapped .parse(req.body) calls (courses.ts:745,1068) in the same try/catch →
422 ERR_VALIDATION_FAILED pattern the rest of the file already uses.

M18 — replace the ~20 parameterless catch blocks across both route files with one that populates
details[] from err.issues when the caught error is a ZodError, matching the envelope contract.

L3 — normalize GET /v1/courses's three divergent response shapes; make sure the student branch
includes the `id` the tree route requires.

L4 — courses.ts:63's handleErr should forward `details` the same way admin-courses.ts:64 already
does.

L5 — add auditFromReq to the sub-section PATCH route and both reorder routes (:766,670,857) — every
other authoring write in this file already has one.

Add tests: a malformed :id returns 404 (not 500); a bad ?status= returns 422 with details[]
populated; the two previously-unwrapped .parse() routes return 422 on invalid bodies.

Run: pnpm typecheck && pnpm --filter @workspace/api-server run test
```

---

## 12 — Structural test-gap closure

```
Close the meta test gaps COURSES_MODULE_REVIEW.md calls out, beyond what prompts 1-11 already added:

- Add loginAs("state_admin"), loginAs("sanchalak") and loginAs("student") coverage to
  courses.test.ts — today state_admin and sanchalak are 0 logins, so the city-scoping branches at
  admin-courses.ts:269,344,406,450,531,582 never execute in CI.
- Fix course-progress.test.ts:17-23: stop installing 0052_fn_course_progress.sql ad hoc in beforeAll;
  run it (and prompt 6's fix-forward migration) through the real migration runner so the suite tests
  what actually ships, not a hand-assembled function.
- Add a female ensureShikshakGender("female") run to course-certificates.test.ts's five integration
  tests (today only male is ever exercised — a regression hardcoding "Guruji" into
  loadCertifierContext would pass every current test).
- Fill the two missing documented exit-criteria runs: course-certificates.test.ts is missing
  criteria 2 (present in course-sync.test.ts); course-sync.test.ts is missing criteria 1 and 6
  (present in course-certificates.test.ts).
- Add the CU3 negative test: a city-B course must not appear for a city-A student — today
  mumbaiCityId() falls back to cities[0] so every test course lands in-city and the kindOk predicate
  at course-visibility.ts:38 could be deleted without failing anything.
- Add an audit_logs row assertion to at least one certify test, one reset test, and one publish
  test, so removing writeAudit from any of the three breaks CI.

Run: pnpm typecheck && pnpm --filter @workspace/api-server run test && pnpm --filter @workspace/api-server run test:integration
```

---

## Verification after each prompt

```bash
pnpm typecheck
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/api-server run test:integration   # prompts 1, 2, 6, 10, 12
pnpm --filter @workspace/jain-pathshala run build           # prompts 7, 9
pnpm --filter @workspace/jain-pathshala-mobile run test     # prompts 3, 9
```

Commit per Conventional Commits, one commit per prompt:

```
fix: courses — correction no longer voids the wrong things or hides who did it (C1, C2, H26, H27)
fix: courses — offline writes stop losing the newest mark, bulk stops half-applying (C3, H8, H9, H25)
fix: courses — mobile stops fabricating progress and stops reporting loss as success (C4, C5, H17, H20, H21)
fix: courses — a signed-in Guruji sees at least as much as a guest, drafts stay drafts (H1, H2, H4, H30)
fix: courses — a missing Punya config awards nothing, not everything (H3, H7)
fix: courses — deploy-safe migrations, one canonical progress calc, real delete guards (H10, H29, M1-M5)
fix: courses — web admin stops losing and misleading on delete, archive and publish (H11-H16)
fix: courses — certificates print the real name and PDFs don't get stuck (H5, H31, H32, M43, M44)
fix: courses — mobile and web catch up to what the API already returns (H18, H19, H22-H24)
feat: courses — monthly progress report gains the curriculum block CU30 promised (H28)
fix: courses — malformed input gets a 422 with a reason, not a 500 (M16-M18)
test: courses — cover the personas and code paths CI was blind to
```
