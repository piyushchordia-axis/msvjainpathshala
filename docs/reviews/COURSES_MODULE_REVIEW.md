# Code review — Courses module

**Date:** 2026-08-16
**Structure:** persona → navigation → action → observed vs expected
**Spec of record:** `docs/CURRICULUM_ENHANCEMENT.md` (CU1–CU33, resolved 2026-08-07)

## Scope reviewed

| File | Lines |
|---|---|
| `apps/jain-pathshala/src/pages/admin/CoursesAdminPage.tsx` | 1,602 |
| `apps/api-server/src/routes/v1/courses.ts` | 1,095 |
| `apps/api-server/src/routes/v1/admin-courses.ts` | 957 |
| `apps/api-server/test/courses.test.ts` | 902 |
| `apps/api-server/src/services/course-certify.ts` | 779 |
| `apps/api-server/src/services/course-progress.ts` | 595 |
| `apps/jain-pathshala-mobile/components/CourseTree.tsx` | 527 |
| `apps/api-server/test/course-certificates.test.ts` | 475 |
| `apps/jain-pathshala-mobile/components/CourseAdmin.tsx` | 459 |
| `apps/api-server/test/course-sync.test.ts` | 353 |
| `lib/db/migrations/0051_curriculum_courses.sql` | 348 |
| `apps/jain-pathshala-mobile/components/CourseBrowseOutline.tsx` | 299 |
| `apps/jain-pathshala-mobile/components/CourseLearnerRow.tsx` | 298 |
| `apps/jain-pathshala-mobile/components/CourseDetailScreen.tsx` | 291 |
| `apps/api-server/src/services/course-certificates.ts` | 274 |
| `apps/api-server/test/course-progress.test.ts` | 268 |
| `apps/api-server/src/services/course-admin.ts` | 253 |
| `apps/jain-pathshala-mobile/app/courses.tsx` | 207 |
| `apps/jain-pathshala/src/pages/public/CoursesPage.tsx` | 200 |
| `apps/api-server/src/services/course-templates.ts` | 176 |
| `apps/jain-pathshala-mobile/components/CourseLearnerOutline.tsx` | 170 |
| `apps/jain-pathshala-mobile/components/CourseFolderCard.tsx` | 169 |
| `apps/jain-pathshala/src/pages/public/CourseDetailPage.tsx` | 158 |
| `apps/jain-pathshala-mobile/hooks/useCourseSyncOps.ts` | 144 |
| `lib/db/migrations/0052_fn_course_progress.sql` | 127 |
| `apps/api-server/src/lib/course-points.ts` | 120 |
| `apps/api-server/src/lib/course-certificate-pdf.ts` | 114 |
| `apps/api-server/src/services/course-access.ts` | 109 |
| `apps/api-server/src/lib/course-progress.ts` | 88 |
| `apps/jain-pathshala-mobile/lib/course-progress-cascade.ts` | 84 |
| `apps/api-server/src/lib/course-visibility.ts` | 70 |
| `apps/api-server/src/jobs/course-certificate-pdf.ts` | 57 |
| plus mobile route files, `course-labels.ts`, migration `0058` | — |

**Also read for cross-checks:** `lib/db/src/schema/curriculum.ts`, `punya.ts`, `enums.ts`; `apps/api-server/src/lib/{scope,punya,audit,notify,roles,pdf,queues,sync-operations}.ts`; `routes/v1/{public,progress,certificates,sync}.ts`; `lib/api-zod/src/errors.ts`; `apps/jain-pathshala-mobile/lib/queries.ts` (course hooks, 2046–2336) and `lib/offline/*`; `apps/jain-pathshala/src/routes/AdminRoutes.tsx`, `components/admin/sidebar-nav.ts`; `components/QuickActions.tsx`.

---

## Summary

This is a large, carefully-built module and the hard parts are right. CU10's partial-index `targetWhere` — the "guaranteed day-one stumble" the spec warns about — is correct in all four upsert branches. CU28 is one SQL function with all three of its named fatal traps handled (`::numeric`, `LEFT JOIN`, leaf filter on the join). CU23's idempotency keys carry both the `revision` and the *triggering* section id, so re-certification after a correction mints rather than colliding. AT20's guarded insert is exact. CU17's three-branch honorific is correct on server, PDF and mobile, and tested. CU4's release-day landmine — every existing `curricula` row being `'active'` — is defused at `0051:106`. Q12's non-negotiable coupling holds: the sanchalak's mobile certification screen shipped alongside the shikshak gate.

Four things went wrong, and they cluster.

**Certification correction is destructive in two directions that cannot be undone.** `correctCourseCertification` computes `wasCourseComplete` before the update and then reverses the course bonus and voids the course certificate *regardless of node kind* (`course-certify.ts:629, 691`). Correcting a mis-starred **sub-section** — which carries no Punya at all under CU21 and is not part of CU25's course predicate — silently strips the student's entire course-completion bonus and flips their course certificate to `void`. Separately, `findExistingCertificate` (`course-certificates.ts:49-73`) has no `voided_at` filter, so when the Guruji re-certifies correctly, the voided row is returned, `created:false`, no PDF is enqueued and `voided_at` is never cleared. The partial unique indexes make inserting a replacement impossible. **The Punya comes back; the certificate reads `void` forever.** Each half lives in a different test suite and the two never meet.

**The offline layer reports loss as success.** Three independent sites: the `set` clause of every upsert writes `client_op_id: input.clientOpId ?? null, client_marked_at: input.clientMarkedAt ?? null` (`course-progress.ts:206-207`), so a normal online tap — and every bulk and reset write — nulls the column CU31's newest-wins rule compares against, disarming it permanently. The mutation hooks return a `conflict` or `failed` per-op result *as success data* rather than throwing (`queries.ts:2254, 2322`), so the confirm sheet closes and the tree refetches with no alert. And `useCourseSyncOps` infers `synced` from an op's *disappearance from the queue* (`:87-97`), while `readQueue` returns `[]` on any parse failure (`storage.ts:26`) — so a truncated MMKV write turns a day of a Guruji's queued stars into four seconds of green ticks.

**The mobile client fabricates progress the server never asked for.** `course-progress-cascade.ts` writes a `completed` row for every uncertified sub-section when a section is closed (`:37-46`), and auto-completes the parent section when the last sibling closes (`:71-83`). CU15 says a row exists only once someone has acted on that node; CU16 says "never auto-correct one from the other". The result is that `fn_course_progress` reports `coverage = 100%` for a child who opened one thing, and the `status_diverges` flag — which the server computes correctly at `courses.ts:481` and ships over the wire — can never fire for anything a mobile user touched. It is also never rendered: grep finds the five divergence fields declared as types in `queries.ts:2083-2087` and drawn nowhere on either client.

**Two personas cannot reach the module at all, and one route hands drafts to a fourth.** `cityIdsForAuthor` in `courses.ts:69-78` returns `[]` for shikshak and sanchalak — the sibling helper in `admin-courses.ts:41-57` resolves their cities from assigned centres correctly, this copy does not — so `GET /v1/courses` compiles to `WHERE false` and a signed-in Guruji sees an empty catalogue on the web, strictly worse than a logged-out guest. Meanwhile `/v1/public/courses` (`public.ts:187`) filters on `status='active'` alone: **every MSV course and its complete section/sub-section outline is served to anonymous visitors**, with no city gate and no `msv_status` gate, plus a 60-second public cache header. And `/admin/courses` has no route guard (`AdminRoutes.tsx:100`) while the sidebar gates at `city_admin` — a shikshak with the URL sees every draft in the city with live Delete and Archive buttons.

**Verdict: request changes.** C1–C6 are release blockers. C1 and C2 should be fixed before any super_admin correction is performed in production, and C6 before the public site is indexed.

---

## Findings index

Severity is blast radius × likelihood, not fix difficulty.

### Critical

| ID | Finding | Where |
|---|---|---|
| **C1** | Correcting a sub-section star reverses the course bonus and voids the course certificate — unrecoverable | `course-certify.ts:629,691` |
| **C2** | Re-certification after a correction returns the voided row; the certificate verifies as `void` forever | `course-certificates.ts:49-73,86` |
| **C3** | Every online, bulk and reset write nulls `client_marked_at`/`client_op_id`, disarming CU31 and AT19 | `course-progress.ts:206-207`; `queries.ts:2258` |
| **C4** | The mobile cascade fabricates progress rows and auto-reconciles declared vs derived | `course-progress-cascade.ts:37-46,71-83` |
| **C5** | A conflicted, failed or lost offline op is reported to the Guruji as saved | `queries.ts:2254,2322`; `useCourseSyncOps.ts:87-97`; `storage.ts:26` |
| **C6** | `/v1/public/courses` publishes every MSV course and its full outline to anonymous visitors | `public.ts:187,204` |

