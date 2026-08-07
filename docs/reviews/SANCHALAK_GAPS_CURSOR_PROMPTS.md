# Sanchalak — the six unrequested gaps, Cursor prompts

**Date:** 2026-08-05
Companion to [`SANCHALAK_REVIEW.md`](./SANCHALAK_REVIEW.md), which covers the nine items you raised. This file covers the six gaps found in the sweep, with the scoping decisions now settled.

## Decisions taken

| Gap | Decision |
|---|---|
| 1. Attendance / sessions | Centre monitor + alerts, **read-only**. The Sanchalak observes and phones; the Guruji marks. |
| 2. Service requests | **Full inbox** — list, thread, reply, claim, resolve. |
| 3. Niyam review | **Tighten shikshak to batch scope; Sanchalak is the safety net.** Recorded as **Q12** in `CLAUDE.md`. |
| 4. Gallery moderation | **Full parity with web**, including opted-out items — with mobile-specific safeguards (below). |
| 5. Homework | **Full parity** with the Guruji screen. |
| 6. Reports | **Build a real monthly centre report** with PDF share. Web Reports page rethought alongside. |

Build order below is by dependency and risk, not by gap number.

---

## 1 — Niyam review: Q12 scope + Sanchalak mobile access (gap 3)

Ship the two halves together. Tightening the shikshak gate without the Sanchalak's mobile access strands unstaffed batches — that is why Q12 says so explicitly.

```
Read CLAUDE.md Q12 (new) and Q5, then apps/api-server/src/routes/v1/niyam-submissions.ts
(POST /:id/approve line ~859, POST /:id/reject line ~993) and apps/api-server/src/lib/scope.ts.

Both routes currently gate on inScope(scope, sub.centre_id) — the @deprecated centre-level check.
A shikshak can therefore approve or reject proof for children in batches they do not teach.

=== Part A: server ===
- Select students.batch_id alongside centre_id in both handlers.
- Replace inScope with inBatchWriteScope(scope, sub.batch_id, sub.centre_id). Do NOT special-case
  sanchalak: inBatchWriteScope already falls back to centre membership when scope.batchIds is null,
  which is exactly the sanchalak/city_admin/super_admin case.
- Leave GET /pending centre-scoped (per Q12) so a shikshak can still see the centre's backlog. Add
  `can_decide: boolean` to each row of the /pending response, computed with inBatchWriteScope, so
  clients can disable the action rather than discover the 403 on tap.
- Apply the same change to the bulk-approve route from SHIKSHAK_MOBILE_FIX_PROMPTS.md prompt 3 if
  that has already merged; if it has not, note this requirement in that prompt.

Tests: a shikshak approving a submission from a batch they teach succeeds; from another batch at
the same centre → 404; a sanchalak succeeds for any batch at their centre; /pending returns
can_decide=false for out-of-batch rows to a shikshak and true for all rows to a sanchalak.

=== Part B: mobile access for the sanchalak ===
apps/jain-pathshala-mobile/app/shikshak/niyam-review.tsx is locked behind
PersonaTabs allowed={["shikshak"]} in app/shikshak/_layout.tsx, so a Sanchalak cannot reach it.

- Move the screen to a shared location (e.g. app/niyam-review.tsx) reachable from BOTH personas,
  or duplicate the route under app/admin/niyam-review.tsx importing one shared component. Prefer
  the shared component — do not fork the file.
- Add "Niyam review" to SANCHALAK_ACTIONS in components/QuickActions.tsx.
- Grey out Approve/Reject on rows where can_decide is false, with a one-line explanation
  ("This student is in another Guruji's batch"), rather than hiding the row — seeing the centre's
  full backlog is the point of leaving /pending centre-scoped.

If SHIKSHAK_MOBILE_FIX_PROMPTS.md prompt 3 (compact rows, real reject reasons, bulk approve) has
merged, this builds on the reworked screen. If not, run that first — do not rework the screen twice.

Run `pnpm typecheck`, `pnpm test`.
```

---

## 2 — Centre attendance monitor + alerts (gap 1)

