# Curriculum Enhancement — binding decisions (CU1–CU33)

> Status: **design agreed, not yet implemented.** Resolved 2026-08-07.
> Style follows the AT1–AT32 attendance rules in `CLAUDE.md`. Once approved, CU1–CU33 move
> into `CLAUDE.md` verbatim and this file becomes the rationale archive.
> Precedence: `CLAUDE.md` > this file > `SPEC.md`.

> ### ⚠ Required companion change to `CLAUDE.md`
> CU31 adds two `op_type` values, two MMKV queues and two drain positions to the offline model.
> `CLAUDE.md` declares its offline section **"the only offline sync specification"** with a closed
> 7-value union. Because `CLAUDE.md` outranks this file, CU31 is *overridden* rather than additive
> until that section is amended. **Amend `CLAUDE.md` in the same commit as the CU31 implementation,
> or CU31 does not exist.**

---

## 0. Why this exists

Curriculum is the core record of a student's progress. The existing implementation
(`curricula → curriculum_sections → curriculum_items` + `student_curriculum_progress`) models
*competency assessed by a shikshak* — a passive grid the Guruji fills in.

This enhancement makes it an *active* record owned by the student:

- Every student sees **every course in full**, from the first day. Courses are not assigned to
  batches or centres; there is no syllabus position to be "at".
- Each section and sub-section carries a state: **to be started → in progress → completed**.
  Shikshak, parent and student all move it, in both directions while uncertified.
- A shikshak can additionally **star** a node — certification. The star is orthogonal to the
  state, not a fourth state.
- **Punya is minted by certification alone** — on a section star, and again as a milestone when
  every section in the course is starred. Both values are authored by the city_admin and scaled by
  a multiplier the city configures. Sub-section stars are recognition without currency.

### What already exists (do not rebuild)

| Thing | State |
|---|---|
| 3-level tree + section/item CRUD + transactional reorder | ✅ `apps/api-server/src/routes/v1/curriculum.ts` (519 lines), tested |
| Curriculum shell create/list/tree | ✅ `apps/api-server/src/routes/v1/admin-modules.ts` |
| `student_curriculum_progress` + level upsert + PDF report + release | ✅ `apps/api-server/src/routes/v1/progress.ts` (579 lines), tested |
| Web admin authoring + progress grid | ✅ `AdminExtendedPages.tsx`, `ProgressPage.tsx` |
| Homework → curriculum item advisory tag | ✅ `homework_assignments.curriculum_item_id` (migration `0027`), `apps/api-server/src/lib/homework-curriculum.ts` |
| Punya value resolution | ✅ `punya_configs` (city-scoped) + `punya_features` (catalogue with `min_points`/`max_points` clamp) |
| Mobile | 🟡 read-only `ProgressPanel` in `app/student-detail/[id].tsx` |
| Certification, section-level progress, punya, certificates, templates, bulk, parent write, offline | ❌ none of it |

---

## 1. Naming and structure

### CU1 — Rename to courses; three levels, frozen
The tree is exactly three levels. Do not add a fourth.

```
course_templates ─(one-time copy)─▶ courses → course_sections → course_subsections
```

Renames (one migration, next number `0051`):

| Old | New |
|---|---|
| `curricula` | `courses` |
| `curriculum_sections` | `course_sections` |
| `curriculum_items` | `course_subsections` |
| `student_curriculum_progress` | `student_course_progress` |
| `student_curriculum_progress.level` | `student_course_progress.status` |
| `student_curriculum_progress.note` | `student_course_progress.note` (retained — see CU9) |
| `homework_assignments.curriculum_item_id` | `homework_assignments.subsection_id` |

`curriculum_level_enum` **keeps its name**. Renaming a pgEnum is churn with no payoff.

**Migration mechanics.** CU29 drops and recreates four FKs; CU9 rebuilds the unique index as two
partial ones; CU5 and CU22 add three NOT NULL columns between them. Add every new FK as `NOT VALID`
then `VALIDATE CONSTRAINT` in a second statement — a plain `ADD CONSTRAINT` takes ACCESS EXCLUSIVE
for a full table scan. Same for the CU9 CHECKs.

Blast radius: `curriculum.ts`, `admin-modules.ts`, `progress.ts`, `homework.ts`,
`apps/api-server/src/lib/homework-curriculum.ts`, `msv.ts`, `AdminExtendedPages.tsx`,
`ProgressPage.tsx`, `HomeworkPage.tsx`, mobile `queries.ts` + `HomeworkAdmin.tsx` +
`student-detail/[id].tsx`, and `docs/IMPLEMENTATION_STATUS.md`.

### CU2 — Courses are never assigned to a batch or centre
There is no `course_assignments` table, no `batches.course_id`, and no course↔batch link of any
kind. SPEC §5.13's `curriculum_assignments` and §19's "one active Standard + one active MSV per
centre/batch" are **deleted, not deferred**.

A course is a body of material. A student's relationship to it is their own progress rows and
nothing else. This is what makes CU28's denominator well-defined and removes the entire class of
"which course is this batch on" resolution logic.

### CU3 — Course visibility
A student sees a course when **all** of:

- `courses.status = 'active'` (CU4)
- `courses.city_id IS NULL` (national) **OR** `courses.city_id` = the city of the student's centre
- if `courses.kind = 'msv'`, then `students.msv_status = 'approved'`

The MSV gate reads `students.msv_status`, **not** `msv_enrolments` — this is the existing
`msvCurriculumByStudent()` predicate at `msv.ts:47`, generalised from one course to a list. Both
sources exist in the schema and can disagree; `students.msv_status` is the one already in
production use and is therefore the single source of truth here.

No age-group targeting. `course_templates.age_group` (CU7) is authoring metadata for the
super_admin's own catalogue and is **not copied onto derived courses** and never filters
visibility.

Parents see the courses of each child they manage. A student in student-view (≥13, Q4) sees their
own.

### CU4 — Course lifecycle
`courses.status` becomes a real enum: `'draft' | 'active' | 'archived'`. Default `'draft'`.

