# Code review — Niyam module

**Date:** 2026-08-15
**Structure:** persona → navigation → action → observed vs expected
**Prior art:** [`claude/QuizModule_CodeReview_v2_2026-08-15.md`](./QuizModule_CodeReview_v2_2026-08-15.md) (same format)

## Scope reviewed

| File | Lines |
|---|---|
| `apps/api-server/src/routes/v1/niyam-submissions.ts` | 1,110 |
| `apps/api-server/src/services/niyam-approve.ts` | 245 |
| `apps/api-server/src/services/niyam-submit-sync.ts` | 102 |
| `apps/api-server/src/lib/niyam-{audience,badges,completion-rate,constants,period,points}.ts` | 469 |
| `apps/api-server/test/niyam-submissions.test.ts` | 1,658 (40 cases) |
| `apps/api-server/test/me-niyams.test.ts` | 151 (3 cases) |
| `apps/jain-pathshala/src/pages/admin/NiyamReviewPage.tsx` | 599 |
| `apps/jain-pathshala-mobile/components/NiyamReviewScreen.tsx` | 729 |
| `apps/jain-pathshala-mobile/components/NiyamProofPicker.tsx` | 715 |
| `apps/jain-pathshala-mobile/app/niyam-submit.tsx` | 430 |
| `apps/jain-pathshala-mobile/app/{parent,student}/niyams.tsx`, `niyam-submissions.tsx`, `shikshak/niyams.tsx` | 456 |
| `apps/jain-pathshala-mobile/components/Niyam{ListRow,CatalogEntry,BadgeRow,Proof,SubmissionsList}.tsx` | 633 |
| `lib/db/src/schema/niyams.ts` | 178 |
| `lib/db/migrations/000{5,6,7}, 0015, 006{1,2}_*.sql` | 526 |

**Also read for cross-checks:** `routes/v1/me.ts`, `routes/v1/admin-modules.ts` (niyam + punya-config CRUD), `routes/v1/admin-resources.ts` (admin listings), `routes/v1/gallery.ts` (Q6 consent join), `services/sync-batch.ts`, `lib/{punya,scope,route-helpers,notify,audit,file-tokens,owned-upload}.ts`, `lib/centre-monthly-report.ts`, `apps/jain-pathshala/src/pages/admin/AdminListPages.tsx` (`NiyamsPage`, `AddNiyamDialog`, `PunyaConfigsPage`, `PunyaAuditTable`), `sidebar-nav.ts`, `QuickActions.tsx`, `lib/offline/{queue-keys,drain,sync-engine}.ts`, `lib/queries.ts`, `lib/db/src/seed.ts`, all 68 files in `lib/db/migrations/`.

---

## Summary

The **request-path** Niyam module is the best-engineered thing I have read in this repo. The submit transaction (`niyam-submissions.ts:520-619`) takes an advisory lock, re-checks the period inside the transaction, and composes the Punya award, gallery insert, streak recompute and badge ladder into one commit, with audit and push strictly post-commit. `approveNiyamSubmission` claims on `status='pending'` before awarding. Reversal re-reads status, `created_at` and `points_awarded` *inside* the transaction so the Q5 window cannot race a day-boundary tick. Q12 is implemented exactly as written, including `can_decide` on the list so the client can grey out what it cannot decide. Q6's query-time consent join is intact. Forty tests cover concurrency, the 29-day/31-day window boundary, badge idempotency across day 7 and day 8, cross-user proof URLs, and streak lapse.

Three things sit outside that request path, and all three are serious.

**The module's schema is not in the migration chain.** `period_key`, `last_period_key`, the entire `niyam_submission_media` table, `niyams.approval_mode` / `max_uploads` / `proof_required` / `scope` / `state_id` / `city_id` / `msv_audience`, three enums, and the `niyam_submissions_niyam_student_period_uq` index appear in `lib/db/src/schema/niyams.ts` and in `meta/0009_snapshot.json` — and in **none** of the 68 `.sql` files. They were applied with `drizzle-kit push`. A fresh `pnpm db:migrate` (the command CLAUDE.md documents) produces a database on which every niyam submit throws *column "period_key" does not exist*. The stale baseline index on `submission_date` is still there, and it enforces the wrong grain for weekly and monthly niyams.

**The offline sync handler is a second, broken implementation of submit.** `applyNiyamSubmission` marks a submission `auto_approved` and then awards **nothing** — no Punya, no `points_awarded`, no streak, no badge, no gallery, no media rows, no duplicate check, no rate limit, no date-window check, and no proof-ownership check. Its authorization test is `["shikshak","sanchalak","city_admin","state_admin"].includes(role)` with no centre or batch comparison, so **any Guruji in the country can mint a submission for any student in the country** — occupying that child's period slot so the real parent gets a 409. CLAUDE.md's offline-sync spec says in bold that each `op_type` handler must call the same service method as the online endpoint. It has zero tests. The mobile app never enqueues into `jp.queue.niyam_submissions`, so the queue is dead on the client and live-but-wrong on the server.

