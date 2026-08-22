# Centres & Batches Module — Full Code Review

**Date:** 2026-08-15 · **Reviewer:** Claude (Cowork)
**Format:** persona → navigation → action → observed vs expected

## Scope reviewed

| Layer | Files |
|---|---|
| API — centre CRUD, batch create, holidays, reports | `apps/api-server/src/routes/v1/admin-resources.ts` (1977 L) |
| API — batch list, timetable, activate/deactivate | `apps/api-server/src/routes/v1/admin.ts` (948 L) |
| API — centre & batch staffing | `apps/api-server/src/routes/v1/admin-staffing.ts` (1411 L) |
| API — public centre browse | `apps/api-server/src/routes/v1/public.ts`, `routes/v1/centres.ts` |
| Scope / RBAC | `apps/api-server/src/lib/scope.ts`, `lib/route-helpers.ts`, `lib/api-zod/src/contracts.ts` |
| Reports | `apps/api-server/src/lib/centre-monthly-report.ts` |
| Schema | `lib/db/src/schema/centres.ts` (centres, batches, centre_holidays, assignments) |
| Web admin | `BatchesPage.tsx`, `CentreStaffPage.tsx`, `AdminListPages.tsx` (CentresPage / HolidaysPage / ReportsPage), `AdminRoutes.tsx`, `AdminLayout.tsx`, `sidebar-nav.ts` |
| Web public | `public/CentresPage.tsx`, `public/CentreDetailPage.tsx`, `PublicRoutes.tsx` |
| Mobile | `app/admin/batches.tsx`, `app/admin/centres.tsx`, `app/shikshak/batches.tsx`, `app/centres.tsx`, `app/guest/centres.tsx`, `components/CentresBrowseScreen.tsx`, `components/CentreSwitcher.tsx` |
| Tests | `staffing.test.ts`, `centre-monthly-reports.test.ts`, `perf13-batch-city-cache.test.ts`, `perf13-scope-memo.test.ts` |

Persona hierarchy used: `super_admin → state_admin → city_admin → sanchalak → shikshak → parent → student` (+ guest).

---

## Verdict

**The staffing half of this module is the strongest part.** `admin-staffing.ts` gates every one of its nine mutations on an explicit role predicate, checks centre/batch ownership on all eleven routes, soft-deletes rather than hard-deletes, enforces exactly-one-primary at the database level with a partial unique index, audits every mutation, and never writes `users.role` for an existing user — there is no privilege-escalation path through staff assignment. That is a well-built surface.

The failures are concentrated in four places:

1. **The batch write routes forgot their role gate.** `POST /v1/admin/batches`, `PATCH /v1/admin/batches/:id/timetable` and `POST /v1/admin/batches/:id/:action` authorise on centre *scope* only. `requireAdminPanel` admits `shikshak`, so a Guruji can create batches, rewrite any timetable at their centre, and deactivate colleagues' batches. Creating a batch with themselves as primary *widens their own `scope.batchIds`* — this is a genuine escalation, not just a scope smell. Every neighbouring centre route (`POST /centres`, `PATCH /centres/:id`) has the gate; these three do not.

2. **The Holiday calendar page is entirely non-functional.** The UI issues `POST`, `PATCH` and `DELETE` against `/v1/admin/centres/:id/holidays[/:hid]`. **None of those three routes exists anywhere in `apps/api-server/src`** — only two GETs do. AT10 (holidays cancel sessions) cannot be configured through any surface.

3. **Nothing in this module can be edited after creation.** There is no `PATCH /v1/admin/batches/:id`, and `PATCH /v1/admin/centres/:id` accepts `{status}` and nothing else. A typo in a centre name, a wrong capacity, a batch scheduled Tue/Thu instead of Sat/Sun — all permanent. The one edit route that *does* exist, `PATCH /batches/:id/timetable`, has **no caller on web or mobile**.

4. **The GPS geofence has no write path.** `centres.lat` / `lng` are nullable with no writer in any route, and `gps_radius_meters` is stuck at its 250 default. AT13/AT14 attendance geofencing has no reference point to compare against.

**Headline count:** 2 Critical · 17 High · 24 Medium · 16 Low.

**Also: soft delete is decorative.** Nothing anywhere writes `centres.deleted_at` or `batches.deleted_at` (verified by grep across `apps/api-server/src` — the writers that exist are for courses, library, gallery, homework, team and users). Every `isNull(centres.deleted_at)` filter in the module is defensive-only today, which is why several missing filters below are rated Low rather than High.

---

# 1. Guest / Parent / Student — public centre browsing

**Entry points:** Web `/centres` → `/centres/:id` (`PublicRoutes.tsx`). Mobile `app/guest/centres.tsx` and `app/centres.tsx`, both thin shims over `CentresBrowseScreen`. All reachable and correctly unauthenticated. ✅

### G-1 · A network failure is presented as "no Pathshalas exist" — **HIGH**

| | |
|---|---|
| **Navigation** | Public site → **Centres** |
| **Action** | Open the page on a patchy mobile connection (or during a 500) |
| **Observed** | `CentresPage.tsx:22-26` is `.then(r => r.ok ? r.json() : { data: { items: [] } })` followed by `.catch(() => {})` — a 500, a 502 and a DNS failure all resolve to an empty list, which renders "अभी कोई केंद्र सूचीबद्ध नहीं है। / No centres listed yet." (`:53-56`). A parent is told the Megh Sanskar Vatika network has **no Pathshalas at all**. Sharing a centre link is worse: `CentreDetailPage.tsx:111-113` catches every transport error into `setNotFound(true)`, rendering "यह केंद्र नहीं मिला। / Centre not found." (`:137-139`). Neither offers a retry. |
| **Expected** | Distinguish transport failure from an empty/404 result — "We couldn't load centres just now, check your connection" + retry. `CentreDetailPage.tsx:80-82` already handles a real 404 separately and correctly; the `.catch` is what collapses the two. |

### G-2 · Hindi visitors get English day names and a raw DB enum — **MEDIUM**

| | |
|---|---|
| **Navigation** | `/centres/:id` in Hindi |
| **Action** | Read a batch's schedule line |
| **Observed** | `CentreDetailPage.tsx:42, 49, 178` maps `day_of_week` through a hardcoded English `['','Mon',…,'Sun']`, so "Mon, Wed" appears mid-Devanagari — while `formatAgeGroups` on the *very next expression* (`:174`) is correctly localised. Line `:180-182` renders `{b.language_preference}` raw; it is `languageEnum` (`schema/centres.ts:73`), so the caption reads `hi` or `en`. Both public pages also render an English-only "Loading…" (`CentresPage.tsx:52`, `CentreDetailPage.tsx:126`). |
| **Expected** | Localised day names, a label map for `language_preference`, localised loading copy. |

### Medium / Low — public

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| G-3 | M | Mobile guest → Centres tab, large state | `CentresBrowseScreen.tsx:21-26` groups by `state_name` only; web groups **state → city** (`public/CentresPage.tsx:29-35, 59-65`). A guest in Maharashtra scrolls one undifferentiated block; the city is small secondary text inside each card (`:72`). Neither surface has search. **Expected:** mirror web's two-level grouping or add a city filter. |
| G-4 | M | Mobile browse in Hindi | `CentresBrowseScreen.tsx` sets **zero** `lineHeight` (`:52-60, 70-77`), against CLAUDE.md's 22 px Devanagari minimum — matras clip. `app/shikshak/batches.tsx` is the same throughout. Sibling `app/admin/centres.tsx` sets 22-24 on every text node (`:43, 56, 59, 60, 63, 94, 115, 116, 173, 174, 183`), so this is drift, not an unset convention. |
| G-5 | L | Any public centre page after a future soft-delete lands | `public.ts:54-55, 83, 103` filters `status = 'active'` with **no** `isNull(centres.deleted_at)`; the admin equivalent filters both (`admin-resources.ts:119-120`). Latent only because nothing writes `deleted_at` (see X-1). |
| G-6 | L | Hindi visitor reads a centre or batch name | `schema/centres.ts:37, 67` — `centres.name`, `centres.locality` and `batches.name` have **no `_hi` variant**, unlike `niyams.title_en/_hi` and `notices.title_en/_hi`. Rendered raw at `CentreDetailPage.tsx:149, 151, 172`. Schema-level, so flag as a conscious decision rather than a route fix. |
| G-7 | L | Signed-in user opens `/centres` on mobile | `app/centres.tsx:4` renders `CentresBrowseScreen` **without** `tabBarInset`, while `app/guest/centres.tsx:4` passes it — so the signed-in route has no title/subtitle at all. That one boolean also controls a hardcoded `paddingBottom: 110` (`:13, 30-36`) instead of `useBottomTabBarHeight()`, so the last card is occluded at large text scale. *Needs verification — no `_layout.tsx` was in scope, so a native header may cover the first half.* |