**Migration backfill — mandatory.** `curricula.status` is `text NOT NULL DEFAULT 'active'` today
and `admin-modules.ts` never sets it on insert, so **every existing row is `'active'`**. Changing
the default alone would make every half-authored admin-only curriculum in the database nationally
visible to every parent on release day, under CU3. The migration sets **all existing rows to
`'draft'`**. Curricula were never student-facing; nothing regresses.

**Publish preconditions.** `draft → active` is an explicit audited transition, not a field edit,
and is rejected unless:
- `name_hi` is non-null (CU5)
- `academic_year` is non-null — it is nullable text today and nothing enforces it, but CU33's
  staleness nudge is computed from it and is inert without it
- the course has at least one section
- every section has `punya_points` explicitly set (CU22)

Once a course has been `'active'` it can only move to `'archived'`, never back to `'draft'`.

**Archived** removes the course from CU3 visibility for new work but does **not** hide or
invalidate anything a student already earned: existing progress rows, Punya and certificates all
survive, and CU27 verification keeps resolving. An archived course still appears in a student's
own progress history and in CU30 reports.

Archiving is manual and is the catalogue's only pressure valve (CU33). Because it removes a course
from view, the confirm dialog must state how many students currently have in-progress, uncertified
work on it — archiving out from under a child mid-course is the failure mode this action has.

### CU5 — Courses and templates are bilingual
`courses.name` is replaced by `name_en` (NOT NULL, backfilled from `name`) and `name_hi`
(**nullable**). `course_templates` likewise.

`name_hi` is nullable *only* to make the migration possible over live rows — copying English into
a Hindi column would violate the Devanagari rule, and there is no other backfill value. CU4's
publish gate makes it effectively required: a course cannot go `active` without it.

### CU6 — PATCH and DELETE for courses
`PATCH /v1/admin/courses/:id` and `DELETE /v1/admin/courses/:id` (soft, per CU29) must exist.
Today a course cannot be renamed, re-kinded, re-yeared or archived after creation — there is no
route at all.

### CU7 — Templates are a one-time copy; there is no drift
`course_templates` are super_admin masters. Deriving a course from a template **snapshots** it:
sections and sub-sections are copied, `courses.template_id` records provenance, and the two are
independent from that moment forward.

Editing a template never touches a derived course. Deleting a template never touches a derived
course. There is no sync, no propagation, no override flags.

SPEC §5.13 defines `curriculum_templates` and Step 19 says curricula are "derived from templates
or scratch", but neither states what happens on master edit. A snapshot answers it in the only
direction that cannot disturb a student's progress or orphan a Punya award.

```
course_templates
  id, name_en, name_hi (nullable), kind ('standard'|'msv'), age_group,
  created_by, deleted_at, created_at, updated_at
```

Template section/sub-section rows mirror the course tables, including `punya_points`. Templates
are authored and derived by `super_admin` only; `kind='msv'` follows CU8.

### CU8 — Q2 resolution: MSV authoring is super_admin only
Creating *or editing* a `kind='msv'` course, or any course with `city_id IS NULL`, is
`super_admin` only, enforced in the service layer. A `state_admin` or `city_admin` calling it
directly gets 403.

Two separate gaps close here, in different files:

- **`city_id IS NULL` on create — already correct.** `admin-modules.ts:346-350` already rejects a
  null `city_id` for anyone but super_admin. No change.
- **`kind='msv'` — not gated at all.** A `state_admin` or `city_admin` can create a `kind='msv'`
  course today so long as it carries an in-scope `city_id`. This is the actual Q2 hole.
- **Section/sub-section authoring under a national course.** `curriculum.ts:74` admits
  `NATIONAL_AUTHOR_ROLES = ["super_admin", "state_admin"]`. `CLAUDE.md` Q2 says super_admin only.
  **Q2 wins** — drop `state_admin` from the national author set.

---

## 2. Progress model

### CU9 — One row per student per node
ONE progress state per `(student, node)`, written by every actor.

```sql
student_course_progress
  id              uuid PK default gen_random_uuid()
  student_id      uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT
  section_id      uuid     NULL REFERENCES course_sections(id) ON DELETE RESTRICT
  subsection_id   uuid     NULL REFERENCES course_subsections(id) ON DELETE RESTRICT
  status          curriculum_level_enum NOT NULL DEFAULT 'not_started'
  note            text     NULL
  started_at      timestamptz NULL
  completed_at    timestamptz NULL
  certified_at    timestamptz NULL
  certified_by    uuid     NULL REFERENCES users(id) ON DELETE RESTRICT
  certification_note text  NULL
  revision        integer  NOT NULL DEFAULT 0
  updated_by      uuid     NULL REFERENCES users(id) ON DELETE SET NULL
  updated_by_role text  NOT NULL
  client_op_id    char(26) NULL
  client_marked_at timestamptz NULL
  created_at, updated_at timestamptz NOT NULL

  CONSTRAINT student_course_progress_one_node
    CHECK (num_nonnulls(section_id, subsection_id) = 1)
  CONSTRAINT student_course_progress_certified_pair
    CHECK (num_nonnulls(certified_at, certified_by) IN (0, 2))
  CONSTRAINT student_course_progress_certified_requires_completed
    CHECK (certified_at IS NULL OR status = 'completed')
  CONSTRAINT student_course_progress_client_op_id_format
    CHECK (client_op_id IS NULL OR client_op_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$')
```

Exactly one of `section_id` / `subsection_id` is set. `certified_at` and `certified_by` are set
together or not at all. The ULID regex is copied verbatim from
`lib/db/src/schema/attendance.ts:31`.

`note` is retained from the existing `student_curriculum_progress.note` so migration has somewhere
to land; `certification_note` is separate and written only by the CU17 certify path.

`client_marked_at` is the **client's** clock and is what CU31's conflict rule compares — never
server receipt time. Same reasoning as AT26.

Uniqueness is **two partial indexes**, not one composite:

