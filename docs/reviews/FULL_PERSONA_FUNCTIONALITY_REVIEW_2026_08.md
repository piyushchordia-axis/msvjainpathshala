# Full persona × functionality code review — web + mobile + API

**Date:** 2026-08-16 · **Reviewer:** Claude Code (static review) · **Scope:** all 8 personas across `apps/jain-pathshala` (web), `apps/jain-pathshala-mobile` (mobile), `apps/api-server` (API)

Every persona's assigned functionality was checked on four dimensions — **API wiring** (frontend calls a real endpoint, correct params/envelope, UI↔server guard parity), **design consistency** (tokens, sentence case, bilingual, states), **performance** (pagination, N+1, virtualization, offline queues), **error handling** (error codes surfaced with a fix, retry, offline failure states). Findings are judged against the binding rules in `CLAUDE.md` (Q1–Q12, AT1–AT32, offline canonical model, design/tone rules).

Every finding with a suggested fix is tagged with the **failing functionality ID** and carries **numbered reproduce steps** with observed-vs-expected. The [master issue table](#13-master-issue-table) (§1.3) is the tester-facing centrepiece: one row per issue as *persona → navigation → action → observed → expected → fix*.

---

## 1. Executive summary

### 1.1 Verdict per surface

- **API (`apps/api-server`):** Strong core — scope model, Punya idempotency, attendance transaction and AT32 handling are correctly implemented and well-tested (83 unit + integration suites). The gaps are at the **edges of the authorization surface**: MSV approval, donations, settings-read and quiz/competition authoring admit roles the product nav implies they exclude; Q3 (80G) and Q7 (video-URL validation) are unimplemented; several public write endpoints have no rate limit; and a few `CLAUDE.md` invariants (RS256 JWT, `dbRead` pool, 5-device cap, refresh-reuse detection, impersonation audit pair) are not enforced.
- **Web (`apps/jain-pathshala`):** The admin design system (tokens, `AdminTable` virtualization, `useAdminList`) is genuinely good, but **34 of 48 admin routes have no page-level role gate** — access control is nav-visibility only, and three backing endpoints are equally permissive, so a shikshak who types a URL can read donor PII and approve MSV admissions. Pervasive secondary issues: ~20 admin lists silently truncate at a hardcoded limit, geography pickers offer out-of-scope targets that then 403, there is no error boundary, ~12 pages swallow load errors into a "looks empty" state, and committed debug telemetry still ships on the public `/team` page.
- **Mobile (`apps/jain-pathshala-mobile`):** The offline-critical *shikshak* trio (check-in, roster, course sync) is a reference implementation. But the **offline drain loop runs only for `shikshak`/`sanchalak`**, so parent homework and city-admin certifications queue and never sync; **niyam submission and shivir scanning have no offline producer at all** and lose work silently; the **web attendance dialog defaults every unmarked student to `present`** (an AT6 violation that awards Punya to absent children); and there is no student-view age gate anywhere (Q4).

### 1.2 Persona × dimension scorecard

Rating: 🟢 solid · 🟡 issues to fix · 🔴 broken journey / rule violation.

| Persona | API wiring | Design | Performance | Errors |
|---|---|---|---|---|
| super_admin | 🔴 (80G, impersonate start, settings edit) | 🟡 | 🟡 | 🟡 |
| state_admin | 🟡 (audit paging, nav/guard split) | 🟡 | 🟢 | 🟡 |
| city_admin | 🔴 (exam edit 404, donations PII, ungated routes) | 🟡 | 🟡 | 🔴 |
| sanchalak | 🔴 (unbatched-student scope, web notices/enrolment gaps) | 🟡 | 🟡 | 🔴 |
| shikshak | 🔴 (web present-default, offline attendance/shivir UI) | 🟡 | 🟢 | 🔴 |
| parent | 🔴 (niyam+homework offline loss, MSV missing, child leak) | 🟡 | 🟡 | 🔴 |
| student | 🔴 (no 13+ gate, quiz answer loss) | 🟡 | 🟡 | 🟡 |
| guest | 🔴 (join "closed" on error, mobile donate/enquire stubs) | 🟡 | 🟡 | 🔴 |

### 1.3 Master issue table

The table lives in [§13](#13-master-issue-table) because of its length (one row per fixable issue). It is sorted persona-then-severity and is the primary view in the companion HTML artifact (filterable by persona/severity).

### 1.4 Counts

- **~128 findings** total after dedupe. By severity: **14 Critical**, **35 High**, **~52 Medium**, **~27 Low**.
- Baseline (vs prior `docs/reviews/*`): **~95 NEW**, **~28 STILL-OPEN**, **2 REGRESSION** (L069 exam-edit, L120 today-cache), and **~20 prior findings verified FIXED** (exam take-flow, homework upload folder, GPS sentinels, niyam streak-lapse, quiz lockout, roster virtualization, and more — see §12).

---

## 2. Method, verification & limits

- **9 read-only agents in 2 waves:** platform passes (API guard map, web transport, mobile offline, baseline ledger) then 5 persona-journey passes. Each finding required file:line evidence.
- **Verification:** every Critical/High was independently re-read at file:line by the orchestrator; unreproducible claims were dropped. Confirmed by direct read during verification: `scope.ts:133`, `AttendancePage.tsx:89/107`, `sync-engine.ts:419`, `query-persist-keys.ts`, `join-provision.ts:251`, `OfflineSyncLoop.tsx:9`, `me.ts:195`, absence of `PATCH /v1/admin/exams/:id`, `canViewDonations` used only in `admin.ts`, `donations.ts:215` (`eighty_g_eligible: true`), `videoEmbedUrl` zero call sites.
- **Baseline reconciliation** against `PERSONAS_REVIEW.md`, `MODULES_FUNCTIONAL_TECHNICAL_REVIEW.md`, `SANCHALAK_*`, `SHIKSHAK_*`, `EXAMS_*`, `QUIZ_*`, `LIBRARY_*`, `UPLOAD_*`, `PERFORMANCE_REVIEW.md`, `SECURITY_AUDIT.md`, `FRONTEND_AUDIT_FINDINGS.md`.
- **Limits:** This is a **static** review — no dev servers, no runtime clicking, no integration test run (those need live Postgres/Redis). `pnpm typecheck` could not run in this environment (`pnpm`/`node` are not on PATH in the review sandbox); type-level claims rest on direct reads of the contract mismatches, not a compiler pass — re-run `pnpm typecheck` locally to confirm. Backend correctness internals (Punya math, PDF arithmetic) were reviewed only where they intersect persona-facing wiring; prior module reviews cover those in depth.

---

## 3. Cross-cutting findings

These are single root causes with wide persona blast radius. Fix them once; several persona-section rows resolve together.

### 3.1 API / authorization platform

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| **XC-API-01** | 🔴 Critical | **Ungated admin routes + permissive endpoints.** `AdminLayout` checks only `canAccessAdminPanel` (true for shikshak+); 34/48 routes never re-check. Three backing endpoints are equally loose: `POST /v1/msv/:id/approve\|reject` is `requireAdminPanel` only, `GET /v1/admin/donations` has no `canViewDonations`, `GET /v1/admin/settings` has no role check. | `AdminRoutes.tsx:93`, `msv.ts:307`, `admin-modules.ts:289`, `admin-resources.ts:1408`; `canViewDonations` used only in `admin.ts:236` | Generate route guards from `ADMIN_NAV.min/gate` (single source), render an `AdminRestricted` card not a redirect, and tighten the three endpoints to `requireRole(...)` / `canViewDonations`. |
| **XC-API-02** | 🔴 Critical | **Q3 (80G) is unimplemented and inverted.** No `eighty_g_enabled` / `eighty_g_registration_number` / `organization_pan` anywhere; `donations.ts:215` hardcodes `eighty_g_eligible: true` and receipts assert Section 80G deductibility unconditionally — the opposite of the "default false, both fields required" rule. | `donations.ts:215`, `client-settings.ts:6` (allowlist = 1 key), `pdf.ts` 80G block; no `platform_settings` in `lib/db` | Add the three settings; gate the pair in `PATCH /v1/admin/settings`; set `eighty_g_eligible` from the flag at capture; suppress the 80G receipt block when off; add a Settings UI card. |
| **XC-API-03** | 🟠 High | **Q7 video-URL validation is dead code.** `videoEmbedUrl()`/`isVideoEmbedUrl()` are implemented but have **zero call sites**; `youtube_url` on library items is a bare `z.string()` (not even `.url()`), so `javascript:` and look-alike hosts store successfully. | `validation.ts:49-68` (defs only), `admin-library.ts:653` | Use `youtube_url: videoEmbedUrl(2000).nullable().optional()` on create + PATCH; re-validate on publish. |
| **XC-API-04** | 🟠 High | **Public write endpoints have no rate limit:** `POST /v1/join/registrations`, `/v1/join/uploads`, `/v1/registration/forms/:kind/responses`, `/v1/enquiries`, `/v1/donations/order` (first five unauthenticated), plus `POST /v1/uploads` (authed, no per-user cap). The upload routes write to object storage on unauthenticated input. `ratelimit.ts` also fails **open** on Redis error. | `join.ts:258/579`, `registration.ts:203`, `enquiries.ts:45`, `donations.ts`, `uploads.ts:80` | Wrap each with the existing `rateLimit()` helper (per-IP, tighter for uploads; per-user for `/v1/uploads`). |
| **XC-API-05** | 🟠 High | **`CLAUDE.md` auth invariants not enforced:** tokens are custom HMAC-SHA256 with a 1h access TTL (not RS256 15-min JWT); no read-replica `dbRead` pool; **no 5-device session cap** (6th login never revokes oldest); **no refresh-token reuse/family detection** (rotates in place, a replayed token just 401s while the thief keeps a rolling session); **impersonation writes one audit entry and no action carries `impersonator_id`** (actions attribute to the *subject*). | `tokens.ts:17/38`, `auth.ts:191/258`, `admin.ts:194`, `audit.ts` | Prioritize the two security items (device cap, refresh-family revocation) and the impersonation audit pair; treat RS256/`dbRead` as documented deviations to reconcile in `CLAUDE.md` or implement. |
| **XC-API-06** | 🟡 Medium | **Sync-batch per-op error codes are untyped `string`** (unlike every other path which uses the `ErrorCode` enum), and a **stale 17-code error enum fork** lives in `apps/jp-shared/src/errors.ts` beside the real 90-code `lib/api-zod/src/errors.ts`. | `sync-operations.ts:14`, `jp-shared/src/errors.ts` | Type per-op codes to `ErrorCode`; delete the fork or re-export the canonical enum. |
| **XC-API-07** | 🟡 Medium | **AT24 cancelled-session guard is outside the marking transaction** (read before `db.transaction`, never re-checked inside; `cancelSession` takes no matching advisory lock) — a cancel and a mark can interleave, landing unreversed Punya on a cancelled session. **AT16** duplicate-check-in 409 on the soft-create branch skips the Sanchalak notify. **`admin/curricula` accepts free-form `kind`** (`z.string()`), so `kind:"MSV"` stores an inert orphan one casing-bug away from a Q2 bypass. | `attendance-mark.ts:689`, `session-lifecycle.ts:237`, `admin-modules.ts:331` | Move the AT24 check inside the txn under the `attn:{id}` lock; hoist the notify; constrain `kind` to `z.enum(["standard","msv"])` + DB CHECK. |
| **XC-API-08** | 🟡 Medium | **Unbounded list endpoints** (no `limit`, three unauthenticated): `GET /v1/public/centres`, `/v1/public/courses`, `/v1/donations/campaigns`, and both library trees (`GET /v1/library`, `/v1/admin/library`). | `public.ts:39/187`, `donations.ts:63`, `library-tree.ts`, `admin-library.ts:247` | Add `clampLimit` + keyset cursor on the public lists; paginate or ETag the library trees. |

### 3.2 Web platform

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| **XC-WEB-01** | 🟠 High | **No React error boundary anywhere** — any render-time throw blanks the whole SPA. This is the amplifier that turns CTY-ERR-01 (edit-exam `undefined.trim()`) into a full white-screen. | 0 hits for `ErrorBoundary` in `apps/jain-pathshala/src` | Add a route-level error boundary in `AdminRoutes.tsx` and `PublicRoutes.tsx`. |
| **XC-WEB-02** | 🟠 High | **~20 admin lists silently truncate.** `AdminLoadMore` + `useAdminList.hasMore/loadMore` exist but only 4 of 32 pages consume them; the rest request `?limit=N` and stop, showing a truncated prefix with no count — donations under-reports against the bank, students/audit hide rows. | `AdminExtendedPages.tsx:585`, `AuditLogPage.tsx:51`, `QuizzesPage.tsx:911`, +17 | Pass `hasMore/loadMore` into `AdminTable footer`; convert raw-`apiGet` lists to `useAdminList`. |
| **XC-WEB-03** | 🟠 High | **~12 pages swallow load errors into a "looks empty" state** (`.catch(() => {})` or catch→`notFound`), so an outage reads as "no centres / no shivirs / centre not found" to a prospective parent, and the sanchalak dashboard renders confident all-zero stats. | `CentresPage.tsx:25`, `ShivirsPage.tsx:33`, `CentreDetailPage.tsx:111`, `DashboardPage.tsx:57`, +8 | Separate 404 from transport error; render an error card with retry (the `NoticesPage`/`AnalyticsPage` pattern). |
| **XC-WEB-04** | 🟡 Medium | **Committed debug telemetry ships in production.** `TeamMemberCard.tsx` fires `fetch("http://127.0.0.1:7744/ingest/…")` per portrait `onLoad`/`onError` on the public `/team` and `/team/:city` pages and inside `CentreDetailPage`. This class was found-and-removed twice before (L093/L102/L114) and has recurred. | `TeamMemberCard.tsx:83`, `:107` | Delete both `// #region agent log` blocks; add a lint rule blocking `127.0.0.1:7744`. |
| **XC-WEB-05** | 🟡 Medium | **Dark mode is dead code**, **react-query is mounted but unused** (34 pages hand-roll `useEffect`+fetch), the **admin chrome is English-only** (no admin language switcher, `preferred_language` ignored), and **~19 public pages raw-fetch JSON** bypassing the shared client's 401→refresh retry. | `index.css:4/98` (selector mismatch), `App.tsx:48`, `locale-context.tsx` | Lower-priority hygiene; track behind the correctness work. |

### 3.3 Mobile platform

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| **XC-MOB-01** | 🔴 Critical | **The offline drain loop runs only for `shikshak`/`sanchalak`**, but parents/students enqueue homework + acknowledgement ops and city/state/super enqueue course-certification ops. Their queued work gets one opportunistic `drainQueues()` and, if it fails, never retries — homework never reaches the Guruji, certificates strand. The guarding comment ("Parents, students… never enqueue") is factually wrong. | `OfflineSyncLoop.tsx:9`, `queries.ts:1652`, `CourseTree.tsx:201` | Start the loop whenever `hasPendingSyncWork()` is true, or on NetInfo/AppState transitions — keeping the PERF #23 idle-poll win without stranding work. |
| **XC-MOB-02** | 🔴 Critical | **Two declared offline queues have no producer.** `jp.queue.niyam_submissions` and `jp.queue.shivir_scans` are drain-ordered, handled server-side and unit-tested, but nothing enqueues to them — niyam submit (`useSubmitNiyam`) and shivir QR scan post directly and discard failures, so a parent submitting proof or a volunteer scanning at a no-signal venue loses the work silently (and the recorded media on app-kill). | `queries.ts:1575`, `NiyamProofPicker.tsx:199`, `app/shivir-scan/[id].tsx:103`; `sync-engine.ts` exports no `enqueueNiyamSubmission`/`enqueueShivirScan` | Add the two producers writing `PendingNiyamSubmissionOp`/`PendingShivirScanOp`, route proof media through the offline media queue, map results to the six-state UI. |
| **XC-MOB-03** | 🟠 High | **Offline failure states are invisible on the parent/shikshak side.** `SyncOpStatus` is mounted only on shikshak check-in / course screens; no screen reads `QUEUE_KEYS.attendance`, `checkout`, or the parent homework queues — so a server 409/`failed` renders as a green "Saved" and a stranded op has no retry. `drainQueues` also reads `err.status` (always undefined; `ApiError` is `.statusCode`), so 4xx batches retry ~25 min instead of going terminal. | `queries.ts:650`, `today.tsx:216`, `sync-engine.ts:419` | Add `useAttendanceSyncOps`/parent equivalents rendering `SyncOpStatus`; fix `httpStatus = err.statusCode`. |
| **XC-MOB-04** | 🟡 Medium | **`preferred_language` is never synced to the server** (toggle is device-local); **shared `Stack.Screen` titles and `ErrorFallback` are English-only**; **no global offline banner**; **`Alert.alert` (~130 sites) is the de-facto mutation-error channel**, blocking and off-design; **queues use AsyncStorage not MMKV** and **`StyleSheet.create` appears in only 8/156 files**. | `_layout.tsx:86-121`, `ErrorFallback.tsx`, `storage.ts:1` | Batchable design/i18n cleanup; prioritize the offline banner and a shared error-toast to retire `Alert.alert`. |

### 3.4 Design-system conformance

Token discipline is genuinely strong on both surfaces — a full scan found only **2 stray hexes** in web `index.css` and **5** in mobile, and **zero** `className` misuse or true emoji in mobile UI. The consistency gaps are: **status badges using stock Tailwind palettes** instead of `--status-*` tokens (`MsvAdminPage.tsx:23`, L084-class), **raw enum strings rendered as labels** in Hindi (`in_progress`, `active` on mobile shikshak lists), **English "Loading…" / headers on Hindi pages** (7 guest pages + mobile stack titles), and **native `window.prompt`/`confirm` for the sanchalak's most consequential decisions** (enrolment reject, deactivate, gallery takedown) where mobile has designed sheets.

---

## 4. super_admin

**Functionality status**

| ID | Functionality | Surface | Verdict | Findings |
|---|---|---|---|---|
| SUP-F01 | Course templates / MSV curriculum (Q2) | web | 🟢 PASS | — (super-gated in depth) |
| SUP-F02 | Library publish / unpublish / delete | web | 🟡 PARTIAL | CTY-DSN-01 (opaque to editors) |
| SUP-F03 | Settings PATCH | web | 🔴 FAIL | SUP-API-01 (read-only UI) |
| SUP-F04 | States / geography create | web | 🟢 PASS | — |
| SUP-F05 | Queues / DLQ | web | 🟡 PARTIAL | SUP-DSN-01 (defaults to non-existent queue) |
| SUP-F06 | Impersonation start / stop | web | 🔴 FAIL | SUP-API-03 (no start UI), SUP-API-04 (origin-fragile stop), XC-API-05 (audit) |
| SUP-F07 | Audit logs | web | 🟡 PARTIAL | STA-API-01 (200-row cap) |
| SUP-F08 | 80G configuration (Q3) | web | 🔴 FAIL | XC-API-02 |

**Key findings** (repro in the [master table](#13-master-issue-table)):
- **SUP-API-03 (High):** `POST /v1/admin/impersonate/:userId` is built and super-only, but no UI starts it — the whole feature (banner, cookie, audit) is unreachable except via curl. Add a super-only "Impersonate" row action to Team/Shikshaks with a confirm dialog.
- **SUP-API-04 (Medium):** the stop button is a native `<form action="/v1/admin/impersonate/stop">` with a hardcoded same-origin path — on a split-origin deploy it POSTs to the web host and the session never ends. Use `apiPost` (which prefixes `API_BASE`) with the form as a `noscript` fallback.
- **SUP-API-01 (High):** `PATCH /v1/admin/settings` exists (super-only, audited) but `SettingsPage` renders a bare read-only table — the one writable setting is unreachable.
- **SUP-DSN-01 (Medium):** Queues page initialises `selectedQueue` to `'notifications.fanout'`, not a member of `QUEUE_NAMES`, so the DLQ view opens on a false "all clear". Default from `stats[0]`.

**What works well:** Q2 is enforced in depth (UI hides the `msv` kind, templates panel is super-gated, server rejects independently); exam OTPs are hashed at rest; `QueuesPage` is the reference implementation of a role-restricted page (skips the fetch, explains the restriction in one calm sentence).

---

## 5. state_admin

Reviewed as a scope delta of city_admin. Distinct surfaces: audit logs, state-wide geography/settings visibility, state notice audience.

| ID | Functionality | Surface | Verdict | Findings |
|---|---|---|---|---|
| STA-F02 | Audit logs | web | 🟡 PARTIAL | STA-API-01 |
| STA-F03/F04 | Settings / Geography (read) | web | 🟡 PARTIAL | STA-DSN-01 |
| STA-F05 | State-audience notices | web | 🟡 PARTIAL | CTY-DSN-02 |

- **STA-API-01 (High):** `/admin/audit` hardcodes `limit:200`, no cursor — a state_admin can never see beyond the newest 200 entries, and a city_admin who types the URL gets a bare 403 red card (looks broken, not restricted). Move to `useAdminList` + `AdminLoadMore` and add a role-aware restricted state.
- **STA-DSN-01 (Medium):** Geography and Settings sit at `min:state_admin` in the nav but every mutation is super-only and the buttons are simply *absent* with no explanation — the state_admin can't tell if the page is broken or restricted. Add a role-aware read-only subtitle (L005).

---

## 6. city_admin

**Functionality status** (highlights)

| ID | Functionality | Surface | Verdict | Findings |
|---|---|---|---|---|
| CTY-F01 | MSV enrolment review (Q1) | web | 🟡 PARTIAL | CTY-API-08 (note dropped), XC-API-01 (reachable by shikshak) |
| CTY-F02 | Exams create / edit / release | web | 🔴 FAIL | CTY-ERR-01, CTY-API-01, CTY-API-07, CTY-API-07b |
| CTY-F05 | Quizzes | web | 🟡 PARTIAL | CTY-API-10 (guard parity) |
| CTY-F06 | Competitions | web | 🟡 PARTIAL | CTY-API-10, CTY-API-05 |
| CTY-F07 | Courses authoring (Q2) | web | 🟢 PASS | — |
| CTY-F14 | Library draft editing | web | 🟡 PARTIAL | CTY-DSN-01 |
| CTY-F17 | Punya configs | web | 🔴 FAIL | CTY-API-09 (create-only) |
| CTY-F18 | Donations visibility | web | 🔴 FAIL | XC-API-01 (no guard → PII leak) |
| CTY-F21 | Mobile admin | mobile | 🟡 PARTIAL | XC-MOB-01 (stranded certify) |

**Key findings:**
- **CTY-ERR-01 (Critical) + CTY-API-01 (Critical):** `GET /v1/admin/exams` omits `title_hi`/`max_attempts`, so opening "Edit exam" calls `.trim()` on `undefined` and (with no error boundary) white-screens the whole panel; and the edit dialog PATCHes `/v1/admin/exams/:id`, an endpoint that **does not exist** (verified — no `router.patch("/exams"`), so no exam is ever editable. Add the columns + the PATCH route (or remove the dialog).
- **CTY-API-07b (High, STILL-OPEN L055):** create validates only `pass_mark <= total_marks`; the builder never shows `SUM(question marks)` vs declared `total_marks`; `release-results` checks scope only — so an exam declared out of 100 whose questions total 20 fails the entire cohort. Show the running sum; block release on mismatch.
- **CTY-API-05 (High, L026):** exam/competition/notice dialogs feed unscoped `/v1/admin/geography` straight into a `<Select>`, offering every city in India; the server 403s after the form is filled. Reuse the `QuizzesPage`/`AddNiyamDialog` role-filter (extract a `useScopedGeography()` hook).
- **CTY-API-09 (High):** Punya configs are create-only — a mis-entered point value can never be corrected. Add `PATCH /v1/admin/punya/configs/:id` + row edit.

**What works well:** Q2 layered enforcement; `QuizzesPage`/`AddNiyamDialog` scope their pickers correctly; bilingual authoring is consistently required where content is bilingual; marks lock after results release with a plain-language explanation.

---

## 7. sanchalak

**Functionality status** (highlights)

| ID | Functionality | Surface | Verdict | Findings |
|---|---|---|---|---|
| SAN-F01 | Centre dashboard | both | 🟡 PARTIAL | SAN-ERR-01 (web zeroes on failure), SAN-DSN-04 |
| SAN-F02 | Students + deactivate (Q11) | both | 🟡 PARTIAL | SAN-API-07 (web no filter/paging), SAN-ERR-02 (reason discarded) |
| SAN-F03 | Enrolment review | both | 🟡 PARTIAL | SAN-API-03 (web 1-char reason), SAN-API-04 (50-student picker) |
| SAN-F04 | Batch mgmt (timetable AT9) | both | 🔴 FAIL | SAN-API-06 (no timetable-edit UI) |
| SAN-F08 | AT27 alerts | mobile ✓ / web ✗ | 🟡 PARTIAL | SAN-API-10 |
| SAN-F09 | Niyam review centre-wide (Q12) | both | 🟡 PARTIAL | SAN-API-01 |
| SAN-F16 | Gallery mgmt | both | 🟡 PARTIAL | SAN-API-05 (web offers forbidden Feature) |

**Key findings:**
- **SAN-API-01 (High):** `inBatchWriteScope` returns `false` for a null `batch_id` *before* the `batchIds === null → centre` fallback (`scope.ts:133`), so a sanchalak cannot decide a niyam / certify / award Punya for a **student with no batch** (newly-approved, pre-enrolment) — the exact stranded-submission case Q12 exists to prevent. Reorder the guard so `batchIds === null` resolves to centre membership first. *(Verified: `scope.ts:133` returns false before line 134's centre fallback.)*
- **SAN-API-06 (High):** `PATCH /v1/admin/batches/:id/timetable` — the only path that rematerialises sessions and notifies parents (AT9) — has **no client caller** on either surface; the only workaround is deactivate-and-recreate, which orphans history. Add a timetable editor.
- **SAN-API-03 / SAN-API-05 / SAN-DSN-02 (High/Medium):** the mobile fixes for enrolment-reject reason length (L037), gallery feature-gating and designed reason dialogs were **not applied to web** — web still uses `window.prompt` with a truthiness check (a 1-char reason reaches a parent), renders a Feature button that 403s for sanchalak, and a dead "Featured" checkbox on upload.
- **SAN-ERR-01 (High):** the web dashboard's two fetches end in `.catch(() => {})` and render the all-zero `EMPTY` constant as real data on any API failure.

**What works well:** mobile is the reference implementation for this persona — server-search + status-filter + cursor students, a genuinely pastoral AT27/AT32.4 attendance monitor with a "Call parent" action, Q12 mobile niyam review satisfied, and L040 (holiday delete + rematerialise) verified fixed on both surfaces. Monthly reports read the canonical AT5 SQL function (L044 not reproducible).

---

## 8. shikshak

**Functionality status** (highlights) and **AT-conformance** in §8.1.

| ID | Functionality | Surface | Verdict | Findings |
|---|---|---|---|---|
| SHI-F04 | Attendance marking (bulk, mobile) | mobile | 🟡 PARTIAL | SHI-API-04 (no late/excused), SHI-API-06 (excused prefill) |
| SHI-F05 | Attendance marking (web) | web | 🔴 FAIL | SHI-API-02 (present-default), SHI-API-09 |
| SHI-F06 | Attendance offline sync states | mobile | 🔴 FAIL | XC-MOB-03, SHI-ERR-08 |
| SHI-F20 | Shivir QR scan | mobile | 🔴 FAIL | XC-MOB-02 |
| SHI-F11 | Niyam review (Q12) | both | 🟢 PASS | SHI-API-10 (deep-link filter) |
| SHI-F16 | Course progress + certify | mobile | 🟢 PASS | SHI-PRF-16 |

**Key findings:**
- **SHI-API-02 (Critical):** the **web** attendance dialog seeds unmarked students to `'present'` and POSTs the whole roster (`AttendancePage.tsx:89,107`), fabricating affirmative attendance and awarding Punya (+ parent push) to children who never came — a direct AT6 inversion. *(Verified at file:line.)* Add a "Not marked" default; submit only touched rows.
- **XC-MOB-02 (Critical):** shivir QR scan is online-only — every scan at a no-signal venue is lost (AT28 makes it the only record). Add the offline producer.
- **SHI-ERR-01 / XC-MOB-03 (Critical/High):** the attendance offline queue has no UI — `useMarkAttendance` throws away the drain result and returns success, so a 409 (cancelled/edit-window) renders as a green "Saved — queued" forever.
- **SHI-ERR-05 (High, REGRESSION L120):** the today-sessions list is dropped from the persist cache because the allow-list matches `["shikshak","today"]` but `qk.today` is `["me","today"]` — a Guruji relaunching offline at a centre sees "No sessions today" and can reach no roster. One-line fix in `shouldPersistQueryKey`.

### 8.1 AT-rule client conformance

| Rule | Verdict | Note |
|---|---|---|
| AT1/AT3 four statuses in marking UI | 🔴 FAIL | mobile roster is present/absent only (L015); late/excused unreachable |
| AT4 excused prefill | 🟡 PARTIAL | prefills, but "All present" wipes it and it can't be restored; reason never shown |
| AT6 partial submit, no auto-absent | 🟢 mobile / 🔴 web | mobile submits only marked rows; **web defaults to present** (SHI-API-02) |
| AT8/AT32 mark without check-in | 🟢 PASS | no gate; advisory only; soft-create keys on (batch, date) |
| AT15/AT32.2 GPS never blocks, no sentinels | 🟡 PARTIAL | lat/lng correctly null (L050 fixed); but `accuracy_m: … ?? 0` invents a pinpoint fix (SHI-API-13) |
| AT16/AT19 op-id plumbing | 🟢 PASS | ULID `submission_op_id` + per-item `client_op_id` |
| AT26 client `marked_at` + rejection mapping | 🟡 PARTIAL | sent correctly; `ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED` has no client copy |
| Six offline states — check-in | 🟢 PASS | full coverage (L053 fixed) |
| Six offline states — attendance / check-out | 🔴 FAIL | no UI consumer (SHI-ERR-01, SHI-ERR-07) |
| Q12 batch-bound decide, centre-wide read | 🟢 PASS | `can_decide` disables-not-hides, explains why, bulk re-filters |

**What works well:** AT32/AT8/AT15 GPS handling is genuinely correct (equal-weight "Start without location", honest denial copy, null coords); the drain planner (causal order + FAILED escape hatch + orphan requeue) and backoff-with-jitter match the spec exactly; the course module is the reference six-state offline UI; roster virtualization (L119) and students search/cursor (L038) verified fixed.

---

## 9. parent

**Functionality status** (highlights)

| ID | Functionality | Verdict | Findings |
|---|---|---|---|
| PAR-F01 | Children + child switcher | 🔴 FAIL | PAR-API-04 (inactive child leak) |
| PAR-F05 | Niyam submit + proof | 🔴 FAIL | XC-MOB-02 (offline loss) |
| PAR-F07 | Homework submit / mark-done | 🔴 FAIL | XC-MOB-01 (never drains), XC-MOB-03 |
| PAR-F13 | MSV apply + status | 🔴 MISSING | PAR-API-05 (no client wiring) |
| PAR-F17 | Competitions register | 🔴 FAIL | PAR-API-07 (wrong child shown registered) |
| PAR-F19 | Notifications inbox | 🟡 PARTIAL | PAR-API-08 (page 1 only) |
| PAR-F12 | Gallery opt-in (Q6) | 🟡 PARTIAL | PAR-API-13 (stale caches) |

**Key findings:**
- **PAR-API-04 (High):** `GET /v1/me/children` filters only `deleted_at`, not `status='active'`, while every downstream child-scoped call uses `ownedStudentsCondition` (active-only) — a deactivated child appears in the switcher, can become the default selection, and then every screen 404s. *(Verified: `me.ts:195` omits the status filter.)* Reuse `ownedStudentsCondition`.
- **PAR-API-05 (High):** `POST /v1/msv/apply` and `GET /v1/msv/mine` are fully built and guarded but **have no client surface at all** — a parent cannot apply for MSV or see pending/rejected status (only an `approved` pill renders). Build the apply + status screen.
- **PAR-API-07 (High):** competition "Registered" state is a local `Record<compId,true>` never reset on child-switch, and the query key isn't child-scoped, so registering child A shows child B as already-registered and blocks them. Return `registered_student_ids` and key by student.
- **PAR-API-08 (High):** notifications fetch page 1 only although the server is cursor-paginated — notification 51+ is unreachable. Convert to `useInfiniteQuery`.

**What works well:** the exam take-flow is the app's reference implementation (debounced autosave with an out-of-order guard, a real resume endpoint, advisory-locked attempt caps — L059/L063 verified fixed); `SessionViewContext` gets child-switch hygiene right; Q6 consent is modelled correctly end-to-end; AT5 is honoured everywhere (no client recomputes the percentage); the loading/empty/error triad is genuinely consistent via one `StateView` primitive.

---

## 10. student

Student is a **separate OTP login role**, not the parent's `switch-view` toggle (Q4's `POST /v1/auth/switch-view` does not exist).

| ID | Functionality | Verdict | Findings |
|---|---|---|---|
| STU-F21 | Login provisioning + 13+ gate | 🔴 FAIL | PAR-API-01 |
| STU-F20 | Punya balance + ledger | 🟡 PARTIAL | STU-DSN-12 (English-only), STU-API-14 (capped at 50) |
| STU-F16 | Quizzes take | 🟡 PARTIAL | STU-API-06 (answer loss) |
| STU-F01 | Home | 🟡 PARTIAL | L004 (near-duplicate of parent home) |

**Key findings:**
- **PAR-API-01 (Critical):** the Q4 "13+ hard gate" exists in exactly two places (course-progress write + `courses.ts:187`); **every other student surface** — niyams, exams, quizzes, competitions, punya, ID card, service requests — accepts a `role='student'` actor of any age, and `join-provision.ts:251` mints a student login on a distinct 10-digit mobile with **no age check** (`reg.age` is available but ungated). *(Verified at file:line.)* Gate provisioning at `reg.age >= 13` and add a shared `assertStudentViewAge()` in the auth service. The student tab group itself is clean (no parent-only leakage).
- **STU-API-06 (High, STILL-OPEN L014/L083):** quiz answers persist only at submit and there is no `PUT .../answers` route (unlike exams), so an app-kill mid-attempt loses every answer and consumes the attempt slot. Add quiz autosave mirroring the exam flow. *(L072 quiz-lockout and L074 Hindi-blanks verified fixed.)*
- **STU-DSN-12 (Medium):** the punya ledger — the student's headline tab — renders `humanize(feature_key)` (Title-cased English) with no Hindi mapping. Add a bilingual `feature_key` label map.

---

## 11. guest

**Functionality status** (highlights)

| ID | Functionality | Surface | Verdict | Findings |
|---|---|---|---|---|
| GST-F11 | Join funnel | both | 🔴 FAIL | GST-API-01 (closed-on-error), GST-PRF-03 |
| GST-F12 | Join → complete payment | both | 🔴 FAIL | GST-API-02 (student CTA missing), GST-API-11 (code enumeration) |
| GST-F14/F15 | Enquiry / Donation | mobile | 🔴 FAIL | GST-API-03 (mailto stubs) |
| GST-F01/F02 | Centres / Shivirs browse | web | 🔴 FAIL | XC-WEB-03 (silent-empty), GST-PRF-02 |
| GST-F03 | Public library | web | 🔴 FAIL | GST-PRF-01 (re-downloads whole corpus) |
| GST-F10 | Public courses | both | 🟡 PARTIAL | GST-API-12 (no mobile entry), GST-API-13 (unfiltered) |

**Key findings:**
- **GST-API-01 (Critical):** every join-form load failure (offline, 500, timeout) is mapped to `phase='closed'`, so a prospective family is told "Registration is closed" when the server is merely unreachable — on the single highest-value conversion path. *(Verified: `JoinStudentPage.tsx:63` sets `'closed'` in the catch.)* Add a distinct `'error'` phase with retry; reserve "closed" for `registration_open === false`.
- **GST-API-03 (High):** mobile guest Donate and Enquire are static `mailto:` stubs though `POST /v1/enquiries` and `/v1/donations/*` are fully wired on web — the surface most guests use can't donate or enquire. Port the web forms.
- **GST-API-02 (High):** the student join "done" screen dead-ends with only a "Done" button; `/join/student/complete-payment` is routed but unlinked, so students can't pay. Add the CTA.
- **GST-PRF-01 (High):** all three web library pages raw-fetch the whole `/v1/public/library` tree (every item's full scripture text) and `.find()` one node client-side, ignoring the purpose-built `/sections/:id` endpoint — three full-corpus downloads to read one text.
- **GST-API-11 (Low, ties to XC-API-04):** complete-payment lookup echoes a registrant's real name for a sequential `display_code` and lets the same session flip `has_paid`, unthrottled — enumeration + write. Require a mobile-number match; add client backoff.

**What works well:** mobile's `StateView` triad is genuinely consistent; library guest-gating is correct and matches the server on both surfaces; team city pages are properly cursor-paginated and crawlable; no emoji anywhere in guest UI; Devanagari line-height discipline (≥22px) is applied where it matters; `dev-capture` is safely fenced to non-production. Baseline: **L087, L117, L143 verified FIXED.**

---

## 12. Baseline reconciliation (prior reviews)

**Verified FIXED** (spot-checked): exam take-flow resume/context/caps (L059, L063), homework upload folder (L101), "Submitted."-on-failure (L104), HEIC picker (L107), GPS sentinels (L050), check-in wiring (L047), fake-geofence removed (L048), roster virtualization (L119), offline query cache for sessions (L120 — but the *today list* regressed, SHI-ERR-05), students search/cursor (L038), niyam streak-lapse cron (L152), badge push bilingual (L153), quiz lockout (L072), quiz Hindi blanks (L074), holiday delete+rematerialise (L040), SR dialog programmatic open (L141), library `safeHref` (L087), lazy route bundles (L117), public nav localization (L143).

**Notable STILL-OPEN:** L001 (switch-view/Q4), L003 (mobile sync roles), L011/L110/L154 (niyam offline), L015 (late/excused UI), L024 (route guards), L026 (geography pickers), L027 (settings read-only), L028/L029 (impersonation start, library publish handoff), L030 (dead exports), L031 (list truncation), L034 (notice audience), L044 — *not reproducible* (report reads AT5 SQL), L055 (exam pass-mark), L071–L084 (quiz module — largely open), L095–L099 (library publish/cleanup/audit).

**REGRESSION:** L069 (exam edit — a broken PATCH endpoint replaced the absent one, CTY-API-01), L120 (today-list cache key drift, SHI-ERR-05).

---

## 14. Prioritized backlog

**P0 — ship-blockers (Critical, restore a broken/unsafe journey)**

| Fix | Restores | Effort | IDs |
|---|---|---|---|
| Route guards from `ADMIN_NAV` + tighten MSV/donations/settings endpoints | admin authorization; stops shikshak reading donor PII / approving MSV | M | XC-API-01, CTY-API-03/04 |
| Start the offline drain loop for any role with queued work | parent homework sync, city-admin certify | S | XC-MOB-01 |
| Add niyam + shivir offline producers | parent niyam proof, shivir scans at no-signal venues | M | XC-MOB-02 |
| Web attendance: "Not marked" default, submit touched rows only | AT6 correctness; stops false Punya/pushes | S | SHI-API-02 |
| Age-gate student provisioning + `assertStudentViewAge()` | Q4 13+ enforcement | S | PAR-API-01 |
| `/v1/me/children` → `ownedStudentsCondition` | parent app after a child is deactivated | S | PAR-API-04 |
| 80G settings + gate capture on the flag | Q3; stops unconditional 80G receipts | M | XC-API-02 |
| Split join load-error from "closed"; port mobile donate/enquire | guest conversion + giving | M | GST-API-01/03 |
| Add `PATCH /v1/admin/exams/:id` + missing SELECT columns + error boundary | exam edit (currently white-screens) | M | CTY-ERR-01, CTY-API-01, XC-WEB-01 |

**P1 — next sprint (High)**

Attendance offline UI + `err.statusCode` fix (XC-MOB-03, SHI-ERR-08); today-list cache key (SHI-ERR-05); `inBatchWriteScope` null-batch reorder (SAN-API-01); AT9 timetable-edit UI (SAN-API-06); exam pass-mark reconciliation (CTY-API-07b); scoped geography hook (CTY-API-05); adopt `AdminLoadMore` across lists (XC-WEB-02); web enrolment/gallery/deactivate parity with mobile (SAN-API-03/05, SAN-ERR-01/02); MSV apply screen (PAR-API-05); competition per-child state (PAR-API-07); notifications + punya paging (PAR-API-08, STU-API-14); quiz autosave (STU-API-06); impersonation start UI (SUP-API-03); settings edit UI (SUP-API-01); public rate limits (XC-API-04); Q7 video validation (XC-API-03); device-cap + refresh-family (XC-API-05); silent-empty error states (XC-WEB-03); library publish handoff (CTY-DSN-01); audit paging (STA-API-01).

**P2 — hygiene (Medium/Low)**

Remove debug telemetry (XC-WEB-04) — trivial and recurring; retire `window.prompt` for designed dialogs (SAN-DSN-02); status-token badges (CTY-DSN-03); bilingual labels for punya/enum strings (STU-DSN-12, SHI-DSN-15); localized loading/headers (GST-DSN-01/04); AT24 TOCTOU + `kind` enum + AT16 notify (XC-API-07); dead admin exports (SUP-DSN-02); mobile offline banner + `Alert.alert` retirement (XC-MOB-04); dark-mode/react-query cleanup (XC-WEB-05).

---

## 13. Master issue table

Persona → Navigation → Action → Observed → Expected → Fix. Sorted by persona, then severity. `S/H/M/L` = Critical/High/Medium/Low.

| Persona | Surface | Navigation | Action | Observed | Expected | Sev | Fix | ID |
|---|---|---|---|---|---|---|---|---|
| super_admin | web | System → Settings | Configure or disable 80G | No control; receipts claim 80G unconditionally | Toggle with paired reg-number+PAN validation, default off | S | Add `eighty_g_*` settings; gate capture | XC-API-02 |
| super_admin | web | People/Team rows | Start impersonating a user | No control exists anywhere (curl-only) | Super-only row action with confirm | H | Add ImpersonateButton to Team/Shikshaks | SUP-API-03 |
| super_admin | web | System → Settings | Edit a platform setting | Read-only table, no edit control | Inline edit for allowlisted keys | H | Edit dialog wired to PATCH /settings | SUP-API-01 |
| super_admin | web | Impersonation banner | Click "Stop impersonating" (split-origin deploy) | POSTs to web origin; session never ends | Stop reaches API; returns to own account | M | apiPost with noscript form fallback | SUP-API-04 |
| super_admin | web | System → Queues | Open the page | DLQ defaults to non-existent queue → false all-clear | Default to a real queue from stats | M | Init selectedQueue from stats[0] | SUP-DSN-01 |
| super_admin | web | Programme → Exam builder | Pick between same-named exams | Options indistinguishable (title only) | City + window shown per option | L | Add city_name/window to option label | CTY-DSN-06 |
| super_admin | web | (code health) | Read AdminListPages.tsx | 5 dead page components shadow live ones | Removed | L | Delete unused exports | SUP-DSN-02 |
| state_admin | web | Insights → Audit log | Filter / scroll past 200 | Hard cap at 200; city_admin sees bare 403 card | Cursor paging + explicit restricted state | H | useAdminList + AdminLoadMore + 403 copy | STA-API-01 |
| state_admin | web | System → Geography / Settings | Open either page | Read-only, no explanation why | Read-only note naming who can edit | M | Role-aware subtitle | STA-DSN-01 |
| city_admin | web | Programme → Exams → Edit | Click the edit pencil | Whole admin panel white-screens | Dialog opens pre-filled | S | Add missing SELECT cols + error boundary | CTY-ERR-01 |
| city_admin | web | Programme → Exams → Edit | Change dates/marks, save | Silent 404; exam never editable | Exam updates, list refetches | S | Implement PATCH /v1/admin/exams/:id | CTY-API-01 |
| city_admin | web | Operations → Donations | (shikshak types URL) view donations | Full city donor list + PII renders, no 403 | 403 + explanation card | S | Add canViewDonations to donation routes | XC-API-01 |
| city_admin | web | People → MSV applications | (shikshak types URL) Approve | Approval succeeds — teacher decides admission | 403 + explanation | S | Role-guard routes + MSV write endpoints | XC-API-01 |
| city_admin | web | Programme → Exam builder / Release | Build questions summing below total, release | Whole cohort fails silently | Mismatch warning + release guard | H | Show SUM(marks); block release on mismatch | CTY-API-07b |
| city_admin | web | Programme → Exams → New exam | Pick an out-of-scope city, submit | 403 after full form entry | Picker shows only in-scope cities | H | Scoped geography hook in dialogs | CTY-API-05 |
| city_admin | web | Programme → Exams → New exam | Create with auto OTP | OTP vanishes in a 4s toast, unrecoverable | Persistent code panel + copy + regenerate | H | Show OTP in a dialog, add regenerate | CTY-API-07 |
| city_admin | web | Programme → Punya configs | Correct a wrong point value | No edit/deactivate control | Inline edit + active toggle | H | Add PATCH /punya/configs/:id + row edit | CTY-API-09 |
| city_admin | web | People → MSV applications | Approve an application | No rationale recorded (note dropped) | Optional note captured like reject | H | Add note dialog to approve | CTY-API-08 |
| city_admin | web | Operations → Library → Items | Edit + save a draft | No publish affordance, no draft/published state | Disabled publish + reason + draft badge | H | Render disabled PublishControls for editors | CTY-DSN-01 |
| city_admin | web | Operations → Donations | Scroll to end of list | Silently truncated at 100, no count | Load-more footer or "100 of N" | H | Adopt AdminLoadMore across lists | XC-WEB-02 |
| city_admin | web | any admin mutation | Trigger a 403/409 | Generic "Failed." toast, no code mapping | Code-mapped inline message naming the fix | H | Shared describeApiError() + field errors | CTY-ERR-02 |
| city_admin | mobile | Admin → Courses → student → Certify | Certify while offline | Op queues and never drains for this role | Drains on reconnect | H | Run sync loop for any role with work | XC-MOB-01 |
| city_admin | web | Programme → Competitions / Quizzes | (shikshak types URL) create | Full authoring works below the nav minimum | Guard parity both directions | M | Align server guard with nav min | CTY-API-10 |
| city_admin | web | Programme → Quizzes → Add question | Open dialog with API failing | Empty pickers read as "empty scope" | Inline load error + retry | M | Surface picker load failures | CTY-ERR-03 |
| city_admin | web | Operations → Library / Media / Grading | Follow a link without the role | Silent bounce to dashboard | Named restriction message | M | AdminRestricted card, not Redirect | CTY-DSN-04 |
| city_admin | web | Programme → Exams | Read the OTP column | Always "Set"; implies a retrievable code | "Access code: Required/Not required" | M | Rename column, drop plaintext branch | CTY-DSN-05 |
| city_admin | web | People → MSV applications | View status badges | Off-palette stock Tailwind colours | Status design tokens | M | Swap STATUS_STYLES to --status-* | CTY-DSN-03 |
| city_admin | web | any dialog with a city picker | Open the dialog repeatedly | Full national geography re-fetched each time | Cached, scope-filtered lookup | M | useGeography() cache hook | CTY-PRF-01 |
| city_admin | web | People → ID Cards / Award Punya | Search a student beyond 500 | Not found; Award Punya can't reach them | Server-side ?q= search | M | Add ?q= to /v1/admin/students | CTY-PRF-02 |
| sanchalak | both | Manage → Niyam review | Approve an unbatched student's submission | Disabled "another Guruji's batch" / 404 | Approve succeeds centre-wide | H | Reorder inBatchWriteScope null-batch guard | SAN-API-01 |
| sanchalak | both | Batches | Change a batch's day/time | No control exists | Edit timetable triggers AT9 rematerialise | H | Add timetable edit calling the PATCH | SAN-API-06 |
| sanchalak | web | Notices → New notice | Publish with default audience | 403 after full compose (defaults National) | Only centre/batch offered, centre default | H | Filter AUDIENCE_LABEL by role | SAN-API-02 |
| sanchalak | web | Enrolments → Reject | Enter "x" as the reason | Rejection saved with "x", sent to parent | 10–300 char reason enforced | H | min(10).max(300) + real dialog | SAN-API-03 |
| sanchalak | web | Enrolments → Add enrolment | Search a student late in the alphabet | "No matching student" (only 50 loaded) | Server ?q= search | H | Wire CommandInput to ?q= | SAN-API-04 |
| sanchalak | web | Students | Find a deactivated student | No filter, list capped at 100 | Status filter + search + load more | H | Wire q/status/cursor into the fetch | SAN-API-07 |
| sanchalak | web | Dashboard | Load with API failing | Confident all-zero stats shown as fact | Error state with retry | H | Set error state, not empty catch | SAN-ERR-01 |
| sanchalak | web | Gallery | Click Feature | Generic failure toast (403) | Control hidden with explanation | H | Gate on canFeatureMedia(role) | SAN-API-05 |
| sanchalak | web | Centres → Staffing | Load while API errors | Empty lists read as "no staff" | Error card with retry | M | Keep error state; don't swallow catches | SAN-ERR-03 |
| sanchalak | web | Students → Deactivate | Type a reason, confirm | Reason discarded, no audit trail | Reason stored and audited | M | Persist reason + write audit | SAN-ERR-02 |
| sanchalak | web | Award Punya | Enter points above the role cap | Blind rejection after submit | Cap + remaining-today shown up front | M | Fetch award-limit, clamp, send idem key | SAN-API-08 |
| sanchalak | mobile | Manage / Students | Award Punya to a child | No entry point; card only Deactivate | Student card opens detail with award | M | Add Punya tile + tappable rows | SAN-API-09 |
| sanchalak | web | Attendance | Look for consecutive-absence alerts | Only a flat session table | Four alert groups with parent phone | M | Render /attendance/alerts above log | SAN-API-10 |
| sanchalak | mobile | Holidays | Add a 20-day range | 20 serial requests; vague partial-failure | One ranged call with per-date results | M | Ranged holiday endpoint | SAN-PRF-01 |
| sanchalak | web | Centres → Staffing → Batches | Reassign across several batches | 8 serial writes, partial state on failure | Single atomic assignment call | M | Bulk batch-assignment endpoint | SAN-PRF-02 |
| sanchalak | both | Service requests / Enrolments | Scroll past 100 rows | List silently ends | Load more + result count | M | AdminLoadMore + cursor on mobile hooks | SAN-PRF-03 |
| sanchalak | web | Typed URL (/geography,/settings,/team) | Visit an above-role page | National data + dead buttons render | Access-denied screen | M | Reuse nav min as a route gate | SAN-API-11 |
| sanchalak | web | Enrolments/Students/Gallery | Trigger a reason-required action | Native browser prompt, unstyled, no Hindi | Designed dialog with presets/counter | M | Replace prompts with Dialog | SAN-DSN-02 |
| sanchalak | web | Holidays / Attendance | Read the page subtitle | Rule IDs and route paths shown | Warm human subtitle | M | Rewrite subtitles in product voice | SAN-DSN-01 |
| sanchalak | web | Dashboard | Read the approval queue | Identical anonymous "Enrolment request" rows | Child name, code, batch shown | L | Render fields the API already returns | SAN-DSN-04 |
| shikshak | web | Attendance → Mark | Mark 3 absent, save | 29 untouched students recorded present + Punya | Untouched left unmarked | S | "Not marked" default; submit changed only | SHI-API-02 |
| shikshak | mobile | Shivirs → Scan attendance | Scan cards with no network | Every scan fails and is discarded | Scans queue offline, sync later | S | Add enqueueShivirScan producer | XC-MOB-02 |
| shikshak | mobile | session → Mark | Save on a cancelled/out-of-window session | Green "Saved — queued" success banner | Conflict banner explaining the rejection | S | Surface attendance queue via SyncOpStatus | SHI-ERR-01 |
| shikshak | mobile | Dashboard → session → Mark | Mark a late arrival | Only Present/Absent available | Late + excused selectable | H | Add late/excused to the roster control | SHI-API-04 |
| shikshak | mobile | Dashboard | Relaunch offline at a centre | "No sessions today" — no roster reachable | Cached sessions render from disk | H | Add ["me","today"] to persist allow-list | SHI-ERR-05 |
| shikshak | mobile | session → Mark | Tap "All present" with pre-notified absences | Excused prefill destroyed, unrestorable | Pre-notified rows preserved, reason shown | H | Preserve suggested_status; show reason | SHI-API-06 |
| shikshak | mobile | Dashboard | Close check-out sheet while queued, sync fails | No state shown, no retry possible | Failed banner with manual retry | H | Read checkout queue in today.tsx | SHI-ERR-07 |
| shikshak | mobile | background sync | Server returns 422/401 for the batch | 10 futile retries over ~25 min | Immediate terminal failed state | M | Read err.statusCode, not err.status | SHI-ERR-08 |
| shikshak | web | Attendance → centre | Click Mark on another Guruji's batch | Roster opens, save 403s after the work | Mark disabled with a scope note | M | Return can_mark per row | SHI-API-09 |
| shikshak | mobile | Students → student → Niyam review | Student's submission is past page 1 | "No pending Niyams" — pagination stalls | Student's pending rows listed | M | Pass student_id to /pending | SHI-API-10 |
| shikshak | mobile | Dashboard → Start with location | GPS returns no accuracy value | Recorded as 0 m (pinpoint) | Recorded as null / unverified | M | Send null accuracy, not 0 | SHI-API-13 |
| shikshak | mobile | Homework → assignment → Approve ready | 4 of 30 fail server-side | Only "26 approved"; failures silent | skipped/failed counts surfaced | M | Print skipped/failed; state notify volume | SHI-ERR-14 |
| shikshak | mobile | Guruji menu → Join approvals | Load fails / list empty | Bare error string, no retry, no spinner | StateView triad + confirm on approve | M | Port to React Query + StateView | SHI-ERR-11 |
| shikshak | mobile | Dashboard | Open on a slow link | Full rosters for all batches downloaded, discarded | Counts-only list, roster on demand | M | Seed session cache from today payload | SHI-PRF-12 |
| shikshak | mobile | any list with a status pill | View in Hindi | Raw enum "in_progress"/"active" | Localised sentence-case label | M | Export statusLabel + reuse | SHI-DSN-15 |
| shikshak | mobile | Courses → student tree | Leave the screen open | 2 storage reads/sec with an empty queue | Event-driven updates | M | subscribeQueue; poll only when pending | SHI-PRF-16 |
| shikshak | mobile | Niyam review → select → Approve | Some rows skipped | Raw UUIDs listed in an alert | Student names + reason | L | Map ids to student_name | SHI-ERR-17 |
| shikshak | mobile | Niyam review | Multi-select 20 of 90 | Whole visible list re-renders per tap | Only the tapped row re-renders | L | memo ReviewRow; index by id | SHI-PRF-19 |
| shikshak | both | Guruji menu | Look for notices | No mobile entry (web row exists) | Notices reachable on mobile | L | Add /notices to SHIKSHAK_ACTIONS | SHI-API-18 |
| shikshak | mobile | Homework → New | Type the date as DD-MM-YYYY | Server 422 in an alert after submit | Inline validation or date picker | L | Add a date picker | SHI-API-20 |
| parent | both | Join approval → student mobile OTP | Sign in as an under-13 student | Full student app, no age gate | Login blocked below 13 | S | Age-gate provision + auth | PAR-API-01 |
| parent | mobile | Niyams → Submit Niyam | Submit with proof while offline | "Submission failed", proof + submission lost | "Saved offline — will sync" | S | enqueueNiyamSubmission + media queue | XC-MOB-02 |
| parent | mobile | Homework → Submit | Submit offline, reconnect later | Op stranded in local queue indefinitely | Drains on reconnect, confirms | S | Run sync loop for any role with work | XC-MOB-01 |
| parent | both | Any screen after a child is deactivated | Open the app | Inactive child auto-selected, every screen 404s | Inactive children hidden from switcher | H | Reuse ownedStudentsCondition in /me/children | PAR-API-04 |
| parent | both | (no route exists) | Try to apply for MSV | No entry point anywhere | Apply form + status card wired to /v1/msv | H | Build MSV apply + status screen | PAR-API-05 |
| parent | mobile | Competitions | Register child A, switch to child B | Child B shown registered, can't register | Per-child registration state from server | H | Return registered_student_ids; key by student | PAR-API-07 |
| parent | mobile | Header bell → Notifications | Scroll past 50 items | List ends silently, older unreachable | Loads next page on scroll | H | useInfiniteQuery with next_cursor | PAR-API-08 |
| parent | mobile | Homework | Submit offline, leave, come back | No sign it queued; failures invisible | Per-row queued/syncing/failed badge + retry | H | Mount SyncOpStatus on homework rows | XC-MOB-03 |
| parent | web | /courses | Parent of 2 children in different cities | Merged catalogue, wrong child's cert badges | Child selector scoping both calls | H | Add child picker; pass student_id | PAR-API-10 |
| parent | mobile | Profile → Gallery visibility | Toggle off, return to home | Child's photo still on the carousel | Photos gone immediately | M | Invalidate gallery keys; optimistic switch | PAR-API-13 |
| parent | both | Submit Niyam / Start exam | Multi-child parent acting for 2nd+ child | 429 with a generic failure message | Per-student budget; 429 states the wait | M | Key limiters on (user, student) + 429 copy | PAR-API-11 |
| parent | mobile | Attendance → Notify leave | Type dates dd-mm-yyyy, or pick a holiday week | Format error / silent no-op notice | Date picker, min date, holiday awareness | M | DateTimePicker + pass holidays into modal | PAR-DSN-16 |
| parent | mobile | Homework → All children | Year-end feed of hundreds of rows | Long blank wait then jank / memory spike | Paged FlatList, one page per scroll | M | useInfiniteQuery + FlatList | PAR-PRF-22 |
| parent | mobile | Homework | Hindi-preference parent views assignment | Mixed-script card, body English only | Bilingual title/description with fallback | M | Add title_hi/description_hi | PAR-DSN-15 |
| parent | both | Courses catalogue | Course renamed after a certificate issued | Certificate badge disappears | Badge follows course_id, survives renames | M | Return course_id on cert rows; match on it | PAR-API-18 |
| parent | mobile | Profile → Delete my account | Read the confirmation | Claims permanent deletion of child records | States closure + 30-day purge + re-enrol path | M | Rewrite copy to match soft-delete (Q11) | PAR-DSN-19 |
| student | mobile | Quizzes → Start quiz | App killed mid-attempt, then Resume | All answers lost, attempt slot consumed | Answers restored from server | H | Add quiz answer autosave, mirror exams | STU-API-06 |
| student | mobile | Punya tab | Student with >50 transactions | Ledger stops at 50, total doesn't reconcile | Paged ledger or explicit truncation notice | M | Add cursor paging to punya transactions | STU-API-14 |
| student | mobile | Punya tab | Switch app to Hindi | Ledger rows in English key-case | Devanagari feature labels | M | Bilingual feature_key label map | STU-DSN-12 |
| student | mobile | Quizzes → Start quiz | Start/submit fails in Hindi session | English-only alert, no fix stated | Bilingual "problem + fix" from the screen | M | Move onError to screen; hi/en copy | PAR-ERR-17 |
| parent/student | mobile | Course detail / SR thread | View in Hindi | CJK period; English-only timestamps | Devanagari punctuation; locale-aware dates | L | Fix punctuation; pass locale to toLocaleString | PAR-DSN-20 |
| guest | both | Home → Join → Student | Open the form while API is down | "Registration is closed" | "Couldn't load — check connection, retry" | S | Split load-error from closed state | GST-API-01 |
| guest | mobile | More → Donate / Enquire | Make a donation or send an enquiry | mailto composer opens, no API call | In-app forms posting to /v1/donations, /enquiries | H | Port DonatePage/EnquirePage to mobile | GST-API-03 |
| guest | both | Join → Student → Submit | Pay the registration fee | Only "Done"; payment screen unreachable | "Complete payment" CTA with code prefilled | H | Add complete-payment CTA to student done | GST-API-02 |
| guest | web | Home → Centres (also Shivirs, Donate) | Browse while the API is down | "No centres listed yet" — looks empty | Error state naming the failure + Retry | H | Add error state; stop no-op catch | XC-WEB-03 |
| guest | web | Centres → a centre (also /register) | Open a detail page during a 5xx | "Centre not found" / "No form available" | Distinct load-failure state with retry | H | Separate 404 from catch/5xx | GST-ERR-02 |
| guest | web | Library → section → text | Browse two levels deep | Full library corpus downloaded 3× | One index fetch + one per-section fetch | H | Use /public/library/sections/:id; share cache | GST-PRF-01 |
| guest | both | Enquire / Register / Complete payment | Submit an invalid form in Hindi | English server text inside a Hindi page | Localized copy keyed off error.code | M | messageForCode(code, locale) helper | GST-API-05 |
| guest | web | direct URL /about or /msv | Read about MSV in Hindi | English-only stub text | Bilingual copy (same as mobile /info/msv) | M | Reuse mobile CONTENT map on web | GST-DSN-02 |
| guest | mobile | More → Team (also Gallery, Panchang) | Browse in Hindi | English header titles above Hindi content | Localized titles | M | Localize stack titles like join/_layout | GST-DSN-01 |
| guest | web | Library / Courses / Gallery / Notices | Hit a server error | "Library request failed (502)" — raw, English | Localized "problem + fix" copy | M | Replace Error.message with localized pair | GST-DSN-03 |
| guest | web | Centres / Shivirs / Notices / Register | Wait for first paint in Hindi | English "Loading…" | "लोड हो रहा है…" | M | Localize the loading strings | GST-DSN-04 |
| guest | mobile | Centres tab (also Shivirs, Notices) | Scroll a large network list | All rows mounted, janky scroll | Virtualized list | M | Convert maps to FlatList/SectionList | GST-PRF-02 |
| guest | mobile | Centres / Shivirs / Notices tab | Reopen the app offline | Error state, no content | Cached list with an offline notice | M | Add public keys to persist allow-list | GST-ERR-03 |
| guest | both | Enquire → Register | Fill a parent/shikshak registration form | Only the student form exists; no mobile UI | Kind selector on web; mobile screen | M | Add kind selector; port to mobile | GST-API-06 |
| guest | both | Centres → a centre | Check when the centre is closed | No holiday information shown | Published holidays listed under batches | M | Render /v1/centres/:id/holidays | GST-API-07 |
| guest | mobile | Join → Shikshak → Complete payment | Pay by UPI | UPI id as plain text, no QR | QR image + payee name | M | Add payment_qr_image to mobile settings type | GST-API-08 |
| guest | mobile | Sign in tab (vs More → Sign in) | Sign in mid-task | Inline flow ignores returnTo, loses OTP on tab switch | Single shared flow honouring returnTo | M | Redirect guest home CTA to /auth/phone | GST-API-09 |
| guest | mobile | Sign in → Browse grid / More | Browse the course catalogue | No Courses entry point in guest chrome | Courses tile linking to /courses | M | Add Courses to GUEST_BROWSE_ACTIONS | GST-API-12 |
| guest | web | Library → Panchang | Look up today's tithi | "Panchang will be available here soon" | Month calendar (mobile already has it) | M | Port mobile PanchangMonthCalendar to web | GST-API-04 |
| guest | both | Home → Join | See which paths are open | Cards flash "Open" then flip; outage → all "Closed" | Loading state then true status | L | Add loading state; don't default to open | GST-API-10 |
| guest | both | Join → Complete payment | Try sequential registration codes | Each code discloses a name + writable id, unthrottled | Throttle + mobile-number confirmation | L | Require mobile match; client backoff | GST-API-11 |
| guest | both | Join → Student → City | Pick a city | Full national catalogue downloaded + mounted | Server-side search / capped list | M | Add ?q= to cities/centres | GST-PRF-03 |
| guest | both | Home → Courses | Browse the catalogue | Every active course listed, uncapped | Only public-flagged courses, paginated | L | Add is_public filter + limit | GST-API-13 |
| guest | web | Home → Team → a city | Load the roster | Dozens of failed localhost debug POSTs per page | No debug telemetry | L | Delete both #region agent log blocks | XC-WEB-04 |
| guest | web | Gallery (also Notices, Team, Courses) | Recover after a transient failure | Static error card, reload required | Try again button | L | Hoist loader into a retry handler | GST-ERR-04 |
| guest | web | Donate → complete a donation | See the confirmation | Amber badge outside palette, ALL CAPS | gold/accent token, sentence case | L | Swap amber classes for tokens | GST-DSN-05 |

---

*Generated by a static persona-by-persona review. Re-run `pnpm typecheck` and the api-server test suites locally to confirm the type-level and behavioural claims before scheduling P0 work.*