---

# 2. Shikshak (Guruji / Didi) — `role: shikshak`

`contracts.ts:154-164` puts `shikshak` in `ADMIN_PANEL_ROLES`, and `middlewares/auth.ts:55-62` is the only gate on both `admin-resources.ts:72` (`router.use(requireAuth, requireAdminPanel)`) and `admin.ts:124`. The file's own convention is explicit — `POST /centres` (`admin-resources.ts:1477-1481`) and `PATCH /centres/:id` (`:1552-1556`) both add a role floor on top, and `contracts.ts:169-196` repeats three times that "sanchalak and shikshak can open the admin panel but must NOT …". **The batch routes are the ones that missed it.**

### SH-1 · Can create a batch and self-assign as primary — widening their own write scope — **CRITICAL**

| | |
|---|---|
| **Navigation** | `POST /v1/admin/batches` with a shikshak token (or `/admin/batches` → **Add batch** in the browser — see SH-4) |
| **Action** | Create a batch at a centre they are tagged to, passing their own user id as `primary_shikshak_id` |
| **Observed** | `admin-resources.ts:1638-1645` — the only authorisation is `inScope(scope, body.centre_id)`. For a shikshak, `scope.centreIds` is every centre they are tagged to (`scope.ts:86-111`), so this passes. The `primary_shikshak_id` branch then requires the target to be an active shikshak (`:1662`) tagged to the centre (`:1677`) — **the caller satisfies both** — and inserts `shikshak_batch_assignments {is_primary: true}` (`:1690-1695`). On the next request `resolveAdminScope` returns that batch in `scope.batchIds`, widening every `inBatchWriteScope` gate downstream. They can also name a *different* shikshak as primary, which is exactly the operation `admin-staffing.ts:545` restricts to `isSanchalakPlus` — so the batch-staffing gate is bypassable by creating a new batch. |
| **Expected** | `isSanchalakPlus` on `POST /v1/admin/batches`, matching the sidebar's own declared floor (`sidebar-nav.ts:69`, `min: 'sanchalak'`) and every neighbouring centre route. |

### SH-2 · Can rewrite any batch's timetable at their centre — **HIGH**

| | |
|---|---|
| **Navigation** | `PATCH /v1/admin/batches/:id/timetable` |
| **Action** | Change `day_of_week` on a batch taught by another Guruji |
| **Observed** | `admin.ts:690-725` — no role predicate; the only check is `inScope(scope, batch.centre_id)` (`:709`), i.e. **centre**-level. The same file two routes earlier deliberately narrows a shikshak to their assigned batches *for reads* (`scopedBatchFilter`, `admin.ts:650`) — so a shikshak can read only their own batches but **write** the schedule of every batch in the centre. The write then calls `rematerialiseBatch` (`:722-723`), deleting and recreating future sessions and, per AT9, notifying affected parents. `body.day_of_week = []` passes both the "at least one field" check (`:698` — an empty array is truthy) and the update (`:716`), so a batch's entire schedule can be wiped. |
| **Expected** | `isSanchalakPlus` + `inBatchWriteScope(scope, batch.id, batch.centre_id)`, not the `@deprecated` centre-level `inScope` (`scope.ts:138-141`). |

### SH-3 · Can deactivate colleagues' batches — **HIGH**

| | |
|---|---|
| **Navigation** | `POST /v1/admin/batches/:id/deactivate` |
| **Action** | Deactivate any batch at a centre they are tagged to |
| **Observed** | `admin.ts:740-781` — again `inScope(scope, batch.centre_id)` only. The catch-all accepts exactly `activate` and `deactivate` (`:742`, unknown actions correctly 422 before any DB work). `activate` enforces the primary-shikshak invariant (`:761-776`, `ERR_NO_PRIMARY`); `deactivate` has no precondition, no audit, and no cascade. Per AT7, `session.materialise` expands only active batches, so the target Guruji's class silently stops producing sessions. |
| **Expected** | `isSanchalakPlus`, plus batch-level scope for any shikshak path that is retained. |

### SH-4 · `/admin/batches` renders in full for a role the sidebar hides it from — **HIGH**

| | |
|---|---|
| **Navigation** | Type `/admin/batches` (bookmark, shared link, or the link at `BatchesPage.tsx:117`) |
| **Action** | Land on the page |
| **Observed** | `AdminRoutes.tsx:99` registers the route unconditionally; `AdminLayout.tsx:26` gates only on `canAccessAdminPanel` (which admits shikshak); and `BatchesPage.tsx` contains **zero `useAuth` references** — verified by grep. `AddBatchDialog` renders unconditionally at `:449`, unlike `AddCentreDialog` which is correctly gated on city_admin+ (`AdminListPages.tsx:136-145`). The sidebar hides the item (`sidebar-nav.ts:69`) — that is the only barrier, and it is UI-only. Combined with SH-1/SH-3, every button on this page **works**. |
| **Expected** | Page-level `sanchalak+` guard with an access-denied state, matching `ExamGradingPage`'s pattern. Same for `ExamsPage`-style route registration. |

### SH-5 · `/admin/centres/:id` shows a shikshak a Remove button next to their own name — **HIGH**

| | |
|---|---|
| **Navigation** | `/admin/centres/<their centre>` (linked from `BatchesPage.tsx:117, 393`) |
| **Action** | Land on the staffing page |
| **Observed** | `AdminRoutes.tsx:115` registers it unconditionally. `CentreStaffPage.tsx:64-65` gates only `canManageSanchalaks` (CITY_PLUS), which hides the Sanchalak card; the Shikshak card at `:409-598` renders for everyone. For a shikshak caller `GET /centres/:id/shikshaks` correctly returns **only themselves** (`admin-staffing.ts:291`), so they see a one-row list — with a **Remove** button beside their own name. "Pick existing" is empty because `GET /users/pick` 403s (`admin-staffing.ts:1327-1330`) and the `.catch(() => setPick*([]))` at `:124, 128` swallows it silently. Every button toasts "Could not add staff." / "Could not remove shikshak." |
| **Expected** | Gate the page on `sanchalak+`; if a read-only view is wanted, suppress the mutation controls. |

### SH-6 · Reads the centre head's personal phone number — **MEDIUM**

| | |
|---|---|
| **Navigation** | Mobile → Admin → Centres → tap a centre. Or `GET /v1/admin/centres/:id/sanchalaks`. |
| **Action** | Open the centre detail |
| **Observed** | `admin-staffing.ts:92-117` has **no role narrowing** and selects `users.phone` (`:103`). Its two sibling GETs deliberately filter a shikshak caller down to their own row (`:291`, `:524`) — so the policy is clear and this route just missed it. Web *hides* the call behind `canManageSanchalaks` (`CentreStaffPage.tsx:98-101`) — a UI-only guard that curl bypasses — while **mobile renders it to everyone**: `app/admin/centres.tsx:28` calls `useCentreSanchalaks` unconditionally and `:113-119` prints `full_name` and `phone`. So the two clients disagree about who may see this. |
| **Expected** | Pick one intent. Either narrow the route server-side like `/shikshaks`, or make it a real staff directory and show it consistently on both surfaces. |