```
Read CLAUDE.md AT5, AT27, AT8, AT32, and the frozen attendance route table, then
apps/api-server/src/routes/v1/sessions.ts (GET /today) and
apps/api-server/src/services/consecutive-absence.ts.

AT27 notifies the Sanchalak when a student hits three consecutive absences, specifically because
they are "the person who can actually phone the family". AT8 notifies them on unscheduled sessions
and duplicate check-ins. They receive all of these and have no mobile screen to open.

Build a READ-ONLY centre monitor. The Sanchalak observes and phones; the Guruji marks. Do not add
attendance write capability to this screen.

=== Server ===
GET /v1/sessions/today already supports ?centre_id= with a scope check and returns roster data.
Confirm it returns, per session: status, check_in_at, gps_flagged, gps_unverified, present_count,
total_count, batch_name, centre_name, conducted_by name. Add whatever is missing — the check-in
fields are also required by SHIKSHAK_CHECKIN_REVIEW.md Part 2, so coordinate if that has merged.

Add GET /v1/admin/attendance/alerts (requireAdminPanel, centre-scoped):
  - consecutive_absences: students currently at >= 3 consecutive 'absent' rows per AT27, with
    student name, batch, count, last attended date, and the PARENT'S PHONE NUMBER — the entire
    point of the alert is that the Sanchalak calls them. Reuse the consecutive-absence service
    logic; do not re-implement the streak arithmetic.
  - unmarked_sessions: today's sessions past scheduled_end_time with zero attendance rows (AT6 —
    these are unmarked, NOT absent; label them "not marked", never "absent").
  - gps_flagged_sessions: sessions where gps_flagged = true. Per AT32.3 this means a real fix
    failed the radius or accuracy test — sessions with no fix at all (gps_unverified, check_in_at
    null) are listed SEPARATELY as "not checked in" and are pastoral information, not alerts.
  - Return counts in meta so the dashboard can badge.

Phone numbers are PII — they are already redacted from logs by the Pino redactor; make sure this
route does not log the response body.

=== Mobile: app/admin/attendance.tsx ===
Centre switcher (reuse the AsyncStorage pattern, key "jp.sanchalak.selectedCentreId").

Alerts strip at the top, only when non-empty:
  - Consecutive absences: student name, batch, "absent 3 sessions in a row", last attended date,
    and a Call button (Linking.openURL('tel:…')). This is the highest-value affordance on the
    whole screen — make it a primary action, not an afterthought.
  - Not marked / GPS flagged / not checked in as separate collapsible groups. "Not checked in" is
    informational per AT32.4 — style it as neutral information, never as a warning.

Below: today's sessions across the selected centre. Per session — batch name, time, status pill
(translated; "in_progress" must never render literally), present/total, and a badge for
checked-in / not checked in / GPS flagged. Tap → read-only roster with each student's status.
No mark buttons, no edit affordance anywhere on this screen.

Add a date stepper so the Sanchalak can look back over the past week. Do not add a full calendar.

Add "Attendance" to SANCHALAK_ACTIONS and badge the quick-action tile with the alert count.

Design rules: tokens only, sentence case, no emoji, bilingual with `hi ? x_hi ?? x_en : x_en`,
Devanagari line-height >= 22, +35% Hindi length tolerance.

Tests: alerts are centre-scoped (another centre's students never appear); a session with zero
attendance rows appears under unmarked and contributes nothing to present/total (AT6); a session
with check_in_at NULL appears as "not checked in" and NOT as gps_flagged (AT32.3).

Run `pnpm typecheck`, `pnpm test`.
```

---

## 3 — Service request inbox (gap 2)