### High

| ID | Finding | Where |
|---|---|---|
| **H1** | `GET /v1/courses` returns an empty catalogue to shikshak and sanchalak | `courses.ts:69-78,312` |
| **H2** | Certify and progress writes never check the course is active, visible or in-city | `course-certify.ts:257`; `courses.ts:128-144`; `course-progress.ts:80` |
| **H3** | Deactivating a `punya_features` row removes the award clamp instead of disabling the award | `course-points.ts:64-65,86` |
| **H4** | `PATCH /admin/courses/:id` can retarget a course into a city the caller does not administer | `admin-courses.ts:335-360` |
| **H5** | CU27's rate limit is keyed on a client-controlled `x-forwarded-for` | `certificates.ts:17-21,38` |
| **H6** | A student with no batch cannot be written or certified by anyone, including super_admin | `scope.ts:133` |
| **H7** | Concurrent certification of the last two sections loses the course milestone, with no sweep to recover | `course-certify.ts:462` |
| **H8** | One malformed op takes the entire nine-queue backlog terminal `failed` | `sync-engine.ts:91-129`; `sync.ts:14` |
| **H9** | The missing-result retry branch never reaches `MAX_ATTEMPTS` — an op spins forever | `sync-engine.ts:64-72` |
| **H10** | `DELETE /admin/courses/:id` bypasses the CU20 guard, shows no impact count, and has no undelete | `admin-courses.ts:381-423` |
| **H11** | The `punya_points` prefill overwrites the authored value when the editor is re-opened | `CoursesAdminPage.tsx:436,315` |
| **H12** | Deleting a section or sub-section has no confirmation | `CoursesAdminPage.tsx:833,899,1055` |
| **H13** | A failed archive-impact fetch renders as a factual "no students affected" | `CoursesAdminPage.tsx:1429,1574` |
| **H14** | Publish preconditions are discoverable only by failing; the server's `reasons`/`fixes` are discarded | `CoursesAdminPage.tsx:761,1410` |
| **H15** | `/admin/courses` has no route guard while the sidebar does | `AdminRoutes.tsx:100` vs `sidebar-nav.ts:70` |
| **H16** | Web admin ships no certify, no CU16 divergence indicator and no honorific — §9's two named items | `CoursesAdminPage.tsx` (absent) |
| **H17** | CU13 bulk — the shikshak's primary path — has no offline route at all | `queries.ts:2271-2294` |
| **H18** | Bulk controls are unreachable unless a batch chip was set first | `CourseDetailScreen.tsx:63-70`; `CourseTree.tsx:293` |
| **H19** | Sub-section certification is unreachable on mobile | `CourseTree.tsx:442-483` |
| **H20** | Parent and student writes are hard-coded online-only | `CourseLearnerOutline.tsx:36`; `[sectionId].tsx:43` |
| **H21** | A queued write leaves the row showing its old status with no pending indication | `CourseTree.tsx:93-100` |
| **H22** | The CU18 confirm shows the authored points, not the Punya the student will receive | `CourseTree.tsx:477,519` |
| **H23** | 403 / 409 / 422 collapse into one raw English string across five handlers | `CourseTree.tsx:101,140,206`; `CourseLearnerOutline.tsx:62`; `[sectionId].tsx:79` |
| **H24** | Certificates are matched to courses by **title string** on both clients | `courses.tsx:38-43`; `CoursesPage.tsx:176` |
| **H25** | The bulk write omits `submission_op_id`, so it has no replay safety | `queries.ts:2281-2289` |
| **H26** | The CU19 correction has no service-layer role check and hardcodes `super_admin` into the audit | `course-certify.ts:566,645,743,762` |
| **H27** | A 23505 inside the certify transaction poisons it; the recovery branch is unreachable | `course-certificates.ts:105` |
| **H28** | CU30 is not implemented — no `snapshot_version`, no `courses` block in the progress report | `progress.ts:378`; `curriculum.ts:284` |
| **H29** | Migration `0058` hardcodes `order_index = 3` against a unique index — the deploy aborts | `0058:35,45` |
| **H30** | The legacy progress route writes the same table through the deprecated `inScope` gate | `progress.ts:141,284` |
| **H31** | The certificate PDF prints only the student's first name | `course-certificate-pdf.ts:62,70,90` |
| **H32** | Certificate PDF enqueue failures are swallowed and can never be re-triggered | `course-certificates.ts:265-274` |

### Medium

| ID | Finding | Where |
|---|---|---|
| M1 | `fn_course_progress` never excludes deactivated students (Q11) | `0052` (whole file) |
| M2 | CU16's childless-section NULL roll-up is patched in one caller, not in the function | `0052:41-54`; `courses.ts:435,480` |
| M3 | `softDeleteCourseNode`'s "soft-delete progress rows" is a no-op — no `deleted_at` column exists | `course-admin.ts:184-195` |
| M4 | CU20's certification check runs outside the delete transaction | `course-admin.ts:140-172` |
| M5 | `GET /:id/tree` calls `fn_course_progress` once per section, over an unbounded whole-history select | `courses.ts:399-402,430` |
| M6 | `allSectionsCertified` is N sequential queries inside the certify transaction | `course-certify.ts:180` |
| M7 | Bulk and reset are per-student round trips with no transaction; a mid-loop failure half-applies | `course-progress.ts:409,536` |
| M8 | Reset includes deactivated students; bulk excludes them | `course-progress.ts:510` vs `:379` |
| M9 | CU14's per-student audit is written after the writes, outside any transaction, and swallowed on failure | `course-progress.ts:576-593` |
| M10 | Every write clobbers `note` to NULL when none is supplied | `course-progress.ts:195` |
| M11 | Unknown or deactivated student ids are reported as a scope violation | `course-progress.ts:382` |
| M12 | The Punya multiplier cache is a per-process Map, never invalidated, not Redis | `course-points.ts:13,91` |
| M13 | `course-access.ts` duplicates the online route's gate and is unused by it | `course-access.ts:19` vs `courses.ts:151-217` |
| M14 | Online certify/bulk are gated by `requireAdminPanel`; the same writes over `/v1/sync/batch` are not | `courses.ts:933,970,1013` vs `sync.ts:10` |
| M15 | Legacy `mastered` rows are permanently un-certifiable and silently skipped by bulk | `course-certify.ts:316`; `course-progress.ts:315` |
| M16 | `:nodeId` and several admin `:id`s are never UUID-validated → 500 instead of 404 | `courses.ts:128`; `admin-courses.ts:385,429,178` |
| M17 | Two routes call `.parse()` unwrapped → 500 instead of 422 | `courses.ts:745,1068` |
| M18 | Zod failures are swallowed; the envelope's `details[]` is always empty | ~20 handlers in both route files |
| M19 | CU4's publish preconditions can be un-done by a later PATCH on an active course | `admin-courses.ts:298-306,356` |
| M20 | A repeated `client_op_id` on a different node surfaces as a 500, not `duplicate` | `course-progress.ts:242` |
| M21 | `db` is used inside `db.transaction` — two pool connections per certify | `course-certify.ts:160,415` |
| M22 | `duplicate` is presented to the user as "synced" | `sync-engine.ts:74`; `useCourseSyncOps.ts:87` |
| M23 | The conflict fallback message is an English-only literal that states no fix | `sync-engine.ts:82-86` |
| M24 | The section cascade fires N sequential round trips, each re-posting the whole backlog | `course-progress-cascade.ts:37` |
| M25 | Certificates still in `issuing` state render a ready ribbon | `courses.tsx:39-43` |
| M26 | The bulk write does not invalidate the admin progress cache | `queries.ts:2290-2292` |
| M27 | The student picker never loads past the first 50 | `CourseAdmin.tsx:91`; `CourseDetailScreen.tsx:52` |
| M28 | Active courses are read-only in the web editor, contradicting CU25 | `CoursesAdminPage.tsx:643` |
| M29 | `academic_year` is unvalidated free text, so CU33's staleness nudge silently no-ops | `CoursesAdminPage.tsx:252,133` |
| M30 | Template sub-sections are authored through `window.prompt`; rename and delete are unreachable | `CoursesAdminPage.tsx:970,1189` |
| M31 | Clearing the course Punya field silently writes 0; template Punya silently clamps | `CoursesAdminPage.tsx:329,1025` |
| M32 | No Devanagari validation anywhere, so a Hinglish "Hindi" name publishes cleanly | `CoursesAdminPage.tsx:233,488,592,1174` |
| M33 | Only the first child's certificates load on web; no child switcher | `CoursesPage.tsx:98` |
| M34 | Signed-in parents and students are served the guest tree on web | `CourseDetailPage.tsx:52` |
| M35 | Devanagari line-height is 16–20px against a 22px minimum across ~40 sites; the honorific is clipped at 110px | `CourseLearnerRow.tsx:178,181` and 9 more files |
| M36 | "Close" means two different things on the same sheet | `[sectionId].tsx:288,312` vs `CourseTree.tsx:369` |
| M37 | No "Start" action in the sub-section sheet, so `started_at` is never stamped from there | `[sectionId].tsx:285-308` |
| M38 | `allowCertifiedWrite` does not clear the certified pair — a loaded 23514 → 500 trap | `course-progress.ts:225` |
| M39 | The archive confirm never says the action is one-way; no un-archive exists | `CoursesAdminPage.tsx:1578`; `admin-courses.ts:305` |
| M40 | Deleting a draft course has no confirmation | `CoursesAdminPage.tsx:1534` |
| M41 | Five of seven mobile course components have zero accessibility props; targets 18–32pt | `CourseTree.tsx:304,354`; `CourseBrowseOutline.tsx:152` |
| M42 | Web a11y: nudge buttons unnamed, toggle state unannounced, the archive count never announced | `CoursesAdminPage.tsx:1337,1517,1548` |
| M43 | Certificate PDF strips non-Devanagari, non-Latin names entirely (Gujarati) | `pdf.ts:29`; `course-certificate-pdf.ts:70` |
| M44 | `certified_at` is taken from the client clock unvalidated while `completed_at` uses the server's | `course-certify.ts:326,353` |