**Award points are read from an unconstrained global config any city_admin can write.** `resolveNiyamAwardPoints` prefers a `punya_configs` row keyed `niyam_submission` over the per-niyam `points` an admin actually typed. `POST /v1/admin/punya/configs` takes a free-text `feature_key`, always writes a **global** row (it cannot set `city_id`), is open to `city_admin`, has no scope check, and writes no audit entry. `punya_configs` has no unique constraint, and the resolver reads `.limit(1)` with no `ORDER BY`. One city administrator typing `niyam_submission` into a text box silently and unauditably re-prices every niyam in India.

Separately, and a product problem rather than a bug: `approval_mode` defaults to `'auto'`, and the mobile review screen lists **only** `status='pending'`. The repo's own rule file says *"any admin surface that lists only pending rows is broken by definition."* The web panel has Open / Approved / Rejected tabs. Mobile — the surface Q12 mandates for the Sanchalak — has one hardcoded status and will be permanently empty on a default-configured platform.

**Verdict: Request changes.** C1 blocks any clean deployment. C2 should be fixed or the op type disabled before the next release.

---

## Findings index

Severity is by blast radius × likelihood, not by how hard the fix is.

### Critical

| ID | Finding | Where |
|---|---|---|
| **C1** | The whole post-baseline Niyam schema is `push`-only — absent from every `.sql` migration | `lib/db/migrations/*.sql` (68 files) vs `lib/db/src/schema/niyams.ts` |
| **C2** | `/v1/sync/batch` niyam handler is a parallel implementation: awards nothing, validates nothing, and admits any staff role for any student | `services/niyam-submit-sync.ts:44-98`; `sync-batch.ts:352-390,728` |
| **C3** | Niyam award points resolve from a global `punya_configs` row any city_admin can create, unaudited, unconstrained, unordered | `lib/niyam-points.ts:39-73`; `admin-modules.ts:662-683` |

### High

| ID | Finding | Where |
|---|---|---|
| **H1** | Mobile review lists only `pending`; with `approval_mode='auto'` as the default the Sanchalak's mandated queue is empty by construction | `niyam-submissions.ts:744`; `NiyamReviewScreen.tsx:415` |
| **H2** | Web review renders Approve/Reject on rows the caller cannot decide — `/v1/admin/niyam-submissions` returns no `can_decide` | `admin-resources.ts:419-443`; `NiyamReviewPage.tsx:578-589` |
| **H3** | Badge Punya is an inlined `25` under `feature_key='niyam_badge'`, a key absent from `punya_features` (AT21) | `lib/niyam-badges.ts:17,75`; `seed.ts:161-173` |
| **H4** | Rejection reverses the submission award but never the badge bonus it triggered | `niyam-submissions.ts:1015-1045` vs `lib/niyam-badges.ts:72-82` |
| **H5** | No notification on approval, and none to the reviewer that a queue exists | only `niyam_rejected` + `niyam_badge` are ever sent |
| **H6** | Yesterday's niyam can never be submitted — no client sends `submission_date` | `lib/niyam-period.ts:14`; `app/niyam-submit.tsx:107-113` |
| **H7** | Niyams cannot be edited from the admin panel — only `is_active` is ever PATCHed | `AdminListPages.tsx:747` vs `admin-modules.ts:572-586` |
| **H8** | `niyam_submissions.is_featured` is rendered as a "Featured" chip but written only by the seed | `NiyamSubmissionsList.tsx:66`; `seed.ts:855` |
| **H9** | Pending and rejected submissions render `+0` — the `!= null` guard can never fire | `NiyamSubmissionsList.tsx:118,128`; `schema/niyams.ts:69` |
| **H10** | A Punya reversal renders as `+-10` in the admin ledger | `AdminListPages.tsx:934` |
| **H11** | The `+N` pill the child sees is `niyams.points`, not the points actually awarded | `app/niyam-submit.tsx:245`; `lib/niyam-points.ts:56,70` |
| **H12** | `jp.queue.niyam_submissions` is declared, ordered, mapped and drained — and never written | `lib/offline/queue-keys.ts:8,23,36`; `sync-engine.ts` (no `enqueueNiyam*`) |
| **H13** | No Hindi description field; a missing Hindi title is silently stored as the English one | `AdminListPages.tsx:572-586`; `admin-modules.ts:545` |
| **H14** | No `start_date` / `end_date` authoring — time-boxed niyams are unreachable and two mobile labels are dead | `AdminListPages.tsx:572-586`; `NiyamCatalogEntry.tsx:22-23` |

### Medium

