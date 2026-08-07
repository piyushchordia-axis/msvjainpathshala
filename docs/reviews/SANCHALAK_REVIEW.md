# Code review — Sanchalak persona

**Date:** 2026-08-05
**Covers:** the nine items raised, plus a sweep of what else the Sanchalak can reach on web but not on mobile.

**Scope reviewed:**

| File | Relevance |
|---|---|
| `apps/jain-pathshala-mobile/app/admin/{_layout,dashboard,students,enrolments,batches}.tsx` | the whole mobile admin persona — 538 lines total |
| `apps/jain-pathshala/src/components/admin/sidebar-nav.ts` | the web surface, and the reference for what a Sanchalak may do |
| `apps/jain-pathshala/src/pages/admin/AdminListPages.tsx` | Niyams page, Holidays page |
| `apps/api-server/src/routes/v1/admin.ts` | `/students`, `/enrolments`, `/analytics/overview` |
| `apps/api-server/src/routes/v1/admin-modules.ts` | niyam create/patch guards, holiday write |
| `apps/api-server/src/routes/v1/admin-resources.ts` | holiday read |
| `apps/api-server/src/routes/v1/admin-staffing.ts` | shikshak/sanchalak assignment |
| `apps/api-server/src/routes/v1/notices.ts` | `authorizeWrite` audience gating |

---

## Summary

Eight of your nine items are real, and the good news runs through most of them: **the backend already does the right thing in almost every case.** The enrolment list already returns the student's name. Niyam creation is already gated to city_admin and above. Notice audiences are already constrained so a Sanchalak can only target their own centre. Shikshak assignment, centre reads and holiday writes all exist and are already scoped to sanchalak+. Six of the nine are client-side work against APIs that are ready.

The exception is item 9, and it is worse than "not required". **The Donations YTD figure on the dashboard is not scoped at all** — a Sanchalak of one centre in Pune is being shown the entire organisation's national year-to-date donation total, and so is every shikshak who opens the web dashboard. Every other metric on that same endpoint is centre-scoped. Removing the tile fixes the symptom; the query needs fixing too.

The mobile persona is thin in a way the numbers make plain: the Sanchalak's web sidebar offers eighteen destinations, and the mobile tab bar offers five. Your items 4–8 name four of the gaps. The sweep at the end finds six more, of which two matter operationally — a Sanchalak gets paged by AT27 consecutive-absence alerts and by service-request escalations, and on mobile has no screen for either.

**Verdict: Request changes.** C1 is a data-exposure fix that should not wait for the rest.

---

## Critical

### C1 — Donations YTD is unscoped: every admin sees the national total (item 9)

`GET /v1/admin/analytics/overview` computes six metrics. Five are scoped. One is not:

```ts
// admin.ts:255-261 — every other metric in this Promise.all carries a centre filter
db.select({ sum: sql`coalesce(sum(${donations.amount_paise}),0)::bigint` })
  .from(donations)
  .where(and(
    eq(donations.payment_status, "captured"),
    gte(donations.payment_captured_at, fyStart),
  )),
  //  ↑ no scopedCentreFilter, no city filter, no join to anything scoped
```

Compare the neighbours in the same block: `activeStudents` uses `centreFilter`, `centreCount` uses `centreScope`, `openReq` uses `enrolCentreFilter`, `punyaRow` uses `punyaCentreFilter`. The donations sum joins nothing and filters on nothing but payment status and the financial-year start.

So `donations_total_paise_ytd` is the **national** captured-donation total, returned to every caller of the overview endpoint. On mobile that is sanchalak and above (`ADMIN_ROLES`). On web the Dashboard nav item is `min: 'shikshak'` — so a Guruji sees it too.

The inconsistency is visible in the nav config itself: `/admin/donations` is `min: 'city_admin'`, meaning the donations *page* is deliberately withheld from sanchalak and shikshak. The headline number leaks past that gate on the dashboard.

**Fix, in both halves:**
1. Remove the Donations YTD tile from the mobile dashboard (`admin/dashboard.tsx:26`) — your item 9.
2. Scope the query. Donations need a centre or city association to filter on; if `donations` has no such column, the honest fix is to omit the field entirely for roles below city_admin rather than send a number that means something different than the recipient will assume. Do not leave a national figure on a scoped endpoint.

Worth a quick audit of the other admin aggregate endpoints for the same pattern while you are in there.

---

## Your items

### Item 1 — Enrolments show no name (client-only fix)