### Low

| ID | Finding | Where |
|---|---|---|
| L1 | The certify response leaks the internal Punya idempotency key | `courses.ts:1055`; `course-points.ts:110` |
| L2 | A draft course cannot be archived — the only exit is the unguarded DELETE | `admin-courses.ts:348` |
| L3 | `GET /v1/courses` returns three different response shapes; the student branch omits the id the tree route requires | `courses.ts:272,292,336` |
| L4 | `handleErr` in `courses.ts` drops the `details` the service produced | `courses.ts:63` vs `admin-courses.ts:64` |
| L5 | Sub-section PATCH and both reorder routes write no audit entry | `courses.ts:766,670,857` |
| L6 | `publishCourse` is not transactional and has no `status='draft'` guard on the UPDATE | `course-admin.ts:61,103` |
| L7 | The second CU19 audit entry carries nothing the first does not | `course-certify.ts:759` |
| L8 | An idempotent replay reports a transaction id alongside zero points | `course-certify.ts:443,525` |
| L9 | Template routes sit outside the CU §8 table and have no reorder | `admin-courses.ts:705-930` |
| L10 | Two implementations of the same status ranking | `course-progress.ts:306,312` |
| L11 | `NOT VALID` → `VALIDATE` in one migration file buys no lock relief | `0051:244-262` |
| L12 | `DROP INDEX IF EXISTS` will not skip an index backing a UNIQUE *constraint* | `0051:155-156` |
| L13 | `punya_features.key` / `punya_configs (feature_key, city_id)` have no unique constraint behind the seed guards | `0051:328-348`; `punya.ts:21-45` |
| L14 | `student_course_progress.status` default is declared in Drizzle but never set in SQL | `curriculum.ts:180` vs `0051:87` |
| L15 | The Q11 FK cascades "deferred to migration 0052" have no home — 0052 was spent on the function | `curriculum.ts:276`; `punya.ts:87` |
| L16 | `punya_points` is shipped to the public/guest catalogue payload | `public.ts:195`; `CoursesPage.tsx:16` |
| L17 | Raw enum values rendered as UI copy (`msv`, `STANDARD`, `Super_admin masters`, `CU4 gate`) | `CoursesPage.tsx:37`; `CoursesAdminPage.tsx:1162,1480`; `CourseAdmin.tsx:246` |
| L18 | English readers silently receive Devanagari body text via a reverse fallback | `[sectionId].tsx:274`; `CourseBrowseOutline.tsx:265` |
| L19 | CJK full stop (U+3002) used instead of the Devanagari danda | `app/course/[id]/index.tsx:70` |
| L20 | `✓` dingbat used where the icon set is required | `CourseLearnerRow.tsx:238` |
| L21 | Guest data path bypasses the shared API client and hand-rolls envelope unwrapping | `CoursesPage.tsx:60`; `CourseDetailPage.tsx:52` |
| L22 | Sub-section descriptions are written as `''` rather than `null` | `CoursesAdminPage.tsx:558` |
| L23 | Publish has no in-flight guard; a double-click shows success then an error | `CoursesAdminPage.tsx:1410,761` |
| L24 | The >15-active-courses warning buckets national courses separately from the city's | `CoursesAdminPage.tsx:1309` |
| L25 | The CU33 "persistent" banner is unmounted on narrow screens while editing | `CoursesAdminPage.tsx:1485` |
| L26 | The correction service resolves nodes without the `deleted_at` filter its route applies | `course-certify.ts:584,594` |
| L27 | Dead `duplicate` branch and a no-op transport indirection in the sync layer | `useCourseSyncOps.ts:52`; `sync-engine.ts:40` |
| L28 | Offline queues use AsyncStorage where CU31 names MMKV (documented, not hidden) | `lib/offline/storage.ts:1-5` |
| L29 | No filter, search or pagination on an unbounded admin course list | `CoursesAdminPage.tsx:1372`; `admin-courses.ts:472` |

---

## Persona walkthrough

The requested spine. Each row is one concrete journey. **Ref** links to the findings index.

### 1. Guest 🌐

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Public site → `/courses` | Browse the catalogue | Works, and returns more than it should. `public.ts:187` filters on `eq(status,'active')` and `isNull(deleted_at)` — **nothing else**. No `city_id` predicate and no `kind='msv'` predicate | CU3 makes visibility a function of the *student*: city match, plus `students.msv_status='approved'` for MSV. With no student there is no city and no MSV gate, so a public catalogue cannot satisfy CU3 by construction. Either restrict the public route to `kind='standard' AND city_id IS NULL`, or remove it | **C6** |
| A course card → detail | Read the outline of an **MSV** course | Full section and sub-section tree, titles and descriptions, unauthenticated (`public.ts:204`), behind a 60-second CDN cache header (`app.ts:185`). `punya_points` rides along in the list payload | MSV is a gated programme; its curriculum structure is the thing the gate exists around | **C6**, L16 |
| Any error | Read the failure | `Courses request failed (500)` rendered verbatim into a destructive card (`CoursesPage.tsx:62,75,161`) — English only even when the page is in Hindi, no next step | Both languages, problem plus fix, no HTTP status shown to visitors | L21 |
| Scan a certificate QR | Verify it | Correct and well-built: exact 5-key allowlist, first name only, no uuid, no centre (`certificates.ts:86`), and the `void` state is reported honestly. But the rate limit keys off `x-forwarded-for`'s first entry (`:17-21`), so rotating one header gives unlimited attempts | CU27's security argument is "60 bits of entropy **plus** rate limiting". Key off `req.ip` under Express `trust proxy` | **H5** |

---