### Medium / Low — shikshak

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| SH-7 | M | Type `/admin/reports` | Route registered (`AdminRoutes.tsx:136`), sidebar `min: 'sanchalak'` (`sidebar-nav.ts:113`), page has no gate (`AdminListPages.tsx:1356`), and the API is **scope-only** (`admin-resources.ts:803-812` GET, `:706-730` POST) — unlike the sibling holidays GET which does gate (`:669-673`). A shikshak gets a **working** page: they can queue unlimited `report.generation` jobs (the upsert at `:742-761` just re-queues, no rate limit) and download 7-day signed URLs to centre-wide trustee PDFs carrying attendance %, niyam/homework completion, enrolment movement and Punya totals (`centre-monthly-report.ts:43-62, 285-320`). |
| SH-8 | M | Type `/admin/shikshaks` | Same shape (`AdminRoutes.tsx:98`, `sidebar-nav.ts:62`, no page gate at `AdminListPages.tsx:1036`, scope-only API at `admin-resources.ts:614-634`). Working list of every colleague at their tagged centres **with phone numbers**. |
| SH-9 | M | Type `/admin/holidays` | Route + page ungated (`AdminRoutes.tsx:118`, `AdminListPages.tsx:1215`); the API *does* gate at `sanchalak+` (`admin-resources.ts:670-673`), so the page renders with "Add holiday" and then an error banner containing the raw server string **"Sanchalak or higher required."** — English, in a Hindi UI, stating no fix. |
| SH-10 | M | `GET /v1/admin/attendance/centres/:id/log` | `admin-resources.ts:1053-1059` — no role predicate, so a shikshak gets the whole centre's session log and, via `?session_id=`, the full roster of a batch they don't teach. Separately `const centreId = String(req.params.id)` skips `UUID_RE` (defined at `:74` and used in four other routes in this file), so for a super_admin (`centreIds === null`) any string reaches Postgres → `22P02` → 500. `admin.ts:49-50` documents the regex as existing precisely to prevent this. `GET /centres/:id/holidays` (`:674`) has the same missing UUID check. |
| SH-11 | L | `GET /v1/admin/staffing/me?user_id=<anyone>` | `admin-staffing.ts:789-795` gates the override on `isSanchalakPlus` but never checks the target is in `scope.centreIds` — a sanchalak in Mumbai reads any user's tagged centres and batches nationally. Combined with SH-8 (which hands out the ids) this is a usable enumeration path. A non-UUID `user_id` is silently ignored (`:789`) and the caller's own record returned instead of a 422. |

---

# 3. Sanchalak (Centre head) — `role: sanchalak`

The primary day-to-day operator of this module. Inherits nothing from §2 (a sanchalak legitimately holds those permissions) — these are its own failures.

### SN-1 · "Save batches" silently demotes another Guruji — even on a no-op save — **HIGH**

| | |
|---|---|
| **Navigation** | `/admin/centres/:id` → Guruji list → **Batches** next to Didi B |
| **Action** | Open the editor to *look*, change nothing, click **Save batches** |
| **Observed** | `CentreStaffPage.tsx:271-277` seeds `editPrimaryId` to `(s.batches ?? []).find(b => b.is_primary)?.batch_id ?? ids[0] ?? ''` — if Didi B is primary of nothing, it silently defaults to her **first** batch. `:298-300` then unconditionally `POST`s `/v1/admin/batches/${editPrimaryId}/primary`, and `admin-staffing.ts:757-772` demotes the sitting primary inside the same transaction. Guruji A has just lost primary on that batch. No confirmation, no warning; the only evidence is the "Primary Guruji / Didi" column on `/admin/batches` now reading a different name. The add flow does the same (`CentreStaffPage.tsx:137-145` → `admin-staffing.ts:1031-1034, 1052-1059`), and the audit entry (`:1301-1312`) records `batch_ids` but **not** the demoted user, so it is untraceable. |
| **Expected** | Only call `/primary` when the selection actually changed; add a "No primary batch" option; warn when the chosen batch's primary is someone else. The per-batch route already has the right default (`admin-staffing.ts:592`, `makePrimary = body.is_primary === true`) — the two routes disagree. |

### SN-2 · Create-without-primary → deactivate → permanently stuck — **HIGH**

| | |
|---|---|
| **Navigation** | Web `/admin/batches` → **Add batch**; or mobile Admin → Batches → **Create** |
| **Action** | Leave "Primary Guruji / Didi" on **None yet** (both forms label it *optional* — `BatchesPage.tsx:388-409`, `app/admin/batches.tsx:295, 308-312`), create, use the batch for weeks, then deactivate it. Now try to reactivate. |
| **Observed** | `admin.ts:762-775` returns `422 ERR_NO_PRIMARY` — "Assign a primary shikshak before activating this batch." On web the sanchalak can escape via the Staff dialog on the same row, but nothing in the toast says so. **On mobile there is no batch-staff UI at all** (the only writes in `app/admin/batches.tsx` are create at `:186` and activate/deactivate at `:396`), so the alert names an action with no screen, in English, inside a Hindi dialog titled "त्रुटि". The batch is permanently inactive. The same trap fires after a Guruji is removed from the centre (`admin-staffing.ts:465-481` clears all their batch assignments including primary). |
| **Expected** | Either require a primary at creation (drop "optional"), or route the failure into the staffing UI. `GET /v1/admin/batches` already returns `shikshak_name` (`admin.ts:660`), so the client can predict the 422 and disable the button with inline copy — no round trip needed. |

### SN-3 · A batch is created `active` with no primary, bypassing the invariant that exists to prevent exactly that — **HIGH**

| | |
|---|---|
| **Navigation** | `POST /v1/admin/batches` without `primary_shikshak_id` |
| **Action** | Create |
| **Observed** | `admin-resources.ts:1702-1711` inserts with no `status`, and `schema/centres.ts:74` defaults it to `'active'`. So the batch is immediately live with no Guruji — the precise state `admin.ts:761-776` refuses to allow through the activate route, with a dedicated error code and a test (`staffing.test.ts:249`). AT7 then materialises 60 days of sessions for a batch nobody teaches, and nobody can be alerted because nobody is assigned. |
| **Expected** | Create as `status='inactive'` unless a primary is supplied, forcing every batch through the route that enforces the invariant. |

### SN-4 · Removing the last Guruji leaves an active, unteachable batch — **HIGH**

| | |
|---|---|
| **Navigation** | `/admin/centres/:id` → **Remove** on the last Guruji, or `/admin/batches` → Staff → Remove |
| **Action** | Remove the only shikshak from an active batch |
| **Observed** | `admin-staffing.ts:702-710` sets `is_primary: false` unconditionally with **no check on `batches.status`** and no check that another shikshak remains; the centre-level removal (`:466-481`) does the same across every batch at that centre. The batch keeps `status = 'active'`, `session.materialise` keeps producing sessions, and no shikshak has it in `scope.batchIds` — so `inBatchWriteScope` denies every teacher and attendance is only markable through the sanchalak safety net. The response is a plain `{removed: true}` (`:719`); no warning, no notification. The API has a symmetric guard for the other side — `ERR_LAST_SANCHALAK` (`:230`) — so the pattern exists and was not applied here. |
| **Expected** | An `ERR_LAST_SHIKSHAK`-style 422, or auto-deactivate the batch, or at minimum warn and notify the sanchalak. Nothing in this file looks at `sessions` at all. |

### SN-5 · Nothing in this module can be edited after creation — **HIGH**

| | |
|---|---|
| **Navigation** | `/admin/batches` → look for an edit control |
| **Action** | Fix a batch created as Tue/Thu that should have been Sat/Sun |
| **Observed** | There is none. `BatchesPage.tsx:96-221` renders only **Staff** and **Deactivate/Activate** per row; mobile is the same. `PATCH /v1/admin/batches/:id/timetable` **does exist** (`admin.ts:690-725`, with the AT9 `rematerialiseBatch` call at `:722`) and has **no caller anywhere** — grep for `timetable` across `apps/jain-pathshala/src` and `apps/jain-pathshala-mobile` returns nothing. There is no PATCH at all for a batch's name, capacity or age groups. The only recourse is deactivate + re-create, which orphans the original's enrolments, sessions and attendance history — and per SN-2 the deactivation may be one-way. |
| **Expected** | Wire an edit dialog to the existing timetable route (it already rematerialises and notifies), and add `PATCH /v1/admin/batches/:id` for the metadata columns. |

