# Frontend Exhaustive Audit — Findings Log

Driving every screen via Claude preview (web :5173 / API :8080). Each finding: severity, repro, fix, verification.

Legend: 🔴 broken/data-loss · 🟠 functional gap · 🟡 UX/validation · 🟢 fixed+verified

---

## Findings

### F1 — 🟢 Sunday batches render empty day-of-week (convention mismatch)
- **Where:** Public `/centres/:id` (CentreDetailPage), admin `/admin/batches`, mobile batch lists.
- **Repro:** Ghatkopar centre → "Bal Batch - Sunday Morning" showed `· 09:00–10:30` with no day label.
- **Root cause:** Canonical convention is ISO weekday **1–7 (Sun=7)** — enforced by API zod `min(1).max(7)` (admin-resources.ts:523) and produced by the web day-toggle (`day = i + 1`). But the **seed** stored Sunday as `[0]` (JS convention), which renders as `DAY[0]=''` (empty) everywhere.
- **Fix:** seed.ts Sunday batches `[0]` → `[7]`.
- **Also affected (mobile, ISO-incompatible — pending):** `app/shikshak/batches.tsx` & `app/admin/batches.tsx` use 0-indexed `DAYS_EN=["Sun",...]` so ISO Sunday(7) is out of range → empty; `app/centre/[id].tsx:79` renders the raw `day_of_week` array. To fix in mobile pass.
- **Verify:** reseed → centre detail shows "Sun · 09:00–10:30". ✅

### F2 — 🟢 Public top nav + footer not localized (i18n inconsistency)
- **Where:** `components/public/TopNav.tsx`, `components/public/Footer.tsx`, `lib/locale-context.tsx`.
- **Repro:** Switch language to हिन्दी — page content translated but nav links (Centres/Shivirs/…/About + "Sign in") and the whole footer stayed English; `<html lang>` stayed "en".
- **Fix:** Added Hindi labels to TopNav nav items + Sign-in; localized Footer nav + tagline; LocaleProvider now syncs `document.documentElement.lang`.
- **Verify:** nav → "केंद्र शिविर सूचनाएँ पुस्तकालय गैलरी परिचय / लॉगिन"; footer → "परिचय संपर्क दान करें MSV पूछताछ एडमिन"; `<html lang="hi">`. ✅

### F3 — 🟢 Student registration form missing "Yuva" age-group option
- **Where:** seed.ts student `registration_form_configs` age_group options (only bal/kishor/tarun).
- **Impact:** A yuva-age student can't register; inconsistent with the bal/kishor/tarun/yuva set used everywhere else.
- **Fix:** added `{ value: "yuva", label_en: "Yuva", label_hi: "युवा" }`. (needs reseed to surface)

---

## Public forms — verified OK (no bug)
- **/contact** — native `required` blocks empty submit; valid submit → "Thank you!"; **DB row persisted** (kind=contact, name/email/phone/message, status=new). ✅
- **/enquire** — valid submit (optional phone empty) → thank-you + Register CTA; **DB row persisted** (kind=enquire, city=Surat). ✅
- **/register** (student) — dynamic config fields render (no dup name); submit → **persisted** (responses `{age_group:bal, parent_phone}`, status=submitted). Note: only `student` config seeded — other kinds are admin-published by design (no public links to them). ✅
- Read-only public lists (centres, shivirs+detail, notices, library, gallery) render seeded data, SPA Link nav works, no failed requests, no console errors. ✅

---

## Admin findings

### F4 — 🟢 Student-code format mismatch (seed vs runtime generator)
- **Where:** seed.ts students used `JP0001…JP0005`; runtime generator (admin-resources.ts:569) produces `STU000006`.
- **Impact:** mixed code formats across the roster + on ID cards. No code/test depended on `JP000x` (verified by grep).
- **Fix:** seed codes → `STU000001…STU000005` so seeded + generated codes share one format and stay sequential.