### 2. Student (13+, student view) 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home → Courses | See the catalogue | Works. `useCoursesCatalogue(studentId)` → the CU3 predicate in SQL (`course-visibility.ts:38`), MSV gate included. ✅ | ✅ | — |
| Catalogue → a course | Read a section's status | `courseStatusLabel` returns **"To be started" / "शुरू करना बाकी"** for `not_started` — CU11's rename honoured in both languages and unit-tested | ✅ | — |
| Section → tick the last sub-section | Record their own progress | **The client also declares the parent section complete on their behalf** (`course-progress-cascade.ts:71-83`). CU17 requires `completed` before a star, so a child's self-serve tick has just made the node certifiable — and a section star mints `punya_points × multiplier` | CU16: "Never auto-correct one from the other." The section's row is a declared act by a person, not a derived consequence | **C4** |
| Sub-section sheet | Record that they have *started* something | No such action. The sheet offers only "Mark complete" and "Reopen" (`[sectionId].tsx:285-308`). `started_at` — the timestamp CU11 stamps once — is never set from here | CU11 and §9 both name start/close/reopen for this persona | M37 |
| Same sheet | Tap "बंद करें" expecting to mark it done | The sheet dismisses; nothing is written. "Close" is CU11's *completion* verb on the bulk screen (`CourseTree.tsx:369`) and the *dismiss* verb here (`[sectionId].tsx:312`) | One verb, one meaning. Dismiss is "Cancel / रद्द करें", as the two student pickers already do it | M36 |
| On a train, no signal | Mark a sub-section complete | Fails. `useSetCourseNodeProgress({ offline: false })` is a literal at both learner call sites (`CourseLearnerOutline.tsx:36`, `[sectionId].tsx:43`) with no queue fallback. The identical tap by a Guruji queues durably | CU31 scopes offline parity by *op type*, not by persona: "Both status marking and certification sync offline" | **H20** |
| Certified section | Tap the status pill | Correctly intercepted on the device with an explanation rather than a 409 (`CourseLearnerRow.tsx:56-66`). ✅ Good | ✅ | — |
| A certified section | Read who certified it | `"गुरुजी द्वा…"` — the three-branch honorific is computed correctly and then clipped by `maxWidth: 110` + `numberOfLines={1}` at `fontSize: 11, lineHeight: 16` (`CourseLearnerRow.tsx:178-183`) | ≥22px line-height for Devanagari and +35% width headroom. The part that names *who* vouched for the child is exactly the part cut | M35 |
| Catalogue, in Hindi | Read a course subtitle | For any course with a null `academic_year`, the subtitle falls back to the raw enum: lowercase `standard` / `msv` (`courses.tsx:25`) | `_en`/`_hi` labels. "Jain terms stay untranslated" covers Punya and Niyam, not database enums | L17 |
| Web, signed in → a course | Open the detail page | Served the **guest** tree (`CourseDetailPage.tsx:52` fetches `/v1/public/courses/:id/tree` unconditionally) — a flat outline with no status, no star, no honorific, for a signed-in student | Fetch `/v1/courses/:id/tree?student_id=`, which the CU route table calls "the student-facing read path" | M34 |

---

### 3. Parent — Abhivaavak 📱🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home → Courses → child switcher | See each child's catalogue | Works on mobile. Ownership is enforced server-side (`courses.ts:227-253`). ✅ | ✅ | — |
| **Web** → Courses | Same, with three children | The course list is a *union* across all children (`courses.ts:256-275`) while `studentId` is pinned to `res.items?.[0]?.id` (`CoursesPage.tsx:98`) — so the list is everyone's and the certificate badges are the eldest's, with no selector | A child selector, matching the mobile `ChildSwitcher` contract the API already supports | M33 |
| Courses list | See which courses their child has certificates for | Matched by **title string** — `courseCertTitles.has(course.name_en)` on both clients (`courses.tsx:38-43`, `CoursesPage.tsx:176`). `CourseCertificateRow` carries no `course_id`, so the id join is impossible with the current payload | CU24 keys certificates on `(student_id, course_id)`. Two academic years of "Jain Darshan" both show the ribbon; a CU6 rename makes a real certificate's ribbon vanish | **H24** |
| Certificate ribbon | Tap it seconds after the final star | The chip renders as ready. `row.status` (`"ready" | "issuing" | "void"`) and `row.pdf_url` are never consulted (`courses.tsx:39-43`), so an in-flight PDF looks finished | CU24: a NULL `storage_key` is "issuing", not broken — say so | M25 |
| Certificate | Read the child's name on it | **"Student: Aarav"** — `firstName()` is applied to the *certificate PDF* (`course-certificate-pdf.ts:62,70,90`), discarding the full name the snapshot already holds | CU27's first-name-only rule governs the **public verification endpoint**, not the artefact handed to the family. `certificates.ts:86` already applies it in the right place | **H31** |
| Certificate, Gujarati-script name | Same | The name is empty. `pdf.prepare()` strips every non-WinAnsi glyph when the string contains no Devanagari (`pdf.ts:29`) — and the MSV network is Gujarat-centred | Mukta is chosen precisely because it covers Devanagari + Gujarati + Latin; fall through to the embedded face for any non-WinAnsi text | M43 |
| After a super_admin correction | Check the certificate again | It verifies as **`void`, permanently** — even after the Guruji re-certifies correctly. `findExistingCertificate` has no `voided_at` filter (`course-certificates.ts:49-73`), returns the voided row, `created:false`, no PDF enqueued, `voided_at` never cleared; the partial unique index blocks a replacement | Re-issue must clear `voided_at`/`voided_by` and re-enqueue, or the index must exclude voided rows | **C2** |
| Same correction, on a **sub-section** | Check the Punya balance | The whole course-completion bonus (up to 2,000 points × multiplier) is silently reversed and the course certificate voided, because `wasCourseComplete` is evaluated regardless of `nodeKind` (`course-certify.ts:629,691`). Sub-section stars carry no Punya at all under CU21 | CU19 §4 reverses the course bonus because de-certifying a **section** un-completes the course. Guard the block on `nodeKind === 'section'` | **C1** |
| Marks a node online at 18:00 | A Guruji's phone syncs a stale 10:00 mark at 18:05 | The stale mark wins and the child's completed work reverts, silently. The online write nulled `client_marked_at` (`course-progress.ts:207`), so the newest-wins guard at `:156-159` has nothing to compare against | CU31: "the comparison lives in the shared service method, **so the online path is governed by it too**." A write carrying no client clock must leave the stored one intact | **C3** |
| Progress → monthly report | See course coverage and mastery | Absent. `progress.ts:378` still builds `{ items, homework, generated_at }`; `getCourseProgress` is never imported, there is no `snapshot_version` column anywhere in the repo | CU30. SPEC §8.14's "curriculum %" has been consumed without a definition since day one, and CU28 built the two numbers for exactly this | **H28** |
| Anywhere | Be told their child was certified | Never. `courses.ts` does not import `notify`; no notification, SMS or feed entry fires on a star, a certificate or a course completion | A star is the highest-value event in the module | — *(product gap, not a rule breach)* |

---

### 4. Shikshak — Guruji / Didi 📱🖥