```sql
CREATE UNIQUE INDEX student_course_progress_subsection_unique
  ON student_course_progress (student_id, subsection_id) WHERE subsection_id IS NOT NULL;
CREATE UNIQUE INDEX student_course_progress_section_unique
  ON student_course_progress (student_id, section_id)    WHERE section_id IS NOT NULL;
CREATE UNIQUE INDEX student_course_progress_client_op_id_unique
  ON student_course_progress (client_op_id) WHERE client_op_id IS NOT NULL;
```

The existing `student_curriculum_progress_student_item_unique` on `(student_id, curriculum_item_id)`
**must be dropped and recreated as partial.** Postgres treats NULLs as distinct in a unique index,
so once `subsection_id` is nullable the old index silently stops constraining section rows and
permits unlimited duplicates for a student.

### CU10 — Every write is an UPSERT, with the index predicate repeated
Two actors can tap the same node concurrently. Every progress write is
`ON CONFLICT … DO UPDATE`, never a read-then-insert.

Because the unique indexes are **partial**, the conflict target must repeat the predicate or
Postgres cannot match the index:

```sql
INSERT INTO student_course_progress (…) VALUES (…)
ON CONFLICT (student_id, subsection_id) WHERE subsection_id IS NOT NULL
DO UPDATE SET …
```

In Drizzle this is `target` plus `targetWhere`. Omitting `targetWhere` fails at runtime with
"no unique or exclusion constraint matching the ON CONFLICT specification" — a guaranteed day-one
stumble. The unique constraint plus `ON CONFLICT DO UPDATE` is the true idempotency anchor, exactly
as `CLAUDE.md`'s offline §3 states for attendance.

### CU11 — Status has three values; `mastered` is dead
```
not_started ⇄ in_progress ⇄ completed        ("to be started" in the UI)
```

- `start` sets `status='in_progress'` and stamps `started_at` (first time only).
- `close` sets `status='completed'` and stamps `completed_at`.
- Movement is **free in both directions while `certified_at IS NULL`**, for every actor including
  parent and student. A child who marked something done too early undoes it themselves; that is
  not the risk CU14 exists for. Reversing clears `completed_at`.

**`'mastered'` is never written.** Certification is `certified_at` / `certified_by` (CU17), not a
status value, so `completed` + certified is exactly what `mastered` would have meant. The value
stays in `curriculum_level_enum` as reserved — dropping a pgEnum value requires recreating the
type — but any code path writing it is a bug.

`not_started` is labelled **"to be started"** in the UI, in both languages. The enum value does not
change.

### CU12 — Certified rows are frozen for everyone, at both layers
Once `certified_at IS NOT NULL`, any write that would change `status` returns
`409 ERR_COURSE_NODE_CERTIFIED` — for **parent, student, shikshak and sanchalak alike**. Only the
CU19 super_admin correction path may move it, and it clears `certified_at`/`certified_by` in the
same statement.

The database backs this up via the `certified_requires_completed` CHECK (CU9). Note what that
implies: if a service path is missed, the write fails with SQLSTATE 23514 and surfaces as a **500,
not the designed 409**. The service guard is the contract; the CHECK is the net. Both are required.

Postgres evaluates row CHECKs after the whole UPDATE, so the correction path's
`SET status='in_progress', certified_at=NULL, certified_by=NULL` in one statement passes cleanly.

### CU13 — Bulk status write is the primary path for a shikshak
A Guruji closing one section for a batch of 40 is 40 rows. If the only route is single-student, it
is forty taps and it will not get done.

```
POST /v1/courses/nodes/:nodeId/progress/bulk
Body: { batch_id | student_ids, status, note?, submission_op_id }
```

Exactly one of `batch_id` / `student_ids` — supplying both or neither is `422`.

`batch_id` is a **student selector only**; it resolves to the batch's currently active roster. It
does not resolve a course, because courses have no batch link (CU2). Deactivated students (Q11)
are never included.

**Scope.** Every student in the resolved set must pass
`inBatchWriteScope(scope, student.batch_id, student.centre_id)` — the same gate as CU21. A
`student_ids` list containing anyone outside the caller's scope is rejected whole with `403`, never
partially applied. This is the higher-volume path and must not be laxer than the certify path.

SPEC Step 19 already mandates "bulk-update controls"; they were never built.

### CU14 — Bulk advances, never regresses
A bulk write applies to a student ONLY if the new status is strictly further along CU11 than their
current status. A child already at `completed` is untouched by a bulk `in_progress`.

Regression requires an explicit `reset: true` on a separate route, is restricted to shikshak+, and
writes an audit entry per affected student. Without this, one bulk tap silently walks a whole
roster backwards and nobody can tell it happened.

This governs the **bulk** route only. Single-student self-correction is free (CU11) — the risk here
is one tap moving forty students, not a child fixing their own row.

Rows with `certified_at IS NOT NULL` are excluded from every bulk write, `reset` included (CU12).

### CU15 — Silence is not regression
A student with no progress row for a node is `not_started` by absence, not by assertion. Do not
backfill `not_started` rows on course publish or enrolment — a row exists only once someone has
acted on that node. This mirrors AT6: absence of a mark is not a mark.

It also matters at scale: every student sees every course (CU3), so backfilling would create rows
for the entire catalogue for every student on day one.

### CU16 — Section status is stored AND derived; divergence is information
A section carries its own progress row (the declared act, CU9) and a derived roll-up over that
student's sub-section rows within it. **The roll-up is `fn_course_progress` (CU28) scoped to one
section — not a second formula.** CU28 is the ONE implementation; a section-scoped call is a
parameter, never a reimplementation.

Both are surfaced. A section declared `completed` while three sub-sections sit at `not_started` is
**not an error** — it is a fact reported to the Sanchalak, exactly as AT32 treats a session marked
without check-in: visible, not punitive. Never auto-correct one from the other, and never block the
declaration because the roll-up disagrees.

A section with zero sub-sections has a derived roll-up of `NULL`, not `0` and not `100`.

---

## 3. Certification

### CU17 — The star requires `completed`
Certification is an **orthogonal flag**, not a status. It sets `certified_at` and `certified_by`
and leaves `status` at `completed`.

