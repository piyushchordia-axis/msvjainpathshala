# Curriculum Enhancement — Cursor build prompts (Steps 1–7)

> Companion to `docs/CURRICULUM_ENHANCEMENT.md` (CU1–CU33).
> Run these **in order**. Each is self-contained and copy-pasteable. Do not merge steps —
> the ordering is dependency-driven, and Steps 1 and 5 have destructive/frozen-file consequences.

**How to use:** paste one fenced block per Cursor session. Steps 1 and 5 open with `/plan` and
require your approval before any code is written.

| Step | Scope | Gate |
|---|---|---|
| 1 | Migration `0051` + schema + seeds + error codes | `/plan` |
| 2 | `fn_course_progress` + progress upsert service | — |
| 3 | Course/template/progress/certify routes + Punya | — |
| 4 | Certificates, PDF worker, public verification | — |
| 5 | Offline sync + **`CLAUDE.md` amendment** | `/plan` |
| 6 | Web admin | — |
| 7 | Mobile (shikshak, sanchalak, parent/student) | — |

---

## Step 1 — Schema, migration `0051`, seeds, error codes

```
/plan

Implement Step 1 of the curriculum enhancement: schema, migration 0051, seed data and error codes.

READ FIRST, IN THIS ORDER — do not write code before finishing all of these:
1. CLAUDE.md in full. Pay special attention to: Database conventions, Q2, Q11, AT17, AT19,
   AT20, AT21, AT29, and the frozen QUEUE_NAMES list.
2. docs/CURRICULUM_ENHANCEMENT.md — rules CU1, CU2, CU4, CU5, CU7, CU8, CU9, CU22, CU24,
   CU29, CU32. Read the whole file once for context first.
3. Existing code: lib/db/src/schema/curriculum.ts, lib/db/src/schema/enums.ts,
   lib/db/src/schema/punya.ts, lib/db/src/schema/attendance.ts (for the ULID regex at line 31),
   lib/db/src/schema/homework.ts, lib/db/src/seed.ts, apps/jp-shared/src/errors.ts.
4. lib/db/migrations/0050_centre_monthly_reports_centre_month_uq.sql to match migration style.

SCOPE — schema and migration only. No routes, no services, no UI.

A. Renames per CU1: curricula→courses, curriculum_sections→course_sections,
   curriculum_items→course_subsections, student_curriculum_progress→student_course_progress,
   student_curriculum_progress.level→status, homework_assignments.curriculum_item_id→subsection_id.
   Keep the pgEnum named curriculum_level_enum — do NOT rename it.
B. courses: status→enum('draft','active','archived') default 'draft'; name→name_en NOT NULL
   (backfill from name) + name_hi NULLABLE; add template_id, punya_points, deleted_at.
C. New tables: course_templates (+ its section/subsection mirrors), course_certificates.
D. student_course_progress: full DDL exactly as CU9 specifies, including all four CHECK
   constraints and the three indexes.
E. course_sections.punya_points and courses.punya_points with their CHECK bounds (CU22).
F. All four cascading FKs → RESTRICT (CU29 table). Add deleted_at to the four course tables.
G. Seed: punya_features + punya_configs rows for 'course_section_certified' and
   'course_completed', both multipliers = 100 (CU22).
H. Add the six error codes in CU32 to apps/jp-shared/src/errors.ts.

LANDMINES — these are the specific ways this step goes wrong:
- THE BACKFILL. curricula.status is text NOT NULL DEFAULT 'active' and every existing row is
  already 'active'. The migration MUST set all existing rows to 'draft'. Changing only the
  column default makes every half-authored curriculum nationally visible to every parent on
  release day. This is the single highest-consequence line in the migration.
- The old unique index student_curriculum_progress_student_item_unique MUST be dropped and
  recreated as TWO PARTIAL indexes. Postgres treats NULLs as distinct, so once subsection_id
  is nullable the old index stops constraining section rows entirely and permits duplicates.
- name_hi is NULLABLE on purpose. There is no valid backfill value and copying English into a
  Devanagari column violates the bilingual rule. Do not make it NOT NULL.
- Copy the ULID regex verbatim from lib/db/src/schema/attendance.ts:31. Do not retype it.
- Add every new FK and CHECK as NOT VALID, then VALIDATE CONSTRAINT in a separate statement.
  A plain ADD CONSTRAINT takes ACCESS EXCLUSIVE for a full table scan.
- punya_configs.points is integer. The multiplier is stored as integer percent (100 = 1x).
  Do not attempt a numeric column.
- Do NOT add anything to QUEUE_NAMES or CRON_EXPRESSIONS. Both are frozen.
- Do NOT create course_assignments or any course-to-batch link. CU2 deletes that concept.

EXIT CRITERIA — run each and paste the actual output:
1. pnpm db:generate — show the generated migration diff.
2. pnpm db:migrate against a scratch database restored from a production-shaped dump.
3. SELECT status, count(*) FROM courses GROUP BY status;  — every pre-existing row must be 'draft'.
4. Verify both partial indexes exist: \d student_course_progress
5. Attempt an insert violating each of the four CHECKs; show all four rejections.
6. pnpm typecheck

Commit: feat: step 1 — curriculum schema, migration 0051, seeds
```

