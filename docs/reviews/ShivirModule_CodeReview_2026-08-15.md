# Code review — Shivirs module

**Date:** 2026-08-15
**Structure:** persona → navigation → action → observed vs expected

## Scope reviewed

| File | Lines | Role |
|---|---|---|
| `apps/api-server/src/routes/v1/shivir-scanner.ts` | 436 | Sessions, scan-context, scan, live dashboard |
| `apps/api-server/src/services/shivir-scan.ts` | 105 | Shared scan apply (used by sync/batch) |
| `apps/api-server/src/services/sync-batch.ts` | 296–350 | `handleShivirScan` offline transport handler |
| `apps/api-server/src/routes/v1/admin-resources.ts` | 261–280, 1925–1976 | Admin list + create shivir |
| `apps/api-server/src/routes/v1/public.ts` | 109–161 | Public list + detail |
| `apps/api-server/test/shivir-scanner.test.ts` | 267 | 5 test cases |
| `lib/db/src/schema/shivirs.ts` | 130 | 5 tables |
| `lib/api-zod/src/contracts.ts` | 455–478 | `shivirRowSchema`, `shivirDetailSchema` |
| `apps/jain-pathshala/src/pages/admin/ShivirDashboardPage.tsx` | 276 | Attendance dashboard + session create |
| `apps/jain-pathshala/src/pages/admin/AdminListPages.tsx` | 360–485 | Shivirs list + create dialog |
| `apps/jain-pathshala/src/pages/public/ShivirsPage.tsx` / `ShivirDetailPage.tsx` | 77 / 117 | Public website |
| `apps/jain-pathshala-mobile/app/shivir/[id].tsx` | 100 | Mobile detail |
| `apps/jain-pathshala-mobile/app/shivir-scan/[id].tsx` | 478 | Mobile QR scanner |
| `apps/jain-pathshala-mobile/components/ShivirsBrowseScreen.tsx` | 74 | Shared browse (guest + signed-in) |
| `apps/jain-pathshala-mobile/lib/offline/{queue-keys,types,drain,sync-engine}.ts` | — | Offline queue layer |

**Also read for cross-checks:** `apps/api-server/src/lib/idcard-crypto.ts`, `apps/api-server/src/routes/v1/id-cards.ts`, `apps/api-server/src/routes/v1/sync.ts` (via device), `apps/api-server/src/lib/{scope,audit,notify,roles}.ts`, `lib/db/src/schema/enums.ts`, `lib/db/src/seed.ts` (via device), `sidebar-nav.ts`, `AdminRoutes.tsx`, `PublicRoutes.tsx`, `TopNav.tsx`, `QuickActions.tsx`, mobile `_layout.tsx` / `guest/_layout.tsx`, `lib/queries.ts`, SPEC §5.11 / §6.14 / §8.6 / Step 15, CLAUDE.md (AT19, AT28, Bilingual, Socket.IO, Offline sync canonical model).

---

## Summary

What exists is a well-built **scanner**: the HMAC-signed QR verification is constant-time and domain-separated, the revocation re-check runs inside a per-student advisory-lock transaction (a genuine TOCTOU fix), duplicate scans are made harmless by a DB unique index rather than client discipline, out-of-scope callers get a PII-safe 404 with a test proving it, and the mobile scanning UX (distinct success/duplicate/revoked feedback, haptics, debounce, permission states, full bilingual chrome) is the most polished screen in the app.

But a Shivir module is a lifecycle — publish → **register** → assign **volunteers** → scan → notify → report — and only the two ends of it exist. Four things stand out.

**The sync path is an authorization back door.** The online scan route enforces "registered volunteer OR in-scope admin" (`shivir-scanner.ts:277`) and validates `scan_kind` against the session's mode (`:283-290`). The offline replay path enforces neither: `POST /v1/sync/batch` is `requireAuth` only, `handleShivirScan` calls `applyShivirScan` (`shivir-scan.ts:29-105`), and that service checks *only* that the session exists and the signature is valid. **Any authenticated user — a parent, using their own child's signed QR from `GET /v1/id-cards/mine` — can record attendance scans into any session of any shivir in India**, including `check_in` on `present_only` sessions. It also silently discards the client's `scanned_at` (`sync-batch.ts:309` parses it; the call at `:327-334` never passes it). The cross-city 404 test exists only for the online route; fixing this breaks no existing test.