A node must be `completed` before it can be certified. Online, a request against a node that is not
completed returns `409 ERR_COURSE_NODE_NOT_COMPLETE`.

**Offline soft-transition (AT32 pattern).** When a certification arrives via `/v1/sync/batch` and
the node is not `completed` — because the Guruji's close is still queued behind it, or was never
made — the certify transaction sets `status='completed'`, `completed_at`, `certified_at` and
`certified_by` **in one statement**, satisfying the CU9 CHECK. Hard-failing would lose a Guruji's
classroom work over queue ordering, which is exactly the harm AT8 and AT32 refuse.

Both sections and sub-sections can be starred. Sub-section stars never carry Punya (CU21).

**Display.** The star's label names the certifying shikshak with the correct honorific, resolved
from `users.gender`:

| `users.gender` | Label |
|---|---|
| male | "Certified by Guruji" / "गुरुजी द्वारा प्रमाणित" |
| female | "Certified by Didi" / "दीदी द्वारा प्रमाणित" |
| **NULL or other** | "Certified" / "प्रमाणित" |

`users.gender` is nullable with no backfill. A two-branch male/female rule silently falls back to a
hardcoded "Guruji", which is the exact bug this rule exists to prevent — the third branch is
required, not optional.

### CU18 — Certification is irreversible; every certification is audited
There is no revoke route. Certification is final for shikshak, sanchalak, city_admin and
state_admin.

Every certify writes an audit entry via `auditFromReq` with `entityKind: 'course_certification'`.
`CLAUDE.md` requires an audit entry for all admin actions; the irreversible act that mints Punya and
issues a certificate is the last one that should be missing it. The same applies to CU6 PATCH/DELETE,
CU4 publish, CU7 derive, and any edit to `course_sections.punya_points`.

Certification is per-student and has **no bulk route**. The client must show an explicit confirm
carrying the student's name, the node title and the Punya value before the write. Bulk the
reversible thing (CU13), make the irreversible thing deliberate — the same posture as AT25's
`force_cancel`.

If a batch-wide certification flow is later shown to be necessary, it must present a reviewable list
of every affected student with per-student opt-out before submitting — never a single action on a
roster.

### CU19 — The super_admin correction path
Not a product feature. Reachable only from the super_admin console. It:

1. Increments `student_course_progress.revision`.
2. Clears `certified_at` / `certified_by`, optionally regressing `status`, in one statement (CU12).
3. Writes a **reversing** `punya_transactions` row with its own idempotency key and
   `source_revision = revision`, per AT18 reverse-only. Without its own key, running the correction
   twice double-reverses.
4. **If the course was complete, reverses the course bonus too** (CU23) — de-certifying one section
   un-completes the course, so the milestone award must not survive it. Find the award to reverse by
   the most recent unreversed `source_entity_kind='course'` row for that student and course, never by
   assuming which section triggered it.
5. Sets `voided_at` / `voided_by` on any issued section certificate, and on the course certificate
   if the course was complete (CU24). Voided certificates are never deleted; CU27 verification
   reports them as `void`.
6. Writes two audit entries — one for the correction itself and one naming the acting super_admin,
   matching the impersonation convention.

"Irrevocable" means Gurujis and parents experience it as final — not that a production error is
unfixable forever.

### CU20 — Deleting a certified node is blocked
A soft delete of a `course_section` or `course_subsection` is rejected with
`409 ERR_COURSE_NODE_HAS_CERTIFICATIONS` if any `student_course_progress` row for it has
`certified_at IS NOT NULL`. Archive the course instead (CU4).

**This must be a service-layer precondition.** CU29 makes deletion soft, so `ON DELETE RESTRICT`
never fires — the FK protects against a hard `DELETE` that the application will never issue. Relying
on the FK here means relying on nothing.

Deleting an uncertified node soft-deletes its progress rows with it. It leaves CU28's denominator,
which raises every affected student's `coverage`; that is accepted, and is the reason CU20 blocks the
case where value has already been minted.

---

## 4. Punya

### CU21 — Punya is minted by certification alone
| Event | Punya | `source_entity_kind` |
|---|---|---|
| Start / close / reopen any node, by anyone | **0** | — |
| Sub-section certified (starred) | **0** | — |
| Section certified (starred) | `course_sections.punya_points` × city multiplier | `course_section` |
| Course fully certified (CU25) | `courses.punya_points` × city multiplier | `course` |

Starting and closing award nothing, so nothing is farmable: a parent tapping through 200
sub-sections earns zero. Sub-section stars are recognition without currency. Only a Guruji's star,
placed under CU18's confirm, moves the ledger.

The course bonus is a **milestone award in the spirit of AT22's repeating streak bonus**, not a
second helping of the section awards. It fires from the same transaction that certifies the final
section — never from a cron sweep — so there is no `punya.reconcile` dependency for correctness.
Sub-sections remain unpaid, so there is still no parent/child double-count within a section.

Certification scope gates on `inBatchWriteScope(scope, student.batch_id, student.centre_id)` —
identical to niyam approve/reject, signature at `apps/api-server/src/lib/scope.ts:128`. A shikshak
certifies only students in batches they are assigned to; a Guruji attesting that a child has
mastered a node needs to know the child. `inBatchWriteScope` resolves `batchIds === null` to centre
membership, so sanchalak and above keep whole-centre reach with no special case.

**Do not ship the shikshak gate without the sanchalak's mobile certification screen in the same
release.** Q12 records exactly why: an unstaffed batch's queue strands with nobody able to clear it.

### CU22 — Points are authored; the multiplier is `punya_configs`
```sql
ALTER TABLE course_sections
  ADD COLUMN punya_points integer NOT NULL DEFAULT 0
  CHECK (punya_points >= 0 AND punya_points <= 1000);

ALTER TABLE courses
  ADD COLUMN punya_points integer NOT NULL DEFAULT 0
  CHECK (punya_points >= 0 AND punya_points <= 2000);
```