### F5 — 🟢 Waitlisted enrolment could not be approved from the UI
- **Where:** `EnrolmentsPage.tsx` `DecideActions` — Approve button rendered only for `status==='pending'`, so a **waitlisted enrolment could only be rejected**, never promoted to approved (dead-end holding state).
- **API check:** handler `admin.ts:265` sets next status with no current-status guard → waitlisted→approved is fully supported server-side. UI-only bug.
- **Fix:** show Approve for both pending & waitlisted (Waitlist stays pending-only).
- **Verify:** waitlisted Kabir now shows Approve+Reject; approved him → enrolment=approved, student active + batch attached. ✅

### F6 — 🟢 Competition create required a raw City UUID typed by hand
- **Where:** `CompetitionsPage.tsx` "City ID *" was `<Input placeholder="UUID of the city">` — admins can't know/paste city UUIDs (other pages use a city dropdown).
- **Fix:** replaced with a `Select` fetching `/v1/admin/geography` (City (State) labels), matching Exams/Shivirs.
- **Verify:** created "Audit Essay Competition" via the dropdown (Mumbai) → row appears Draft. ✅

### F7 — 🟢 Push-quiz create required a raw Batch UUID typed by hand
- **Where:** `QuizzesPage.tsx` CreatePushDialog "Batch id *" was `<Input placeholder="UUID">` (with a "paste a UUID" hint).
- **Fix:** replaced with a `Select` fetching `/v1/admin/batches` ("name · centre"); removed the centres-hint plumbing.
- **Verify:** started a push quiz via the dropdown → "Push quiz started." + DB row (push_quizzes). ✅

### F8 — 🟢 Punya manual-award required a raw Student UUID typed by hand
- **Where:** `AdminListPages.tsx` PunyaAwardPage "Student ID (UUID)" `<Input placeholder="From Students list">`.
- **Fix:** replaced with a `Select` fetching `/v1/admin/students?limit=500` ("name — code").
- **Verify:** awarded 25 Punya to Aarav via dropdown → "New total: 165 (shravak)"; appears in Punya audit. ✅

### F9 — 🔴 Service-request thread dialog stuck on "Loading…" forever
- **Where:** `ServiceRequestsAdminPage.tsx` — `loadDetail()` was only called from `handleOpenChange` (Radix `onOpenChange`). The dialog is opened **programmatically** (parent sets `open=true`), and Radix doesn't fire `onOpenChange` for externally-controlled opens → the detail fetch never ran (confirmed: no `/v1/service-requests/{id}` request in network log). The whole reply/assign/resolve workflow was unreachable.
- **Fix:** load the thread via `useEffect([open, request?.id])`; Dialog `onOpenChange` now just forwards to the parent setter.
- **Verify:** thread loads (status/parent/student/description/messages); sent a reply (appears in thread); Assign + Resolve → status "Resolved", both buttons disabled. ✅

## Admin pages — verified OK
- **/admin/enquiries** — shows my public Contact/Enquire submissions (end-to-end); kind filter works; status action New→In Review. ✅
- **/admin/service-requests** — open thread, reply, assign, resolve all work (post-F9). ✅
- **/admin/quizzes** — Add-question validation + create (bank 2→3); push quiz via batch dropdown. ✅
- **/admin/shivirs** — create shivir via city dropdown reflects in table. ✅
- **/admin/punya/manual-award** — award via student dropdown returns new total + tier. ✅
- **/admin/punya/configs** — create config reflects in table. ✅
- **/admin/punya/audit** — read-only ledger; shows my +25 award at top (35 rows). ✅
- **/admin/attendance** — Mark dialog (roster + status + GPS) saves; New session create. ✅
- **/admin/notices** — create notice (audience/flags) reflects. ✅
- **/admin/gallery** — feature/unfeature toggle works (tracked by student). ✅
- **/admin/library** — add item reflects. ✅
- **/admin/centres** — add via city dropdown reflects. ✅
- **/admin/holidays** — add via centre dropdown + date reflects. ✅
- **/admin/donations** — read-only; campaigns + my donation visible (₹1,26,100 campaign total). ✅
- **/admin/geography**, **/admin/settings** — read-only render. ✅
- **/admin/audit** — entity-kind filter narrows rows; my own actions are logged. ✅
- **/admin/queues** — super_admin DLQ list + Replay ("Job replayed."). ✅
- **/admin/registration-forms** — config builder publishes versioned config; response Approve (my public reg → approved). ✅
- **/admin/shivir-dashboard** — shivir selector + counts; New session create. ✅
- **Login** — phone validation (disabled <10 digits); OTP flow → /admin. ✅