`GET /v1/admin/enrolments` already returns everything needed (`admin.ts:552-563`):

```
student_name, student_code, centre_name, batch_name,
status, created_at, decided_at, requested_centre_id, requested_batch_id
```

The mobile card renders **none of the identifying fields** (`admin/enrolments.tsx:87-96`) — only "Submitted: {date}", a status pill, "Decided: {date}", and three action buttons. A Sanchalak is asked to approve, waitlist or reject an enrolment with no idea whose it is.

**Fix:** render `student_name` as the card title, `student_code · centre_name · batch_name` as the subtitle, keep the dates as metadata. Add the fields to `AdminEnrolmentRow` in `lib/types.ts` if they aren't typed yet.

While there: the reject action sends a canned reason.

```ts
// admin/enrolments.tsx:37
{ id, action, reason: action === "reject" ? "Rejected via mobile admin" : undefined }
```

Every mobile rejection carries the string "Rejected via mobile admin". That is the same defect found in the Guruji niyam review screen. Prompt a real reason.

### Item 2 — Students needs search (server + client)

There is no search anywhere: no input on the screen, and `GET /v1/admin/students` (`admin.ts:331-357`) accepts no `q` parameter. It returns up to `clampLimit(req.query.limit, 100, 500)` rows ordered by name, with **no cursor** — so a centre past 500 students silently truncates with no indication.

The list also returns `batch_id` and `centre_id` but no batch or centre *names*, so a Sanchalak running two centres cannot tell which centre a student belongs to.

**Fix:** add `?q=` (matching `full_name` ILIKE or `student_code`), `?status=`, `?batch_id=`, and cursor pagination to the route; add a debounced search field pinned above the `FlatList` with `keyboardShouldPersistTaps="handled"` (already set) and the existing filter-chip pattern from `admin/enrolments.tsx`. Join and return `batch_name` / `centre_name`.

### Item 3 — Niyam creation: API correct, UI is a dead end

The API is already right — `POST /v1/admin/niyams` and `PATCH /v1/admin/niyams/:id` both carry `requireRole("super_admin", "state_admin", "city_admin")` (`admin-modules.ts:485`, `:584`). A Sanchalak gets 403.

The web UI does not know that. `/admin/niyams` is `min: 'shikshak'` in the nav, and the page renders the create dialog unconditionally:

```tsx
// AdminListPages.tsx:871
<AdminPageShell title="Niyams" … actions={<AddNiyamDialog onAdded={reload} />}>
```

So a Sanchalak — and a Guruji — sees "New niyam", opens it, fills in title, points, scope, type, and submits, only to be told 403. The file already knows how to gate: `canToggleNiyam(role, …)` at `:831` guards the enable/disable toggle. The create dialog just never got the same treatment.

**Fix:** wrap `AddNiyamDialog` in a `roleSatisfies(user.role, 'city_admin')` check. The Niyams page itself can stay at `min: 'shikshak'` — reading the catalogue is useful to both roles; only authoring is restricted.

### Items 4–7 — Missing mobile screens (backends all ready)

| Item | Backend | Status |
|---|---|---|
| 4. Shikshak management | `GET/POST /v1/admin/centres/:id/shikshaks`, `.../shikshaks/:userId/remove`, `GET/POST /v1/admin/batches/:id/shikshaks`, `POST /v1/admin/batches/:id/primary`, `GET /v1/admin/users/pick` | Ready. Writes gated by `isSanchalakPlus` (`admin-staffing.ts:337`) |
| 5. Centre management | `GET /v1/admin/centres`, centre detail, `GET/POST /v1/admin/centres/:id/sanchalaks` | Ready. `app/centre/[id].tsx` exists but is a read-only public detail view, not management |
| 6. Holiday management | `GET /v1/admin/centres/:id/holidays` (`admin-resources.ts:660`), `POST` (`admin-modules.ts:686`) — sanchalak+ scoped per AT30, and the POST correctly calls `applyHolidayToSessions` for AT10 | Ready, with one gap — see below |
| 7. Notices | `GET/POST/PATCH/DELETE /v1/notices/admin` | Ready, and **already enforces your audience requirement** |

On item 7 specifically: `authorizeWrite` (`notices.ts:363-394`) already restricts a Sanchalak to `centre` and `batch` audiences with the centre in scope, and returns 403 for `state`, `city`, `national` and `msv`. The mobile screen should therefore offer only "My centre" and "A batch at my centre" as audience choices — not because the client needs to enforce it, but so the Sanchalak is never offered an option the server will reject.