| ID | Finding | Where |
|---|---|---|
| M1 | Q5 divergence: `pending` is exempt from the 30-day window in code, not in CLAUDE.md | `lib/niyam-constants.ts:22` |
| M2 | `GET /me/niyam-catalog` without `student_id` applies no audience filter; `GET /admin/niyams` has no scope filter and no limit | `me.ts:462`; `admin-resources.ts:283-308` |
| M3 | "Niyam completion rate" is an approval rate — pending rows sit in the denominator | `lib/niyam-completion-rate.ts:29-40` |
| M4 | The parent's own submission list has no cursor and no deterministic tiebreak | `me.ts:350,368` |
| M5 | The catalog is unpaginated, ordered by points desc, with three fan-out queries | `me.ts:490,507-545` |
| M6 | Cancelling a half-filled submission orphans already-uploaded proof media, with no confirmation | `app/niyam-submit.tsx:72-76,351-355` |
| M7 | `?student_id=` deep link into mobile review filters client-side over loaded pages only | `NiyamReviewScreen.tsx:424-428` |
| M8 | Web reject reason is a single-line input with no presets; mobile has multiline + three bilingual presets | `NiyamReviewPage.tsx:309` vs `lib/niyam-reject-reason.ts:8-21` |
| M9 | Rejection is terminal — Punya reversed, streak broken, gallery item `deleted_at`-ed, no undo | `niyam-submissions.ts:1050-1060` |
| M10 | Tapping a catalog row opens the submit screen with nothing selected, under copy that says "Tap a Niyam" | `app/student/niyams.tsx:90,154` |
| M11 | `PunyaConfigsPage` free-texts the feature key, hides `city_id`, and offers no edit or delete | `AdminListPages.tsx:827-894`; `admin-resources.ts:448-459` |
| M12 | Zero tests for the sync path, the points-resolution path, or catalog audience filtering | `test/` |

### Low

| ID | Finding | Where |
|---|---|---|
| L1 | Notes field has no `maxLength`; >500 chars surfaces the generic "Invalid submission data." | `app/niyam-submit.tsx:282-303`; `niyam-submissions.ts:406` |
| L2 | Mobile review checkboxes, thumbs and filter chips carry no `accessibilityRole` / `accessibilityLabel` | `NiyamReviewScreen.tsx:270-289,706` |
| L3 | Web proof image is `alt=""` — the proof *is* the content | `NiyamReviewPage.tsx:146-149` |
| L4 | Web review date filters are read in the browser's timezone with no IST label | `NiyamReviewPage.tsx:499,503` |
| L5 | Student filter caps at 500, niyam filter unbounded, no truncation indicator | `NiyamReviewPage.tsx:367,370` |
| L6 | Raw palette classes (`amber-*`, `emerald-*`, `sky-*`) instead of design tokens | `NiyamReviewPage.tsx:100,102,561` |
| L7 | No bulk approve on web; mobile has it | `NiyamReviewPage.tsx` (absent) vs `NiyamReviewScreen.tsx:451-492` |
| L8 | Zod failures are swallowed — the envelope's `details[]` is never populated | `niyam-submissions.ts:406,821,933` |
| L9 | `runNiyamStreakLapse` skips rows with `last_period_key IS NULL`, so pre-`period_key` rows never lapse | `niyam-submissions.ts:287` |
| L10 | `STREAK_RECOMPUTE_LOOKBACK_DAYS = 400` is not type-aware — ~13 periods for a monthly niyam | `lib/niyam-period.ts:23`; `niyam-submissions.ts:164` |

---

## Persona walkthrough

The requested spine. Each row is one concrete journey. **Ref** links to the findings index.

### 1. Guest 🌐

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Public site → Punya Wall | See children's niyam photos | Works and is correct. `GET /v1/gallery` (`gallery.ts:117`) is genuinely public, and the Q6 consent join (`:144-157`) resolves `coalesce(parent_id, user_id) → users.gallery_visibility_opt_in` at query time. Featuring never overrides opt-out. Payload is minimised to first name + age group | ✅ Nothing to change. This is the reference implementation of Q6 | — |
| Anywhere | Reach a niyam route | `router.use(requireAuth)` covers `/v1/niyam-submissions` (`:66`) and `/v1/me` (`me.ts:51`). No public catalog | ✅ | — |

**Verdict: clean.**

---