---

## Step 2 — `fn_course_progress` and the progress upsert service

```
Implement Step 2 of the curriculum enhancement: the canonical progress SQL function and the
shared progress write service.

READ FIRST:
1. CLAUDE.md — AT5 in full (the canonical-percentage rule this mirrors), AT6, Q11.
2. docs/CURRICULUM_ENHANCEMENT.md — CU9, CU10, CU11, CU15, CU16, CU28.
3. lib/db/migrations/0012_derived_attendance.sql and 0026_homework_completion_rate.sql —
   these are the two existing canonical-calculation functions. Match their style exactly.
4. apps/api-server/src/routes/v1/progress.ts (current implementation being replaced).

SCOPE:
A. Migration 0052: create fn_course_progress(p_student_id uuid, p_course_id uuid,
   p_section_id uuid DEFAULT NULL) returning
   (leaf_total int, leaf_reached int, leaf_certified int, section_total int,
    section_certified int, coverage numeric, mastery numeric) per CU28.
B. A single shared service method for progress writes, used by BOTH the online route and
   (later) the offline sync handler. Never two implementations.

LANDMINES — CU28 has three individually fatal traps, all documented in the rule:
- INTEGER DIVISION. leaf_reached / leaf_total with both int returns 0 for everyone. Cast the
  numerator ::numeric. Both existing functions above do this — copy them.
- THE LEFT JOIN. CU15 means untouched nodes have NO progress row at all. An inner join reports
  100% for a student who has touched one node.
- THE LEAF FILTER. CU9 puts section rows and subsection rows in the SAME table. Counting
  certified rows without restricting to leaf nodes pulls certified SECTIONS into a
  leaf-denominated numerator and mastery exceeds 100%.
- "Leaf nodes" = all non-deleted subsections PLUS all non-deleted sections having zero
  non-deleted subsections. A section-only course must not report NULL.
- Use COUNT(*) FILTER (WHERE ...), never COUNT(expr IN (...)). COUNT(boolean) counts every
  non-null row and returns 1.0 for everyone.
- mastery is NULL, not 0, when leaf_reached = 0.
- The upsert must repeat the partial index predicate in the conflict target — Drizzle `target`
  plus `targetWhere`. Omitting targetWhere fails at runtime with "no unique or exclusion
  constraint matching the ON CONFLICT specification".
- CU16's section roll-up calls this SAME function with p_section_id. Do not write a second
  formula anywhere, in SQL or TypeScript.

EXIT CRITERIA — paste actual output:
1. A test fixture: student 7/20 through a course. Assert coverage = 0.35, NOT 0.
2. A student with zero progress rows. Assert coverage = 0 and mastery IS NULL.
3. A section-only course (sections with no subsections), fully certified. Assert coverage = 1.
4. A student with certified sections AND certified subsections. Assert mastery <= 1.
5. Concurrent upsert test: two writers on the same (student, node). Assert one row, no error.
6. pnpm typecheck && pnpm --filter @workspace/api-server run test

Commit: feat: step 2 — canonical course progress function and upsert service
```