On item 6, one real gap: **there is no DELETE or PATCH for holidays.** A holiday added on the wrong date cannot be removed, and the future sessions that `applyHolidayToSessions` deleted cannot be restored. Add `DELETE /v1/admin/centres/:id/holidays/:holidayId` with re-materialisation, and a publish/unpublish PATCH, before putting this on mobile — mobile date pickers make mis-taps considerably more likely than a desktop form does.

### Item 8 — Dashboard needs action buttons

`admin/dashboard.tsx` renders six stat tiles and exactly one action ("Review enrolments"). There is no `SANCHALAK_ACTIONS` export in `QuickActions.tsx` — only `PARENT_ACTIONS` and `SHIKSHAK_ACTIONS`. The Guruji dashboard gets a full `ShikshakQuickActions` grid; the Sanchalak got a single button.

**Fix:** add `SANCHALAK_ACTIONS` and a `SanchalakQuickActions` component following the existing pattern, and render it on the dashboard below the gallery carousel exactly as `shikshak/today.tsx:38` does.

---

## Also missing (not raised)

The Sanchalak's web sidebar offers eighteen destinations. Mobile offers five tabs. Beyond your items 4–7, these are reachable on web and not on mobile:

| Surface | Web nav | Why it matters on mobile |
|---|---|---|
| **Niyam review** | `min: 'shikshak'` | A Sanchalak can approve niyams for their whole centre (the API uses centre-level `inScope`), and does so on web. On mobile only `/shikshak/niyam-review` exists, and `PersonaTabs allowed={["shikshak"]}` locks a Sanchalak out. If a Guruji is away, the centre's queue cannot be cleared from a phone. |
| **Service requests (admin side)** | `min: 'sanchalak'` | `app/service-requests.tsx` is the *parent* view — it calls `useChildren()`. There is no admin inbox. The Sanchalak is the first line for parent escalations and has no way to see them on a phone. |
| **Attendance / sessions** | `min: 'shikshak'` | **AT27 notifies the Sanchalak** on three consecutive absences, precisely because they are "the person who can actually phone the family". They receive that push and have no screen to open. Same for AT8 unscheduled-session and duplicate-check-in alerts, which also target the Sanchalak. |
| **Homework** | `min: 'shikshak'` | Overdue homework surfacing exists for the Guruji on mobile; the centre head has no view of it. |
| **Gallery moderation** | `min: 'sanchalak'` | Visibility and takedown (`PATCH /admin/:id/visibility`, `DELETE /admin/:id`) are sanchalak-level. A takedown request is time-sensitive and phone-shaped. Note featuring stays city_admin+ (`canFeatureMedia`) — do not widen it. |
| **Reports** | `min: 'sanchalak'` | Lower priority; large tabular output suits desktop. |

Ranked by whether the Sanchalak gets *notified* about something they then cannot act on, the order is: attendance/AT27 alerts, service requests, niyam review, gallery takedown, homework, reports.

---

## What looks good

- **Notice audience authorisation is exemplary** (`notices.ts:363-394`) — a clean switch over audience with the role and geography check for each arm, and a doc comment above it stating the rule in prose. This is the pattern the rest of the codebase should copy.
- **Niyam create/patch guards are correct and consistent**, and the scope-of-edit logic at `:605-615` correctly stops a city_admin editing a national niyam.
- **AT30 is properly implemented on both halves** — public published-only read at `/v1/centres/:id/holidays`, admin read and write nested under `/v1/admin/centres/:id/holidays`, with the AT10 re-materialisation actually wired into the POST rather than left as a TODO.
- **Staffing writes are gated by `isSanchalakPlus` while reads are not**, and the shikshak read is self-filtered (`admin-staffing.ts:281`) so a Guruji sees only their own assignment. That is a considered distinction, not an accident.
- `scopedCentreFilter` / `scopedBatchFilter` are used consistently across `admin.ts` — which is exactly why the unscoped donations query stands out.

---

## Cursor prompts

Ordered by dependency and risk. Prompt 1 is a data-exposure fix and should ship on its own.

### 1 — Scope the donations figure and drop the tile (C1, item 9)