### SN-6 · Deactivate is one click, no confirmation, on both surfaces — **HIGH**

| | |
|---|---|
| **Navigation** | `/admin/batches` row actions; mobile batch card |
| **Action** | Mis-click **Deactivate** on the row above the intended one |
| **Observed** | Web `BatchesPage.tsx:58-71` + `:218-220` fires `apiPost` straight from `onClick`. Mobile `app/admin/batches.tsx:392-403` calls `mutate.mutate` directly — in a file that uses `Alert.alert` for an *incomplete form* (`:173, :177`) and for a *success toast* (`:199`). The batch flips to `inactive` instantly; sessions stop being scheduled; the Guruji can no longer mark attendance. Feedback is a green "Batch deactivated." toast on web and nothing but a Pill flip on mobile. Compare `CentreStaffPage.tsx:193, 244-250` and `AdminListPages.tsx:1183-1186`, which both confirm with a consequence sentence. |
| **Expected** | A destructive confirm naming the batch and the consequence ("New sessions will stop being created"). Same for **Remove** and **Make primary** on `BatchesPage.tsx:177-207`, which sit adjacent in a `flex-wrap` row (`:175, :208`) and both fire bare. |

### Medium / Low — sanchalak

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| SN-7 | M | Staffing editor → untick 2 batches, tick 1 → **Save** → wifi drops mid-save | `CentreStaffPage.tsx:279-309` issues N sequential un-batched requests (remove per dropped batch `:287-291`, assign per kept batch `:292-297`, then `/primary` `:298-300`), and `toast.success`, `setEditingUserId(null)` and `await reload()` are **all inside the `try`** (`:301-303`). The first removal already committed; the sanchalak sees "Could not update batches.", the editor stays open showing the **pre-change** checkboxes, and retries — or concludes nothing happened. **Expected:** `reload()` in a `finally`, re-seed from server state, and reuse the transactional `POST /centres/:id/staff` (`admin-staffing.ts:1202`) which the *add* path already uses. |
| SN-8 | M | Add batch → tap no day chips → **Create** | Neither client validates days: web guard is `!name.trim() \|\| !centreId \|\| ageGroups.length === 0 \|\| !startTime \|\| !endTime` (`BatchesPage.tsx:290`, mirrored at `:412`); mobile `app/admin/batches.tsx:176-184` is the same; server is `.default([])` (`admin-resources.ts:1624`). Neither labels "Days of week" with a `*` (`BatchesPage.tsx:366`, `app/admin/batches.tsx:280`) while every other required field has one. The batch is created **active**, AT7 expands an empty array, and it never produces a single session — silently, forever. |
| SN-9 | M | Enter 18:00 → 09:00, or type "99:99" | `end_time` is never compared to `start_time` on either client or server — `createBatchSchema` has a `superRefine` but it only checks age groups (`admin-resources.ts:1616-1635`), and `patchTimetableSchema` is worse: sending only `start_time` never compares against the stored `end_time` (`admin.ts:713-720`), so a valid batch can be *turned into* an inverted one. Both time regexes are shape-only `/^\d{2}:\d{2}(:\d{2})?$/` (`admin-resources.ts:1622-1623`, `app/admin/batches.tsx:29`), so "99:99" passes zod and dies on the Postgres `time` cast (`22007`) → unhandled → 500. The file already has the right pattern: `isValidReportMonth` range-checks after the regex (`centre-monthly-report.ts:17-21`). Downstream, AT12 auto-checkout keys on `scheduled_end_time + 2h`, already past at session start. |
| SN-10 | M | Mobile → Create batch, offline or after a failed centres fetch | `app/admin/batches.tsx:125-134` reads only `.data?.items ?? []`; `isError`/`isLoading` are never inspected. `CentreSwitcher.tsx:28` returns `null` when `centres.length <= 1`, so the sheet shows the heading "केंद्र * / Centre *" with **nothing underneath**, and tapping Create alerts "पहले केंद्र चुनें। / Select a centre first." with no control to select one. With exactly 1 centre the switcher also disappears but `usePersistedCentreId` has silently picked it (`:96-98`) — submission succeeds and the user is never told which centre it landed in. Same class at `:161` for shikshaks: a failed fetch renders "इस केंद्र पर पहले गुरुजी टैग करें" to a sanchalak whose centre has six tagged Gurujis. |
| SN-11 | M | Mobile → visit `/admin/centres` first, then Batches → Create | `CentreSwitcher.tsx:86-100` — effect A does an async `AsyncStorage.getItem`; effect B, with **no hydration guard**, fires as soon as `centres` is non-empty and does `setSelectedId(centres[0])` *plus* `AsyncStorage.setItem(...)`. When React Query already has the centres cached, B wins and overwrites the saved choice with the alphabetically-first centre. It survives the session but is gone on next launch. The same pattern is duplicated verbatim at `app/shikshak/batches.tsx:28-42`, and `CentreSwitcher.tsx:12` notes the key is shared with the staffing and holidays screens — so the wrong centre propagates. |
| SN-12 | M | Mobile → Centres → tap a centre → Android back | `app/admin/centres.tsx:131-139` holds the detail in `useState`, not a route. Hardware back exits `/admin/centres` entirely to `/admin/dashboard` (`:148-149`, hardcoded `backHref`), losing the place. Pull-to-refresh inside the detail refetches **only** sanchalaks (`:51-54`), so the GPS radius, batch count and active-student pills (`:71, 79, 87`) stay frozen at tap time. Selection is lost on app kill. |
| SN-13 | M | Mobile → Create batch → type capacity `0`, or `1000`, or `3.5` | `app/admin/batches.tsx:185` `Number(capacity) \|\| 30` turns `0` into 30 silently; `:194` clamps 1000 → 500 with no notice, so the sanchalak believes they set 1000; and `3.5` passes the clamp but fails the server's `.int()` (`admin-resources.ts:1625`) into the generic "Invalid batch data." naming no field. Capacity is also absent from the validation block at `:176-184`. |
| SN-14 | M | Any Hindi-locale sanchalak reads a batch or centre card | Status pills render the raw Postgres enum: `app/admin/batches.tsx:389`, `app/admin/centres.tsx:178-181`, `app/shikshak/batches.tsx:136` all pass `label={b.status}` → literally **active** / **inactive** beside otherwise fully-localised text. |
| SN-15 | M | Any error on the mobile batches screen | `app/admin/batches.tsx:202-207` surfaces `ApiError.message` verbatim — English server strings ("Centre not in your scope.", "Shikshak must be tagged to this centre first.", "Assign a primary shikshak before activating this batch.") inside a dialog titled "त्रुटि". Line `:398` doesn't even branch on `ApiError` and falls back to a hardcoded English `"Action failed"` regardless of locale. No `error.code` is ever mapped. |
| SN-16 | M | Mobile Admin → Batches as a city_admin | `app/admin/batches.tsx:343` renders `data?.items` flat — **no centre filter, no search** — while the shikshak screen has one (`app/shikshak/batches.tsx:49-53, 80-110`) and the create modal has one (`app/admin/batches.tsx:241-246`). `GET /v1/admin/batches` is city-scoped (`admin.ts:647`), so this is one unfiltered scroll of every batch in the city, each card carrying the unconfirmed Deactivate of SN-6. |
| SN-17 | M | Mobile → Create batch twice while offline | `app/admin/batches.tsx:327, 401` read only `isPending`; error handling lives solely in `onError` (`:202, :398`). If the QueryClient leaves `mutations` on React Query's default `networkMode: 'online'`, the mutation *pauses*: `isPending` stays true, `onError` never fires, the spinner never resolves. Re-tapping queues a second paused mutation and both fire on reconnect — `POST /v1/admin/batches` has no idempotency key and no duplicate-name check, so two identical batches appear. *Needs verification — the QueryClient construction was not in the reviewed set; this is the same defect confirmed in the Exams review.* |
| SN-18 | L | Mobile chips in Hindi | `app/admin/batches.tsx:57-63` — the `Chip` `<Text>` is raw and unstyled: `fontSize: 13`, no `lineHeight`, and `fontFamily: fonts.bodySemiBold` (`:59`) instead of the locale-aware `bodyFamily(hi)` used at all seven sibling call sites. It renders "सोम" / "बाल 5-8 वर्ष" (`:262, :285`). |
| SN-19 | L | Screen reader anywhere in mobile Centres/Batches | Grep for `accessibility` across all six mobile files returns **zero matches**. The day and age-group chips (`app/admin/batches.tsx:46-56`) convey selection by colour alone with no `accessibilityState`, and at ~30 px are below the 44 pt minimum. Same for the centre chips (`shikshak/batches.tsx:88-97`, `CentreSwitcher.tsx:51-60`) and every card `Pressable`. This is a regression against the 30+ mobile files that do set these. |
| SN-20 | L | Mobile → shikshak list on the create sheet | `app/admin/batches.tsx:161` `.filter(s => s.is_active)` is dead — `GET /centres/:id/shikshaks` already constrains `is_active = true` in its WHERE (`admin-staffing.ts:290`). Harmless, but it reads as if inactive rows were expected. Also `CentreSwitcher.tsx:17` declares a `storageKey` prop the component body never reads (all persistence is in the separate `usePersistedCentreId` hook, `:80-108`) — a future caller passing only `storageKey` gets silent non-persistence. |