Authored by the city_admin at course-design time. This is **authored data, not a hardcoded
constant** — AT21 forbids inlining values, and a value the admin types into the course is the
opposite of inlining. The upper bounds stop a mistyped `100000` inflating a city into AT23's
Tirthankar tier, whose thresholds are global.

**Authoring prefills (UI, not database defaults).** The column default stays `0`; these are
suggestions the admin can overwrite, recalculated live while authoring and frozen on save:

| Field | Prefill |
|---|---|
| `course_sections.punya_points` | `10 × (number of sub-sections in the section)` |
| `courses.punya_points` | `20% of the sum of its sections' punya_points` |

A section with 5 sub-sections prefills at 50; a 12-section course of that shape prefills a 120
completion bonus on ~600 of section value. Bigger sections are worth more automatically, and
admins anchor on a sane number rather than on whatever the first course in their city used. For
scale: attendance yields roughly 1,000 points a year and AT23's Sadhak tier begins at 501.

`courses.punya_points = 0` is legitimate and means "certificate, no bonus" — unlike a section,
where CU4's publish gate forces an explicit choice because 0 there silently disables the main
award path.

The multiplier is city-scoped configuration in the **existing** value table, one key per award kind:

```
punya_features rows:  key = 'course_section_certified' | 'course_completed'
                      min_points, max_points          (catalogue + clamp)
punya_configs  rows:  feature_key = same two keys
                      points, city_id                 (the multiplier)
```

`punya_configs.points` is `integer`, so the multiplier is stored as **integer percent**:
`100` = 1×, `250` = 2.5×. A numeric multiplier cannot be stored and must not be attempted.

```
award = ROUND(<authored punya_points> * punya_configs.points / 100.0)
        clamped to punya_features.min_points … max_points
```

Resolved at award time, city-scoped with global fallback, Redis-cached — exactly per AT21 — and
**snapshotted into the transaction row**. A later change to the authored points or the city's
multiplier never retroactively alters an existing award. The `min_points`/`max_points` clamp is the
existing runaway-award guardrail and must not be bypassed just because the base value is authored.

**Seed defaults are mandatory, not open items.** `punya_configs` seeds both
`course_section_certified = 100` and `course_completed = 100` (1×) globally, and CU4's publish gate
requires every section to have `punya_points` explicitly set. Without both, the feature ships
awarding zero: a missing config resolves to 0, and 0 × anything is 0.

Mechanics follow the attendance rules unchanged: guarded insert `ON CONFLICT DO NOTHING … RETURNING`,
balance moves only by the amount actually returned (AT20), never an unguarded increment beside a
guarded insert. Points of `0` award nothing and write no transaction.

### CU23 — Idempotency keys
```
section award:     course_section_certified:{section_id}:{student_id}:{revision}
section reversal:  course_section_certified:reverse:{section_id}:{student_id}:{revision}

course  award:     course_completed:{course_id}:{student_id}:{trigger_section_id}:{revision}
course  reversal:  course_completed:reverse:{course_id}:{student_id}:{trigger_section_id}:{revision}
```

`revision` comes from `student_course_progress.revision` (CU9) and is written to
`punya_transactions.source_revision`, which already exists and is indexed
(`idx_punya_tx_source_revision`).

**Why the section key needs a revision.** An earlier draft of this document dropped it, reasoning
that certification never reverses. That was wrong: CU19 defines a reversal, so re-certification
after a correction is reachable. Without the revision component that re-certification collides with
the original key, `punya_transactions_idempotency_key_uq` blocks the insert, the guarded insert
returns nothing, and the student ends up with a star and zero points — verbatim the failure AT17
exists to prevent.

**Why the course key needs the triggering section.** Course completion is not anchored to a single
progress row, and it *recurs*: a correction can de-complete a course and a later certification can
re-complete it. This is exactly AT22's repeating-streak-bonus problem, and it takes AT22's
solution — the key includes the **triggering** entity, here the section whose certification
completed the course, plus that section's revision.

Worked example. Sections A, B, C; C is certified last, so the key is `…:C:{C.revision}`. A
super_admin correction de-certifies A: the course bonus reverses, keyed on the same C. Re-certifying
A completes the course again, now triggered by A, giving `…:A:{A.revision}` — a distinct key, so
the award lands. A plain replay of C's certification produces the identical key and correctly does
nothing.

The reversal lookup follows AT18 and is specified as step 4 of CU19.

---

## 5. Certificates

### CU24 — Certificate schema
```sql
course_certificates
  id                uuid PK default gen_random_uuid()
  student_id        uuid NOT NULL REFERENCES students(id)      ON DELETE RESTRICT
  course_id         uuid NOT NULL REFERENCES courses(id)       ON DELETE RESTRICT
  section_id        uuid     NULL REFERENCES course_sections(id) ON DELETE RESTRICT
  kind              text NOT NULL CHECK (kind IN ('section','course'))
  verification_code char(12) NOT NULL
  scope_snapshot    jsonb NOT NULL
  issued_at         timestamptz NOT NULL DEFAULT now()
  voided_at         timestamptz NULL
  voided_by         uuid NULL REFERENCES users(id) ON DELETE RESTRICT
  storage_key       text NULL
  created_at, updated_at timestamptz NOT NULL

  CHECK ((kind = 'section' AND section_id IS NOT NULL)
      OR (kind = 'course'  AND section_id IS NULL))

CREATE UNIQUE INDEX course_certificates_section_unique
  ON course_certificates (student_id, section_id) WHERE section_id IS NOT NULL;
CREATE UNIQUE INDEX course_certificates_course_unique
  ON course_certificates (student_id, course_id) WHERE section_id IS NULL;
CREATE UNIQUE INDEX course_certificates_code_unique
  ON course_certificates (verification_code);
```

`verification_code` is 12 characters of Crockford base32 from a CSPRNG (~60 bits), generated with
retry on unique violation. `storage_key` is NULL until the worker finishes; a row with NULL
`storage_key` is "issuing", not broken.

### CU25 — What "fully certified" means, and certificates are point-in-time
- A **section certificate** is issued when that section's own progress row is certified. Not when
  its sub-sections are — that would contradict CU21, which mints the section award on the section
  star itself and never on its children.