```
Read CLAUDE.md (role hierarchy), then fix GET /v1/admin/analytics/overview in
apps/api-server/src/routes/v1/admin.ts (line ~202).

Five of the six metrics in the Promise.all carry a scope filter (centreFilter, centreScope,
enrolCentreFilter, punyaCentreFilter). The donations sum at line ~255 carries none — it filters
only on payment_status='captured' and the financial-year start, so it returns the NATIONAL
year-to-date donation total to every admin-panel caller, including sanchalak and shikshak. The
/admin/donations page is deliberately min:'city_admin' in the web nav, so this leaks past a gate
that was drawn on purpose.

- Inspect lib/db/src/schema/donations.ts. If donations carry a centre_id or city_id (directly or
  via a student/campaign FK), apply the same scoped filter the other metrics use.
- If there is NO scopable column, do not invent a join. Instead omit donations_total_paise_ytd
  from the response entirely unless canFeatureMedia-style role check passes — use a new
  DONATION_VIEW_ROLES = ["super_admin","state_admin","city_admin"] in lib/api-zod/src/contracts.ts
  with a canViewDonations(role) helper, mirroring EXAM_ADMIN_ROLES. Comment it the same way:
  deliberately narrower than canAccessAdminPanel, do not "fix" by reusing ADMIN_PANEL_ROLES.
- Make the field optional in any client type that reads it.

Then remove the Donations YTD tile from the mobile dashboard stats array in
apps/jain-pathshala-mobile/app/admin/dashboard.tsx (line ~26) — the Sanchalak does not need it.
Leave the web donations page alone; it is already correctly gated.

Add a test asserting a sanchalak's overview response either scopes or omits the donation figure,
and that a city_admin still receives it.

While you are in admin.ts, check the other aggregate endpoints for the same missing-filter
pattern and report anything you find — do not fix them in this prompt.

Run `pnpm typecheck`, `pnpm test`.
```

### 2 — Enrolment details, student search, niyam create gate (items 1, 2, 3)

```
Three independent fixes. All small.

--- Item 1: enrolment cards show no name ---
GET /v1/admin/enrolments (admin.ts:552-563) already returns student_name, student_code,
centre_name and batch_name. apps/jain-pathshala-mobile/app/admin/enrolments.tsx renders none of
them — a Sanchalak approves or rejects with only a submission date on screen.

- Add the fields to AdminEnrolmentRow in apps/jain-pathshala-mobile/lib/types.ts if absent.
- Render student_name as the card title, `student_code · centre_name · batch_name` as the
  subtitle, and keep Submitted/Decided as small muted metadata.
- Replace the hardcoded reject reason (line ~37, "Rejected via mobile admin") with a required
  free-text prompt in a sheet, minimum 10 characters, with a live counter. Offer editable
  presets: "Batch is full for this age group", "Centre is outside the requested area",
  "Details incomplete — please reapply with the student's date of birth", plus Hindi equivalents
  in Devanagari. This reason reaches the parent.

--- Item 2: student search ---
GET /v1/admin/students (admin.ts:331) accepts no search parameter and has no cursor — it caps at
clampLimit(…, 100, 500) and truncates silently past that. It also returns batch_id/centre_id but
no names, so a Sanchalak with two centres cannot tell them apart.

- Add to the route: ?q= (ILIKE on students.full_name OR students.student_code), ?status=,
  ?batch_id=, and keyset pagination returning next_cursor. Keep the existing scope filters.
- Join batches and centres to return batch_name and centre_name.
- Add a covering index if EXPLAIN warrants it. Consider pg_trgm on full_name if the ILIKE is slow.
- In apps/jain-pathshala-mobile/app/admin/students.tsx, pin a debounced (300ms) search field above
  the FlatList — it must stay visible while the list scrolls, not scroll away. Add status filter
  chips reusing the pattern in app/admin/enrolments.tsx. Consume next_cursor via useInfiniteQuery.
  Show batch_name · centre_name on each row.
- Apply the same search to app/shikshak/students.tsx, which shares useAdminStudents.

--- Item 3: niyam create is a dead end for sanchalak and shikshak ---
POST/PATCH /v1/admin/niyams are correctly gated to city_admin+ (admin-modules.ts:485, :584), but
apps/jain-pathshala/src/pages/admin/AdminListPages.tsx:871 renders <AddNiyamDialog /> to everyone
the page is visible to (nav min: 'shikshak'). A Sanchalak fills the entire form and gets a 403.

- Gate the actions prop on roleSatisfies(user.role, 'city_admin') — the helper is already
  imported in that file's neighbourhood and canToggleNiyam at :831 shows the intended pattern.
- Leave the page itself at min:'shikshak'; reading the catalogue is useful to both roles.
- Add a one-line note under the page subtitle for non-authoring roles: "Niyams are set by city
  administrators and above."

Run `pnpm typecheck`, `pnpm test`.
```