---

# 4. City / State / Super Admin — centres, holidays, reports

**Navigation:** sidebar → Centres (`/admin/centres`), Batches (`/admin/batches`), Holiday calendar (`/admin/holidays`), Reports (`/admin/reports`) — all routed (`AdminRoutes.tsx:99, 115-118, 136`). ✅

### A-1 · The Holiday calendar page is entirely non-functional — **CRITICAL**

| | |
|---|---|
| **Navigation** | Sidebar → **Holiday calendar** |
| **Action** | Add a holiday, edit one, or delete one |
| **Observed** | The page calls `POST /v1/admin/centres/:id/holidays` (`AdminListPages.tsx:1115`), `PATCH .../holidays/:hid` (`:1169`) and `DELETE .../holidays/:hid` (`:1189-1191`). **None of those routes exists anywhere in `apps/api-server/src`** — a grep for `holidays` across every route file returns exactly two handlers, both GET: `admin-resources.ts:667` (admin list) and `centres.ts:13` (public, published-only). Every button 404s into a toast. The delete confirm even promises "This will restore N cancelled sessions" (`:1183-1186`) and reports `res.sessions_restored` (`:1192-1194`) from a response that never arrives. **Consequence:** AT10 — holidays cancel sessions — cannot be configured through any surface. The admin GET's dynamic import of `countRestorableSessions` with the comment *"Per-row estimate for the delete confirm"* (`admin-resources.ts:692-698`) shows the DELETE was designed and never shipped. |
| **Expected** | Ship the three routes (with the audit entries and `sessions_restored` contract the UI already expects), or remove the UI. |

### A-2 · A centre cannot be edited after creation — **HIGH**

| | |
|---|---|
| **Navigation** | Sidebar → Centres → look for an edit control |
| **Action** | Fix a typo in a centre's name, or set its contact phone |
| **Observed** | `patchCentreStatusSchema` is `z.object({ status: z.enum(["active","inactive"]) })` (`admin-resources.ts:1546-1548`) — **status and nothing else**. `name`, `code`, `locality`, `pincode`, `contact_phone`, `contact_email` are write-once at `POST /centres`. There is no edit dialog on web (`AdminListPages.tsx:140-160` renders name, code, city, counts and a link) and mobile's centre screen is read-only. Separately, **no client calls `PATCH /v1/admin/centres/:id` at all** — grep across both apps finds no `apiPatch` against it — so even the status toggle that *is* implemented (with `unpublishTeamMembersForCentre` and an audit entry) is unreachable from any UI. |
| **Expected** | Extend the schema to the editable columns and ship an edit dialog; wire the existing status toggle. |

### A-3 · The GPS geofence can never be configured — **HIGH**

| | |
|---|---|
| **Navigation** | Create a centre → try to set its location |
| **Action** | Any attendance check-in at that centre |
| **Observed** | `schema/centres.ts:44-48` defines `lat`, `lng` (nullable, no default) and `gps_radius_meters` (default 250, documented "AT13 — per-centre overridable"). `createCentreSchema` (`admin-resources.ts:1458-1468`) contains none of the three, and the insert (`:1533-1542`) never sets them; `patchCentreStatusSchema` cannot either. The value is only ever **read** — `admin-resources.ts:106`, rendered at `app/admin/centres.tsx:71-72`. So every centre has `lat = lng = NULL` and a radius nobody can change: AT13/AT14 has no reference point to compare a check-in against, and "per-centre overridable" is false. |
| **Expected** | Add the three columns to the create schema and a centre-edit route, with a map picker or lat/lng inputs. |

### A-4 · A duplicate Pathshala code is a dead end — **HIGH**

| | |
|---|---|
| **Navigation** | Centres → **Add centre** for a second Pathshala in the same locality |
| **Action** | Submit |
| **Observed** | `createCentreSchema` accepts an optional `code` (`admin-resources.ts:1462`) and derives one from `localityToken(...)` when absent (`:1496-1518`); a collision returns `409 ERR_DUPLICATE` — "Pathshala code MUM-GHK is already in use." (`:1520-1529`). But `AddCentreDialog` sends only `name, city_id, state_id, locality, contact_phone` (`AdminListPages.tsx:77-83`) and has **no code input** (`:103-121`). The city admin gets an error naming a field they cannot set, about a value they cannot see, with no centre-edit UI to inspect the existing centre's code. Editing the locality text is the only lever, and the locality → code mapping is invisible. |
| **Expected** | Surface an optional "Pathshala code" input pre-filled with the derived value, made editable when the server returns `ERR_DUPLICATE`. |

### A-5 · Adding staff can orphan a user account and burn the phone number — **HIGH**

| | |
|---|---|
| **Navigation** | `/admin/centres/:id` → Guruji card → Create new → tick a batch → **Add** |
| **Action** | Include a `batch_id` that does not belong to this centre (stale UI state, or a batch moved since load) |
| **Observed** | `admin-staffing.ts:1240-1287` runs four ungrouped steps: `insertStaffUser` (`:1241`) → `ensureCentreTag` (`:1268`) → `assignBatchesForCentre` (`:1273`) → audit (`:1301`). Only step 3 has an internal transaction (`:1038`); nothing spans them. Step 3 throws `ERR_BATCH_CENTRE_MISMATCH` (`:1028`), converted to 422 at `:1281-1284` — **after** the `users` row committed at `:913-926` and the centre tag at `:1268`. The admin corrects the batch list, resubmits the same phone, and now gets **409 `ERR_DUPLICATE`** (`:881-886`). The created user's id was never returned, so the `user_id` branch is unavailable, and `users/pick` excludes centre-tagged users (`:1365-1374`) so they are invisible in the picker. The account exists, is tagged, is unreachable, and the phone is burned. |
| **Expected** | Validate `batch_ids` against the centre **before** creating anything — the query at `:1017-1029` needs no user — or wrap create + tag + batches in one `db.transaction`. |

### A-6 · The staff picker's geography filter fails open — **HIGH**

| | |
|---|---|
| **Navigation** | `/admin/centres/:id` → Guruji card → **Pick existing** |
| **Action** | Open the dropdown as any admin whose `city_id` and `state_id` are both null |
| **Observed** | `admin-staffing.ts:1379-1386` is a three-way ternary whose final arm is `: undefined` — a null geo filter. `and(...)` drops it, and `:1388-1407` returns the first 200 shikshaks (or sanchalaks) **in the entire database, each with `phone`** (`:1392`). Not hypothetical: the test helper inserts staff with no city/state (`staffing.test.ts:57-61`). Two further defects in the same expression: `isNull(users.city_id)` leaks city-less users to every caller with phone; and a state_admin who also carries a `city_id` hits branch 2 and is wrongly narrowed to one city. Even on the intended path a **sanchalak** — a centre-scoped role — receives every shikshak in the city with phone numbers, well outside `scope.centreIds`. |
| **Expected** | Derive the filter from `resolveAdminScope`, never fall through to "no filter", drop the `isNull(...)` arm, check `state_id` before `city_id`, and return `display_code` rather than `phone` below city_admin. |