The persona CU13 and CU21 were written around.

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Mobile → Quick actions → Courses | Open the course list | Works — `/shikshak/courses` → `CourseAdmin persona="shikshak"` → `/v1/admin/courses`, which uses the **correct** city helper. ✅ | ✅ | — |
| **Web**, signed in → `/courses` | Same | **Empty.** `cityIdsForAuthor` (`courses.ts:69-78`) falls through to `return []` for shikshak and sanchalak, which compiles to `sql\`false\`` at `:333`. The sibling helper at `admin-courses.ts:41-57` resolves their cities from `scope.centreIds` correctly — this copy was never finished | Same resolution as `cityIdsForUser`. A signed-in Guruji currently sees less than a logged-out guest | **H1** |
| Course → a student → a section | Set it to Completed | The client also writes a `completed` row for **every** uncertified sub-section (`course-progress-cascade.ts:37-46`) — twelve rows for nodes nobody opened. `fn_course_progress` then reports `coverage = 100%` | CU15: "a row exists only once someone has acted on that node… Do not backfill." The Sanchalak's whole ability to see who is actually behind rests on this | **C4** |
| Same screen | Rely on the `status_diverges` indicator | It can never fire for anything mobile touched — the cascade has already reconciled the two — and it is not rendered anywhere anyway. The five fields are declared in `queries.ts:2083-2087` and drawn in zero components | CU16 and §9 both require it on both surfaces. The rule is 100% server-side and 0% delivered | **C4**, **H16** |
| Course list → a student | Find the Batch bulk controls | Present only if the batch chip was set first. `applyStudent` builds the query from `pickerBatchId` alone (`CourseDetailScreen.tsx:63-70`), the student's own `batch_id` is never used, and `CourseTree.tsx:293` renders the overflow only when `batchId` is truthy. `CourseAdmin.tsx:143` does it correctly | CU13 is "the primary path for a shikshak"; it must not depend on an optional filter chip. Same Guruji, same student, two different feature sets by entry point | **H18** |
| Batch → Close, for 40 students | Bulk-close a section | Works online. **Offline it is lost entirely** — `useBulkCourseNodeProgress` has no queue branch (`queries.ts:2271-2294`), even though `PendingCourseProgressOp.marks` is an array specifically to carry a roster. Individual marks for the same 40 students would have queued fine | CU13 exists because "it is forty taps and it will not get done"; CU31 says both status marking and certification sync offline. The offline model covers the slow path and abandons the fast one | **H17** |
| Same tap, twice on flaky wifi | Replay safety | None — `submission_op_id` is accepted by the server (`courses.ts:925`) and never sent (`queries.ts:2281`). CU14's advance-only guard limits the damage for status, but the same route serves `reset`, where CU14 mandates one audit entry per student — now doubled | CU13's body includes `submission_op_id`; `sync_operations`'s unique index is what makes a replay a no-op | **H25** |
| Bulk Start vs Close | Aim for Start | The two controls are ~18pt tall, 8pt apart, with no `hitSlop` (`CourseTree.tsx:330-371`). And a mis-hit Close is **not** reversible by re-tapping Start — CU14 is advance-only, so it needs the audited reset route, which mobile does not expose | 44pt minimum, and expose the correction path wherever the mistake can be made | M41 |
| Section → Certify | Read the confirm | Carries the student's name, the node title and a Punya number — but the number is `section.punya_points` raw (`CourseTree.tsx:477,519`), not `ROUND(points × multiplier/100)` clamped. In a 2.5× city the sheet says 50 and the child receives 125 | CU18 makes this the one screen that must be exact, because there is no revoke route | **H22** |
| Sub-section → Certify | Star a child who memorised one sutra | **No control exists.** `canCertify` and the Certify button live only inside the section map (`CourseTree.tsx:442-483`); `nodeKind: "section"` is the only value passed anywhere in the app | CU17: "Both sections and sub-sections can be starred." This is the zero-Punya "recognition without currency" CU21 designed. The Guruji must over-reward or do nothing | **H19** |
| Certify a node another Guruji starred a minute ago | Read the outcome | The sheet closes, no alert, the tree refetches. The hook **returns** the `conflict` result as success data (`queries.ts:2322-2324`) so `confirmCertify`'s catch never fires. The only trace is a chip above the section list they have already scrolled past | CLAUDE.md offline §8: `conflict` explains what happened and what to do; `failed` offers manual retry and is never silently discarded | **C5** |
| Reconnects after a low-storage app kill | See yesterday's queued stars | Four seconds of green "synced" ticks. `readQueue` returns `[]` on any parse failure (`storage.ts:26`) and `useCourseSyncOps` promotes any op that *disappeared* to `synced` (`:87-97`) | `synced` must come from an actual `status:"success"`, never from absence. Twenty stars that never reached the server are reported as saved | **C5** |
| One bad op in a day's backlog | Sync | `sync.ts:14` parses the whole body and 422s if any part fails; the client then marks **every op in the batch** `failed` (`sync-engine.ts:129`) — attendance, niyams and thirty course marks together | CLAUDE.md offline §4: "process every op independently and return a per-op result." This is the lose-a-day's-work outcome AT8 and AT32 exist to prevent | **H8** |
| An op the server drops from `results` | Wait | Spins at the 5-minute cap forever — the `if (!result)` branch re-queues unconditionally without consulting `MAX_ATTEMPTS` or `shouldRetry` (`sync-engine.ts:64-72`), unlike every other branch in the same function | Cap at 10 attempts, then `failed` with manual retry | **H9** |
| Offline, taps a section pill | Watch the row | It snaps back to the old status. There is no `onMutate` optimistic patch and the handler refetches immediately (`CourseTree.tsx:93-100`) | "Saved offline — will sync". As written the natural read is "the tap didn't register", so the Guruji taps three times | **H21** |
| Certify a child who moved batches | Read the error | Title in Hindi, body in English: `"That student is outside your scope."` Five handlers branch on exactly one of CU32's six codes (`CourseTree.tsx:101,140,206`; `CourseLearnerOutline.tsx:62`; `[sectionId].tsx:79`) | Branch on `error.code`, both languages, problem **and** fix — CU21 anticipates the handoff to the Sanchalak and the UI never mentions it | **H23** |
| A newly-enrolled child not yet in a batch | Mark anything | Refused, for everyone. `inBatchWriteScope` opens `if (!batchId) return false;` **before** the `scope.batchIds === null` fallback (`scope.ts:133`), so shikshak, sanchalak, city_admin, state_admin and super_admin all fail. The parent *can* write, producing progress no staff member can ever star | CU21: `inBatchWriteScope` "resolves `batchIds === null` to centre membership, so sanchalak and above keep whole-centre reach with no special case." Fall through to `inCentreScope` when `batchIds` is null. *(Shared with attendance and homework — fix once, re-test both.)* | **H6** |
| A pre-migration `mastered` row | Certify it | `409 ERR_COURSE_NODE_NOT_COMPLETE` on a node the UI shows as finished (`course-certify.ts:316`), and bulk close skips the student silently because `statusRank` maps `mastered` to 2 (`course-progress.ts:315`) | CU11 keeps the enum value reserved but `0051` never backfills existing rows. Convert them to `completed`, or treat them as completed in the precondition | M15 |
| Certifies the last two sections at once with a colleague | Complete the course | Under READ COMMITTED neither transaction sees the other's uncommitted star, both `allSectionsCertified` return false, and **no course bonus and no certificate are ever issued** (`course-certify.ts:462`). CU21 deliberately has no reconcile sweep, so nothing recovers it | `SELECT … FOR UPDATE` over the student's section rows, or `pg_advisory_xact_lock` on `(student_id, course_id)` | **H7** |

---

### 5. Sanchalak — centre head 📱🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Mobile → Quick actions → Courses | Clear the centre's certification queue | **Ships.** `app/admin/courses.tsx` → `CourseAdmin persona="sanchalak"` → `CourseDetailScreen` → `CourseTree mode="admin"`, reachable from `SANCHALAK_ACTIONS`. Q12's non-negotiable release coupling is honoured — worth saying plainly | ✅ | — |
| **Desktop** → any course screen | Same, at the desk they actually work at | Nothing exists. Grep across the web app for `certify`, `derived_status`, `status_diverges`, `honorific` returns zero hits, while the API returns all of it per section (`courses.ts:473-481`) | §9 assigns the web admin "section-level progress with the CU16 divergence indicator; certify with CU18 confirm". Both are absent | **H16** |
| Web → `/courses` | Browse the catalogue at all | Empty, same as the Guruji | **H1** | **H1** |
| Mobile → student picker | Find a child in a 180-student centre | The list stops at 50 with no "load more" and no message. Both pickers flatten `pages` without ever calling `fetchNextPage` (`CourseAdmin.tsx:91`, `CourseDetailScreen.tsx:52`) | Paginate, or state the cap. A Sanchalak covering several batches will not know every student code | M27 |
| Divergence panel | See "declared complete, children untouched" | Cannot. The mobile cascade reconciles the two before the server ever sees them, and no client renders the flag | **C4** | **C4** |
| A section-only course | Read the derived roll-up | `derived_status` is correctly suppressed to `null` for a childless section (`courses.ts:435`) but `derived_coverage` is emitted raw two lines later (`:480`) — 0.0 or 1.0. And the suppression lives in one *caller*, so the PDF worker and mobile calling `getCourseProgress` directly get no guard at all | CU16: "a roll-up of `NULL`, not `0` and not `100`." Put it in the function, not in one caller — this is exactly the "never a second formula" discipline CU28 exists to seal | M2 |
| A child who left in October | Read their coverage | Still live and still moving. `0052_fn_course_progress.sql` never joins `students` and has no `deactivated_at` predicate anywhere | CU28: "Excluded everywhere: … students from `deactivated_at` forward, with prior history retained (Q11)" — the same clause AT5 carries for attendance | M1 |
| Investigate "why did the whole batch go backwards" | Read the audit | Possibly nothing to read. `resetCourseProgress` applies every regression first, then calls `writeAudits(audits)` with no `tx` (`:593`), and `writeAudits` without a transaction catches and logs | CU14's *entire* justification for permitting the route is the per-student audit: "without this, one bulk tap silently walks a whole roster backwards and nobody can tell it happened" | M9 |
| Read a Guruji's note on a struggling child | Find it | Gone, if any bulk write has since touched the row — the `set` clause writes `note: input.note ?? null` unconditionally (`course-progress.ts:195`) | An op carrying no note is not a write of an empty note. Omit the column when `input.note` is `undefined` | M10 |

---

