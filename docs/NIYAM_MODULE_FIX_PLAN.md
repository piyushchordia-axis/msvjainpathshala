# Niyam Module — Fix Plan & Cursor Prompts

Companion to [`NIYAM_MODULE_REVIEW.md`](./NIYAM_MODULE_REVIEW.md). Covers findings **1–24 except 20** (offline queue — deferred to its own cross-cutting prompt).

Built for **Cursor**. Repo conventions live in `.cursor/rules/` and attach automatically, so the prompts below stay short and carry only the work.

---

## Part 1 — Decisions locked before coding

### D1. Streak badge thresholds (resolves the FullSpec §8.5 vs PersonaFeatures conflict)

Hybrid ladder, frequency-aware:

| Niyam frequency | Milestones | Badge keys |
|---|---|---|
| `daily` | 7, 14, 30, 60, 100 consecutive days | `daily_7`, `daily_14`, `daily_30`, `daily_60`, `daily_100` |
| `weekly` | 4 consecutive weeks | `weekly_4` |
| `monthly` | 3 consecutive months | `monthly_3` |

One-time per `(student, niyam, badge_key)`. Awarding a badge grants bonus Punya (default 25) and sends a push. `FullSpec §8.5` should be amended to this table so the docs stop disagreeing.

### D2. Badges get their own table, not a boolean

`niyam_streaks.badge_awarded` / `badge_kind` (as written in `§5.8`) cannot represent five milestones on one streak. Use a `niyam_badges` table with a unique index — that also makes badge awarding idempotent under streak recomputes.

### D3. Rejection window constant

`NIYAM_REVERSAL_WINDOW_DAYS = 30`, exported from a shared constants module, referenced by the service and the tests, and surfaced to clients as `reversal_window_expires_at` + `can_reject` so no UI hardcodes 30.

### D4. Migration style

Hand-written numbered SQL in `lib/db/migrations/` with a `meta/_journal.json` entry — **not** `drizzle-kit generate`. See `.cursor/rules/10-db-schema.mdc`.

### D5. Cursor rules carry the conventions

Three rules files were added so each prompt doesn't restate the repo's shape:

| File | Attaches |
|---|---|
| `.cursor/rules/00-workspace.mdc` | always — layout, envelope, typecheck traps |
| `.cursor/rules/10-db-schema.mdc` | on `lib/db/**` — schema + migration conventions |
| `.cursor/rules/20-niyam-fix-pass.mdc` | on niyam/gallery/punya files — Q5/Q6/Q11 invariants, badge ladder, "do not fix these" list |

`docs/CONVENTIONS_FOR_AGENTS.md §8` (contention rules — never edit shared files) does **not** apply to this pass. That rule assumes parallel module agents; this is a sequential fix on an existing module, so editing `schema/enums.ts`, `routes/v1.ts`, `lib/queries.ts` directly is expected.

---

## Part 2 — Sequenced plan

Four prompts, run in order. Each must end green before the next starts.

| Prompt | Theme | Findings closed |
|---|---|---|
| **N1** | Data model & migration | 5, 7, 9(schema), 10, 18, 24 |
| **N2a** | Q5 window, transaction boundary, gallery pipeline | 1, 3, 4, 7(write path), 8 |
| **N2b** | Badges, hardening, listings | 6, 9(logic), 11, 12, 13, 14, 15, 16, 17, 19, 21, 22, 23 |
| **N3** | Admin panel & mobile | 2, plus surfacing badges, date ranges, rejection window |

**Why this order.** N2a's transaction rewrite needs the `idempotency_key` column from N1. N3's review-page rework needs N2b's status-filtered endpoint. Running the migration first also means the `feature_key` backfill happens once, before any new writes land in the old composite format.

**Why N2 is split in two.** The original single N2 had fourteen numbered work items. Cursor's agent degrades noticeably on sweeps that long — it starts skipping items silently rather than reporting them. N2a is the five that change money and privacy behaviour and deserve full attention; N2b is the hardening tail. If you're running a long-context model and prefer one pass, they merge cleanly.