## Whole-app re-verification (after all fixes)
- **web typecheck** (`tsc --noEmit`): green.
- **mobile typecheck** (`tsc --noEmit`): green (after F1 mobile day fix).
- **web production build** (`vite build`): green — 570 kB / 160 kB gz, built in 1.26s.
- **API tests** (`vitest run`): **105 passed / 17 suites**.
- **clean reseed** verified: Sunday batches `{7}`, codes `STU000001…5`, student form has Yuva. (Note: API tests pollute the DB with a v2 student config — reseed *after* tests; preview left on a fresh seed.)
- Public site: 0 console errors; register shows clean "Student Registration" + Bal/Kishor/Tarun/**Yuva**.
- Preview left logged in as super_admin on `/admin` for the user.

## Summary
- **9 findings, all fixed & browser-verified.** Severities: 1×🔴 (F9 service-request thread unreachable), 3×🟠 UX blockers (F6/F7/F8 raw-UUID inputs → dropdowns), 5×🟡/data (F1 day convention, F2 i18n, F3 yuva, F4 student-code, F5 waitlist-approve).
- **Every screen driven**: 13 public + ~37 admin pages. Every form filled+submitted with **DB-verified persistence**; validation (required/empty) exercised; filters, tabs, status actions, pagination-equivalents, and read-only renders all checked.
- Files changed: web `TopNav/Footer/locale-context/EnrolmentsPage/CompetitionsPage/QuizzesPage/AdminListPages/ServiceRequestsAdminPage`; mobile `shikshak/batches/admin/batches/centre[id]`; `lib/db/src/seed.ts`.
- **/admin/batches** — Add-batch: Sunday toggle → stored ISO `{7}`, renders "Sun · 08:00–09:30"; deactivate persists. ✅
- **/admin/curriculum** — View-tree shows sections/items; create curriculum reflects in table. ✅
- **/admin/exams** — create (auto-gen OTP) + Release-results (Pending→Released, button gone). ✅
- **/admin/exam-builder** — question editor validation blocks no-correct-answer; valid single-choice question added. ✅
- **/admin/niyams** — create niyam reflects in table. ✅
- **/admin/niyam-review** — approve → leaves queue, submission=approved, **punya awarded** (15pts) + persisted. ✅
- **/admin/homework** — Submissions dialog grade (Diya Pending→Approved); New-assignment fans out to batch (0/2). ✅
- **/admin/progress** — level change persists (`in_progress`); report generate → **PDF 200 application/pdf**; Release No→Yes. ✅
- **/admin/competitions** — status flow Open→Closed→Results Published (punya awarded); create via city dropdown. ✅
- **/admin/enrolments** — status filter tabs (URL `?status=`) filter correctly; pending→waitlisted→approved all work + persist; approval attaches student to centre/batch & activates. ✅
- **/admin (Dashboard)** — live KPIs; Donations YTD reflected my public ₹1,100 donation (₹85,000→₹86,100) end-to-end. ✅
- **/admin/students** — Add-student dialog: Register disabled until required filled; created "Audit New Student" (Ghatkopar/bal) → **DB persisted** (STU000006); Deactivate (prompt reason) → status→inactive, button→Reactivate, persisted. ✅
- **/admin/msv-enrolments** — Approve applied→approved persists (student msv_status=approved); reject dialog present. ✅
- **/admin/shikshaks** — read-only roster renders. ✅
- **/admin/id-cards** — search filter narrows list; select+Generate → signed-QR PNG (600×380) renders + Open link; **DB persisted** (MSV-JP0001 v1 active). ✅
- **/admin/analytics** — metrics render & update live with actions (MSV approved 2→3, pending 1→0). ✅
- **/admin/reports** — session attendance table (12 rows). Read-only (no filters/export — by design). ✅