**Registration does not exist.** `shivir_registrations` has zero write paths in the entire repo — no API route, no web UI, no mobile CTA. Parents cannot register a child on any surface; `capacity` is stored and rendered but never enforced; the dashboard's "Registered:" figure is permanently 0; the scan flow never checks registration (SPEC §8.6 step 3); and SPEC Step 15's exit criterion — *"parents register 50 students"* — is unachievable. The schema is also missing the spec'd `status` and `registered_by_user_id` columns and the `UNIQUE (shivir_id, student_id)` key.

**Volunteers cannot exist.** `shivir_volunteers` is only ever *read* (`canActOnShivir`, `shivir-scanner.ts:99-109`). SPEC §6.14's `POST /v1/admin/shivirs/:id/volunteers` was never built, there is no UI, and the seed creates none — so the "registered volunteer" arm of every authorization check is dead code, and the only people who can scan are admin-panel accounts. Meanwhile the mobile detail page shows a "Volunteers can record attendance here" card to *every* signed-in user (`shivir/[id].tsx:67-78`), walking parents into a guaranteed "not available" dead end — while the sync back door (above) would actually let them through.

**Offline scanning was built on both ends and never connected.** Queue key `jp.queue.shivir_scans`, drain order, `PendingShivirScanOp`, and the server's `handleShivirScan` all exist — but nothing on the client ever *enqueues*: the scanner posts online-only via `useMutation` and a network failure is just "Scan failed. Please try again." At a shivir venue (the one place in the product where connectivity is guaranteed to be bad — SPEC's exit criterion literally specifies "airplane mode toggling mid-event"), scans are lost.

Beyond these: there is no edit/unpublish/delete for a shivir (typos are permanent, cancellation impossible), the "live" dashboard neither uses the mandated Socket.IO namespace nor even polls, `msv_only` is stored but never filtered or settable from the panel (guests see MSV-only shivirs), the schema is single-language against CLAUDE.md's bilingual rule, no notification of kind `shivir` is ever sent, and the SPEC's in/out re-entry model cannot be represented by the `(session, student, kind)` unique index.

**Verdict: the scanner core is solid; the module around it is a torso.** C1 is a security fix that should ship immediately; C2/C3 are product-blocking gaps that need a build decision before the first real shivir runs on this system.

---

## Findings index

Severity is by blast radius × likelihood, not by how hard the fix is.

### Critical

| ID | Finding | Where |
|---|---|---|
| **C1** | Sync path records scans with no authorization, no mode validation, and a discarded `scanned_at` — any authed user can write attendance into any shivir nationwide | `shivir-scan.ts:29-105`; `sync-batch.ts:296-350`; `sync.ts:10` |
| **C2** | Registration flow does not exist on any surface; capacity never enforced; scan never checks registration; schema lacks `status`, `registered_by`, and the unique key | `shivir_registrations` (no writers repo-wide); `schema/shivirs.ts:35-51` |
| **C3** | Volunteer assignment does not exist — `POST /v1/admin/shivirs/:id/volunteers` (SPEC §6.14) unbuilt; the volunteer arm of `canActOnShivir` is unreachable | `shivir_volunteers` (no writers repo-wide); `shivir-scanner.ts:99-109` |

### High