### Verification — important

**Do not use root `pnpm run typecheck` as your signal.** It has pre-existing failures in shadcn components from two coexisting `@types/react` versions. They are unrelated to this work and will send the agent chasing ghosts. Use:

```bash
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
```

This is also captured in `.cursor/rules/00-workspace.mdc` so the agent sees it every time.

### Risk note for N1

The `feature_key` backfill rewrites existing `punya_transactions` rows. **Snapshot the database first**, and run the inspection `SELECT` on production data before the `UPDATE`. Reversal rows (`points < 0`) must be matched to their originals in the same pass.

---

## Part 3 — The Cursor prompts

Run each in **Agent mode**. For N1 and N2a, use **Plan mode** first (or the explicit plan instruction in the prompt) — both touch the ledger.

Model: use your strongest reasoning model for N1 and N2a. N2b and N3 are mechanical enough for a faster one.

---

### PROMPT N1 — Data model & migration

````
@docs/NIYAM_MODULE_REVIEW.md @docs/NIYAM_MODULE_FIX_PLAN.md
@lib/db/src/schema/niyams.ts @lib/db/src/schema/gallery.ts @lib/db/src/schema/punya.ts
@lib/db/src/schema/enums.ts @apps/api-server/src/lib/punya.ts
@lib/db/migrations/0004_student_parent_blood.sql @lib/db/migrations/meta/_journal.json

Part 1 of 4 of the Niyam module fix pass. Data model only — no behaviour changes.
Closes review findings 5, 7, 9(schema), 10, 18, 24.

Produce a plan and stop for my approval before editing anything.

## 1. punya_transactions — real idempotency (finding 5)

Currently apps/api-server/src/lib/punya.ts encodes the idempotency key INTO
feature_key as `niyam_submission#submission:<uuid>`. That breaks per-feature
reporting, breaks punya_configs city overrides, and is rendered raw to parents in
/v1/me and to admins in the transactions list. Fix the data model properly.

Add to lib/db/src/schema/punya.ts:
- idempotency_key  text, nullable
- reversal_of      uuid FK punya_transactions.id, onDelete set null
- source_entity_kind text   ('niyam_submission' | 'attendance' | 'manual' | ...)
- source_entity_id   uuid
Indexes:
- unique on idempotency_key, partial where idempotency_key is not null
- index on feature_key
- partial index on reversal_of where reversal_of is not null

Then rewrite apps/api-server/src/lib/punya.ts:
- feature_key stores ONLY the clean key. Delete the composite hack and its comment.
- De-dupe becomes INSERT ... ON CONFLICT (idempotency_key) DO NOTHING, using
  rowCount to distinguish a real award from an idempotent replay.
- Keep the advisory lock ONLY if a test proves it is still needed once the unique
  index exists. Prefer removing it.
- runReverse sets reversal_of to the original transaction id and carries the same
  source_entity_kind / source_entity_id.
- Public signatures of awardPunya / reversePunya do not change.

## 2. niyam_submissions — dedicated rejection columns (finding 7)

The reject route currently appends the admin's reason onto `notes`, which is
parent-authored content. Add proper columns:
rejected_at, rejected_by (FK users, set null), rejection_reason,
approved_at, punya_transaction_id, reversal_transaction_id.
Keep reviewed_by / reviewed_at for the approve path. Drop nothing yet — N2a is what
stops writing into notes.

## 3. niyams — date range (finding 10)

Add start_date (date, not null, default current_date) and end_date (date, nullable).
Index (is_active, start_date).

## 4. niyam_badges — new table (finding 9, decision D2)

id, student_id (FK cascade), niyam_id (FK cascade), badge_key, streak_length int,
points_awarded int default 0, awarded_at timestamptz default now(), ...timestamps().
Unique on (student_id, niyam_id, badge_key).
Add NIYAM_BADGE_KEYS + niyamBadgeKeyEnum to schema/enums.ts:
daily_7, daily_14, daily_30, daily_60, daily_100, weekly_4, monthly_3.