---

## Step 3 — Routes, certification, Punya

```
Implement Step 3 of the curriculum enhancement: course/template/progress/certify routes and
the Punya award path.

READ FIRST:
1. CLAUDE.md — Q2, Q4, Q11, Q12 in full, AT17, AT18, AT20, AT21, AT22, AT25, the API response
   envelope, and the audit-log convention.
2. docs/CURRICULUM_ENHANCEMENT.md — CU3, CU4, CU6, CU7, CU8, CU11, CU12, CU13, CU14, CU17,
   CU18, CU19, CU20, CU21, CU22, CU23, CU32, and the §8 route table.
3. apps/api-server/src/routes/v1/curriculum.ts (519 lines), admin-modules.ts,
   apps/api-server/src/lib/scope.ts (inBatchWriteScope at line 128),
   apps/api-server/src/routes/v1/niyam-submissions.ts (the Q12 gate this must mirror),
   apps/api-server/src/routes/v1/msv.ts:47 (the visibility predicate CU3 generalises).
4. The existing Punya award helper and punya_transactions schema in lib/db/src/schema/punya.ts.

SCOPE: every route in the CU-doc §8 table except the two certificate routes (Step 4).

LANDMINES:
- Q2 (CU8): remove state_admin from NATIONAL_AUTHOR_ROLES in curriculum.ts:74, AND add the
  missing kind='msv' gate — a city_admin can currently create an MSV course with an in-scope
  city_id and nothing stops them. That second hole is the real Q2 defect.
- CU12: a write to a certified row must return 409 ERR_COURSE_NODE_CERTIFIED from the SERVICE.
  If you rely on the CU9 CHECK, it surfaces as SQLSTATE 23514 → a 500, not the designed 409.
  The service guard is the contract; the CHECK is the net. Both are required.
- CU13 bulk: exactly one of batch_id / student_ids (422 otherwise). EVERY student in the
  resolved set must pass inBatchWriteScope. A student_ids list containing anyone out of scope
  is rejected WHOLE with 403 — never partially applied. This path is higher-volume than
  certify and must not be laxer.
- CU14: bulk ADVANCES only. Never regresses. Regression is a separate reset route, shikshak+,
  audited per student. Single-student self-correction stays free (CU11) — do not apply CU14
  to the single-student route.
- CU23 idempotency keys: the section key INCLUDES {revision}. The course key includes the
  TRIGGERING section id AND its revision — course completion recurs, exactly like AT22's
  streak bonus. Read CU23's worked example before writing this.
- CU22: award = ROUND(authored_points * punya_configs.points / 100.0), clamped to
  punya_features.min_points..max_points, resolved at award time and SNAPSHOTTED into the
  transaction row. Never inline a constant (AT21).
- AT20: guarded insert ON CONFLICT DO NOTHING ... RETURNING, and the balance moves ONLY by the
  amount actually returned. Never an unguarded increment beside a guarded insert — that
  double-awards on every resync and is the most likely silent corruption here.
- CU18: certification has NO bulk route. Do not add one for convenience.
- CU18: every certify writes an audit entry via auditFromReq with
  entityKind 'course_certification'. Also audit CU4 publish, CU6 patch/delete, CU7 derive,
  and any punya_points edit.
- CU20: blocking deletion of a certified node MUST be a service-layer precondition. CU29 makes
  deletion soft, so ON DELETE RESTRICT never fires — relying on the FK means relying on nothing.
- CU3: the MSV gate reads students.msv_status = 'approved', NOT msv_enrolments. Both exist and
  can disagree; msv_status is the one already in production use.
- Route roles in the table are MINIMUMS. Higher roles inherit — do not implement them literally
  as exact-role checks.

EXIT CRITERIA — paste actual output:
1. New test file apps/api-server/test/courses.test.ts covering: city_admin blocked from MSV
   create (403); draft course invisible to parent; publish rejected without name_hi /
   academic_year / punya_points; parent write for another parent's child (403); parent write to
   a certified row (409); shikshak bulk with an out-of-scope student_id (403, nothing applied);
   bulk regression ignored; certify on a non-completed node (409); delete of a certified node
   (409).
2. Punya test: certify → assert one transaction and balance delta equal to the returned amount;
   replay the same certify → assert NO second transaction and NO balance change.
3. Punya test: certify final section → assert BOTH the section award and the course bonus, with
   the course key containing the triggering section id.
4. Correction test: super_admin correction → assert section award reversed, course bonus
   reversed, revision incremented; then re-certify → assert a NEW award lands (this is the
   AT17 failure the revision component exists to prevent).
5. pnpm typecheck && pnpm --filter @workspace/api-server run test

Commit: feat: step 3 — course routes, certification and punya
```