| ID | Finding | Where |
|---|---|---|
| **H1** | Offline scanning never wired: queue/types/drain/server handler all exist, nothing enqueues — scans lost offline | `shivir-scan/[id].tsx:103-172`; `queue-keys.ts:6,22,35` |
| **H2** | Re-entry is impossible: unique `(session, student, kind)` allows exactly one check-in and one check-out per session, contradicting SPEC §8.6 step 4 | `schema/shivirs.ts:119-123` |
| **H3** | No server-side in/out toggle — the volunteer manually flips kind; check-out with no prior check-in accepted; forgotten flip = confusing "Already scanned" | `shivir-scan/[id].tsx:368-398`; `shivir-scanner.ts:283-290` |
| **H4** | Zero notifications: parent scan push (SPEC §8.6 step 6) and publish announcements absent; enum kind `shivir` never sent by any code | no `notify` import in `shivir-scanner.ts`; `enums.ts:137` |
| **H5** | "Live" dashboard is static: no Socket.IO `/shivirs/:shivirId` (CLAUDE.md), no polling — manual Refresh only | `ShivirDashboardPage.tsx:163-183,224-232` |
| **H6** | No PATCH/DELETE/unpublish for shivirs — creation is the only write; mistakes and cancellations are permanent and stay publicly listed until `end_date` | `admin-resources.ts` (routes absent) |
| **H7** | `GET /v1/admin/shivirs` is unscoped — every admin-panel role (shikshak+) lists all shivirs nationwide, including unpublished drafts; the dashboard dropdown then offers shivirs that 404 | `admin-resources.ts:262-280`; `ShivirDashboardPage.tsx:145` |
| **H8** | MSV gating unimplemented: `msv_only` never filtered (guests see MSV-only shivirs, contra SPEC §6.14), never badged, and not settable from the admin panel | `public.ts:110-128`; `AdminListPages.tsx:393-402`; `contracts.ts:455-478` |
| **H9** | Single-language schema: `name`/`description` have no `_hi` variants — violates CLAUDE.md "All user-facing content must have `_en` and `_hi`" | `schema/shivirs.ts:13-14`; CLAUDE.md:532-538 |
| **H10** | Role gates on the wrong side: API admits shikshak to session create/dashboard/scan via `canAccessAdminPanel` (SPEC lists city_admin+/sanchalak/volunteer), while the web nav hides both pages from sanchalak at `min:'city_admin'` and the routes themselves have no guard | `shivir-scanner.ts:95,123`; `sidebar-nav.ts:80,105`; `AdminRoutes.tsx:111,134` |

### Medium

| ID | Finding | Where |
|---|---|---|
| M1 | CSV/PDF export (SPEC §6.14) not built on any layer | — |
| M2 | Dashboard shows counts only — no per-student roster; nobody can answer "who is here?" or "who is missing?" | `shivir-scanner.ts:388-434` |
| M3 | No audit entries for session create or scans (shivir create does audit; the scanner router never imports `auditFromReq`) | `shivir-scanner.ts:121-156,242-383` |
| M4 | No date-window validation anywhere: `end_date < start_date` accepted; session date can fall outside the shivir; scans accepted for past/future sessions | `admin-resources.ts:1925-1935`; `shivir-scanner.ts:114-118` |
| M5 | `msv_shivir` Punya feature exists only in comments — not in `punya_features`, any migration, or seed; the AT28-documented path for shivir Punya cannot resolve (AT21) | `shivir-scanner.ts:6`; repo-wide grep |
| M6 | Mobile detail offers parents/students no action at all — no register, no enquire (web has enquire); instead the scanner card invites every signed-in user into a guaranteed dead end | `shivir/[id].tsx:67-83` |
| M7 | Drafts unusable: the create dialog hardcodes `is_published: true` and no unpublish exists — the list's "Draft" label is unreachable from the UI | `AdminListPages.tsx:401,479` |
| M8 | No handoff path: admin list rows link nowhere; no route from a shivir to its dashboard; no way to give a scanner link/QR to staff — mobile discovery is browse → detail → Scan QR only, and the Guruji menu has no shivir entry | `AdminListPages.tsx:471-481`; `QuickActions.tsx:43-60` |
| M9 | Public listing filters `end_date` against the UTC day, not IST (AT26 spirit) | `public.ts:111` |
| M10 | No pagination or search; `limit` clamped at 200 with no truncation indicator | `admin-resources.ts:263`; `AdminListPages.tsx:465` |

### Low