### 2. Student (13+, student view) 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Tabs → **Niyams** | Open the screen | Works. `/student/niyams` renders the last 2 submissions plus the full catalog with streak line and badge chips (`NiyamCatalogEntry.tsx`). Genuinely nice screen | ✅ | — |
| Niyams list | Read a card in Hindi | `title_hi ?? title_en` at every render site. But `POST /v1/admin/niyams` stores `title_hi = title_en` when the field is blank (`admin-modules.ts:545`) and the column is `NOT NULL` — so the fallback never fires, the child reads English inside a Hindi UI, and nothing anywhere flags the gap | Store `null` when Hindi is absent, or add a **Hindi missing** badge on the admin table. `description_hi` has no input at all | **H13** |
| Catalog | Read the points on a card | `+{row.points}` — the niyam's authored value. The award is `resolveNiyamAwardPoints` (`niyam-points.ts:39`), which prefers a `punya_configs` row. With any config present the pill is wrong. For an `approval_mode='review'` niyam the pill says `+10` and the submission awards `0` until a Guruji acts, with no "on approval" qualifier | Return the resolved value from the API; qualify review-mode points | **H11**, C3 |
| Catalog → tap a Niyam | Pick it | Routes to `/niyam-submit` with **nothing preselected** (`student/niyams.tsx:154`), under copy reading *"Tap a Niyam — streak and badges appear below"* / *"नियम चुनें"*. The child taps their niyam and lands on a blank picker | Pass the id through and preselect | M10 |
| Submit screen | Attach proof, submit | Solid. `NiyamProofPicker` handles photo/video/audio with size guards, an upload-in-progress gate, and the server re-derives `kind` from `upload_objects.content_type` (`niyam-submissions.ts:95-147`) — a client claiming `photo` for an MP4 is rejected, and there is a test for it | ✅ Best-in-repo media handling | — |
| Submit screen | Change their mind, tap **Cancel** | Every uploaded file is discarded with no confirmation (`niyam-submit.tsx:72-76`). The objects are already in `niyam-proof/` and nothing reaps them — `media.cleanup_unfinalized` is a tick stub per CLAUDE.md | Confirm before discarding; make the cleanup job real | M6 |
| Submit at 00:05 IST for yesterday's practice | Submit | Impossible. `SUBMISSION_BACKDATE_DAYS = 1` and the API accepts `submission_date` (`:385`), but no client on any surface ever sends it. The documented *"late evening catch-up across midnight"* is unreachable, and a niyam kept yesterday is lost | Add a "Yesterday" toggle on the submit card; it is one field | **H6** |
| Submit on a bus with no signal | Submit | *"Could not submit your niyam."* and the entry is gone. `useSubmitNiyam` (`queries.ts:1575`) POSTs directly with no queue fallback, and `jp.queue.niyam_submissions` — declared, drain-ordered and op-type-mapped — has no writer anywhere in the app | Add `enqueueNiyamSubmission` alongside the six that exist, then fix the server handler (**C2**) before wiring it up | **H12** |
| Niyams list, after submitting for review | See where it stands | The row shows **`Pending  +0`**. The `points_awarded != null` guard (`NiyamSubmissionsList.tsx:118`) can never be false — the column is `NOT NULL DEFAULT 0` and the shared contract types it `z.number()` | Render the pill only for awarded statuses, or show `—` | **H9** |
| Niyams list | See a "Featured" niyam | Never. `is_featured` is projected into three API payloads and rendered as a *Featured / विशेष* chip, but no production code path writes it — only `seed.ts:855`. Real featuring lives on `gallery_items.featured_gallery` | Drive the chip from the gallery row, or drop the column | **H8** |
| Niyams → **View all** | Scroll their history | Caps at 40 rows (`me.ts:350`), no cursor, and `ORDER BY submission_date DESC` with no id tiebreak — rows on the same date reorder between fetches. Both *admin* surfaces have proper keyset cursors; the child's own does not | Mirror `encodeSubmissionCursor` from `niyam-submissions.ts:348` | M4 |
| Their submission is approved | Learn about it | Nothing arrives. `notifyUsers` is called for `niyam_rejected` and `niyam_badge` only. A `review`-mode submission approved by a Guruji is silent unless it happens to complete a badge | Send a `niyam_approved` push with the points awarded | **H5** |

---

### 3. Parent — Abhivaavak 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home → Quick actions → **Submit Niyam** | Switch child, submit on their behalf | Works. `ChildSwitcher` scopes the screen, the form resets on `activeStudentId` change (`niyam-submit.tsx:66-70`) so one child's media can never be posted against another, and the server re-checks ownership via `ownedStudentId` (`:408`) which excludes soft-deleted and inactive students (Q11) | ✅ Careful, deliberate code | — |
| Submit | Post an MSV-only niyam for a non-MSV child | 403. `studentCanAccessNiyam` is re-run server-side on submit (`:451-468`), not just at catalog time — exactly what the module's own rule file demands | ✅ | — |
| Submit twice in one week (weekly niyam) | Second attempt | 409 `ERR_NIYAM_PERIOD_DUPLICATE` with a type-aware bilingual message (`niyam-submit.tsx:32-46`). Advisory lock + in-transaction re-check; a concurrency test proves one winner | ✅ at the app layer. ⚠️ The DB index that is supposed to back this is keyed on `submission_date`, not `period_key` — see **C1** | **C1** |
| Niyams tab | See why a submission was rejected | `rejection_reason` renders inline, and the reject path pushes a bilingual `niyam_rejected` notification honouring `preferred_language` (there is a Devanagari test) | ✅ | — |
| Punya ledger | Reconcile the points | `feature_key` shows `niyam_submission` / `niyam_badge`, neither of which is a row in `punya_features` (`seed.ts:161-173` registers only `niyam_completion`). The parent sees a raw key with no label, and per-feature reporting has nothing to join to | Register both in the catalogue with labels and bounds | **H3** |
| Anywhere | Have their child's niyam points changed under them | Possible and untraceable. A city_admin creating a global `punya_configs` row re-prices every niyam nationwide with no audit entry (`admin-modules.ts:669-683`), and `resolveNiyamAwardPoints` picks a row with `.limit(1)` and no `ORDER BY`, so with two rows the winner is whatever the planner returns | Scope the route, add `city_id`, add a unique index on `(feature_key, city_id)`, add an audit write, and order the read | **C3** |
| Settings → gallery visibility | Opt out after a photo is already on the wall | Instant. `PATCH /v1/me/gallery-visibility` sets one flag; visibility is a join at read time (`gallery.ts:152-157`). No backfill, no per-item job | ✅ Q6 exactly as specified | — |