---

## Step 4 — Certificates, PDF worker, public verification

```
Implement Step 4 of the curriculum enhancement: certificate issuance, PDF generation and the
public verification endpoint.

READ FIRST:
1. CLAUDE.md — Security rules (signed URLs, rate limiting), the frozen QUEUE_NAMES list.
2. docs/CURRICULUM_ENHANCEMENT.md — CU24, CU25, CU26, CU27, and CU19 step 5.
3. apps/api-server/src/lib/pdf.ts — BOTH PdfBuilder.create() and PdfBuilder.createBilingual().
4. apps/api-server/src/jobs/report-jobs.ts (the report.generation handler you are extending).
5. apps/api-server/src/lib/storage.ts and apps/api-server/src/routes/v1/centre-monthly-report.ts:244.

SCOPE: issuance triggers, the queued PDF worker, GET /v1/students/:id/certificates, and
GET /v1/certificates/verify/:code.

LANDMINES:
- Use PdfBuilder.createBilingual(), NOT PdfBuilder.create(). progress.ts:397 uses create() and
  is explicitly English-first/WinAnsi — it cannot render Devanagari. CU17 requires
  "गुरुजी द्वारा प्रमाणित" to print, so the progress report is NOT the precedent despite being
  the closest artefact. centre-monthly-report.ts:244 is the one to copy.
- Do NOT introduce Handlebars or Puppeteer. SPEC §12.4's six .hbs templates describe the
  unbuilt NestJS target. Zero .hbs files exist in this repo.
- Do NOT add a queue name. Extend report.generation with a payload discriminator.
  QUEUE_NAMES is frozen at 21 entries.
- CU25: a section certificate is issued when the SECTION's own row is certified — not when its
  subsections are. A course with ZERO sections issues nothing (the predicate is vacuously true
  otherwise and would certify everyone).
- CU25: scope_snapshot records what the certificate covered AT ISSUE TIME. Adding a section to
  an active course later does NOT void or re-issue. Verification reports against the snapshot,
  never against the live tree.
- CU27: the public endpoint returns ONLY validity, the title, the issue date, and the student's
  FIRST NAME. Never full name, DOB, centre, or any id. It is enumerable by construction — a
  verbose response makes it a PII scraper.
- CU27: rate-limit per IP using the existing Redis sliding-window mechanism.
- verification_code is 12 chars of Crockford base32 from a CSPRNG, with retry on unique
  violation. Do not use a sequence, a hash of ids, or Math.random.
- storage_key NULL means "issuing", not broken. Handle that state in the UI contract.
- CU17's honorific has THREE branches. users.gender is nullable with no backfill; a
  male/female-only rule silently prints "Guruji" for every unknown, which is the exact bug the
  rule exists to prevent.

EXIT CRITERIA — paste actual output:
1. Certify a section → assert a course_certificates row, then assert the worker produces a PDF.
2. Open the generated PDF and confirm the Devanagari honorific renders (not tofu boxes).
3. Certify every section → assert exactly one course certificate; assert a zero-section course
   produces none.
4. Add a section to that course afterwards → assert the existing certificate is NOT voided and
   verification still reports valid against its snapshot.
5. Super_admin correction → assert voided_at set, PDF NOT deleted, verify endpoint returns void.
6. Verify endpoint response body — assert it contains no surname, no DOB, no centre, no uuid.
7. pnpm typecheck && pnpm --filter @workspace/api-server run test

Commit: feat: step 4 — course certificates and verification
```