### A-7 · Deactivating a centre cascades to nothing — **HIGH**

| | |
|---|---|
| **Navigation** | `PATCH /v1/admin/centres/:id {status:"inactive"}` |
| **Action** | Close a Pathshala |
| **Observed** | `admin-resources.ts:1591-1604` updates `centres` and calls `unpublishTeamMembersForCentre`, and nothing else. Afterwards: `GET /v1/admin/batches` still lists that centre's batches as `active` (`admin.ts:677` filters only `isNull(batches.deleted_at)`); enrolment approval into those batches still succeeds (`admin.ts:876-928` never reads centre status); and AT7 materialisation expands "each active batch" — the batches are still active, so sessions keep generating for a closed centre. Deactivating a **batch** has the mirror problem: `admin.ts:779` sets `status` only and never removes the up-to-60 days of already-materialised sessions, unlike the timetable route which *does* call `rematerialiseBatch` (`:722-723`) — so a deactivated batch keeps appearing in `GET /v1/sessions/today` for its Guruji. |
| **Expected** | Cascade (deactivate batches, delete future zero-attendance sessions per the AT9/AT10 pattern), or block while active batches/students exist with an explicit `force` flag as AT25 does for session cancellation. |

### Medium / Low — admin

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| A-8 | M | Create a centre, create a batch, change a timetable, deactivate a batch — then open the audit log | **None of them appear.** `auditFromReq` is absent from `admin-resources.ts:1471-1544` (POST /centres), `:1638-1712` (POST /batches), `admin.ts:690-725` (timetable) and `admin.ts:740-781` (activate/deactivate) — while `PATCH /centres/:id` **in the same file** audits at `:1606`, and states, cities, settings, reports, students and shivirs all audit (`:1222, :1307, :1389, :1445, :1768, :1905, :1967`), as does every one of the nine staffing mutations. The asymmetry is the tell. CLAUDE.md: "All admin actions must write an audit entry." The timetable route in particular deletes and recreates sessions and notifies parents, with no trace. |
| A-9 | M | Two admins remove a sanchalak simultaneously | `admin-staffing.ts:209-249` — count (`:209-217`), identity lookup (`:219-228`) and `UPDATE` (`:235-249`) are three statements with no transaction and no row lock. Both read `activeCount = 2`, both skip the guard at `:218`, both updates land. The centre ends with **zero** active sanchalaks — the exact state `ERR_LAST_SANCHALAK` exists to prevent, and unrecoverable through this API. **Expected:** one transaction with `FOR UPDATE`, or a single conditional `UPDATE … WHERE (SELECT count(*) …) > 1`. |
| A-10 | M | Two admins create the same centre code concurrently; or reuse a soft-deleted centre's code | `admin-resources.ts:1523-1531` is `SELECT`-then-`INSERT` (`:1533-1542`) with no `try/catch`. The app check filters `isNull(centres.deleted_at)` (`:1526`) but `centres_code_uq` is `on(t.code).where(code is not null)` (`schema/centres.ts:56`) — it does **not** exclude soft-deleted rows. Both cases produce an unhandled `23505` → 500 instead of the intended 409. `POST /cities` in the same file gets this right (`:1315-1323`). Related: `composePathshalaCode` output is never length-checked against `varchar(16)` → `22001` → 500. |
| A-11 | M | Deactivate a centre, then reactivate it | `admin-resources.ts:1600-1604` — `if (body.status === "inactive") { unpublishTeamMembersForCentre(id) }` has **no `else`**. Reactivation never republishes, so a deactivate/reactivate cycle silently and permanently removes that centre's team from the public directory. The two writes are also un-transacted (`:1591-1599` then `:1601-1604`): if the unpublish throws, the centre is inactive, the staff are still public, and the caller sees a 500 for a change that landed. *Needs verification of `unpublishTeamMembersForCentre` semantics.* |
| A-12 | M | Reports → a month already showing **Download PDF** → click **Generate** | `admin-resources.ts:745-760` `onConflictDoUpdate` sets `status:"queued"`, `pdf_url: null`, `snapshot: null` — the live link vanishes **before** the new render exists, with no confirmation (`AdminListPages.tsx:1513-1515`). If the worker is down the row sticks at `queued`, `busy = generating \|\| pending` permanently disables the button (`:1482, :1513`), and the trustee PDF is unrecoverable from the UI. "Generate for all centres" (`:1452-1480`) does this to **every centre in the city** in one unconfirmed click. |
| A-13 | M | Holiday calendar filtered to Ghatkopar → **Add holiday** → pick Andheri in the dialog | The Add dialog has its own centre Select listing *all* centres (`AdminListPages.tsx:1136-1141`), independent of the page filter (`:1271-1276`); `onAdded → reload()` refetches only the filtered centre (`:1230-1258`). Toast reads "Holiday added." and the table does not change — so the admin adds it again, and again. **Expected:** lock the dialog to the filtered centre, or switch the filter to the centre just written to. |
| A-14 | M | Enter Paryushan Parva (8 days) | `AdminListPages.tsx:1143` is a single `<Input type="date">`; `schema/centres.ts:90-95` is one date per row and its own comment says "a Diwali week is currently seven rows" while AT10 is written in terms of ranges. The sanchalak opens the dialog eight times, re-selecting the centre and retyping the reason each time; any miss silently leaves a session scheduled on a holy day. |
| A-15 | M | Add centre → open the city dropdown as a Mumbai city_admin | `AdminListPages.tsx:66-68` reads `/v1/admin/geography`, which has **no role or scope filter** (`admin-resources.ts:1164-1184` returns all states and all cities). The admin picks Surat from a national list, fills the form, submits, and gets "Failed to create centre. / That city is outside your scope." (`:1489-1495`). |
| A-16 | M | Sanchalak opens Holiday calendar | `AdminListPages.tsx:1268` — the page subtitle is literally `"AT30 — admin holidays nested under centre; public GET /v1/centres/:id/holidays is published-only."` An internal rule ID and an HTTP route shipped as product copy, where every other page in the file uses human sentences (`:143-144, :1039, :1488`). |
| A-17 | M | `POST /v1/admin/students {batch_id}` into a full batch | Capacity is enforced transactionally on enrolment approval (`admin.ts:876-897` → `409 ERR_BATCH_FULL`), and the comment at `:873-875` says the guard "mirrors the capacity guard in the create-with-auto_approve path" — but the third door, direct student creation (`admin-resources.ts:1837-1857`), validates the batch's centre and age group and **never its capacity**. Capacity is advisory depending on which route a student arrives through. |
| A-18 | M | Open one centre's staffing page | `CentreStaffPage.tsx:103-104` fetches **all** centres (to read one name at `:108-109`) and **all** batches (filtered client-side at `:110`), and repeats both on every add/remove (`reload()` at `:182, 197, 233, 265, 303`). Neither endpoint paginates — `admin-resources.ts:90-124` has no `clampLimit` and runs a correlated `active_student_count` subquery per row; `admin.ts:645-680` likewise. A super_admin downloads every centre and batch nationally to render one page. **Expected:** `GET /v1/admin/centres/:id` and `?centre_id=` on the batches list. |
| A-19 | M | Screen reader on Add centre / Add batch | `AdminListPages.tsx:32-39` (`FormRow`) renders `<Label>` as a **sibling** of `children` with no `htmlFor` — used for every field in Add centre (`:103-121`) and Add holiday (`:1135-1144`); same at `CentreStaffPage.tsx:354-495` and `BatchesPage.tsx:323-389`. Every field announces "edit text, blank". The day-of-week chips (`BatchesPage.tsx:372-380`) and the Create/Pick mode switches (`CentreStaffPage.tsx:335-348, 412-425`) convey state by Tailwind class alone — no `aria-pressed`, no `role="radiogroup"`. The batch checkboxes at `CentreStaffPage.tsx:481-485, 560-564` **do** use `id`/`htmlFor`, so the fix pattern is already in the file. |
| A-20 | L | Open Holiday calendar for a centre with three years of history | `admin-resources.ts:680-698` — the holiday query has **no limit** (every other list route in the file uses `clampLimit`) and then `Promise.all` fires one `countRestorableSessions` **per row** (`:693-698`), ~60 extra queries per page load, purely to populate a confirm-dialog count for a delete route that doesn't exist (A-1). |
| A-21 | L | Any removal in the audit log | `admin-staffing.ts:255, 495, 712` all write `action: "assign"` for **removals**, with the real intent buried in `summary` free text or a `removed: true` metadata key. An auditor filtering by action cannot separate a staff grant from a revocation. |
| A-22 | L | Deactivate a user, then open their centre's staffing page | `admin-staffing.ts:98-115, 276-294, 527-539` all `innerJoin(users, …)` on **id only** — no `is_active`, no `deleted_at` — and the `ERR_LAST_SANCHALAK` count (`:209-217`) is the same. A deactivated sanchalak still appears as active staff and still blocks removal of the *real* remaining sanchalak. Note `userWithRole` correctly refuses to **assign** such a user (`:76-85`), so the write side is right and only the read side drifted. |
| A-23 | L | Soft-delete a centre, then staff one of its batches | `loadCentreInScope` filters `isNull(centres.deleted_at)` (`admin-staffing.ts:55`) but `loadBatchInScope` never joins `centres` (`:67-74`), and `resolveAdminScope` builds `centreIds` with no `deleted_at` filter (`scope.ts:57-60, 66-69`). So `POST /centres/:id/*` correctly 404s while `POST /batches/:id/shikshaks`, `/remove` and `/primary` all still succeed and write audit entries. Latent only because of X-1. |
| A-24 | L | Centres table → click a centre name | `AdminListPages.tsx:153` and `BatchesPage.tsx:117, 393` use raw `<a href>` inside a wouter SPA — full browser navigation, admin bundle re-download, auth context and sidebar state discarded. From `BatchesPage.tsx:393` this fires from **inside an open Add-batch dialog**, destroying the half-filled form. `CentreStaffPage.tsx:316` uses `<Link>` correctly. |
| A-25 | L | Centres list at national scale | No pagination anywhere: `AdminListPages.tsx:140` (`useAdminList` with no limit and no `AdminLoadMore`, though the hook supports it — see `:908, :920`), `BatchesPage.tsx:431`, `public/CentresPage.tsx:22`. All three render every row in one pass with no virtualisation, because the APIs return everything. |
| A-26 | L | Team directory / Centre Locator ordering | `schema/centres.ts:38-39` documents `centres.order` as "Stable Team directory / Centre Locator sort key (keyset pagination)". **No route reads or writes it** — `public.ts:57` and `admin-resources.ts:122` both order by state → city → name. Every centre has `order = 0`; the documented sort key does not exist in practice. |
| A-27 | L | `POST /v1/admin/batches` with a random `centre_id` as super_admin | `route-helpers.ts:25` returns `true` unconditionally when `centreIds === null`, so `inScope` passes and the insert violates the `batches.centre_id` FK → 500 rather than 404. `POST /students` loads and 404s the centre first (`admin-resources.ts:1827-1835`); this route doesn't. |
| A-28 | L | Shikshaks page after a Guruji's assignments are cleared | `admin-resources.ts:626-628` — two `innerJoin`s through `shikshak_batch_assignments`, so a shikshak tagged to a centre with zero batch assignments never appears. Immediately after `CentreStaffPage.removeShikshak` runs (`admin-staffing.ts:465-481`), that Guruji vanishes from `/admin/shikshaks` entirely; the only way to find them is to open each centre's staffing page. |