---

### 4. Shikshak — Guruji / Didi 📱🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home → Quick actions → **Niyam review** | Open the queue | Reachable (`QuickActions.tsx:55`). The screen is good: infinite scroll, batch and type filters persisted to AsyncStorage, bulk approve behind a confirm, a reject sheet with three bilingual presets and a live character counter | ✅ | — |
| Niyam review | Find anything to review on a default platform | **Empty forever.** `GET /pending` hardcodes `status='pending'` (`:744`) and `niyams.approval_mode` defaults to `'auto'`. The repo's own rule file: *"Retroactive rejection is the primary admin workflow… any admin surface that lists only pending rows is broken by definition."* The web panel got Open/Approved/Rejected tabs; mobile did not | Give `GET /pending` a `status[]` parameter and mirror the web tabs. Q12 makes this the Sanchalak's safety-net surface | **H1** |
| Niyam review | Act on another Guruji's batch | Correctly refused. `can_decide` comes back false, the row dims, the checkbox is disabled, and the copy explains *"This student is in another Guruji's batch"*. `inBatchWriteScope` gates approve, bulk-approve and reject server-side (`niyam-approve.ts:132`, `niyam-submissions.ts:960`) while `GET /pending` stays centre-scoped | ✅ Q12 implemented exactly, and tested (`niyam-submissions.test.ts:1538`) | — |
| Deep link `…/niyam-review?student_id=X` | Review one child | Often *"No pending Niyams to review."* The filter is applied client-side over already-loaded pages (`NiyamReviewScreen.tsx:424-428`), so a row on page 3 is invisible until someone scrolls | Push `student_id` into the query string — the API takes it on the admin route already | M7 |
| Review | Reject a 40-day-old auto-approved submission | Correctly refused with `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED`, the button pre-disabled from `can_reject`, and the window re-evaluated *inside* the transaction so a day-boundary tick cannot race it. Tested at 29 and 31 days | ✅ Q5, done properly | — |
| Approve a submission | Watch the ledger | Award, gallery insert, streak recompute and badge ladder all commit with the status claim; audit and push are post-commit and never fail the approve. `awardPunya` uses `ON CONFLICT DO NOTHING … RETURNING` and moves the balance only by what was returned (AT20) | ✅ | — |
| Reject a submission that had earned a badge | Watch the ledger | The submission's points are reversed and the streak drops — but the badge's **25 Punya stay**. The badge itself surviving is a documented decision; its point bonus riding along is not discussed anywhere | Decide explicitly: either reverse the bonus with the award, or document that badge Punya is permanent. Today it is farmable — 7 submits, +25, reject the 7th | **H4** |
| Web sidebar → **Niyams** | Author a niyam | The nav admits shikshak (`sidebar-nav.ts:74`) but `POST/PATCH /v1/admin/niyams` is `requireRole("super_admin","state_admin","city_admin")`. The page handles it — `canAuthor` hides the dialog and prints *"Niyams are set by city administrators and above"* | ✅ Handled. ⚠️ `GET /v1/admin/niyams` has no scope filter and no limit, so a shikshak still reads every niyam in the country in one response | M2 |
| — (API, direct) | `POST /v1/sync/batch` with a `niyam_submission` op for a student in another city | **200.** `applyNiyamSubmission`'s ownership test is `["shikshak","sanchalak","city_admin","state_admin"].includes(role)` (`:44-48`) with no centre, batch, city or state comparison. The row is written `auto_approved` with 0 points, no media, no streak, and it **occupies that child's period slot** — so their parent's real submission returns 409. `proof_asset_id` goes straight into `proof_url` with no `resolveOwnedUpload` check, so another user's `/uploads/` URL is stored and then signed and served back by the review and parent endpoints | Delete `niyam-submit-sync.ts` and route the op through the same service the HTTP endpoint uses, per CLAUDE.md offline-sync §4. Until then, reject the op type | **C2** |
| Mobile → Punya standings | See a student's niyam Punya | Renders `niyam_submission` / `niyam_badge` raw — neither key exists in `punya_features` | **H3** | **H3** |