```
Read apps/api-server/src/routes/v1/service-requests.ts. The admin lifecycle already exists:
GET / (requireAdminPanel, scoped), GET /:id, POST /:id/messages, POST /:id/assign (→ in_review,
clears resolved_at), POST /:id/resolve. Statuses are submitted | in_review | resolved, and a
parent reply after resolution reopens the request via reopenTransition.

apps/jain-pathshala-mobile/app/service-requests.tsx is the PARENT view — it calls useChildren().
Do not modify it. Build a separate admin inbox.

=== Mobile: app/admin/service-requests.tsx ===
- Filter chips: Open (submitted + in_review) / Mine (assigned_to = me) / Resolved. Default to Open.
- Row: subject, category, student name, parent name, status pill, age of the request ("2 days
  ago"), and an unread indicator when last_response_at is newer than the admin's last view.
- Tap → thread view: the full message history with author names and timestamps, a reply composer,
  and Claim / Resolve actions. Claim is hidden once assigned to someone else — show
  "Assigned to {name}" instead, so two Sanchalaks at a centre don't both answer.
- Resolve confirms first and states that a parent reply will reopen it, so the Sanchalak knows the
  action is not final.
- Reply composer: required, min 5 chars. This goes to a parent — apply the CLAUDE.md error/message
  voice, and keep Hindi available (the parent may have preferred_language 'hi').

Add "Service requests" to SANCHALAK_ACTIONS, badged with the count of open unassigned requests at
their centres. Pull that count into GET /v1/admin/analytics/overview if it isn't already —
open_service_requests is already computed there (admin.ts:238), so reuse it rather than adding a
query.

Design rules as above.

Tests: a sanchalak sees only requests for students at their centres; claiming sets in_review and
assigned_to; resolving then posting a parent message returns the request to the open list.

Run `pnpm typecheck`, `pnpm test`.
```

---

## 4 — Homework, full parity (gap 5)

```
Read apps/jain-pathshala-mobile/app/shikshak/homework.tsx (613 lines) and
apps/api-server/src/routes/v1/homework.ts. The homework admin routes are requireAdminPanel, so a
sanchalak already has create / grade / grade-all / ungrade access, scoped by resolveAdminScope.

Give the admin persona the same screen. Extract, do not fork — a second 613-line copy will drift.

- Move the screen body into a shared component, e.g. components/HomeworkAdmin.tsx, taking the
  persona as a prop only where copy differs.
- app/shikshak/homework.tsx renders it for the Guruji.
- New app/admin/homework.tsx renders it for the Sanchalak, with a centre switcher above it (the
  Guruji has one centre in practice; a Sanchalak may have several) reusing the
  "jp.sanchalak.selectedCentreId" key.
- The batch picker for a Sanchalak must list every batch at the selected centre, not only
  assigned batches. useAdminBatches already returns scope-filtered batches — verify it does not
  apply scopedBatchFilter for a sanchalak, since scope.batchIds is null for that role.
- Add "Homework" to SANCHALAK_ACTIONS.

Note for whoever picks this up: grading attribution. homework_submissions records graded_by, and
the parent-facing view should name whoever graded. Check that the parent screens surface it; if
they show a generic "graded" with no name, raise it rather than fixing it here — a Sanchalak
grading a Guruji's class is now possible and the parent should be able to see who did.

Run `pnpm typecheck`, `pnpm test`.
```

---

## 5 — Gallery moderation, full parity with safeguards (gap 4)

Full parity was chosen deliberately, with the exposure understood. These safeguards are the terms of that choice — they are not optional extras.

```
Read apps/api-server/src/routes/v1/gallery.ts (GET /admin line ~251, PATCH /admin/:id/visibility,
DELETE /admin/:id) and CLAUDE.md Q6.

GET /v1/gallery/admin returns children's full_name, photos, and the parent's opt_in flag, and
deliberately INCLUDES items from families who opted out so admins can still take them down.
Sanchalak may hide and take down; featuring stays city_admin+ via canFeatureMedia — do NOT widen
that, and do not add featuring controls to this screen.

=== Mobile: app/admin/gallery.tsx ===
Full parity with the web list, plus these mandatory safeguards, because a phone is a shared,
shoulder-surfable device in a way a desktop admin panel is not:

1. Items where opt_in is false carry a prominent, unmissable badge — "Family opted out — hidden
   from everyone" / "परिवार ने सहमति नहीं दी — सभी से छिपा" — rendered on the thumbnail itself,
   not only in a detail sheet.
2. Opted-out thumbnails must NOT be written to disk cache. Set cachePolicy="memory-only" on the
   Image component for those rows (expo-image), so nothing persists after the app closes.
3. This screen's query must not be persisted to the offline/MMKV layer. Check the react-query
   persister config and exclude the gallery-admin key explicitly.
4. Default the list filter to "Needs attention" (public + recently added), not "All". Proactive
   browsing of every child's photo should be a deliberate act, not the landing state.
5. No share, no save-to-device, no long-press image menu anywhere on this screen.

Actions per item: hide/unhide (PATCH /v1/gallery/admin/:id/visibility) and take down
(DELETE /v1/gallery/admin/:id, soft delete). Takedown confirms and requires a short reason for the
audit entry.

Add "Gallery" to SANCHALAK_ACTIONS.

Also worth doing while here: GET /v1/gallery/admin has no is_public / opt_in / date filters and
caps at clampLimit(…, 100, 500) with no cursor. Add filters and keyset pagination — safeguard 4
depends on being able to filter.

Run `pnpm typecheck`, `pnpm test`.
```