---

# 5. Platform / cross-cutting

| # | Sev | Area | Observed vs Expected |
|---|---|---|---|
| X-1 | M | Data model | **Soft delete is decorative for this module.** Nothing anywhere writes `centres.deleted_at` or `batches.deleted_at` — verified by grep across `apps/api-server/src` (the writers that exist target courses, library, gallery, homework, team and users). Every `isNull(...deleted_at)` filter here is defensive-only, which is why G-5, A-23 and the `centres_code_uq` gap in A-10 are latent today. They all go live the moment an archive path ships — so ship the filters *with* it, not after. |
| X-2 | M | Notifications | **Zero notification side effects on any staffing change** — grep for `notif\|enqueue\|queue\|push\|sms` across `admin-staffing.ts` returns only unrelated `Array.push`. A Guruji is assigned, removed, made primary, or dropped from a centre and is never told; the sanchalak is not told when a city_admin restaffs their centre; parents are not told when their child's batch changes teacher — contrast AT9, which requires notifying affected parents on a timetable change. All silent 200s. |
| X-3 | M | Directory sync | `syncTeamMemberForUser` is called on every centre-level mutation (`admin-staffing.ts:188, 262, 407, 507, 1175, 1314`) and on **none** of the three batch-level ones (`:544-664, :667-720, :723-782`). If `team_members` denormalises batch name or the primary flag — likely, since a shikshak's public display is "Guruji of X batch" — the directory goes stale on exactly the operations that change it. *Needs verification of `lib/team-members-sync.ts`.* |
| X-4 | M | Concurrency | Three staffing mutations do `SELECT` → branch → `INSERT`/`UPDATE` outside a transaction: sanchalak centre assign (`admin-staffing.ts:143-179`), shikshak centre assign (`:362-398`), and set-primary (`:741-772`). The first two race the partial unique indexes (`schema/centres.ts:124-127, 149-152`) into an uncaught `23505` instead of the idempotent 200 the sequential path returns. The third reads the assignment *before* the transaction opens (`:741-751` vs `:757`), so a row deactivated in between still gets `is_primary = true` — legal under the partial index, which is `where is_active AND is_primary` — leaving the batch with **no** active primary while the API reports `is_primary: true` (`:781`). **Expected:** `ON CONFLICT` for the assigns; move the lookup inside the transaction with `FOR UPDATE` for the primary. |
| X-5 | L | Error contract | Three codes for one semantic — `ERR_DUPLICATE` (`admin-resources.ts:1529`), `ERR_ALREADY_EXISTS` (`:1216, :1284`), `ERR_CITY_SLUG_CONFLICT` (`:1292`). Both create routes discard `err.issues` into a flat "Invalid centre data." / "Invalid batch data." (`:1474, :1641`) — so `BatchesPage.tsx:308` can only say "Failed to create batch.", naming no field — while the students route in the same file surfaces `err.issues[0].message` correctly (`:1800-1806`). `ErrorCode` is imported at `:65` and used twice; every other failure passes a raw string. `POST /centres` and `POST /batches` return **200** where `POST /states` and `POST /cities` return **201**. |
| X-6 | L | Scope helpers | Two `inScope` implementations with different null semantics: `route-helpers.ts:24-28` returns `true` for `(superAdminScope, null)` because the `centreIds === null` check precedes the null-id check; `scope.ts:118-122` (`inCentreScope`) returns `false` for a null centre id in every case. `admin.ts:44` and `admin-resources.ts:54` import the first; `admin-staffing.ts:21` imports the second. Not exploitable in the paths reviewed, but a live trap — and `scope.ts:138` already marks the wrapper `@deprecated`. |
| X-7 | L | Read/write split | `dbRead` appears **zero** times in `admin-staffing.ts`; `loadCentreInScope` (`:52`), `loadBatchInScope` (`:67`) and all five list endpoints use the write pool, against the CLAUDE.md read/write split. |
| X-8 | L | Timestamps | `admin.ts:715-719` (timetable), `:779` (batch status) and `:634-639` set no `updated_at`, while `admin-resources.ts:1593, 1380, 1442` and `admin-staffing.ts:704-709` all set it explicitly — which implies `timestamps()` has no `$onUpdate`, so those rows keep a stale `updated_at`. |
| X-9 | L | Test hygiene | `staffing.test.ts:98-103` permanently removes every sanchalak beyond the first from the **shared Ghatkopar seed** and never restores them (`afterAll` at `:38-52` cleans only rows the test created). The suite degrades the fixture for every subsequent suite and for repeat local runs, and its own assertion at `:108-109` depends on that mutation having happened. |