## 5. Indexes for the review queue (finding 18)

niyam_submissions: (status, submission_date desc).
gallery_items: (submission_id).

## 6. Shared route helpers (finding 24)

inScope, clampLimit, scopedCentreFilter and firstName are copy-pasted across
routes/v1/gallery.ts, niyam-submissions.ts and admin-resources.ts — gallery.ts even
has a comment acknowledging it, and one copy has already drifted. Lift them verbatim
into apps/api-server/src/lib/route-helpers.ts and replace every copy. Behaviour must
be identical.

## 7. Migration 0005

lib/db/migrations/0005_niyam_module_fixes.sql, every statement IF NOT EXISTS
guarded, plus the meta/_journal.json entry (idx 5, tag "0005_niyam_module_fixes").

Backfill order matters — inspect, then rewrite, then constrain:
  a. FIRST show me the output of:
       SELECT feature_key, count(*) FROM punya_transactions
       WHERE feature_key LIKE '%#%' GROUP BY 1 ORDER BY 2 DESC LIMIT 20;
     Do not assume niyam is the only polluted key.
  b. UPDATE ... SET idempotency_key = split_part(feature_key,'#',2),
                    feature_key = split_part(feature_key,'#',1),
                    source_entity_kind = 'niyam_submission'
     WHERE feature_key LIKE 'niyam_submission#%';
  c. Derive source_entity_id from the 'submission:<uuid>' portion where parseable.
  d. Link reversals: set reversal_of by matching '<key>:reversal' back to '<key>'.
  e. ONLY THEN create the unique index, so a duplicate fails loudly during
     migration rather than silently at runtime.

## Tests

New apps/api-server/test/punya-idempotency.test.ts:
- awardPunya twice with the same key → one ledger row, credited once
- reversePunya twice with the same key → one debit
- every resulting feature_key is exactly "niyam_submission", none contain '#'
- reversal_of points at the original row
niyam-submissions.test.ts and gallery.test.ts must still pass unchanged.

## Verify — paste the actual output

pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
psql: SELECT feature_key, count(*) FROM punya_transactions GROUP BY 1;
      -- expect a handful of clean keys, zero containing '#'
psql: \d punya_transactions   and   \d niyam_submissions

Commit: fix(niyam): dedicated idempotency + rejection columns, badges table, migration 0005
````

---

### PROMPT N2a — Q5 window, transaction boundary, gallery pipeline

````
@docs/NIYAM_MODULE_REVIEW.md @apps/api-server/src/routes/v1/niyam-submissions.ts
@apps/api-server/src/routes/v1/gallery.ts @apps/api-server/src/routes/v1/notifications.ts
@apps/api-server/src/lib/punya.ts @apps/api-server/test/niyam-submissions.test.ts

Part 2a of 4. The five changes that affect points and privacy. N1 must be merged and
green first. Closes review findings 1, 3, 4, 7(write path), 8.

Produce a plan and stop for my approval before editing anything.

## 1. Q5 30-day rejection window (finding 1) — the headline fix

ERR_NIYAM_REVERSAL_WINDOW_EXPIRED does not exist anywhere in this codebase today,
and POST /:id/reject has no date check at all. An admin can reverse Punya on a
submission from any point in history. CLAUDE.md lists this as one of three
highest-risk rules.

- Add NIYAM_REVERSAL_WINDOW_DAYS = 30 to a shared constants module.
- In the reject route, before any write: if status is auto_approved or approved AND
  submitted_at < now() - 30 days → fail(res, 409,
  "ERR_NIYAM_REVERSAL_WINDOW_EXPIRED",
  "The 30-day rejection window for this submission has closed.")
- A still-pending submission is EXEMPT — it never awarded points.
- Enforce in the service, not a guard or middleware.
- Return reversal_window_expires_at and can_reject on every submission read so no
  client ever hardcodes 30.

## 2. One transaction for submit (finding 4)