---

### 5. Sanchalak — centre head 🖥📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Mobile → Manage → **Niyam review** | Open the queue | Present (`QuickActions.tsx:69` → `app/admin/niyam-review.tsx`). Q12's *"niyam review MUST be available to the sanchalak persona on mobile, not web-only"* is satisfied | ✅ The one Q12 requirement most likely to have been missed, and it was not | — |
| Same screen | Clear a batch nobody is assigned to | Works — `resolveAdminScope` returns `batchIds: null` for sanchalak, so `inBatchWriteScope` falls back to centre membership. The safety net functions | ✅ | — |
| Same screen | Actually see anything | Same empty queue as the Guruji. On an auto-approve platform the safety net has nothing to catch, and the only surface that shows auto-approved work is the web panel | **H1** | **H1** |
| Web → Niyam Review → **Open** | Reject an auto-approved submission for a child outside their centres | Not shown — `/v1/admin/niyam-submissions` is centre-scoped via `scopedCentreFilter` | ✅ | — |
| Web → Niyam Review | Approve a pending row | Works, and correctly limited by `inBatchWriteScope`. But the admin listing returns no `can_decide`, so the button renders on rows outside write scope and fails with a bare *"Submission not found."* toast | Return `can_decide` from `/v1/admin/niyam-submissions` and gate the button, as mobile does | **H2** |
| Monthly centre report | Read "Niyam completion" | Misleading. The rate is `approved + auto_approved` over **all** submissions (`niyam-completion-rate.ts:31-32`), so pending rows depress it and an unworked queue reads as low compliance. A centre where no child submits at all shows *"n/a — no submissions"*, not 0% | Report submissions-per-enrolled-student, or at minimum exclude `pending` from the denominator and name the metric "approval rate" | M3 |

---

### 6. City Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Sidebar → **Niyams** → New niyam | Author a city niyam | Works, and the scope picker is correctly narrowed per role (`AdminListPages.tsx:535-540`) matching `authorizeNiyamGeo` server-side. `points` is validated against `punya_features.niyam_completion` bounds | ✅ | — |
| Same dialog | Enter the Hindi description | **No field exists.** `title_hi` is there; `description_hi`, `start_date` and `end_date` are not sent at all (`:572-586`). So every web-authored niyam runs forever from today, and `dateRangeLabel` / `endsInDaysLabel` on the mobile catalog card are permanently dead code | Add all three. Time-boxed niyams (Paryushan, a monthly sankalp) are the obvious use case and are unreachable | **H13**, **H14** |
| Niyams list → a niyam with a typo in its title | Fix it | **No edit control.** The only mutation the page performs is `apiPatch(…, { is_active: next })` (`:747`), even though the API accepts title, descriptions, points, proof type, approval mode, max uploads, audience and dates. The only remedy is to disable and re-create — which orphans every submission, streak and badge against the old id | Build the edit dialog. The endpoint is already there | **H7** |
| Punya configs → **New config** | Set niyam points for their city | Types `niyam_submission` into a free-text box and gets a **global** row — the route cannot set `city_id` (`admin-modules.ts:673-677`). Every niyam in the country now awards that number instead of its authored `points`. No audit entry. The list view does not show `city_id`, so nobody can tell afterwards | Add `city_id` to the schema and default it to the caller's city; block global writes below super_admin; audit it; add `UNIQUE (feature_key, city_id)` | **C3**, M11 |
| Punya ledger | Review a niyam rejection | The reversal row renders as **`+-10`** — `AdminListPages.tsx:934` prefixes a hardcoded `+` to a signed value | Format by sign | **H10** |
| Niyam Review → filter by student | Find a child | The dropdown is `?limit=500` with no search and no truncation indicator; the niyam dropdown is unbounded | Type-ahead against the API | L5 |
| Niyam Review | Read the table | Three raw palette classes remain — `amber-500/10 text-amber-700` (`:100`), `emerald-500/10 text-emerald-700` (`:102`), `sky-500/10 text-sky-700` (`:561`). The same `emerald-*` finding was raised and fixed in the Quiz module | Use the tokens | L6 |
| Niyam Review | Reject with a reason | Single-line `<Input>`, no presets, minimum 20 characters typed by hand every time. Mobile has a multiline field and three bilingual presets in a shared module | Import `REJECT_REASON_PRESETS` — it is already shared-shaped | M8 |
| Niyam Review | Approve 30 rows | One at a time. `bulk-approve` exists, is scope-checked, is audited and is tested — and only mobile calls it | Wire the web page to it | L7 |

---

### 7. State Admin 🖥