### Test coverage gaps

`staffing.test.ts` contains **no phantom references** — every route and error code it asserts exists in source (unlike the Exams suite). What it does not cover, ranked by risk left unguarded:

1. **No test that a shikshak is rejected from any POST.** The only negative RBAC tests are sanchalak→sanchalak (`:112-120, :297-306`). This is exactly the gap SH-1/SH-2/SH-3 fell through.
2. **No cross-centre / cross-city test** — `KOTHRUD` is loaded (`:26`) but only ever used with a super_admin token (`:162`).
3. **Nothing for A-5 (orphan user — `ERR_BATCH_CENTRE_MISMATCH` is never exercised), SN-1 (silent primary steal) or SN-4 (last shikshak on an active batch).**
4. **No test for `GET /staffing/me?user_id=`**, and none for `users/pick` geography (only the exclusion behaviour, `:342-347`).
5. **No assertion that `phone` is withheld** from lower-privileged callers on any list route.
6. **No concurrency tests** — A-9 and X-4 are invisible to a sequential suite.
7. **No test that a deactivated user disappears** from the staffing lists (A-22).

---

# 6. Verified correct — do not re-report

**Staffing RBAC is sound.** `users.role` is written exactly once, at creation (`admin-staffing.ts:918`), from a `staffRoleSchema` admitting only `sanchalak|shikshak` (`:29`). There is no `update(users)` and no `delete()` in the file. A sanchalak cannot create or assign a sanchalak (`isCityPlus` at `:121, 194, 1121, 1216, 1336`); no caller can assign themselves (`userWithRole` at `:76-85` can never match the caller's own role); a shikshak reaches no mutation in that file. Centre/batch ownership is checked on all eleven routes. Removals are soft everywhere. The centre-tag prerequisite before batch assignment is enforced with `ERR_NOT_CENTRE_TAGGED` (`:571-590`) and tested. Centre-tag removal cascades to that centre's batches **only**, in one transaction (`:428-488`). Every one of the nine mutations audits (the defect is the verb, A-21, not a missing entry).

**Exactly-one-primary is enforced at the database level** by `shikshak_batch_assignments_active_primary_uq` (`schema/centres.ts:178-180`), directly tested at `staffing.test.ts:224-247`; the demote+promote is one transaction (`admin-staffing.ts:757-772`) and a not-assigned target 422s (`:752-755`).

**No phantom response fields anywhere in this module.** Every field declared in a web or mobile row type was checked against the API's SELECT list — `AdminBatchRow`, `CentreRow`, `HolidayRow`, public `CentreRow`, `CentreDetail`, `BatchRow`, `StaffUser`, `StaffBatch`, `PickUser`, `CentreBatch`, and every mobile consumer. All present, nullability correctly declared for the `leftJoin` columns. This is the one class of Exams-module bug that is **not** present here.

**Weekday indexing is consistent** across server (`min(1).max(7)`), web `DAY_NAMES` and mobile `DAYS_EN`/`DAYS_HI`, all 1-indexed with a sentinel at 0, with out-of-range values defended.

**Other things confirmed sound:** the `activate` primary-shikshak invariant (`admin.ts:761-776`); unknown batch actions 422 before any DB work (`:742-745`); the staffing sub-routes are mounted before the catch-all so they are not shadowed (`admin.ts:128` vs `:740`) — though any *future* `POST /batches/:id/x` added below `:740` would be swallowed; `GET /centres` counts via `count(distinct)` + a correlated subquery, not a double fan-out (`admin-resources.ts:108-114`); the batches list's primary join cannot fan out; no cross-centre IDOR on the attendance log's `session_id` branch (`:1067`); `POST /centres` ignores the client's `state_id` and uses `cityRow.state_id` (`:1537`); `POST /centres/:id/reports/monthly` is thorough end-to-end (UUID, month range, IST future-month rejection, scope, existence, idempotent upsert, audit, and a 503 that marks the row `failed` rather than leaving it stuck); `AddCentreDialog` is correctly gated on city_admin+ (`AdminListPages.tsx:136-145`) matching its API; holiday delete confirms with the restore count; `CentreDetailPage` separates a real 404 from a missing body, guards against setState-after-unmount, and uses `aria-labelledby`; `ReportsPage` clamps the month to the current IST month matching the server; gender-based Guruji/Didi honorifics are correct and localised on both web and mobile; mobile handles loading/error/empty with a working retry on all four list screens and wires pull-to-refresh everywhere; per-row mutation spinners target the correct row; the create-batch form resets on open and clears the shikshak pick when the centre changes; no hardcoded hex colours; scope memoisation is sound (`scope.ts:27-48`, WeakMap with the pending promise evicted on rejection); `inBatchWriteScope` correctly falls back to centre membership when `batchIds === null`.

---

# 7. Suggested fix order

**Ship first — security and module-down**

1. **SH-1 / SH-2 / SH-3** — add `isSanchalakPlus` to `POST /v1/admin/batches`, `PATCH /batches/:id/timetable` and `POST /batches/:id/:action`, and use `inBatchWriteScope` rather than the deprecated centre-level `inScope`. One-line-each; closes a real escalation.
2. **A-1** — ship `POST` / `PATCH` / `DELETE` `/v1/admin/centres/:id/holidays[/:hid]` (with audit and the `sessions_restored` contract the UI already expects), or remove the page. AT10 is unconfigurable until this lands.
3. **A-6** — fix the `users/pick` geo filter's fail-open arm and drop `phone` below city_admin.
4. **SH-4 / SH-5 / SH-7 / SH-8 / SH-9** — page-level role guards matching each sidebar `min`, with a proper access-denied state instead of a raw English API string.

**Then — data safety and correctness**

5. **SN-3** — create batches `inactive` unless a primary is supplied, so every batch passes through the `ERR_NO_PRIMARY` invariant.
6. **SN-4** — reject removal of the last active shikshak on an active batch (`ERR_LAST_SHIKSHAK`), mirroring `ERR_LAST_SANCHALAK`.
7. **A-5** — validate `batch_ids` against the centre before creating the user, or wrap the three steps in one transaction.
8. **SN-1** — only call `/primary` when the selection changed; add a "No primary batch" option; record demotions in the audit metadata.
9. **A-7** — cascade centre/batch deactivation (or block it) and clean up materialised future sessions.
10. **SN-6 + SN-9 + SN-8** — confirm dialogs on all destructive actions; `end_time > start_time` and a real time range check on both client and server; require at least one day of week.
11. **A-9 / X-4 / A-10** — transactions + `FOR UPDATE` on the last-sanchalak guard and set-primary; `ON CONFLICT` on the assigns; catch `23505` on centre create.

**Then — the missing surfaces**

12. **SN-5** — wire the existing `PATCH /batches/:id/timetable` to an edit dialog on both clients, and add `PATCH /batches/:id` for name/capacity/age groups.
13. **A-2 / A-3** — extend `PATCH /v1/admin/centres/:id` beyond `{status}` to cover the editable columns **and** `lat`/`lng`/`gps_radius_meters`; wire the status toggle, which currently has no client at all.
14. **A-4** — surface the Pathshala code field, pre-filled and editable on `ERR_DUPLICATE`.
15. **A-8** — audit entries on centre create, batch create, timetable change and batch activate/deactivate.
16. **X-2** — notify on batch assignment, batch removal and centre removal.

**Then** — SN-2 (activate failure routes into staffing), SN-7 (partial-save recovery), A-12 (report regeneration guard), A-11 (reactivation republish), SN-10/SN-11/SN-12 (mobile state bugs), G-1 (public error vs empty state), A-18/A-25 (pagination and `GET /centres/:id`), the i18n set (G-2, SN-14, SN-15, SN-18, G-4), the a11y set (A-19, SN-19), and the remaining Low rows.

---

*Findings were verified line-by-line against source; every claim carries a `file:line` citation. Items marked "needs verification" (SN-17, A-11, X-3, G-7) depend on files outside the reviewed set — the mobile QueryClient construction, `lib/team-members-sync.ts`, and the mobile `_layout.tsx` files.*