In POST /v1/niyam-submissions the db.transaction commits at line ~353, and THEN
awardPunya and bumpStreak run on the bare db handle. A crash in between leaves
points_awarded set with no ledger row, and the period-uniqueness index blocks any
retry. The approve path already does this correctly by threading tx.

Move awardPunya, the streak update and the new gallery insert INSIDE the existing
transaction callback, passing tx. Nothing that mutates points or streaks may run
after commit. Audit writes and pushes stay post-commit, best-effort — mirror the
birthday-cron pattern in notifications.ts.

## 3. Gallery population from submissions (finding 3, Q6)

gallery_items is currently inserted ONLY by the manual admin upload route and by
seed.ts. No production path creates one from a submission, so a parent can opt in
and nothing ever appears. Meanwhile the reject path dutifully soft-deletes a
gallery item that never existed.

Inside the same transaction, when a submission is auto_approved or approved, insert
gallery_items with submission_id, student_id, niyam_id, image_url = the first media
of kind 'photo' (skip entirely if there is no photo), is_public true,
is_featured false, created_by null. Do the same on the approve route.

Do NOT check gallery_visibility_opt_in at write time and do NOT add a backfill job.
The existing query-time consent join in gallery.ts is the correct design — it makes
the toggle instant. Leave it alone.

## 4. Rejection: proper columns and a mandatory reason (finding 7, write path)

- reason becomes required, min 20 chars, max 300 → 422 otherwise.
- Write rejected_at / rejected_by / rejection_reason. STOP concatenating onto notes.
  notes is parent-authored and an admin must never mutate it.
- Record punya_transaction_id and reversal_transaction_id on the submission row.

## 5. Parent notification on rejection (finding 8)

Today Punya silently vanishes from a child's balance with no explanation. Post-commit,
insert a notifications row (kind "niyam_rejected", bilingual title/body including the
reason) for the student's parent, then best-effort sendPush. Follow the pattern in
notifications.ts exactly — the insert gates the at-most-once push.

## Tests

Add to apps/api-server/test/niyam-submissions.test.ts:
- reject at 29 days → 200, punya reversed
- reject at 31 days → 409 ERR_NIYAM_REVERSAL_WINDOW_EXPIRED, balance unchanged
- reject a still-pending 60-day-old submission → 200 (window does not apply)
- reject with a 5-char reason → 422, and notes is byte-identical afterwards
- reject → a notifications row exists for the parent
- auto-approved photo submission → exactly one gallery_items row with submission_id
- that gallery row is invisible on GET /v1/gallery until the parent opts in
- simulate a failure between commit and award → assert it can no longer happen
  (i.e. the award is inside the transaction)

## Verify — paste the actual output

pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
curl the full lifecycle: submit → auto_approved → gallery row → reject → reversal
psql: SELECT id, status, rejected_at, rejection_reason, notes FROM niyam_submissions
      WHERE status='rejected' LIMIT 3;
      -- reason in rejection_reason, notes untouched

Commit: fix(niyam): Q5 rejection window, transactional award, gallery pipeline
````

---

### PROMPT N2b — Badges and hardening

````
@docs/NIYAM_MODULE_REVIEW.md @docs/NIYAM_MODULE_FIX_PLAN.md
@apps/api-server/src/routes/v1/niyam-submissions.ts @apps/api-server/src/routes/v1/me.ts
@apps/api-server/src/routes/v1/admin-resources.ts @apps/api-server/src/lib/niyam-period.ts
@apps/api-server/src/lib/file-tokens.ts @apps/api-server/src/lib/ratelimit.ts

Part 2b of 4. N2a must be merged and green first.
Closes review findings 6, 9(logic), 11, 12, 13, 14, 15, 16, 17, 19, 21, 22, 23.

Work through these in order and report on each by number — do not silently skip any.