### 3 — Holiday delete/publish before mobile exposure (item 6, prerequisite)

```
Read CLAUDE.md AT10 and AT30, then apps/api-server/src/routes/v1/admin-modules.ts (POST
/centres/:id/holidays, line ~686) and admin-resources.ts (GET, line ~660).

Holidays can be created but never removed or unpublished. Creating one calls
applyHolidayToSessions, which deletes future scheduled sessions with zero attendance rows (AT10).
A holiday entered on the wrong date is therefore unrecoverable through the API, and it has
already destroyed the sessions. Fix this BEFORE putting holiday management on mobile, where a
date-picker mis-tap is far more likely than on a desktop form.

Add, both requireRole("super_admin","state_admin","city_admin","sanchalak") and centre-scope
checked, matching the existing POST:

  DELETE /v1/admin/centres/:id/holidays/:holidayId
    - Delete the centre_holidays row, then RE-MATERIALISE the affected date range by calling the
      session.materialise path for that centre so the removed sessions come back.
    - Per AT10, sessions inside the range that already had attendance were never deleted and must
      not be duplicated — the UNIQUE (batch_id, scheduled_date) constraint from AT7 is the guard;
      make sure the re-materialise path respects it rather than working around it.
    - Audit entry recording the date and how many sessions were restored.

  PATCH /v1/admin/centres/:id/holidays/:holidayId
    - is_published only. Does NOT touch sessions — publication controls the public AT30 read,
      not whether class happens.
    - Audit entry.

Update apps/jain-pathshala/src/pages/admin/AdminListPages.tsx HolidaysPage (line ~1248) with
delete and publish/unpublish actions. Delete must confirm and state the consequence plainly:
"This will restore N cancelled sessions for this centre."

Note for a future change, do not implement now: CLAUDE.md AT10 speaks of a holiday "range", but
centre_holidays stores a single holiday_date (schema/centres.ts:88). A Diwali week is currently
seven rows. Either add start/end columns or amend AT10 — flag it, don't fix it here.

Add tests: delete restores the sessions; delete does not duplicate sessions that already had
attendance; unpublish hides the holiday from GET /v1/centres/:id/holidays but leaves sessions
alone.

Run `pnpm db:migrate` if a migration is needed, `pnpm typecheck`, `pnpm test`.
```

### 4 — Sanchalak mobile: quick actions, centres, shikshaks, holidays, notices (items 4, 5, 6, 7, 8)