| ID | Finding | Where |
|---|---|---|
| L1 | `contact_info` is rendered on both detail pages but absent from the create schema — it can never be set | `admin-resources.ts:1925-1935`; `ShivirDetailPage.tsx:101-106` |
| L2 | Mid-scan 404 copy says "This session is no longer available" though sessions can never be deleted — the real cause is lost authorization | `shivir-scan/[id].tsx:141-148` |
| L3 | Create-shivir city picker is unscoped — a city_admin is offered every city and learns only via a 403 toast | `AdminListPages.tsx:385,425-433` |
| L4 | `extractCardToken`'s claimed bare-payload forward-compat branch is dead — non-JSON always returns null | `shivir-scan/[id].tsx:51-69` |
| L5 | Dashboard renders all four count columns regardless of session mode (zeros for the irrelevant kinds) | `ShivirDashboardPage.tsx:251-272` |
| L6 | `shivirRowSchema` omits `msv_only`/`capacity`, so mobile cards could not badge them even after H8 is fixed | `contracts.ts:455-464` |

---

## Persona walkthrough

The requested spine. Each row is one concrete journey. **Ref** links to the findings index.

### 1. Guest 🌐📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Website → **Shivirs** (TopNav) | Browse upcoming shivirs | Works. `/shivirs` and `/shivirs/:id` routed (`PublicRoutes.tsx:53-54`), list filters `is_published` and future `end_date` | ✅ | — |
| Website → Shivirs | See only *public* shivirs | **Sees everything, including MSV-only.** `GET /v1/public/shivirs` (`public.ts:110-128`) never touches `msv_only`. SPEC §6.14: guest = "public only" | Filter `msv_only = false` for guests; badge it for signed-in MSV students | **H8** |
| Website → shivir detail | Take the next step | "Enquire about this shivir" → `/enquire`. Reasonable for a guest | ✅ (registration is a signed-in concern — see Parent) | — |
| Mobile guest tabs → **Shivirs** | Browse | Works — same `ShivirsBrowseScreen` and public endpoint; scanner card correctly hidden for guests (`shivir/[id].tsx:67`) | ✅ Good defensive gating | — |
| Either surface, Hindi locale | Read a shivir in Hindi | UI chrome is fully bilingual, but `name`/`description` are single-language columns — content is whatever language the admin typed, always | `name_en/_hi`, `description_en/_hi` per CLAUDE.md Bilingual | **H9** |
| Website → Shivirs, day after a shivir ends | Still listed? | Delisting flips at 00:00 **UTC** = 5:30am IST (`public.ts:111`) | Compute "today" in Asia/Kolkata | M9 |

---

### 2. Parent / Student — Abhivaavak 📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Home → Browse → **Shivirs** | Open the list | Works (`SIGNED_IN_BROWSE_ACTIONS`, `QuickActions.tsx:107`) | ✅ | — |
| Shivir detail | **Register my child** | **No such thing exists — anywhere.** No API route writes `shivir_registrations`, no button on mobile or web, no capacity check, no confirmation. The module's core parent action is unbuilt. SPEC Step 15: *"parents register 50 students"* | `POST /v1/shivirs/:id/register` (+ cancel), ownership-checked like quizzes' `ownedStudent`; capacity enforced; unique `(shivir_id, student_id)`; a Register CTA on the detail page | **C2** |
| Shivir detail | Understand what the "Attendance scanner" card is for them | Card renders for **every** signed-in user: *"Volunteers can record attendance here…"* with a Scan QR button (`shivir/[id].tsx:67-78`). A parent taps it → scanner loads → server 404 → "This scanner isn't available to you." A designed dead end on the page's only CTA | Show the card only when scan-context succeeds (fetch it first), or gate to roles that can plausibly scan | M6 |
| — (API, direct) | `POST /v1/sync/batch` with `op_type: "shivir_scan"`, using their own child's QR from `GET /v1/id-cards/mine` | **Success.** `/v1/sync` is `requireAuth` only (`sync.ts:10`); `handleShivirScan` → `applyShivirScan` checks session existence + signature and **nothing else** (`shivir-scan.ts:29-105`). A parent can mark their child present at any session of any shivir in India — including `check_in` on a `present_only` session, which the online route would 422 (`shivir-scanner.ts:283-290`) | Run `canActOnShivir` and the mode check inside `applyShivirScan` (or in `handleShivirScan`); add the negative test the online route already has | **C1** |
| After a real scan at the venue | Get the "your child checked in" push | Never. SPEC §8.6 step 6 mandates immediate parent push; no code sends notification kind `shivir` — the enum value is dead | Enqueue a parent push in the scan transaction's success path (both routes share `applyShivirScan` — one insertion point after C1's refactor) | **H4** |
| Next week | See which shivirs their child attended | Nothing. No history surface; scans are visible only via admin counts | Attendance history on the student profile / progress report | M2 |