1. STREAK BADGES (finding 9, ladder in .cursor/rules/20-niyam-fix-pass.mdc)
   Replace bumpStreak with recomputeStreak on BOTH submit and reject — forward-only
   bumping under-counts backdated submissions (finding 17).
   After recompute, evaluate milestones for the niyam's frequency:
     daily 7/14/30/60/100 · weekly 4 · monthly 3
   For each newly reached milestone not already in niyam_badges: insert the badge
   (unique index makes it idempotent), award bonus Punya with idempotencyKey
   `badge:{student_id}:{niyam_id}:{badge_key}`, enqueue a push.
   A rejection that breaks a streak does NOT revoke an earned badge — badges are
   historical achievements. Say so in a comment.
   Return newly-awarded badges in the submission response so mobile can celebrate.

2. BOUND THE RECOMPUTE (finding 16)
   recomputeStreak currently loads every non-rejected submission for the pair,
   unbounded. Limit to the last 400 days. Set longest_streak = max(stored,
   recomputed) so a rejection can never lower a streak the child legitimately reached.

3. NIYAM DATE RANGE (finding 10, logic half)
   Reject a submission whose submission_date is outside [start_date, end_date] → 422.
   Per spec §8.4 step 6 compare submission_date, not now(), so a submission uploaded
   before the niyam ended still lands. Catalog read filters on the range too.

4. SERVER-SIDE AUDIENCE RE-VALIDATION (finding 21)
   msv_audience / scope filtering exists only in GET /v1/me/niyam-catalog. A non-MSV
   student can submit an msv_only or other-city niyam by posting the id directly.
   Extract the predicate and apply it in POST /v1/niyam-submissions → 403.

5. DELETED / INACTIVE STUDENTS (finding 6, Q11)
   ownedStudentId in niyam-submissions.ts omits isNull(students.deleted_at) — the
   identical helper in me.ts includes it. Add it plus status='active', and move the
   helper into lib/route-helpers.ts so they can never drift again.

6. POINTS BOUNDS (finding 22)
   Validate niyams.points against punya_features min/max for niyam_completion at
   niyam create/update. Apply punya_configs city overrides at award time.

7. SIGNED URL TTL (finding 11)
   file-tokens.ts defaults to 24h; spec §10.3 says 1h, and the public gallery hands
   these URLs to anonymous callers for photos of minors. Default to 3600s, with an
   optional per-call override for long-lived report PDFs.

8. PROOF URL OWNERSHIP (finding 12)
   isNiyamProofUrl only checks the path prefix, so any authenticated user who obtains
   another family's proof URL can attach it to their own child's submission. Persist
   uploaded_by on upload and verify the caller owns the key → 422 otherwise.

9. RATE LIMITING (finding 15)
   Apply the existing ratelimit.ts to POST /v1/niyam-submissions: 20/hour/user and
   5/minute/user, standard ERR_RATE_LIMITED envelope.

10. LISTING + PAGINATION (finding 19, and prep for N3)
    Add ?status= (repeatable), ?student_id=, ?niyam_id=, ?from=, ?to= to
    GET /v1/admin/niyam-submissions. Cursor pagination on (submission_date desc,
    id desc) for it and for /pending — the current ordering has no tie-break so pages
    are non-deterministic. Include reversal_window_expires_at and can_reject per row.

11. SMALL CLEANUPS (findings 13, 14, 23)
    - niyam-period.ts: delete the unreachable "any" branch in allowedMediaKinds; stop
      the deprecated proof_url fallback synthesising an audio kind that "either"
      then rejects.
    - Single IST-aware date helper exported from niyam-period.ts, used by both
      todayIstDate and previousDate — currently one uses a fixed +5.5h offset and the
      other UTC arithmetic.
    - SUBMISSION_BACKDATE_DAYS = 1 as a named constant with a comment explaining the
      product rule.

## Tests
- daily niyam, 7 consecutive days → niyam_badges has daily_7 exactly once; day 8
  does not duplicate it
- rejecting day 4 of a 7-day streak → current_streak drops, daily_7 NOT revoked,
  longest_streak does not decrease
- non-MSV student POSTing an msv_only niyam id → 403
- submission outside [start_date, end_date] → 422
- soft-deleted student → 404
- 21st submission in an hour → 429 ERR_RATE_LIMITED
- listing: two rows with the same submission_date paginate deterministically