Inherits every City Admin row. State-specific:

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Niyams → New niyam → scope `city` | Pick a city outside their state | 403. `POST /v1/admin/niyams` resolves the city's `state_id` and checks it against `cityIdsForState` (`admin-modules.ts:507-517`), and the dialog pre-filters the city list to their state | ✅ | — |
| Niyams → a national niyam | Disable it | 403 *"You cannot update national niyams."* The `canToggleNiyam` helper hides the switch client-side too | ✅ | — |
| Anywhere | Read the audit trail for niyam authoring | Create and update both write audit entries (`admin-modules.ts:562,650`), as do approve, bulk-approve and reject. Only the punya-config write — the one that silently re-prices niyams — writes nothing | Add `auditFromReq` to `POST /v1/admin/punya/configs` | **C3** |
| Niyam Review → date range | Filter by month | `type="date"` inputs read in the browser's timezone with no IST label, on a module whose period keys are all `Asia/Kolkata` | Label the fields and convert explicitly | L4 |

---

### 8. Super Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Deploy → `pnpm db:migrate` on a fresh database | Start the platform | **The Niyam module does not work at all.** Across all 68 `.sql` migrations there is no `period_key`, no `last_period_key`, no `niyam_submission_media` table, no `niyam_media_kind_enum` / `niyam_approval_mode_enum` / `niyam_scope_enum` / `niyam_msv_audience_enum`, and no `approval_mode` / `max_uploads` / `proof_required` / `scope` / `state_id` / `city_id` / `msv_audience` on `niyams`. They exist only in `lib/db/src/schema/niyams.ts` and `meta/0009_snapshot.json` — applied by `drizzle-kit push`. Every submit throws *column "period_key" does not exist* | Generate the missing migration and check it in. `pnpm db:migrate` is the documented path; `push` is not | **C1** |
| Same | Rely on the period-uniqueness guarantee | The only unique index a migration creates is the baseline's `niyam_submissions_niyam_student_date_uq` on `(niyam_id, student_id, submission_date) WHERE status <> 'rejected'` (`0000_baseline.sql:1036`). For a **weekly or monthly** niyam that is the wrong grain — two submissions on different dates in the same week both pass. The advisory lock is the only real defence, and the schema's `…_period_uq` never ships | Add the period index, drop the date one, in the same migration | **C1** |
| Same | Create a niyam with `proof_type: 'audio'` | The API and the mobile picker both handle `audio` and `any`, but `proof_type_enum` in the migration chain is `('photo','video','either')` and no `ALTER TYPE` adds the others | Same migration | **C1** |
| Punya configs page | See what niyams actually pay | The page lists `feature_key` and `points` with no `city_id` and no edit or delete, and the API projection omits `city_id` entirely (`admin-resources.ts:448-459`). A global default and a city override are indistinguishable | Surface `city_id`; add edit/delete | M11 |
| Punya features page | Tune the badge bonus | Not possible. `NIYAM_BADGE_BONUS_POINTS = 25` is a TypeScript constant (`lib/niyam-badges.ts:17`), and `niyam_badge` is not a `punya_features` row, so it has no min/max bounds either. AT21: *"Attendance point values resolve from `punya_features` at award time… Never inline a constant"* — the same principle applies here | Register `niyam_submission` and `niyam_badge` in the catalogue and resolve the bonus from config | **H3** |
| Anywhere | See how many niyams exist | `GET /v1/admin/niyams` returns the entire table in one unpaginated response, ordered by points desc, with no scope filter | Paginate | M2 |
| Read the spec | Reconcile Q5 | `canRejectSubmission` returns `true` for `pending` regardless of age (`niyam-constants.ts:22`). That is the right call — a pending row has awarded nothing, and gating it would strand a stale queue item forever — but CLAUDE.md Q5 says 30 days with no exception, and only the `.cursor` rule file records the carve-out | Move the exemption into CLAUDE.md Q5 so it is authoritative | M1 |

---

## Test gaps

40 cases in `niyam-submissions.test.ts` plus 3 in `me-niyams.test.ts`. Covered genuinely well: concurrent submits, the 29/31-day window boundary, pending-beyond-30-days, badge idempotency across day 7 and day 8, streak lapse and recompute, MSV audience refusal, start/end window, cross-user proof URLs, derived media kind vs. a lying client, bilingual push copy, gallery create + Q5 hide, bulk-approve scope mixing, and the Q12 shikshak/sanchalak split.

Not covered at all:

- **The entire sync path.** No test file mentions `niyam_submission` as a `/v1/sync/batch` op. The authorization hole in **C2** would be caught by a single case: a shikshak posting a niyam op for a student in another centre.
- **Points resolution.** No test asserts that a city `punya_configs` row overrides the global one, that a global row overrides `niyams.points`, or that the fallback to `niyams.points` fires when neither exists. **C3** ships unnoticed because nothing exercises `resolveNiyamAwardPoints` past its default branch.
- **Catalog audience filtering.** `GET /v1/me/niyam-catalog` has no test at all — neither the `studentNiyamAccessWhere` SQL path nor the fact that omitting `student_id` disables it (M2). The JS predicate `studentCanAccessNiyam` and its SQL twin have no agreement test, the way `quiz-scope.ts` does.
- **Badge Punya reversal.** `niyam-submissions.test.ts:867` asserts the badge *survives* a rejection; nothing asserts what happens to its 25 points (**H4**).
- **Migration integrity.** Nothing runs the migration chain from zero and asserts the schema matches `lib/db/src/schema`. That single check is what makes **C1** invisible.