---

### 3. Volunteer — Sevak 📱 *(the SPEC persona this module was named for)*

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| — | **Become a volunteer for a shivir** | **Impossible.** `shivir_volunteers` has zero write paths in the repo — SPEC §6.14's `POST /v1/admin/shivirs/:id/volunteers` (city_admin, sanchalak) was never built, no UI exists on any surface, and the seed creates no rows. There is no `volunteer` role in the enum (by design — it's a per-shivir grant), so this table is the *only* mechanism, and it is dead | Build the assign/revoke route + an admin UI (web dashboard page is the natural home) + a "My shivirs" entry for assigned volunteers on mobile | **C3** |
| Shivirs browse → detail → **Scan QR** | Scan as an assigned volunteer | If a row existed, `canActOnShivir` (`shivir-scanner.ts:99-109`) would admit them — the code path is correct, tested never | Once C3 lands, add a volunteer-arm test (positive + revoked-negative) | C3 |
| Venue basement, no signal | Scan 40 students | **All lost.** The scanner posts online-only (`useMutation` → `apiPost`, `shivir-scan/[id].tsx:103-109`); failure shows "Scan failed. Please try again." The entire offline stack for this exact flow exists unused: `jp.queue.shivir_scans` (`queue-keys.ts:6`), `PendingShivirScanOp` (`offline/types.ts:47-53`), drain order slot, and the server's `handleShivirScan`. Nothing enqueues. SPEC Step 15 exit criterion: *"with airplane mode toggling mid-event"* | On network failure (or offline detection), enqueue `PendingShivirScanOp` with the real `scanned_at`, show "queued" feedback, drain via the canonical engine | **H1** |
| Scanning an in/out session | Scan a student leaving for lunch, then returning | Leaving: volunteer must *manually* flip the toggle to "Check out" first — SPEC §8.6 says the server toggles automatically from the last scan. Returning: **impossible.** The unique index `(session, student, kind)` (`schema/shivirs.ts:119-123`) permits one check-in ever; the re-entry scan reports "Already scanned". SPEC explicitly requires re-entry (*"Last is check_out → insert new check_in"*) | Drop `scan_kind` from the unique key (dedupe by short-window instead), derive kind server-side from the latest scan, make the client toggle a display, not an input | **H2**, **H3** |
| Scanning, wrong toggle | Forgot to flip to "Check out"; scans a checked-in student | Silent duplicate warning ("already recorded") — the student's exit is simply not captured | Auto-toggle solves this (H3) | H3 |
| Scanning | Scan a student who never registered / from another city | **Recorded without comment.** The scan flow never consults `shivir_registrations` (SPEC §8.6 step 3) — any valid ID card in India lands in any session | After C2 exists: flag walk-ins distinctly (allow, but mark), or reject per product choice | C2 |

---