## Verify
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test
psql: SELECT * FROM niyam_badges LIMIT 10;
Report on all 11 items by number, including any you chose not to do and why.

Commit: fix(niyam): streak badges, audience re-validation, URL TTL, rate limiting
````

---

### PROMPT N3 — Admin panel & mobile

````
@apps/jain-pathshala/src/pages/admin/NiyamReviewPage.tsx
@apps/jain-pathshala/src/components/admin/AdminPageShell.tsx
@apps/jain-pathshala/src/hooks/useAdminList.ts
@apps/jain-pathshala-mobile/app/parent/niyams.tsx
@apps/jain-pathshala-mobile/app/niyam-submit.tsx
@apps/jain-pathshala-mobile/lib/queries.ts

Part 4 of 4. N2b must be merged and green first. Closes review finding 2.

## 1. Admin review page rework — the main fix

niyams.approval_mode defaults to 'auto', so in the intended configuration nearly
every submission is auto_approved. NiyamReviewPage loads
/v1/niyam-submissions/pending only, so those rows never render — which means the Q5
retroactive-rejection workflow, the entire reason the reject endpoint exists, is
unreachable from the admin panel.

Repoint it at GET /v1/admin/niyam-submissions with:
- Status tabs: Needs review (pending) | Recent (auto_approved + approved) | Rejected.
  Default to "Recent" — that is where the work actually is.
- Filters: student, niyam, date range.
- Cursor pagination ("Load more"), replacing the current limit=100 wall.
- Status pill per jp-design-system/preview/admin-status-badges.html.

## 2. Rejection window in the UI (finding 1, client half)

- Reject button disabled when the row's can_reject is false, tooltip "Rejection
  window closed — submissions can only be rejected within 30 days."
- Rows inside the window show a countdown chip ("12 days left") derived from
  reversal_window_expires_at. Never recompute 30 days client-side.
- Reject dialog: reason now required, min 20 chars, live character counter, submit
  disabled until valid. Surface ERR_NIYAM_REVERSAL_WINDOW_EXPIRED as a clear inline
  error, not a generic toast.

## 3. Mobile — badges and dates

- parent/niyams.tsx and student/niyams.tsx: streak badge row showing earned
  niyam_badges with locked/unlocked states and a badge_key → bilingual label map.
  Ladder: daily 7/14/30/60/100, weekly 4, monthly 3.
- Niyam cards show the date range when end_date is set, plus an "Ends in N days" chip.
- niyam-submit.tsx: current streak and next milestone above the submit button
  ("3 more days to your 7-day badge").
- On a submission that earns a badge, show the celebration state — the API response
  now returns newly awarded badges.

## 4. i18n
Every new string in EN and HI. Jain terms stay untranslated: Pathshala, Punya,
Guruji, Sanchalak, Niyam, Shivir.

## Verify — screenshots
- Admin review page, "Recent" tab, auto_approved rows with countdown chips
- Reject dialog with character counter and disabled submit
- An over-30-day row: disabled button + tooltip
- Mobile niyams screen with the badge row
- Walk through: a Sanchalak finds and rejects a 5-day-old auto-approved submission

pnpm --filter @workspace/jain-pathshala run typecheck

Commit: fix(niyam): admin review rework, rejection window UI, streak badges on mobile
````

---

## Part 4 — After the four prompts

- **Finding 20 — offline queue.** No MMKV queue, `client_op_id` or `sync_operations` table exists anywhere in the repo. Cross-cutting mobile + API build touching attendance and shivir scans too. Own prompt.
- **Spec amendments.** `FullSpec_v4 §8.5` and `PersonaFeatures.md:58` need updating to decision D1. `CLAUDE.md` should gain Q-entries for the badge ladder and the 1h signed-URL TTL.
- **Reconciliation job.** `punya.reconcile` is in the spec's queue list with no implementation. Once `reversal_of` exists (N1), a nightly re-aggregation of the ledger into `punya_balances` is straightforward — and would have caught finding 4 in production.