---

## Step 5 — Offline sync (amends `CLAUDE.md`)

```
/plan

Implement Step 5 of the curriculum enhancement: offline sync for course progress and
certification.

THIS STEP AMENDS A FROZEN SPECIFICATION. Read the warning below before planning.

READ FIRST:
1. CLAUDE.md — the ENTIRE "Offline sync — canonical model" section, plus AT8, AT16, AT19,
   AT26, AT32.
2. docs/CURRICULUM_ENHANCEMENT.md — CU31 in full, plus CU9, CU17, CU18, CU23.
3. apps/api-server/src/routes/v1/sync.ts (or wherever POST /v1/sync/batch lives) and the
   sync_operations schema.
4. The mobile MMKV queue implementation for jp.queue.attendance.

CRITICAL — CLAUDE.md outranks the CU document. Its offline section declares itself "the only
offline sync specification" with a CLOSED 7-value op_type union, an exact drain order and exact
MMKV keys. CU31 adds two of each. Until CLAUDE.md is amended, CU31 is OVERRIDDEN, not additive.
Amend CLAUDE.md in the SAME COMMIT as this implementation, or this step does not exist.

SCOPE:
A. Amend CLAUDE.md: add 'course_progress' and 'course_certification' to the op_type union,
   the two MMKV queue definitions with their payload types, and the two new drain positions.
   Do not reword anything else in that section.
B. Server: two op_type handlers in POST /v1/sync/batch, each calling the SAME service method
   as its online route. Never a parallel offline-only implementation.
C. Client: two MMKV queues and their drain logic.

Drain order becomes:
checkin → attendance → checkout → shivir_scans → niyam_submissions → homework_submissions
→ course_progress → course_certification → acknowledgements

LANDMINES:
- CU17 SOFT-TRANSITION. When a certification arrives and the node is not 'completed' — because
  the close is still queued behind it or was never made — the certify transaction sets status,
  completed_at, certified_at and certified_by IN ONE STATEMENT. This satisfies the CU9 CHECK.
  Hard-failing loses a Guruji's classroom work over queue ordering, which is the exact harm AT8
  and AT32 refuse. Do NOT return 409 ERR_COURSE_NODE_NOT_COMPLETE on the offline path; that
  code is for the online route only.
- Because of the soft-transition, NO ordering guard is needed between the two new queues. A
  failed course_progress op must NOT block course_certification.
- Conflict rules (CLAUDE.md §6 requires one per op type):
  course_progress → newest marked_at wins, compared against the stored client_marked_at, NOT
    server receipt time (AT26). If stored is newer, return 'duplicate' and do not apply. This
    comparison lives in the SHARED service method so the online path obeys it too.
  course_certification → if already certified, return 'duplicate', NOT 'conflict'. The star is
    already there and certification is irreversible; a replay is a no-op.
  Out of scope → 'conflict', terminal.
- Every op writes a sync_operations row with response_payload. On replay, return the stored
  payload WITHOUT re-executing. This is the first of two replay-safety layers; the CU23
  idempotency key is the second. Both are required — do not skip one because the other exists.
- client_op_id is per-ITEM, submission_op_id is per-SUBMISSION (AT19). They are deliberately
  named differently. Do not conflate them.
- Certification carries exactly one student_id per op. CU18 forbids bulk; the offline payload
  must not become a loophole for it.
- One failed op must not fail the batch — per-op results.

EXIT CRITERIA — paste actual output:
1. Show the CLAUDE.md diff.
2. Queue a certification for a node with NO completion mark → assert the server soft-transitions
   and the row ends completed + certified, with no error.
3. Queue progress then certification out of order → assert correct final state.
4. Replay an entire batch → assert sync_operations returns stored payloads, assert NO second
   Punya transaction, assert balance unchanged.
5. Queue a certification with a stale client_marked_at against a newer stored row → assert
   'duplicate'.
6. Kill the app mid-drain and relaunch → assert no lost and no duplicated ops.
7. pnpm typecheck && pnpm --filter @workspace/api-server run test

Commit: feat: step 5 — offline course progress and certification sync
```