- A **course certificate** is issued when every non-deleted section in the course is certified.
  A course with **zero sections issues nothing** — the predicate is vacuously true otherwise, and
  an empty course would certify everyone. The same event awards the CU21 course bonus, in the same
  transaction as the final section's certification.

`scope_snapshot` records the node ids and titles the certificate covered **at the moment of issue**.
Adding a section to an active course later does not void or re-issue anything: the certificate is a
true statement about what the course contained that day, and CU27 verification reports it against
the snapshot, not against the live tree.

This is why CU4 forbids `active → draft` but permits editing an active course. Coverage (CU28) does
drop for every student when a section is added; that is honest and expected. Certificates do not
move.

### CU26 — Generation
- Built with `PdfBuilder.createBilingual()` in `apps/api-server/src/lib/pdf.ts` — the path
  `centre-monthly-report.ts:244` uses. **Not** `PdfBuilder.create()`, which `progress.ts:397` uses
  and which is explicitly English-first/WinAnsi and cannot render Devanagari. CU17's
  "गुरुजी द्वारा प्रमाणित" must print, so the progress-report PDF is *not* the precedent here
  despite being the closest artefact.
- **Do not introduce Handlebars or Puppeteer.** SPEC §12.4's six `.hbs` templates in
  `apps/api/src/templates/` describe the unbuilt NestJS target; zero `.hbs` files exist in this repo
  and there is no Puppeteer pipeline.
- Queued on the existing **`report.generation`** queue with a payload discriminator. Do not add a
  queue name — `QUEUE_NAMES` is frozen at 21 entries and `report.generation` is already
  event-driven with no cron entry.
- Stored via `apps/api-server/src/lib/storage.ts` (single `S3_BUCKET` with app-level gating), served
  by signed URL with TTL. Never a public URL. The `STORAGE_BUCKET_PRIVATE` named in `CLAUDE.md` is
  documentation-only and does not exist in code — do not code against it.

### CU27 — Certificates verify live and leak nothing
`GET /v1/certificates/verify/:code` is public and returns **only**: validity (`valid` | `void` |
`not_found`), the course or section title, the issue date, and the student's **first name only**.
Never full name, never date of birth, never centre, never any id.

The endpoint is rate-limited per IP in Redis on the existing sliding-window mechanism. A public
endpoint keyed by a short code is enumerable by construction; 60 bits of entropy plus rate limiting
is what makes that acceptable, and a verbose response would make it a PII scraper.

A PDF in a parent's hand is a rendering of state, not the state itself. This is the only thing that
makes CU19's correction path survivable — otherwise a voided certificate still circulates and is
indistinguishable from a valid one.

---

## 6. Reporting

### CU28 — One canonical progress calculation, in SQL
ONE implementation: a PostgreSQL function. Not a TypeScript service helper — the PDF worker, mobile,
the admin panel and CU16's section roll-up all read from this one place and never compute their own.
Same discipline, same reasoning as AT5.

```sql
fn_course_progress(p_student_id uuid, p_course_id uuid, p_section_id uuid DEFAULT NULL)
RETURNS TABLE (
  leaf_total int, leaf_reached int, leaf_certified int,
  section_total int, section_certified int,
  coverage numeric, mastery numeric
)
```

**Leaf nodes** = all non-deleted `course_subsections`, PLUS all non-deleted `course_sections` having
zero non-deleted sub-sections. A section-only course would otherwise report `NULL` forever while
its sections mint every point the course is worth (CU21) — the canonical calculation cannot be
blind to the nodes that carry value.

```sql
-- over leaf nodes, LEFT JOINed to student_course_progress:
leaf_total     = COUNT(*)
leaf_reached   = COUNT(*) FILTER (WHERE p.status IS NOT NULL AND p.status <> 'not_started')
leaf_certified = COUNT(*) FILTER (WHERE p.certified_at IS NOT NULL)

coverage = leaf_reached::numeric   / NULLIF(leaf_total, 0)
mastery  = leaf_certified::numeric / NULLIF(leaf_reached, 0)
```

Three things that are each individually fatal if missed:

1. **The `::numeric` cast.** `int / int` truncates in Postgres — a student 7/20 through a course
   would report `coverage = 0`. `0012_derived_attendance.sql:69` and
   `0026_homework_completion_rate.sql:34` both cast; match them.
2. **The LEFT JOIN.** CU15 means untouched nodes have no progress row at all. An inner join reports
   100% for a student who has touched one node.
3. **The leaf filter on the join.** CU9 puts section and sub-section rows in the *same table*.
   Counting certified rows without restricting to leaf nodes pulls certified *sections* into a
   leaf-denominated numerator and `mastery` exceeds 100%.

Use `COUNT(*) FILTER (WHERE …)`, NOT `COUNT(expr IN (…))`. `COUNT(boolean)` counts every non-null
row and the naive form returns 1.0 for everyone.

`section_total` / `section_certified` count sections regardless of children — this is what CU25's
course-certificate predicate and CU30's report block read, and what makes section certification
visible in reporting even though sections with children are not leaves.

**Two ratios, never one.** `coverage` says how far through the course this student has got;
`mastery` says how much of what they reached is certified. A single percentage conflates "barely
started" with "struggling" — two situations demanding opposite responses from a Sanchalak.

`mastery` is `NULL`, not `0`, when `leaf_reached = 0`. CU17 guarantees `leaf_certified ≤ leaf_reached`,
so it can never exceed 100%.

`p_section_id` scopes the same function to one section for CU16's roll-up. Excluded everywhere:
soft-deleted nodes (CU29); students from `deactivated_at` forward, with prior history retained (Q11).

**No materialised view is added.** The frozen MV list in `CLAUDE.md` gains nothing, and
`mv_centre_engagement` is not extended in this work. If course metrics are later wanted on a
dashboard, that is a separate decision against the frozen list.