### 6. City Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Sidebar → Courses → New course | Author a course | Works, and the CU4 lifecycle is well built: `active → draft` is structurally impossible on both sides (`admin-courses.ts:305` is `z.enum(["archived"])`), and the publish gate returns a per-reason fix map in the product's error voice (`course-admin.ts:86-101`). ✅ | ✅ | — |
| Course → Edit → the pencil on a section | Fix a typo in the English title | **The Punya field silently changes.** Three effects race on open; the third (`CoursesAdminPage.tsx:436`) omits the `|| section` guard its sibling at `:430` has, so it reads the pre-update `punyaTouched` (false) and overwrites the authored value with the prefill. A section saved at 250 opens showing 50, and `submit` PATCHes 50. The same shape hits the course bonus at `:315` | The authored value must survive a re-open. Delete the duplicated effect — the guarded one is already correct | **H11** |
| Same dialog | Mis-click the trash icon 4px away | The section, its sub-sections and every student's uncertified progress on it are gone with a green toast and no confirm (`:833`, `:899`, `:1055`). The page imports `AlertDialog` and uses it for archive and derive — just not here | A confirm naming the section, its sub-section count and the progress that goes with it | **H12** |
| Course list → Delete on a draft | Mis-click Delete instead of Edit | Immediate soft delete, no confirm (`:1534`), and nothing in the admin UI can restore it — CU29's undelete route was never built | Confirm; a draft can be hours of authoring | M40, **H10** |
| Courses list → Delete on a **live** course | Delete it | Accepted. `DELETE /admin/courses/:id` runs `set({deleted_at})` after a kind/city check only (`admin-courses.ts:410-414`) — no CU20 certification guard, no impact count, no undelete. Students' Punya, certificates and `fn_course_progress` all keep referencing a course that has vanished from every list | CU20 blocks deletion where value has been minted; deleting the *parent* of a certified section is the larger version of the blocked act. CU4 says archive instead | **H10** |
| Archive on last year's course | Read the impact | Correct when it works — a real count, correct pluralisation, action disabled until it arrives (`:1425-1428,1593`). But `catch { setArchiveCount(0); }` (`:1429`) turns a 403, a 500 or a dropped connection into the sentence **"No students currently have in-progress, uncertified work"** | CU4 makes this count mandatory precisely for this decision. An unknown count must never render as a factual zero | **H13** |
| Same dialog | Learn it is one-way | Never stated, and there is no un-archive on the server or in the UI (`:1578`; `admin-courses.ts:305`) | State irreversibility explicitly, as CU18's certify confirm is required to | M39 |
| Author 15 sections → Publish | Learn what is missing | A single toast concatenating every reason, with nothing on screen marking *which* of the 15 sections is at 0 Punya. The server returns structured `{reasons, fixes}` (`course-admin.ts:99`) and the UI discards it — while all four preconditions are locally computable from `tree` | A visible checklist before the click. All 15 dialogs currently have to be opened one by one | **H14** |
| Add section | Accept the Punya suggestion | It is 0. The create trigger passes `subsectionCount={0}` (`:752`), so `sectionPunyaPrefill(0)` renders "Suggested (10 × subsections): 0" — and sections are necessarily created before their sub-sections | CU22's stated purpose is that admins "anchor on a sane number"; as shipped they anchor on 0, which is also the unpublishable value. The one path where the prefill would help is the one corrupted by **H11** | M31 |
| Edit course details | Select the Punya field, get distracted, save | `Number('')` → 0 → `Math.max(0, Math.min(2000, 0))` → PATCHed as 0, toast "Course updated." (`:329`) | CU22 makes `0` a deliberate "certificate, no bonus". An empty field is not the number zero | M31 |
| Name (Hindi) | Type "Prathmik Gyan" | Publishes cleanly. No Devanagari check on any of the four Hindi inputs; the server gate is `.max(300)` and CU4 checks only `!name_hi?.trim()` | Client-side `/[ऀ-ॿ]/` with the error-voice message. Transliteration is never acceptable | M32 |
| Publish, then PATCH | Clear `name_hi` or `academic_year` on the live course | Accepted — `patchCourseBody` allows `.nullable()` on both and the handler writes them through with no status re-check (`admin-courses.ts:298-306,356`). Clearing `academic_year` permanently disables CU33's nudge for that course | Reject nulling a publish precondition on an active course, or re-run the gate on every PATCH | M19 |
| Create a course | Type "FY 2024-25" as the year | Publishes. `academicYearStart` parses `/^(\d{4})/` and returns null otherwise (`:133-137`), and `CatalogueNudges` drops those rows (`:1299`) — invisible to the staleness banner forever | CU4 made the field mandatory *precisely so* CU33's nudge is computable. Constrain the format at entry | M29 |
| Spot a typo in a **published** section | Fix it | The pencil is gone — `isDraft` gates every section and sub-section control (`:643`, `:748-910`) — though the API accepts the PATCH | CU25 explicitly permits editing an active course and accepts the coverage drop as "honest and expected" | M28 |
| Any list | Find one city's draft among 300 rows | No filter, no search, no pagination (`:1372`), and the API applies no LIMIT (`admin-courses.ts:472`). The count is at least truthful | A status filter at minimum, given CU33 anticipates 15+ active courses per city and archived rows accumulate forever | L29 |
| PATCH a course's `city_id` | Move it to another city | Accepted. Create checks city membership (`admin-courses.ts:270`); PATCH validates only the **old** city (`:343-347`) and writes the new value verbatim (`:360`) | The destination must be inside `cityIdsForUser`, exactly as create requires. Today the course lands somewhere its real city_admin cannot see it | **H4** |
| Deactivate `course_completed` in the Punya catalogue | Turn the award off | It removes the **ceiling** instead. `resolveFeature` filters `is_active = true` and defaults `max_points: feat?.max_points ?? 0` (`course-points.ts:64-65`), and the clamp is `if (cfg.max_points > 0 && …)` (`:86`). With a 250% multiplier and a 2,000-point course, one certification mints 5,000 — straight into AT23's Tirthankar tier, whose thresholds are global | A missing or inactive catalogue row must award **0**, never "award, unclamped". CU22: the clamp "must not be bypassed just because the base value is authored" | **H3** |
| Halve the city multiplier | Have it take effect | For up to 60 seconds, different API pods mint different amounts for the same section. The cache is a per-process `Map` (`course-points.ts:13`) and `clearCoursePointsCache()` has zero callers | CU22/AT21: Redis-cached. The values *are* snapshotted into the ledger row, so the divergence is permanent in the awards rather than self-healing | M12 |

---

### 7. State Admin 🖥

Inherits every City Admin row. State-specific:

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Sidebar → Courses | Author across their state | Works — `cityIdsForUser` resolves the state's cities correctly (`admin-courses.ts:44-49`) | ✅ | — |
| — (API, direct) | Create a `kind='msv'` or national course | Correctly 403 via `assertMayAuthorCourseKind` (`course-admin.ts:29-43`). ✅ **But no test ever logs in as `state_admin`** — adding the role to that allowed set breaks nothing in CI, and CU8 exists specifically to close the state_admin hole | Add the negative tests before touching that function | see Test gaps |
| — (API, direct) | Author sections under a **national** course | Reachable. `loadAuthorableCourse` (`courses.ts:80-103`) skips the city check when `city_id IS NULL`, and CU8's third bullet says to drop `state_admin` from the national author set | CU8: "Q2 wins — drop `state_admin` from the national author set" | **H2** |
| Anywhere | Read audit for a sub-section rename or a reorder | Nothing to read. `PATCH /subsections/:id` (`courses.ts:766`) and both reorder routes write no `auditFromReq`, while the section PATCH does | CLAUDE.md: all admin actions write an audit entry; CU18 extends it to authoring edits | L5 |
| Any create/edit | Send something the API rejects | *"Invalid section data."* Every one of ~20 handlers uses a parameterless `catch`, so the `ZodError` is discarded and `details[]` stays empty — while the publish gate proves the envelope supports it | Populate `details[]` from `err.issues` | M18 |
| Hand-edit an admin URL | Load it | 500. `DELETE`, publish and the template routes do `String(req.params.id)` straight into SQL (`admin-courses.ts:385,429,178`) while their PATCH siblings guard with `UUID_RE`. `?status=published` likewise raises `22P02` off an unvalidated enum cast (`:496`) | UUID-guard every `:id`; validate query enums with Zod → 422 | M16 |

---