---

## Step 6 — Web admin

```
Implement Step 6 of the curriculum enhancement: web admin panel.

READ FIRST:
1. CLAUDE.md — Design system section in full: token rules, UI tone rules, bilingual
   requirements, the "no emoji" rule, sentence case, and the error-voice rule (state the
   problem AND the fix).
2. docs/CURRICULUM_ENHANCEMENT.md — CU3, CU4, CU7, CU13, CU16, CU17, CU18, CU20, CU22, §9.
3. apps/jain-pathshala/src/pages/admin/AdminExtendedPages.tsx (CurriculumPage at line 380,
   CurriculumTreeEditor at 266), ProgressPage.tsx, src/index.css for tokens,
   src/components/admin/sidebar-nav.ts.

SCOPE: rename throughout; template CRUD + derive; course draft/publish/archive; PATCH/DELETE;
punya_points editor; section-level progress with divergence; certify with confirm.

LANDMINES:
- CU22 PREFILLS are UI-only suggestions, recalculated live while authoring and frozen on save.
  The DB default stays 0. Section prefill = 10 x subsection count. Course prefill = 20% of the
  sum of its sections' points.
- CU4 publish gate: block with a clear reason listing exactly what is missing (name_hi,
  academic_year, at least one section, punya_points on every section). Error voice: state the
  problem AND the fix.
- CU4 archive confirm MUST state how many students have in-progress uncertified work on that
  course. Archiving out from under a child mid-course is this action's failure mode.
- CU33 nudge: persistent banner listing active courses whose academic_year is older than the
  current one, with a one-tap archive per course; secondary warning past 15 active courses in
  the city.
- CU16: show BOTH the declared section status and the derived roll-up. A divergence is
  INFORMATION, not an error — do not show it as a validation failure, do not auto-correct, and
  do not block the declaration.
- CU18: the certify confirm must carry the student's name, the node title and the Punya value.
  This is the guard that makes an irreversible award safe. Not a generic "are you sure?".
- CU17: three-branch honorific. Never hardcode "Guruji".
- No hardcoded hex. Use CSS variables / theme classes from src/index.css.
- Sentence case on all buttons and headings. No emoji.

EXIT CRITERIA — paste actual output or screenshots:
1. Author a course from scratch through publish; show the publish gate rejecting each missing
   precondition in turn.
2. Derive a course from a template; edit the template; show the derived course is UNCHANGED.
3. Show a section with a deliberate divergence (declared completed, subsections not started)
   rendering as information.
4. Show the certify confirm with name, node and Punya value.
5. Show the archive confirm with the in-progress student count.
6. pnpm typecheck && pnpm --filter @workspace/jain-pathshala run build

Commit: feat: step 6 — course admin panel
```

---