```
Read apps/jain-pathshala-mobile/components/QuickActions.tsx (SHIKSHAK_ACTIONS pattern),
app/shikshak/today.tsx (how a persona dashboard composes actions), app/shikshak/batches.tsx
(centre switcher + AsyncStorage), and apps/api-server/src/routes/v1/admin-staffing.ts.
Prompt 3 must be merged first — do not ship holiday management on mobile without delete.

The mobile admin persona has five tabs and one dashboard button. The Sanchalak's web sidebar has
eighteen destinations. Add the four missing management surfaces plus a quick-action grid. Every
backend below already exists and is already scoped to sanchalak+ — this is client work.

--- Item 8: quick actions ---
Add SANCHALAK_ACTIONS to components/QuickActions.tsx alongside SHIKSHAK_ACTIONS, and export a
SanchalakQuickActions component using the same ActionTile grid:
  Centres        /admin/centres        business-outline
  Shikshaks      /admin/shikshaks      people-circle-outline
  Holidays       /admin/holidays       calendar-outline
  Notices        /admin/notices        megaphone-outline
  Enrolments     /admin/enrolments     clipboard-outline
  Students       /admin/students       people-outline
  Punya Wall     /gallery              images-outline
  Notifications  /notifications        notifications-outline
Render it on app/admin/dashboard.tsx below the GalleryCarousel, wrapped in AnimatedMount delay 40,
exactly as shikshak/today.tsx does. Keep the "Review enrolments" card — it carries the pending
count context the grid does not.

Add the four new screens to the `hide` array in app/admin/_layout.tsx so they do not become tabs.
The five-tab bar stays as it is.

--- Item 5: app/admin/centres.tsx ---
List centres in scope (GET /v1/admin/centres). Tap → detail showing address, contact, GPS radius
(gps_radius_meters, AT13), batch count, active student count, and the assigned sanchalaks
(GET /v1/admin/centres/:id/sanchalaks). Read-mostly: a Sanchalak may view their centres and
manage staffing, but centre creation stays on web.

--- Item 4: app/admin/shikshaks.tsx ---
Centre switcher at the top (reuse the app/shikshak/batches.tsx AsyncStorage pattern, key
"jp.sanchalak.selectedCentreId"). Below it:
  - Shikshaks assigned to the centre (GET /v1/admin/centres/:id/shikshaks) with name, phone,
    gender, and the batches they teach. Address them by their display name per CLAUDE.md —
    Guruji for male, Didi for female, from users.gender. Never "the teacher".
  - Assign (POST /v1/admin/centres/:id/shikshaks) via a picker backed by GET /v1/admin/users/pick.
  - Remove (POST /v1/admin/centres/:id/shikshaks/:userId/remove), with confirmation.
  - Per batch: assign/remove shikshaks (GET/POST /v1/admin/batches/:id/shikshaks,
    POST /v1/admin/batches/:id/shikshaks/:userId/remove) and set primary
    (POST /v1/admin/batches/:id/primary).
Surface the ERR_WRONG_ROLE 422 clearly — "That person is not registered as a Guruji" — rather
than a generic failure.

--- Item 6: app/admin/holidays.tsx ---
Centre switcher, then the holiday list (GET /v1/admin/centres/:id/holidays) grouped by month,
showing date, reason and published state. Add via a date picker + reason field
(POST /v1/admin/centres/:id/holidays). Delete and publish-toggle via the routes from prompt 3.
The add confirmation MUST state the AT10 consequence before it happens: "Classes scheduled at
this centre on that date will be cancelled. Sessions that already have attendance are kept."

--- Item 7: app/admin/notices.tsx ---
List the Sanchalak's notices (GET /v1/notices/admin), and compose (POST /v1/notices/admin).
Audience picker offers ONLY two options — "My centre" (audience: 'centre') and "A batch at my
centre" (audience: 'batch' + batch picker). Do not offer city, state, national or MSV: notices.ts
authorizeWrite (line ~372) 403s a sanchalak on all four, and offering a choice the server will
refuse is the defect this app keeps repeating.
Fields: title_en + title_hi, content_en + content_hi, pinned, is_critical. Hindi is required, not
optional — this is parent-facing content and CLAUDE.md requires both variants. Edit via PATCH and
delete via DELETE /v1/notices/admin/:id, both with confirmation.

--- Applies to all four screens ---
Design tokens only, never raw hex. Sentence case on buttons and headings. No emoji. Every string
bilingual, rendered with the `hi ? x_hi ?? x_en : x_en` fallback. Devanagari line-height >= 22.
Layouts must tolerate +35% string length in Hindi. Empty and error states via the shared StateView
component. Reuse Card / Row / Pill / Button from components/ui.tsx — do not hand-roll.

Run `pnpm typecheck` and verify each screen on a device as a sanchalak account.
```

### 5 — The unrequested gaps

Not prompted here because they need a scoping decision first. In priority order, judged by whether the Sanchalak is *notified* about something they then cannot act on from a phone:

1. **Attendance / sessions view.** AT27 pages the Sanchalak on three consecutive absences precisely because they are the one who can phone the family. AT8 unscheduled-session and duplicate-check-in alerts also target them. They receive all three and have no screen to open.
2. **Service requests (admin side).** `app/service-requests.tsx` is the parent view — it calls `useChildren()`. The Sanchalak is the first line for parent escalations, on web only.
3. **Niyam review.** The API allows a Sanchalak to approve for their whole centre and the web exposes it, but on mobile only `/shikshak/niyam-review` exists and `PersonaTabs allowed={["shikshak"]}` locks them out. If the Guruji is away the centre queue cannot be cleared from a phone. Cheapest of the three: widen the `allowed` array and move the screen, rather than build anything new — but settle the scope question raised in `SHIKSHAK_CHECKIN_REVIEW.md` first, since it decides whose submissions each role sees.
4. **Gallery moderation** — visibility and takedown are sanchalak-level and time-sensitive. Featuring stays city_admin+ via `canFeatureMedia`; do not widen it.
5. **Homework** — centre-level oversight of what the Guruji screens already show.
6. **Reports** — large tabular output, genuinely better on desktop. Lowest priority.