### 8. Super Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Templates → New → sections | Author a national master | Works, but sub-sections are two sequential `window.prompt` calls (`CoursesAdminPage.tsx:970`) — unstyled, untranslatable, no Devanagari hint, and cancelling the second discards the first silently | The `SubsectionDialog` pattern already built two hundred lines away | M30 |
| Templates list | Rename or delete a template; fix a sub-section title | Unreachable. The table offers Edit-tree and Derive only; `PATCH`/`DELETE` on templates, template sections and template sub-sections all exist server-side (`admin-courses.ts:121,174,758,893,930`) and are called from nowhere. `age_group` has no input either | Full CU7 template CRUD. A misspelled template name is currently permanent | M30 |
| Derive → a city course | Confirm the snapshot holds | Correct and tested — later template edits do not touch the derived course (`courses.test.ts:723-781`). ✅ | ✅ | — |
| Console → correct a mis-starred **sub-section** | Fix one mistake | Reverses the entire course-completion bonus and voids the course certificate (`course-certify.ts:691`), because `wasCourseComplete` is computed without regard to `nodeKind`. No route restores either | **C1** | **C1** |
| Console → correct, then have the Guruji re-certify | Restore the student | Punya returns (`courses.test.ts:640` proves it); the certificate stays `void` forever (`course-certificates.ts:86`) | **C2** | **C2** |
| Console → correct anything | Read the audit trail | Two entries, both hardcoded `actorRole: "super_admin"` regardless of caller (`course-certify.ts:645,743,762`), and the second carries only `acting_super_admin_id` — the same id `actor_id` already holds. Enforcement lives only at the route (`courses.ts:1066`) | Q2's house rule puts role restrictions on value-minting operations in the service layer. Assuming the role rather than checking it makes an append-only log unfalsifiable | **H26**, L7 |
| Console → send a malformed correction body | Get an error | 500. `courses.ts:1068` calls `.parse(req.body)` unwrapped — the one path that touches irreversible Punya, and the only one in the file without a try/catch | 422 `ERR_VALIDATION_FAILED` | M17 |
| Certify twice quickly (or a client retry) | Get an idempotent result | Possible 500 with the whole certification rolled back. The 23505 catch in `insertCertificateWithCodeRetry` (`course-certificates.ts:105`) runs *inside* the caller's `tx`, which Postgres has already aborted — the recovery `findExistingCertificate` and the subsequent `writeAudit` both fail with `25P02` | Wrap each attempt in a savepoint (`tx.transaction(...)`), or use `ON CONFLICT DO NOTHING … RETURNING` | **H27** |
| Certify against a **draft** course | Be stopped | Not stopped. Neither `resolveNodeKind` (`courses.ts:128-144`) nor `certifyCourseNode`'s lookup (`course-certify.ts:257`) inspects `courses.status`, `courses.deleted_at`, `city_id` or the MSV gate — and `GET /admin/courses/:id/tree` hands drafts to any shikshak (`admin-courses.ts:566`). Punya lands and a certificate is issued for a course no parent can see | A write is a stronger act than a read; it must not be reachable where the read is not. CU4 gates drafts out of visibility precisely because they are half-authored | **H2** |
| Punya configs | Confirm the seeds landed | All four rows are present with NULL-safe guards (`0051:328-348`). ✅ But `punya_features.key` has no unique constraint and `punya_configs` has only a plain index, so a duplicate from a seed script makes `resolveFeature`'s `.limit(1)` planner-dependent | `UNIQUE (key)` and `UNIQUE (feature_key, city_id)` behind the mandatory seeds | L13 |
| Deploy the release | Run `pnpm db:migrate` | **May abort.** `0058:35,45` inserts the Courses library section with a hardcoded `order_index = 3` / `draft_order_index = 3` guarded only on `key='courses'`, against two partial unique indexes on those columns (`library.ts:54-58`). Passes on a fresh dev DB, coin-flip in production | Derive the slot (`MAX(order_index)+1 WHERE deleted_at IS NULL`) or `ON CONFLICT DO NOTHING` | **H29** |
| Deploy | Hold locks briefly | `0051` follows CU1's `NOT VALID` → `VALIDATE` pattern faithfully — but both halves are in one file, so drizzle-kit runs them in one transaction and the ACCESS EXCLUSIVE from `ADD CONSTRAINT` is held to COMMIT anyway. Four tables locked through one long transaction that also rewrites `courses` for the enum conversion | Split into `0051a` (add NOT VALID) and `0051b` (validate) so they commit separately. The letter of CU1 is met; the objective is not | L11 |
| Read `CLAUDE.md` | Find the CU rules | Only the offline section landed. CU31's ⚠ banner condition **is** satisfied — the 9-value union, both MMKV queues, both drain positions and both conflict rules are in `CLAUDE.md`. But CU1–CU33 never moved across, so the binding rules for a shipped module still live in a file headed *"design agreed, not yet implemented"* | The spec's own instruction: "Once approved, CU1–CU33 move into `CLAUDE.md` verbatim and this file becomes the rationale archive" | — |

---

## Test gaps

36 cases across four API suites (2,033 lines) plus 4 mobile label tests. The coverage that exists is good: CU28's four named landmines are each asserted directly (`course-progress.test.ts:96,130,144,178`), CU4's publish gate is walked precondition by precondition, CU7's snapshot immunity is proven, CU23's course key is asserted verbatim including the trigger section, CU27's response is pinned to an exact 5-key allowlist, and both AT20 replay paths are covered — online and offline, including a *fresh* `submission_op_id` that bypasses `sync_operations` and proves the domain guard.

What is not covered is where every Critical in this report lives.

**Three personas are never authenticated.** `loginAs` counts: `super_admin` 26, `shikshak` 19, `parent` 3, `city_admin` **1** (a single negative test), `state_admin` **0**, `sanchalak` **0**, `student` **0**. Because super_admin authors everything, `cityIdsForUser` returns `null` in every authoring test and the city-scoping branch at `admin-courses.ts:269,344,406,450,531,582` **never executes**. Deleting those guards — letting a Mumbai city_admin publish, archive or delete a Pune course — breaks no test. So does adding `state_admin` to `assertMayAuthorCourseKind`.

**No test asserts the value of a single Punya award.** Every assertion is `toBeGreaterThan(0)` (`courses.test.ts:507,569,613,638`). `resolveCourseAwardPoints` could drop the `/100.0` — 100× every award in the country — swap min and max, or clamp before multiplying, and CI stays green.

**No test ever certifies, corrects or deletes a sub-section.** That single gap hides C1 completely.

**The two halves of C2 live in suites that never meet.** `courses.test.ts:578` corrects then re-certifies and checks only Punya; `course-certificates.test.ts:362` corrects and never re-certifies.

**Zero tests read `audit_logs`.** Removing `writeAudit` from certify, from either CU19 entry, from publish or from reset breaks nothing — including CU14's per-student audit, which is the entire justification for permitting the reset route.

**`POST /progress/reset` has no tests at all** (`grep -c reset` over the test directory returns 0), and its roster query already diverges from bulk's Q11 filter.

**The CU3 MSV gate is asserted in neither direction**, and no test proves a city-A course is invisible in city B — `mumbaiCityId()` falls back to `cities[0]`, so every test course lands in the student's own city. Deleting the `kindOk` term at `course-visibility.ts:38` breaks nothing.

**The mobile offline layer has no tests** — `drain.ts`, `sync-engine.ts`, `backoff.ts`, `storage.ts`, `course-progress-cascade.ts` and `useCourseSyncOps.ts` are entirely uncovered. C3, C4, C5, H8 and H9 all live there.

**The DB constraints are untested.** No test asserts the mandatory `status='draft'` backfill (`0051:106`), that the old composite index was dropped, that the four CASCADE→RESTRICT swaps took, that `certified_requires_completed` rejects a certified `in_progress` row, or that a malformed `client_op_id` is refused. CU12 says "the service guard is the contract; the CHECK is the net. **Both are required**" — the net is unverified.

**Two structural problems.** `course-progress.test.ts:17-23` reads `0052_fn_course_progress.sql` and installs it in `beforeAll` — **the suite creates the function it then tests**, so all four CU28 tests pass against a database where the migration was never applied. And `course-certificates.test.ts` calls `ensureShikshakGender("male")` at the top of all five integration tests, so the honorific written into a real `scope_snapshot` is only ever asserted for the male branch; a regression hardcoding "Guruji" into `loadCertifierContext` passes the pure-function test and every integration test.

**Two exit criteria were simply never written** — `course-certificates.test.ts` runs 1, 3, 4, 5, 6 and `course-sync.test.ts` runs 2, 3, 4, 5. Nothing in CI notices a missing criterion.

### The eight tests worth writing first