### CU29 — Soft delete; RESTRICT is the net, not the guard
`courses`, `course_sections`, `course_subsections` and `course_templates` gain
`deleted_at timestamptz NULL` and adopt the soft-delete convention the rest of the schema follows.
All CASCADE foreign keys in the tree become **RESTRICT**.

| FK | Today | Becomes |
|---|---|---|
| `curriculum_sections.curriculum_id` | cascade | RESTRICT |
| `curriculum_items.section_id` | cascade | RESTRICT |
| `student_curriculum_progress.curriculum_item_id` | cascade | RESTRICT |
| `student_curriculum_progress.student_id` | cascade | RESTRICT |

Deleting one item today silently deletes every student's progress against it — survivable while
progress is an ungraded competency grid, not survivable once Punya has been awarded and a
certificate issued. The `student_id` cascade is worse: it contradicts Q11, which forbids ever
hard-deleting a student, and quietly assumes a delete that must never happen.

**But RESTRICT alone protects nothing here**, because CU29 also makes deletion soft and the FK only
fires on a hard `DELETE`. CU20's service-layer precondition is the actual guard. The FKs are changed
anyway so that a stray hard delete — a migration, a console session — cannot do the damage either.

`curricula.city_id` is already RESTRICT. `homework_assignments.subsection_id` keeps
`ON DELETE SET NULL` — that link is advisory and losing it is not an integrity event.

Undelete (`deleted_at = NULL`) restores the node and its progress rows and re-tightens CU28's
denominator. It is admin-only and audited.

### CU30 — Progress report gains a versioned curriculum block
`progress_reports.snapshot` today carries `{ items, homework, generated_at }`; `progress.ts:387`
notes that attendance % and niyam streaks named in SPEC §8.14 were never added.

The snapshot gains `courses: [{ course_id, coverage, mastery, section_certified, section_total,
certified_nodes[] }]`, all read from `fn_course_progress` (CU28) — never recomputed in the report
worker.

`snapshot` is `jsonb().$type<Record<string, unknown>>()`, which already violates the rule that JSONB
columns validate against a Zod schema from `@jp/shared`. This change adds a
`snapshot_version integer NOT NULL DEFAULT 1` column and a Zod schema for the new shape. Readers
branch on the version; pre-change snapshots are version 1 and have no `courses` key.

This finally gives SPEC §8.14's "curriculum %" a definition — it has been consumed by the monthly
report spec since day one without one ever existing.

---

## 7. Offline

### CU31 — Full offline parity, including certification
Both status marking and certification sync offline. See the ⚠ banner at the top of this document:
**this requires amending `CLAUDE.md`'s offline section in the same commit.**

**Op types** (union goes from 7 to 9): add `course_progress`, `course_certification`.

**MMKV queues:** `jp.queue.course_progress`, `jp.queue.course_certification`.

```ts
// jp.queue.course_progress
type PendingCourseProgressOp = {
  submission_op_id: string;   // ULID char(26)
  node_kind: 'section' | 'subsection';
  node_id: string;            // uuid
  marks: Array<{
    student_id: string;
    status: 'not_started' | 'in_progress' | 'completed';
    note?: string;
    client_op_id: string;     // ULID char(26) — per item (AT19)
  }>;
  marked_at: string;          // ISO-8601 — client clock → client_marked_at (CU9)
  client_timestamp: string;
};

// jp.queue.course_certification
type PendingCourseCertificationOp = {
  submission_op_id: string;
  node_kind: 'section' | 'subsection';
  node_id: string;
  student_id: string;         // always exactly one — CU18 forbids bulk
  certification_note?: string;
  client_op_id: string;
  certified_at: string;       // ISO-8601 — client clock
  client_timestamp: string;
};
```

**Drain order.** Appended to the frozen causal chain before `acknowledgements`:

```
checkin → attendance → checkout → shivir_scans → niyam_submissions
→ homework_submissions → course_progress → course_certification → acknowledgements
```

`course_progress` before `course_certification` is the only *causal* constraint — a node should be
completed before it is starred. The pair's position relative to the attendance chain is positional,
not causal; there is no dependency either way.

**No ordering guard is needed for the pair.** Unlike checkin→attendance, a failed or missing
`course_progress` op does not block certification: CU17's soft-transition sets `completed` and
`certified` together. The escape hatch is built into the handler rather than the drain logic.

**Conflict resolution** (`CLAUDE.md` §6 requires a rule per op type):

- `course_progress` — newest `marked_at` wins, compared against the stored `client_marked_at`
  (CU9), ties broken by server receipt order. If the stored row is newer, return
  `status='duplicate'` and do not apply. The comparison lives in the **shared service method**, so
  the online path is governed by it too.
- `course_certification` — if the row is already certified, return `status='duplicate'`, not
  `conflict`. The star is already there and certification is irreversible (CU18); a replay is a
  no-op, not an error.
- A certification for a node the caller no longer has scope over (CU21) returns `conflict` and is
  terminal.

**Replay safety** rests on two independent layers, both required: `sync_operations`
`UNIQUE (user_id, submission_op_id)` returning the stored `response_payload` without re-executing,
and the CU23 Punya idempotency key with its guarded insert. An earlier draft banned offline
certification on replay-risk grounds; with both layers present that argument does not hold, and
banning it would mean the Guruji's highest-value action is the one that fails in the bad-wifi
classroom the offline model exists for.

CU18's confirm requirement is satisfied **on the device, before queueing**. Deliberateness is a
client property; it does not require a live connection.

`client_op_id` carries a unique index (CU9) so AT19 per-row repair is possible.

---

## 8. Route table (proposed — not yet frozen)

Roles listed are the **minimum**; per `CLAUDE.md`, a higher role can always do what a lower role can.