## Step 7 — Mobile

```
Implement Step 7 of the curriculum enhancement: mobile for shikshak, sanchalak, parent and
student.

READ FIRST:
1. CLAUDE.md — Design system, the eight user roles, Q4 (student view 13+ gate), Q12 in full,
   the bilingual requirements, and the Devanagari line-height / +35% string length rules.
2. docs/CURRICULUM_ENHANCEMENT.md — CU3, CU11, CU12, CU13, CU16, CU17, CU18, CU21, CU31, §9.
3. apps/jain-pathshala-mobile/app/student-detail/[id].tsx (ProgressPanel at 886, progressTone
   at 78), lib/queries.ts (useStudentProgress at 808), constants/colors.ts, components/HomeworkAdmin.tsx.

SCOPE:
A. Shikshak: course list + tree, bulk start/close, per-student certify with confirm.
B. Sanchalak: certification, reachable on mobile.
C. Parent/student: full catalogue, node start/close/reopen, star display, certificates.
D. Offline queues from Step 5 wired to the UI states.

LANDMINES:
- Q12 IS A RELEASE BLOCKER. The sanchalak's mobile certification screen ships in the SAME
  release as the shikshak batch-bound gate. Q12 records why: an unstaffed batch's queue strands
  with nobody able to clear it. Do not ship A without B.
- CU11: parent and student can move a node in BOTH directions while uncertified. This is
  deliberate — a child who marked something done too early undoes it themselves. Do not build
  it forward-only.
- CU12: a certified node is frozen for everyone. Show the star and disable the controls with an
  explanation, rather than letting the tap fail.
- CU17 three-branch honorific from users.gender, which is nullable. NULL → "Certified" /
  "प्रमाणित", never a hardcoded "Guruji".
- CU18: certify confirm carries name, node title and Punya value. No bulk certify anywhere in
  the UI.
- CU3: the catalogue is every active course for the student's city plus national, MSV only if
  students.msv_status = 'approved'. This list is long by design — CU33's nudge is the admin's
  problem, not something to solve by hiding courses on mobile.
- Offline UI states per CLAUDE.md's failure-state table: queued / syncing / synced / duplicate /
  conflict / failed. 'failed' must offer manual retry and must NEVER silently discard. A mark
  that will never sync must not look like success.
- Use tokens from constants/colors.ts. StyleSheet.create() only — no className, no CSS.
- Devanagari needs 22px minimum line-height; every layout must tolerate +35% string length.
- No emoji. Jain terms stay untranslated: Pathshala, Punya, Guruji, Sanchalak, Niyam, Shivir.

EXIT CRITERIA — paste actual output or screenshots:
1. Shikshak: bulk-close a section for a batch; show the roster count affected.
2. Shikshak: certify one student with the confirm visible.
3. Sanchalak: certify a student from a batch they are not assigned to (centre-wide reach).
4. Parent: start, close, then REOPEN an uncertified node.
5. Parent: attempt to move a certified node; show the disabled state with its explanation.
6. Airplane mode: queue progress and a certification, relaunch the app, restore connectivity,
   show both syncing and settling to 'synced'.
7. Show a 'failed' op offering manual retry.
8. Screenshot the tree in Hindi; confirm no clipping at +35% string length.
9. pnpm typecheck

Commit: feat: step 7 — course mobile surfaces
```

---

## After Step 7

- Migration `0052` for the Q11 cascade fix on `progress_reports.student_id` and
  `punya_transactions.student_id` (open item 2 in the CU doc) — deliberately deferred out of
  `0051`.
- Move CU1–CU33 into `CLAUDE.md` and reduce `docs/CURRICULUM_ENHANCEMENT.md` to a rationale
  archive, per its header.
- Update `docs/IMPLEMENTATION_STATUS.md`. Note that `docs/MODULE_AUDIT.md:43,72` is already
  stale — it claims `student_curriculum_progress` does not exist.