1. Assert the **exact numeric award** for a known `punya_points` × multiplier, plus the min/max clamp and an inactive `punya_features` row awarding 0 — catches **H3** and any arithmetic regression.
2. Correct a certified **sub-section** on a fully-certified course; assert the course bonus is untouched and the course certificate is not voided — **C1**.
3. Correct, then re-certify, then assert the certificate verifies as `valid` — **C2**.
4. Create a `kind='msv'` course; assert a non-approved student sees it in none of `/v1/courses`, `/v1/courses/:id/tree` **or `/v1/public/courses`** — **C6**.
5. Log in as `state_admin` and `sanchalak`; assert the full CU8 matrix (national create, MSV create, MSV re-kind by PATCH, section authoring under a national course) and the sanchalak certify path.
6. Exercise `POST /progress/reset` end to end: regression applied, certified rows skipped, one audit row per student, deactivated students excluded.
7. Drive bulk by `batch_id`, assert a deactivated student is excluded, and assert `{}` and `{batch_id, student_ids}` both 422.
8. DB-level tests against `0051`/`0052`: duplicate `(student_id, section_id)` rejected; `certified_at` on a non-`completed` row raises 23514; bad `client_op_id` rejected; `fn_course_progress` excludes soft-deleted nodes and deactivated students — **the last will fail immediately**, because `0052` never mentions `students`.

---

## What looks good

- **CU10's "guaranteed day-one stumble" is avoided in all four places.** Both branches of `upsertCourseProgress` (`course-progress.ts:248,259`) and both certify branches (`course-certify.ts:350,373`) pass `targetWhere` alongside `target`, and the Drizzle schema declares the partial indexes with `.where(...)` so it is expressible at all (`curriculum.ts:214-222`).
- **`fn_course_progress` is one function that gets all three fatal details right** — `::numeric` on both numerators (`0052:112,118`), a real `LEFT JOIN` (`:63`), and — the subtlest — the leaf filter applied *on the join predicate* (`:65-72`) so a certified parent section can never enter a leaf numerator. `COUNT(*) FILTER` throughout, `mastery` NULL via `NULLIF`, and the CU16 roll-up reuses it via `p_section_id` rather than reimplementing. There is no duplicate formula in TypeScript anywhere.
- **CU23's keys carry both components the spec calls out as easy to drop.** `sectionAwardKey` carries `revision`; `courseAwardKey` carries the *triggering* section and its revision (`course-points.ts:96-120`). `findLatestUnreversed` locates the reversal target by `NOT EXISTS (… reversal_of = t.id)` rather than assuming `revision − 1` — AT18 applied correctly, and `courses.test.ts:578` proves re-certification mints rather than colliding.
- **AT20 is exact.** `awardPunya`'s guarded insert is `on conflict … do nothing returning`, and `creditBalance` runs only on a non-empty return. The bespoke `reverseAward` (`course-certify.ts:139-157`) follows the same shape. No unguarded increment sits beside a guarded insert anywhere in the module.
- **CU26 is verified rather than asserted.** `buildCourseCertificatePdf` calls `createBilingual()`, and `course-certificates.test.ts:213-220` proves `NotoSansDevanagari` appears in the output while a `create()` control document does not. No Handlebars, no Puppeteer, and the job rides the existing `report.generation` queue with a `kind` discriminator rather than adding a 22nd queue name.
- **CU17's three-branch honorific is right on all three surfaces** — server (`course-certificate-pdf.ts:14-24`), mobile (`course-labels.ts:37-44`), and the snapshot carries `honorific_en`/`honorific_hi` so the PDF cannot re-derive it wrongly. The "silently falls back to Guruji" bug the rule was written to prevent is absent.
- **CU4's release-day landmine is defused twice over.** `0051:104-106` forces every row to `'draft'` *before* the enum conversion, which also guarantees the `USING …::course_status_enum` cast cannot fail on a legacy value. Backfill first, then convert, is the right order.
- **The certification audit shares the certify transaction.** `writeAudit(…, tx)` at `course-certify.ts:510` plus `audit.ts:47` (`if (tx) throw err`) means a failed audit rolls the certification back — CU18's requirement holds structurally, not by convention.
- **CU12's freeze is explained on the device rather than left to a 409.** `CourseLearnerRow.tsx:56-66` intercepts the tap and shows the reason; the content sheet renders the same copy inline. And CU20's rejection is mapped to actionable copy on the web — *"That section has certifications — archive the course instead of deleting it."*
- **Q12's release coupling was honoured.** The sanchalak's mobile certification screen shipped in the same release as the shikshak gate. So did CU31's companion `CLAUDE.md` amendment — the 9-value union, both queues, both drain positions and both conflict rules are there.
- **Orphaned `syncing` ops are recovered on relaunch** (`sync-engine.ts:347-365`), backoff matches the spec ladder exactly including full jitter, and all 19 bilingual fallbacks on mobile use `||` not `??`, so a server-side `""` correctly falls through to English.
- **Zero hardcoded colours across seven web files**, and every icon-only button in the tree editor carries an `aria-label`.

---

## Recommended order of work

1. **C1 + C2** — guard the course-bonus reversal on `nodeKind === 'section'`, and make re-issue clear `voided_at` (or exclude voided rows from the partial unique indexes). Then **audit production**: any student who has been through a correction may be holding a void certificate or a missing bonus right now. Add tests 2 and 3 above. *Do this before the next super_admin correction.*
2. **C6** — decide what `/v1/public/courses` is for. If it is a marketing surface, restrict it to `kind='standard' AND city_id IS NULL` and drop `punya_points`; if it is not, delete it and point the mobile guest branch elsewhere.
3. **C3** — stop nulling `client_marked_at`/`client_op_id` on update (omit them from `set`, or `coalesce(excluded.…, existing)`), and move the ordering predicate into the upsert's `setWhere` so Postgres arbitrates rather than a read-then-write. Send `marked_at` and `client_op_id` from the online client, and align the field names with CU §8 (`marked_at`, `certification_note`, `certified_at`).
4. **C4** — delete `course-progress-cascade.ts`. If a "close everything under this section" affordance is wanted, it belongs on the server as an explicit, audited action with its own confirm — not as a silent client fan-out that defeats CU15 and CU16 simultaneously. Then render the five divergence fields the API already returns.
5. **C5** — make the mutation hooks throw on `conflict`/`failed`, derive `synced` from an actual success status rather than from absence, and quarantine a corrupt queue under a `.corrupt` key instead of returning `[]`.
6. **H1, H2, H4, H6** — the reachability and scope set. Fix `cityIdsForAuthor` by calling the correct helper; join `courses` in `resolveNodeKind` and the certify lookup and reject non-visible courses; validate the *destination* city on PATCH; fall through to `inCentreScope` for a null `batch_id`. Add the state_admin and sanchalak logins from test 5.
7. **H3** — a missing or inactive `punya_features` row must award 0, not award unclamped. One-line fix, largest silent blast radius in the Punya path.
8. **H29** — before the next deploy. Then **H27** (savepoint the 23505 retry) and **H7** (advisory lock on the completion check).
9. **H8, H9, H17, H21, H25** — the offline set, as one coherent piece: per-op independence on `/v1/sync/batch`, an attempt cap on the missing-result branch, a queue for bulk, an optimistic pending state, and `submission_op_id` on the bulk body.
10. **H11, H12, H13, H14** — the web admin's four ways to lose an admin's work or mislead them. H13 first: it actively asserts the opposite of the truth.
11. **H15, H16, H5, H10, H22, H24, H26, H31, H32**, then the Medium set. **M1** (deactivated students in `fn_course_progress`) and **M2** (the childless-section NULL belongs in the function) are worth pulling forward — both are single-place fixes in the one canonical calculation everything else reads from.

---

## Note on spec status

`docs/CURRICULUM_ENHANCEMENT.md` still reads *"Status: design agreed, not yet implemented"* and instructs that CU1–CU33 move into `CLAUDE.md` verbatim on approval. The module is shipped; only the CU31 offline amendment made the trip. Until the rest follows, the binding rules for a live module — CU12's freeze, CU22's clamp, CU25's predicate, CU28's canonical calculation — are documented in a file that describes itself as a proposal, and `CLAUDE.md` outranks it by the precedence line at the top of that same file.

Separately, and unchanged from prior reviews: this repo is Express + `apps/api-server` + `lib/db` while `CLAUDE.md` specifies NestJS + `apps/api` + `packages/shared`. Out of scope here and not counted against the module — but the AT18/AT20/AT21/AT26, audit, bilingual, error-code and design-token rules cited throughout are stack-independent and do apply.