---

## What looks good

- **The submit transaction** (`niyam-submissions.ts:520-619`) — advisory lock keyed on `niyam:student:period`, in-transaction duplicate re-check, then award + gallery + streak + badges composed into one commit, with audit and push strictly outside it. The comments explain *why*. This is the best-shaped write path in the repo.
- **The reject transaction** (`:969-1063`) — re-reads `status`, `created_at` and `points_awarded` inside the transaction specifically so the Q5 window and the reversal amount cannot race a concurrent approve or a day-boundary tick, with a comment saying exactly that. The `UPDATE … WHERE status IN (…) RETURNING` claim makes it exactly-once.
- **Server-derived media kind** (`:95-147`). The client's `kind` is accepted on the wire and thrown away; the real kind comes from `upload_objects.content_type`, and the URL must be an upload the *caller* owns, under `niyam-proof/`. A client claiming `photo` for an MP4 is rejected, and there is a test.
- **Q12** — `inBatchWriteScope` on approve, bulk-approve and reject; centre scope preserved on the list; `can_decide` returned so the client can grey out rather than fail; and the Sanchalak's mobile entry point actually shipped in the same release, as the rule demands.
- **Q6** — the query-time consent join, unchanged and correct, with a test that proves featuring cannot override opt-out.
- **`recomputeStreak`** (`:157-263`) — the lapse check at `:230-239` is subtle and right: the walk's tail is stale if the child stopped submitting, so a streak is alive only if its last period is the current or immediately previous one. `longest_streak = max(stored, recomputed)` means a rejection can never lower a peak already reached.
- **`runNiyamStreakLapse`** (`:272-315`) — cursor-batched by id, one grouped `UPDATE` per batch, no per-row recompute. Exported so tests can run it without the scheduler.
- **Bilingual rejection copy** — presets in both languages in a shared module, `preferred_language`-aware push, and a test asserting Devanagari lands in the notification row.

---

## Recommended order of work

1. **C1** — generate and check in the missing migration: `period_key`, `last_period_key`, `niyam_submission_media` + its enum, the four `niyams` columns and three enums, `ALTER TYPE proof_type_enum ADD VALUE 'audio'/'any'`, create `niyam_submissions_niyam_student_period_uq`, drop `niyam_submissions_niyam_student_date_uq`. Then add a CI step that migrates from zero and diffs against `lib/db/src/schema`. **Nothing else on this list matters if a fresh environment cannot be built.**
2. **C2** — delete `services/niyam-submit-sync.ts` and route the `niyam_submission` op through the same service `POST /v1/niyam-submissions` uses, per CLAUDE.md offline-sync §4. Add the six negative tests (out-of-scope actor, duplicate period, foreign proof URL, no-award-on-review, replay, media rows). If that cannot land this cycle, reject the op type outright — it awards nothing today and only creates junk.
3. **C3** — scope `POST /v1/admin/punya/configs` (add `city_id`, default it to the caller's city, block global writes below super_admin), add `UNIQUE (feature_key, city_id)`, add the audit write, order the resolver's reads, and surface `city_id` in the list.
4. **H3 + H4** — register `niyam_submission` and `niyam_badge` in `punya_features`; resolve the badge bonus from config; decide and document whether badge Punya reverses with the award.
5. **H1 + H2** — `status[]` on `GET /pending` and the Open/Approved/Rejected tabs on mobile; `can_decide` on `/v1/admin/niyam-submissions` and gate the web buttons. These are the two that decide whether the review workflow works at all on a default-configured platform.
6. **H7 + H13 + H14** — the niyam edit dialog, plus `description_hi`, `start_date` and `end_date` on both create and edit. One piece of work; the endpoint already accepts everything.
7. **H8 + H9 + H10 + H11** — the four display bugs that make the ledger read wrong to a parent: dead `is_featured` chip, `+0` on pending, `+-10` on reversals, and the `+N` pill that is not the awarded value.
8. **H5 + H6 + H12** — approval notification, the "Yesterday" toggle, and the offline enqueue (after C2 lands).
9. **M1–M12**, then L. **M3** (the completion-rate definition) is worth pulling forward — it feeds the Sanchalak's monthly report and is currently misleading rather than merely imprecise.

---

## Note on stack drift

Unchanged from the Quiz review: this repo is Express + `apps/api-server` + `lib/db`, while SPEC.md targets NestJS + `apps/api` + `packages/shared`. Out of scope here and not counted against the module — but the AT20/AT21, audit, bilingual, offline-sync, design-token and error-envelope rules cited above are stack-independent and do apply.