### 4. Shikshak — Guruji / Didi 📱🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Mobile Guruji menu | Find a shivir shortcut | Not there (`SHIKSHAK_ACTIONS`, `QuickActions.tsx:43-60`) — reachable only via the generic Browse row | Fine if deliberate; add an entry if Gurujis are expected to scan | M8 |
| Browse → detail → **Scan QR** | Scan students | **Works — for any shivir in their whole city.** `canAccessAdminPanel` admits shikshak, and `cityScopeForUser` resolves their centres → cities (`shivir-scanner.ts:50-69,95-98`). SPEC §6.14 lists city_admin+/sanchalak/volunteer for this surface — shikshak is not in it | Decide deliberately: either accept (pragmatic — a Guruji at the venue is a natural scanner, and with C3 unbuilt they're the only field staff who can) and document it like `EXAM_ADMIN_ROLES` does, or narrow to a `SHIVIR_SCAN_ROLES` set | **H10** |
| — (API, direct) | `POST /v1/shivir-scanner/shivirs/:id/sessions` on any shivir in their city | **200.** Session *creation* — an act SPEC reserves for admins — is open to every shikshak in the city via the same `requireAdminPanel` + city-scope check (`:121-156`). No audit row is written either | Gate session create at city_admin+ (or sanchalak); add `auditFromReq` | **H10**, M3 |
| Web → `/admin/shivirs` typed directly | Open the page | Renders and works — the sidebar hides it (`min:'city_admin'`, `sidebar-nav.ts:80`) but `AdminRoutes.tsx:111` has no role guard, and the API list is unscoped, so a shikshak sees **every shivir in India, including unpublished drafts** | Scope the list to the caller's cities; guard the routes to match the nav | **H7**, H10 |

---

### 5. Sanchalak — centre head 🖥📱

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Admin sidebar | Find **Shivirs** / **Shivir attendance** | **Not there** — both entries are `min: 'city_admin'` (`sidebar-nav.ts:80,105`). Yet SPEC §6.14 grants the live dashboard to sanchalak, and the API happily serves them (city-scope via their centres). Gate on the wrong side, again | Lower the two nav entries to sanchalak (dashboard at minimum), or narrow the API — pick one side | **H10** |
| Direct URL → `/admin/shivir-dashboard` | Watch attendance at their city's shivir | Works (unguarded route + in-scope API), but the dropdown lists all of India's shivirs and out-of-scope picks 404 (“Failed to load dashboard.”) | Scoped list (H7) fixes the dropdown | **H7** |
| Anywhere | Assign volunteers for their centre's families | Impossible — C3. SPEC names sanchalak as an assigner | C3 | **C3** |
| Mobile home → manage grid | Shivirs entry | Present (`QuickActions.tsx:86`) → browse → detail → scanner works in-city | ✅ | — |

---

### 6. City Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Sidebar → **Shivirs** → New shivir | Create one | Works; role-gated correctly (city_admin+, `admin-resources.ts:1943-1944`), city scope enforced, audit written (`:1968-1973`) | ✅ Solid create path | — |
| New shivir dialog | Set the end before the start | **Accepted.** No refinement in `createShivirSchema` (`:1925-1935`), no client check. The shivir renders with an inverted date range everywhere and, being "ended", never appears publicly | Reject `end_date < start_date` (422 + client validation) | M4 |
| New shivir dialog | Create an **MSV-only** shivir | **Cannot.** No `msv_only` toggle in the dialog (`AdminListPages.tsx:393-402`); server defaults `false`. `contact_info` and `attendance_mode` are likewise unsettable (`contact_info` isn't even in the create schema, yet renders on both detail pages) | Add the toggle + contact field; wire `msv_only` end-to-end with H8 | **H8**, L1 |
| New shivir dialog | Save as draft | **Cannot.** `is_published: true` is hardcoded (`:401`). And once created, there is no PATCH — so no unpublish, no edit, no delete. A typo in the name, a venue change, or a cancelled shivir is permanent and stays on the public site until `end_date` | `PATCH /v1/admin/shivirs/:id` (+ soft-delete), publish toggle in the UI | **H6**, M7 |
| Shivirs list | Open a shivir's dashboard | No link — the list rows are inert (`:471-481`); the dashboard is a separate nav entry with its own dropdown. No path hands a scanner link to venue staff | Row → dashboard; dashboard → shareable scanner deep link / QR | M8 |
| Shivir attendance → select shivir | Watch scans arrive "live" | **Nothing arrives.** No Socket.IO (`/shivirs/:shivirId` namespace mandated by CLAUDE.md:492 — absent), no polling; data loads once per selection (`ShivirDashboardPage.tsx:181-183`) and thereafter only on manual Refresh | At minimum a 5–10s poll like the quiz monitor; properly, the mandated namespace | **H5** |
| Dashboard | See **who** is present | Counts only (`present/checked_in/checked_out/distinct_students`). No names, no roster, no walk-in vs registered split. "Registered: **0**" — always, because registration is unbuildable (C2) | Roster endpoint (paginated) + registered-vs-scanned reconciliation | M2, C2 |
| Dashboard → New session | Create "Day 1" dated outside the shivir window | Accepted — no range check server- or client-side | Validate `session_date` within `[start_date, end_date]` | M4 |
| After the shivir | Export attendance CSV/PDF (SPEC §6.14) | Doesn't exist on any layer | `GET /v1/admin/shivirs/:id/export` → the existing report-job pipeline | M1 |
| After the shivir | Award `msv_shivir` Punya (AT28's documented path) | The feature key exists **only in comments** — not in `punya_features`, any migration, or seed. The award must fall back to generic manual seva, losing the catalogue's per-feature bounds and reporting | Register `msv_shivir` in `punya_features` with min/max per SPEC §13.7 | M5 |
| Audit log | Review who created sessions / scanned | Shivir create is audited; **session create and scans write nothing** (`auditFromReq` never imported in the scanner router) | Audit session create at least; scans arguably belong in the scan table alone, but say so in a comment | M3 |

---

### 7. State Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Shivirs → New shivir | Create in any city of their state | Works — `cityIdsForState` scope check (`admin-resources.ts:1949-1953`) | ✅ | — |
| New shivir dialog | Pick a city | Offered **every city in India** (`/v1/admin/geography` unfiltered, `AdminListPages.tsx:385`); out-of-state picks fail with a 403 toast after submit | Narrow the picker to their state | L3 |
| Shivirs list | See their state's shivirs | Sees everyone's (H7) | Scope by state | **H7** |

---

### 8. Super Admin 🖥

| Navigation | Action | Observed | Expected | Ref |
|---|---|---|---|---|
| Everything above | — | Unrestricted by design (`cityScopeForUser` returns `null`); every functional gap (C2, C3, H1–H6…) applies identically | — | — |
| Settings / infra | Reconcile the Socket.IO namespace list | CLAUDE.md mandates `/shivirs/:shivirId`; nothing implements it and the dashboard doesn't even poll. Same drift pattern as quizzes' `/push-quizzes` | Implement or amend CLAUDE.md — but a live-attendance feature with no live channel *and* no poll is a product gap, not just a doc mismatch | **H5** |
| DB | Compare schema to SPEC §5.11 | Drift beyond the C2 columns: `shivir_sessions` lacks `day_number` (+ unique), `start_time`, `end_time` (sessions are date-only, so two same-day sessions are indistinguishable to volunteers except by title); `shivir_attendance_scans` lacks `shivir_event_id`, `client_op_id`, `device_offline`; events lack `location_lat/lng`, `sessions_count` | Reconcile deliberately — several omissions are defensible (transport-level ULIDs replace `client_op_id` per CLAUDE.md AT19), but `start_time/end_time` and `device_offline` serve real flows | C2, H1 |

---

## Test gaps

Five cases (`shivir-scanner.test.ts`) — auth required on scan, parent 403 on session create, the happy path (session → card → valid scan → tampered 401 → dashboard), out-of-scope/nonexistent 404, and the cross-city no-PII 404, plus the mode/kind 422. The cross-city test is exactly the right shape.

Not covered at all:

- **The sync path.** Zero tests touch `handleShivirScan` or `applyShivirScan` — which is why C1 shipped, and why fixing it breaks no existing test. The must-add: a parent submitting `op_type: "shivir_scan"` via `/v1/sync/batch` → failed/forbidden.
- **Duplicate scans.** The unique-index no-op (`duplicate: true`) has no assertion.
- **in/out mode.** No test creates an `in_out` session, scans check-in then check-out, or attempts re-entry.
- **The volunteer arm.** Untestable until C3 exists; add positive + revoked tests with it.
- **Revoked/version-bumped cards** against the scan endpoint (the id-cards module tests its own verify, but the scanner's advisory-lock re-check path has no direct test).
- **Registration** — everything about it, once it exists.

---

## What looks good

- **The QR trust chain.** Domain-separated HMAC key (`idcard-crypto.ts` — a leaked auth secret can't forge card QRs), canonical-hex constant-time compare, and `parseCardPayload` that fails closed on any malformation.
- **The revocation TOCTOU fix.** Both scan paths re-check `digital_id_cards.is_active`/`version_no` *inside* a transaction holding a per-student advisory lock (`shivir-scanner.ts:306-353`), so a card revoked mid-scan cannot land a row. The comment explains why. This is the same calibre as the quiz submit-claim pattern.
- **DB-enforced idempotency.** Duplicate scans are neutralised by the unique index + `onConflictDoNothing().returning()`, with the empty-return-means-duplicate trick surfaced honestly to the volunteer as "Already scanned". Counts cannot be inflated by scan spam. (The index's `kind` component is the H2 problem — the *mechanism* is right, the key is too wide.)
- **404-not-403 scope hiding** for out-of-scope shivirs and sessions, consistently applied and covered by the cross-city test with an explicit "no PII leak" assertion.
- **One shared apply service.** `applyShivirScan` gives online and offline a single domain path — exactly the right architecture; C1 is a missing check inside it, not a design flaw.
- **The scanner screen.** Distinct duplicate/revoked/invalid/dead-session feedback with matched haptics, a 900ms re-scan lock that still admits a new card instantly, honest camera-permission states (including the blocked-in-Settings case and the web fallback), and complete Devanagari copy throughout. Best-in-app mobile work.
- **AT28 discipline.** The "shivir scans never feed Pathshala attendance/streaks/Punya" rule is documented at the schema (`schema/shivirs.ts:91-95`), route header, *and* service header — and honoured: no code joins `shivir_attendance_scans` into attendance or Punya.

---

## Recommended order of work

1. **C1** — put `canActOnShivir` + the mode check inside `applyShivirScan` (single choke point for both transports), pass `scanned_at` through from the sync payload, and add the parent-via-sync negative test. *Small diff, closes the security hole. Do this first.*
2. **C3** — `POST /v1/admin/shivirs/:id/volunteers` (+ list/revoke), assign UI on the dashboard page, and a "My shivirs" surface for assignees on mobile. This unlocks the persona the module is named for.
3. **C2** — registration: schema migration (`status`, `registered_by_user_id`, unique `(shivir_id, student_id)`), `POST /v1/shivirs/:id/register` with ownership + capacity, Register CTA on mobile/web detail, and the registered-vs-scanned reconciliation on the dashboard. Decide the walk-in policy at the same time.
4. **H2 + H3** — the in/out model: narrow the unique key, derive kind server-side from the last scan, demote the client toggle to a display. One coherent change; do it before real multi-day shivirs generate un-representable data.
5. **H1** — wire the scanner to `jp.queue.shivir_scans` on failure/offline, with queued-state feedback. (Depends on C1's `scanned_at` fix to be worth doing.)
6. **H6 + M7** — `PATCH`/soft-delete + publish toggle. Cheap, and the current permanence is operationally scary.
7. **H7 + H10** — scope the admin list; align nav minimums, route guards, and API role sets (write the `SHIVIR_*_ROLES` decision down the way `EXAM_ADMIN_ROLES` does).
8. **H8 + L6** — `msv_only` end-to-end: filter for guests, badge for members, toggle in the panel, field in the contracts.
9. **H4 + H5** — parent push on scan (the enum kind already exists) and a dashboard poll; then the Socket.IO namespace or a CLAUDE.md amendment.
10. **H9** — bilingual columns (`name_en/_hi`, `description_en/_hi`) — schema migration, so batch it with C2's.
11. **M1–M10, L1–L6** as capacity allows. **M2** (roster) is worth pulling forward on product value — a live count with no names answers almost no real question at a venue.

---

## Note on stack drift

Unchanged from the quiz review: this repo is Express + `apps/api-server` + `lib/db`, while CLAUDE.md/SPEC describe NestJS + `apps/api` + `packages/shared`. Not counted against the module — but the AT19, AT28, bilingual, audit, Socket.IO, and offline-sync rules cited above are stack-independent and do apply.