---

## 6 — Monthly centre report with share (gap 6)

Largest of the six and the only one needing real new server work. Do it last.

```
Read apps/api-server/src/lib/pdf.ts, the report.generation queue registration, the AT5 attendance
rate function, lib/homework-completion-rate.ts, and
apps/jain-pathshala/src/pages/admin/AdminListPages.tsx ReportsPage (line ~1357).

The current web "Reports" page is a 100-row dump of /v1/admin/sessions with no date range, no
aggregation and no export. Replace it with a real monthly centre report, generated server-side as
a PDF, downloadable on web and shareable from mobile.

=== Server ===
POST /v1/admin/centres/:id/reports/monthly  (requireAdminPanel, centre-scoped)
  body: { month: "YYYY-MM" }
  Enqueues report.generation and returns { job_id, status: 'queued' }.

GET /v1/admin/centres/:id/reports?month=YYYY-MM
  Returns generated reports with a signed URL (TTL-limited, per the media rules — never a public
  bucket URL).

The worker composes, for the centre and month:
  - attendance rate — via the AT5 canonical SQL function ONLY. Do not compute it in TypeScript.
  - niyam completion and homework completion — reuse the existing helpers, same rule.
  - Punya earned, broken down by feature_key.
  - enrolment movement: joined, deactivated, pending.
  - per-batch table: students, attendance %, homework %.
  - session count, cancelled count, holidays in the month.
Bilingual output (EN + HI) with the Devanagari font already used by the ID-card renderer.
No individual student names in the aggregate report — this is a centre summary and is likely to be
forwarded to trustees. Per-student reporting stays in the existing progress report.

=== Mobile: app/admin/reports.tsx ===
Centre switcher, month stepper (no future months), Generate button, and a list of already-generated
reports. On completion, open the native share sheet (expo-sharing) so the Sanchalak can send it on
WhatsApp — that is the actual workflow this exists to serve. Show a clear generating state; the
job is asynchronous.

=== Web ===
Replace ReportsPage with the same report: centre + month pickers, generate, download. Delete the
raw session table — the session log is what the Attendance page is for.

Add "Reports" to SANCHALAK_ACTIONS.

Tests: the report is centre-scoped; a sanchalak cannot generate for a centre outside their scope;
attendance % in the PDF matches the AT5 function exactly for a seeded fixture; a month with no
sessions produces a report saying so rather than dividing by zero.

Run `pnpm typecheck`, `pnpm test`.
```

---

## Build order

| Order | Prompt | Why here |
|---|---|---|
| 1 | Niyam review (Q12 + mobile) | Both halves must ship together per Q12. Blocks nothing else. |
| 2 | Attendance monitor | Closes the AT27 loop — the Sanchalak is being paged today with nowhere to go. Coordinate with `SHIKSHAK_CHECKIN_REVIEW.md` Part 2, which touches the same `/today` projection. |
| 3 | Service requests | Self-contained, API fully ready. |
| 4 | Homework | Extract-and-share refactor; low risk, touches a 613-line file so do it when nothing else is in flight there. |
| 5 | Gallery | Safeguards make this more than a port. Needs the filter/pagination server work. |
| 6 | Monthly report | Largest, only one needing new server work, and it replaces a web page too. |

Prompts 1–4 from `SANCHALAK_REVIEW.md` (donations scoping, enrolment details + student search + niyam gate, holiday delete, and the four requested mobile screens) should land before these, since prompt 4 there creates `SANCHALAK_ACTIONS`, which every prompt in this file adds to.