| Method | Route | Roles |
|---|---|---|
| POST · PATCH · DELETE | `/v1/admin/course-templates[/:id]` | super_admin (CU7) |
| POST | `/v1/admin/course-templates/:id/derive` | super_admin — snapshot copy (CU7) |
| POST | `/v1/admin/courses` | city_admin; **super_admin only** for msv / `city_id IS NULL` (CU8) |
| PATCH · DELETE | `/v1/admin/courses/:id` | city_admin — soft delete (CU6, CU29) |
| POST | `/v1/admin/courses/:id/publish` | city_admin — draft → active, gated + audited (CU4) |
| GET | `/v1/admin/courses?kind=&status=` | shikshak |
| GET | `/v1/admin/courses/:id/tree` | shikshak |
| POST | `/v1/courses/:courseId/sections` | city_admin — body includes `punya_points` (CU22) |
| PATCH · DELETE | `/v1/courses/sections/:sectionId` | city_admin (CU20 guard) |
| POST | `/v1/courses/:courseId/sections/reorder` | city_admin |
| POST | `/v1/courses/sections/:sectionId/subsections` | city_admin |
| PATCH · DELETE | `/v1/courses/subsections/:subsectionId` | city_admin (CU20 guard) |
| POST | `/v1/courses/sections/:sectionId/subsections/reorder` | city_admin |
| GET | `/v1/courses` | any authenticated — active + city/national + MSV gate (CU3) |
| **GET** | **`/v1/courses/:id/tree?student_id=`** | any authenticated — **the student-facing read path**; returns the tree with that student's status and star per node |
| GET | `/v1/students/:id/course-progress?course_id=` | owner or in-scope admin |
| POST | `/v1/courses/nodes/:nodeId/progress` | shikshak, sanchalak, parent (own child), student (self, 13+) |
| POST | `/v1/courses/nodes/:nodeId/progress/bulk` | shikshak (CU13) |
| POST | `/v1/courses/nodes/:nodeId/progress/reset` | shikshak — audited (CU14) |
| POST | `/v1/courses/nodes/:nodeId/certify` | shikshak — batch-bound (CU21) |
| GET | `/v1/students/:id/certificates` | owner or in-scope admin |
| GET | `/v1/certificates/verify/:code` | public, rate-limited (CU27) |

`:nodeId` resolves against `course_sections` then `course_subsections`; a node id matching neither
is `404 ERR_COURSE_NODE_NOT_FOUND`.

**Bodies for the two core writes** — both are per-student and neither carries the student in the
path, so both require it in the body. A parent with three children cannot use either otherwise.

```ts
POST /v1/courses/nodes/:nodeId/progress
  { student_id, status, note?, client_op_id, marked_at }

POST /v1/courses/nodes/:nodeId/certify
  { student_id, certification_note?, client_op_id, certified_at }
```

**Parent and student write scope.** A `parent` writes only for their own children; a `student`
(student-view, ≥13 per Q4) only for themselves. Neither can write for a sibling
(`403 ERR_COURSE_STUDENT_OUT_OF_SCOPE`), and neither can write a certified row (CU12).

### CU32 — Error codes
Add to `apps/jp-shared/src/errors.ts` — none of these exist today:

```
ERR_COURSE_NODE_CERTIFIED            409  CU12
ERR_COURSE_NODE_NOT_COMPLETE         409  CU17 (online path only)
ERR_COURSE_NODE_HAS_CERTIFICATIONS   409  CU20
ERR_COURSE_NODE_NOT_FOUND            404  route table
ERR_COURSE_STUDENT_OUT_OF_SCOPE      403  CU13, CU21, parent/student scope
ERR_COURSE_NOT_PUBLISHABLE           422  CU4 publish gate
```

Never return raw strings; `CLAUDE.md` requires the enum.

---

## 9. Surfaces

| Surface | Work |
|---|---|
| Web admin | Rename throughout; template CRUD + derive; course draft/publish/archive with the CU4 gate; PATCH/DELETE with CU20 guard; `punya_points` field on the section editor; section-level progress with the CU16 divergence indicator; certify with CU18 confirm |
| Mobile — shikshak | New: course list + tree, bulk start/close (CU13), per-student certify with confirm (CU18), offline queues (CU31). Currently read-only. |
| Mobile — sanchalak | **Certification must be reachable here in the same release as CU21.** Non-negotiable per Q12. |
| Mobile — parent/student | New: full catalogue per CU3, node start/close/reopen, star display with the CU17 honorific, certificate viewing |
| PDF worker | Section + course certificates via `PdfBuilder.createBilingual()`, queued on `report.generation` (CU26) |

---

## 10. Catalogue management

### CU33 — Manual archive, with a staleness nudge
Every student sees every active course (CU3) and the list grows without bound as academic years
accumulate. There is no automatic archiving and no year filter — a city_admin decides, because
archiving removes a course from every student's view and that judgement is theirs.

The admin course list carries a **nudge**, not a rule:

- A persistent banner lists active courses whose `academic_year` is older than the current one,
  with a one-tap archive action per course. CU4 makes `academic_year` a publish precondition
  precisely so this is computable.
- A secondary warning appears once a city exceeds **15 active courses**, as a backstop for courses
  with a current or rolling `academic_year` that the staleness check will never catch.
- The archive confirm states how many students have in-progress uncertified work on that course
  (CU4).

**The known risk, stated plainly:** a nudge that can be dismissed forever means some cities will
never archive anything, and their students will scroll a catalogue that only grows. Revisit at the
second academic-year rollover with real numbers rather than pre-emptively adding automation. If the
nudge is being ignored, the fallback is the year filter — default the student's list to the current
`academic_year` with a "previous years" toggle — which contains growth without hiding anything.

---

## 11. Open items

1. Whether `student_notes` (SPEC §5.20, shikshak-private) should attach to course nodes. Out of
   scope here.
2. `progress_reports.student_id` and `punya_transactions.student_id` still cascade on delete,
   against Q11 — the same defect CU29 fixes in the course tree. **Deferred to migration `0052`,
   deliberately not folded into `0051`:** that migration already does table renames, four FK swaps,
   an index rebuild, an enum conversion and three NOT NULL adds, each taking ACCESS EXCLUSIVE, and
   adding unrelated tables widens the blast radius of a bad deploy. Track it so it does not become
   permanent.

---

*Resolved 2026-08-07 · CU1–CU33 · supersedes SPEC §5.13, §6.16 and Step 19 where they conflict.*
