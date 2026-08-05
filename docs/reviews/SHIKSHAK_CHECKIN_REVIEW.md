# Code review — Shikshak session check-in / check-out

**Date:** 2026-08-05
**Trigger:** "there was a feature to capture check-in and check-out but couldn't find the same in the journey"

**Scope reviewed:**

| File | Relevance |
|---|---|
| `apps/api-server/src/services/session-lifecycle.ts` | `checkInSession` / `checkOutSession` — full implementation |
| `apps/api-server/src/routes/v1/sessions.ts` | `POST /:id/check-in` (210), `POST /:id/check-out` (238) |
| `apps/api-server/src/services/sync-batch.ts` | `checkin` / `checkout` op handlers (528–533) |
| `apps/api-server/src/services/attendance-mark.ts` | the mark path — no GPS logic |
| `apps/jain-pathshala-mobile/lib/offline/{queue-keys,types,drain}.ts` | queues, drain order, ordering guard |
| `apps/jain-pathshala-mobile/app/attendance/[id].tsx` | the only screen that touches location |
| `apps/jain-pathshala-mobile/app/shikshak/today.tsx` | the session list — the natural entry point |
| `apps/jain-pathshala-mobile/lib/queries.ts` | `useToday` (235), `useMarkAttendance` (331) |
| `apps/jain-pathshala-mobile/app.json` | location permission strings |

**Checked against:** `CLAUDE.md` AT8, AT12–AT16, AT31, the frozen attendance route table, and the Offline sync canonical model.

---

## Summary

You didn't miss it — **there is no check-in or check-out anywhere in the user journey.** A repository-wide search for callers of the two endpoints returns nothing:

```
$ grep -rn "check-in\|check-out" --include=*.ts --include=*.tsx \
    --exclude-dir=node_modules --exclude-dir=dist \
    apps/jain-pathshala-mobile apps/jain-pathshala
(no results)
```

Neither the mobile app nor the web admin panel ever calls `POST /v1/sessions/:id/check-in` or `/check-out`.

What makes this unusual is how much *is* built. The server-side implementation is complete and careful — haversine geofencing, `gps_radius_meters` per centre (AT13), separate check-in/check-out distances (AT14), `accuracy_m > 100` flagging without blocking (AT15), `submission_op_id` idempotency ahead of the status assertion (AT16), AT8 soft-create for unscheduled sessions, duplicate-check-in detection with a Sanchalak notification, `gps_haversine_m`, `duration_minutes`, and the AT12 auto-checkout cron. The offline layer carries `jp.queue.checkin` and `jp.queue.checkout` as first-class queues with the causal drain order and the failed-check-in escape hatch. `POST /v1/sync/batch` routes both op types. There is even a passing integration test, `test/integration/shikshak-full-day.e2e.ts`, that walks the whole API journey.

Every layer exists except the button.

Worse, the one screen that does ask for the Guruji's location — the attendance marking screen — captures it for an operation that ignores it, and shows an error message for a geofence rejection that can never occur.

**Verdict: Request changes.** C1–C3 below.

---

## Critical

### C1 — The check-in/check-out journey has no entry point

`shikshak/today.tsx` lists today's sessions and every non-cancelled card routes straight to `/attendance/{id}` — "Mark attendance" (`today.tsx:88-95`). There is no intermediate step, no check-in affordance, and the card shows only `<Pill label={s.status} />` (`today.tsx:73`) with the raw enum string.

The client type confirms the gap. `TodaySessionRow` (`queries.ts:272-284`) carries `gps_required` and `has_gps` but **no** `check_in_at`, `check_out_at`, `check_in_distance_m`, `gps_flagged`, or `duration_minutes`. The app has no way to know whether a session has been started, so it could not render the state even if someone wanted to.

Consequences that follow directly:

- `sessions.status` never leaves `'scheduled'` through the app. `'in_progress'` and `'completed'` are unreachable states in practice.
- The AT12 auto-checkout cron (`session-lifecycle-jobs.ts:24`) scans for stale `'in_progress'` sessions and finds none, because nothing ever puts a session into that state.
- `duration_minutes` and `gps_haversine_m` are never populated, so any session-duration analytics built on them reads empty.
- AT8's soft-create path — the deliberate escape hatch so a Guruji at an ad-hoc or unmaterialised session doesn't lose a day's work — is dead code.
- The entire offline check-in queue, its drain ordering guard, and the FAILED-check-in escape hatch in `drain.ts:42-67` are unexercised in production. The most subtle logic in the offline engine has never run against a real op.

### C2 — The attendance screen performs a geofence that does not exist

`attendance/[id].tsx` does all of this on submit (`:135-160`):

1. Reads `gpsNeeded = !!session?.gps_required` (`:79`).
2. Calls `captureLocation()`, which requests foreground location permission and blocks the submit entirely on denial, telling the Guruji *"This session requires your location to mark attendance."* (`:114`).
3. Passes `lat` / `lng` into `mark.mutate({ …, lat: coords?.lat, lng: coords?.lng })` (`:157-158`).

And then:

```ts
// queries.ts:331-346 — useMarkAttendance
mutationFn: async ({ batchId, sessionDate, records }: {
  sessionId?: string;
  batchId: string;
  sessionDate: string;
  records: {…}[];
  lat?: number;      // ← declared
  lng?: number;      // ← declared
}) => {
  const submission_op_id = await enqueueAttendance({
    batch_id: batchId, session_date: sessionDate, marks: …
  });                // ← lat/lng never read
```

The coordinates are declared in the parameter type, never destructured, and never enqueued. They are dropped client-side before they reach the network. And it would not matter if they weren't: `attendance-mark.ts` contains no `lat`, `lng`, `gps`, or `haversine` reference anywhere, and the attendance body schema on the route accepts no coordinates. The server mark path has no geofence.

The screen then handles a failure that cannot happen:

```ts
// attendance/[id].tsx:175-183
if (code === "ERR_FORBIDDEN" && gpsNeeded) {
  … "You're outside the centre's allowed radius. Move to the centre to mark attendance."
}
```

Nothing on the mark path produces `ERR_FORBIDDEN` for a radius violation, because nothing on the mark path measures distance.

So the current behaviour is: a Guruji standing anywhere in the world is compelled to grant location permission, is blocked from marking attendance if they decline, and their location is then discarded. The real geofence sits unused in `session-lifecycle.ts:201` (check-in) and `:357` (check-out).

This is the more serious half of the finding. C1 is a missing feature; C2 is a control that appears to be enforced and is not. Anyone reading the app — or auditing it — would reasonably conclude attendance is geofenced. It isn't.

### C3 — Location permission is requested for a capability that isn't shipped

`app.json:72-76` configures the `expo-location` plugin with:

> "Jain Pathshala uses your location to verify you are at the centre when marking class attendance."

and `app.json:40-41` declares `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION`.

Given C2, that statement is not accurate as shipped. Two practical risks beyond the honesty problem:

- **iOS review.** App Store guideline 5.1.1 requires that a permission's stated purpose match actual use. A reviewer who grants location and observes no location-dependent behaviour has grounds to reject.
- **Google Play Data safety.** Precise location must be declared with its purpose; declaring collection that the app then discards is a form mismatch.

Fixing C1 makes the string true. Until then it is a claim the binary cannot support.

### C4 — Offline attendance fabricates GPS coordinates and pages the Sanchalak with a false alarm

Found while validating the AT32 decision below. When an offline attendance batch arrives for a session that was never materialised, `handleAttendance` soft-creates one through the check-in service — with invented coordinates:

```ts
// sync-batch.ts:191-202
// AT8 — no materialised row: soft-create via check-in so marks are not lost.
const created = await checkInSession({
  sessionId: "00000000-0000-4000-8000-000000000000",
  actor,
  submissionOpId: ulid(),
  lat: 0,          // ← Null Island
  lng: 0,
  accuracy_m: 9999,
  batchId: p.batch_id,
  scheduledDate: p.session_date,
});
```

No GPS was captured — the attendance payload has never carried coordinates. These are placeholders to satisfy a non-nullable signature. `checkInSession` then treats them as a real fix (`session-lifecycle.ts:200-203`):

- `centreDistanceM(0, 0, centreLat, centreLng)` — Null Island to any Indian centre is roughly **6,000 km** — so `outOfRadius = true` against a 250 m radius (AT13).
- `9999 > ACCURACY_UNVERIFIED_M` (100) — so `gpsUnverified = true` (AT15).
- Therefore `gps_flagged = true`, and `notifyGpsFlag` fires (`:254-261`):

> **GPS-flagged check-in** — Unscheduled check-in at {centre} was flagged (distance/accuracy).

So every offline roster for an unmaterialised session tells that centre's Sanchalak their Guruji was six thousand kilometres away. The stored `check_in_lat`/`check_in_lng` read `"0"`/`"0"`, and `check_in_distance_m` holds a ~6,000,000 m value that will poison any GPS analytics built on the column.

Where a centre has no `lat`/`lng` configured, `centreDistanceM` returns null and only the accuracy path flags — still a false alarm, just a quieter one.

It lands on precisely the Guruji the AT8 escape hatch exists to protect: the one teaching an ad-hoc class with no signal. They get their marks saved and their Sanchalak alerted that they weren't there.

**Fix (now AT32.2 / AT32.3):** make the GPS fields on `CheckInInput` nullable, pass `null` when there is no fix, and set `gps_unverified = true` with `gps_flagged = false` for that case. `gps_flagged` must mean "we measured and it was wrong", never "we didn't measure".

---

## High

### H1 — Marking attendance does not require a started session — **decided, now AT32**

`markAttendance` guards on `status === 'cancelled'` (AT24, `attendance-mark.ts:556`) and on the same-day edit window (AT26), but not on `check_in_at`. That is correct, and is now binding: **AT32 has been added to `CLAUDE.md`** — check-in is never a precondition for marking attendance. Blocking a roster is a larger harm than an unverified session, the same way AT6 refuses to infer absence from silence.

The rule also settles three things that were previously emergent rather than chosen:

- the first mark on a `'scheduled'` session soft-transitions it to `'in_progress'`, matching what the AT8 soft-create path already does for unmaterialised sessions. Today a materialised session stays `'scheduled'` forever while an unmaterialised one becomes `'in_progress'` — an inconsistency nobody decided on;
- absent GPS is stored as NULL, never as sentinel coordinates (C4);
- a session marked without check-in is *visible* to the Sanchalak as "not checked in", but is not flagged and not alerted — pastoral information, the way AT3 treats `'late'`.

### H2 — `attendance.no_show_check` has nothing to detect

The frozen cron table lists `attendance.no_show_check` every 15 minutes for "unchecked-in sessions past start". With no check-in in the journey, *every* session is unchecked-in past its start time. Either the job is currently firing false positives at scale, or it is inert — check which before shipping C1, because turning check-in on will change its behaviour sharply in one direction or the other.

### H3 — No offline UI for the check-in queue

`SyncOpStatus.tsx` exists and the queue states (`queued` / `syncing` / `synced` / `duplicate` / `conflict` / `failed`) are modelled in `offline/types.ts`. When check-in lands it must surface those states, per the Offline sync table in `CLAUDE.md` — particularly `conflict`, which is how `ERR_ALREADY_CHECKED_IN_BY_OTHER` reaches the Guruji. A check-in that will never sync must not look like a successful start of class.

### H4 — Check-in/check-out has no unit test coverage

Only three integration files reference it (`attendance-scope.integration.test.ts`, `shikshak-full-day.e2e.ts`, `sync-batch.integration.test.ts`) — 8 matching lines total. There are no unit tests for the radius boundary, the AT15 accuracy threshold, the AT16 idempotency-before-status-assertion ordering, or the duplicate-Guruji 409. That logic is subtle and about to get its first real traffic.

---

## What looks good

The service layer is the reason this is a UI task and not a rebuild:

- **AT16 ordering is correct and commented.** `checkInSession` looks up by `submission_op_id` *before* asserting status (`session-lifecycle.ts:114-125`) — the exact trap the rule warns about, avoided.
- **AT15 is honoured properly.** `accuracy_m > ACCURACY_UNVERIFIED_M` sets `gps_unverified` and flags; it never rejects. A bad GPS fix cannot stop a real Guruji starting a real class.
- **AT8 soft-create is implemented**, including resolving an existing same-day row before creating one, and it requires `batch_id` rather than inventing a session.
- **Duplicate check-in notifies the Sanchalak** with bilingual copy (`:139-146`) rather than failing silently.
- **Check-out is radius-validated like check-in** (AT14), and additionally computes `gps_haversine_m` between the two fixes — a nice touch for spotting a phone that never moved.
- **The offline drain guard is right.** `drain.ts:42-67` blocks attendance behind a *pending* check-in for the same `(batch_id, session_date)` but releases it when the check-in is terminally `failed` — the AT8 escape hatch, implemented exactly as specified.

---

## Cursor prompt

```
Read CLAUDE.md (AT8, AT12–AT16, AT31, AT32, the frozen attendance route table, and the Offline
sync canonical model), then apps/api-server/src/services/session-lifecycle.ts and
apps/jain-pathshala-mobile/lib/offline/{queue-keys,types,drain,sync-engine}.ts.

The session check-in / check-out feature is fully implemented on the server and in the offline
sync layer, and has ZERO callers in either client. Add the missing journey. Do NOT rewrite the
service layer — it is correct apart from Part 0.

=== Part 0: nullable GPS — AT32.2/AT32.3 (do this FIRST, it is a live bug) ===

sync-batch.ts:191-202 soft-creates a session by calling checkInSession with lat: 0, lng: 0,
accuracy_m: 9999 when an offline attendance batch has no materialised session. No GPS was ever
captured — those are placeholders for a non-nullable signature. checkInSession treats them as a
real fix: (0,0) is ~6,000 km from any Indian centre, so outOfRadius is true, accuracy 9999
exceeds the AT15 threshold, gps_flagged is set, and notifyGpsFlag pages the Sanchalak claiming
the Guruji was thousands of kilometres away. check_in_distance_m is stored as a ~6,000,000 m
value that corrupts any GPS analytics.

- In session-lifecycle.ts, change CheckInInput/CheckOutInput so lat, lng and accuracy_m are
  `number | null`.
- When lat or lng is null: skip the distance computation entirely, write NULL to check_in_lat,
  check_in_lng and check_in_distance_m, set gps_unverified = true, and set gps_flagged = FALSE.
  Do NOT call notifyGpsFlag. gps_flagged means "measured and wrong", never "not measured".
- When accuracy_m is null, write NULL to check_in_accuracy_m and treat it as unverified (AT15
  still never rejects).
- In sync-batch.ts handleAttendance, pass lat: null, lng: null, accuracy_m: null instead of the
  sentinels. Keep the "Unscheduled session started" notification — that one is legitimate.
- Verify the sessions columns are nullable in lib/db/src/schema/sessions.ts; add a migration if
  any are NOT NULL. Do not backfill existing (0,0) rows automatically — write a separate,
  reviewable migration that nulls out check_in_lat/lng/distance where check_in_lat = '0' AND
  check_in_lng = '0', and say so in the migration comment.

=== Part 1: stop the fake geofence (correctness fix) ===

apps/jain-pathshala-mobile/app/attendance/[id].tsx currently requests location permission, blocks
the submit if denied, passes lat/lng to mark.mutate(), and shows an "outside the centre's allowed
radius" error. useMarkAttendance (queries.ts:331) declares lat/lng in its param type and never
reads them, and attendance-mark.ts has no GPS logic at all. The coordinates are discarded and the
error branch is unreachable.

- Remove the captureLocation() call, the permission gate, and the lat/lng arguments from the
  submit path in attendance/[id].tsx.
- Remove `lat?: number` and `lng?: number` from the useMarkAttendance param type in queries.ts.
- Remove the `ERR_FORBIDDEN && gpsNeeded` error branch.
- Keep the "GPS required" pill on the session header — but change its meaning to "this session
  requires check-in at the centre", and have it link to the check-in action from Part 3.

Geofencing belongs on check-in/check-out only. Do not add GPS to the mark path.

=== Part 1b: AT32.1 soft transition ===

In apps/api-server/src/services/attendance-mark.ts, inside the SAME transaction as the marks:
if the session status is 'scheduled', set status = 'in_progress' and conducted_by = actor id,
leaving check_in_at NULL. Do not touch a 'completed' session — marking inside the AT26 edit
window must not reopen it. Do not add a check_in_at precondition anywhere; AT32 forbids it.

This makes a materialised session behave like the AT8 soft-create path, which already lands in
'in_progress'. Add a test asserting a roster marked with no prior check-in succeeds, leaves
check_in_at NULL, sets status='in_progress', and does NOT set gps_flagged or notify anyone.

=== Part 2: surface session state on the API ===

In apps/api-server/src/routes/v1/sessions.ts, GET /today (and the shared
pageSessionsWithAttendanceCounts projection) must return, per session:
  check_in_at, check_out_at, check_in_distance_m, check_out_distance_m,
  gps_flagged, gps_unverified, duration_minutes, auto_checked_out, unscheduled
Add the matching fields to TodaySessionRow / ShikshakSessionRow in
apps/jain-pathshala-mobile/lib/queries.ts. Do not add a new route — /v1/sessions/today is frozen.

=== Part 3: the mobile journey ===

Session card (app/shikshak/today.tsx) gains a state-driven primary action:
  scheduled + not checked in  → "Start class" / "कक्षा शुरू करें"   (primary)
  in_progress                 → "Mark attendance" (primary) + "End class" / "कक्षा समाप्त करें" (outline)
  completed                   → "Mark attendance" (outline, same-day edit window per AT26)
  cancelled                   → no actions (unchanged)
Replace the raw `<Pill label={s.status} />` with a translated status pill — "in_progress" must
never appear literally to a Guruji. Show check-in time and, when gps_flagged, a warning pill
("Location could not be verified" / "स्थान सत्यापित नहीं हुआ") — informational, never blocking.

Create components/SessionCheckIn.tsx handling both check-in and check-out:
  - Request foreground location via expo-location. On denial, DO NOT block: AT15's principle is
    that a bad or absent fix never stops a real class. Offer "Start without location" which sends
    the check-in through the queue with no coordinates and warns that the Sanchalak will see it
    as unverified. Only a genuine failure to reach the server should stop the Guruji.
  - Capture lat, lng and accuracy_m (pass accuracy through — the server needs it for AT15).
  - Mint a ULID submission_op_id via lib/offline/ulid and enqueue to jp.queue.checkin /
    jp.queue.checkout using the existing sync-engine helpers. Follow the useMarkAttendance
    pattern exactly: enqueue, then best-effort drainQueues(). NEVER call
    POST /v1/sessions/:id/check-in directly — POST /v1/sync/batch is the only transport, and a
    second online-shaped path is explicitly forbidden by the Offline sync model.
  - Reuse the SAME submission_op_id across retries of one attempt; mint a new one only when the
    Guruji reopens the sheet. This is what makes AT16 idempotency work.

Add enqueueCheckIn / enqueueCheckOut to lib/offline/sync-engine.ts alongside enqueueAttendance,
producing PendingCheckInOp / PendingCheckOutOp exactly as typed in lib/offline/types.ts —
keyed on (batch_id, session_date), never a client-minted session_id.

Surface queue state on the card using the existing SyncOpStatus component:
  queued → "Class started — will sync" ; syncing → spinner ; synced → dismiss ;
  conflict → the ERR_ALREADY_CHECKED_IN_BY_OTHER message, explaining that another Guruji already
             started this session and to contact the Sanchalak ;
  failed  → manual retry, never silently discarded.

AT8 unscheduled sessions: when a Guruji is at the centre and today's batch has no materialised
session, "Start class" must still work — send batch_id in the check-in payload so the server
soft-creates with unscheduled=true. Show "Unscheduled class" / "अनिर्धारित कक्षा" on the card
afterwards. This is the failure the whole offline design exists to prevent; do not hard-fail it.

=== Part 4: app.json ===

Once Part 3 is merged the existing location permission strings become accurate — leave them.
Add a NSLocationWhenInUseUsageDescription review note in the release checklist explaining that
location is used only at class start/end, never in the background, and never for students.

=== Part 5: tests ===

Server (new apps/api-server/test/session-lifecycle.test.ts):
  - check-in inside the radius sets status='in_progress' and check_in_distance_m;
  - check-in outside gps_radius_meters still succeeds but sets gps_flagged and notifies the
    Sanchalak (AT13/AT14);
  - accuracy_m > 100 sets gps_unverified and does NOT reject (AT15);
  - replaying the same submission_op_id returns the existing session with 200, and does so even
    when the session is already 'in_progress' (AT16 — idempotency before status assertion);
  - a different shikshak_user_id on a checked-in session returns 409
    ERR_ALREADY_CHECKED_IN_BY_OTHER and notifies the Sanchalak;
  - check-in with no matching scheduled session and a batch_id soft-creates with
    unscheduled=true (AT8);
  - check-out sets status='completed', duration_minutes and gps_haversine_m.

Mobile (extend lib/offline/__tests__/drain.test.ts):
  - a queued check-in blocks attendance for the same (batch_id, session_date);
  - a FAILED check-in releases it (the AT8 escape hatch);
  - check-out never drains before the attendance ops for its session.

Run `pnpm typecheck`, `pnpm test`, and the existing
apps/api-server/test/integration/shikshak-full-day.e2e.ts, which already covers the API journey
end to end and should keep passing unchanged.
```

---

## Decision log

**2026-08-05 — check-in is not mandatory.** Added to `CLAUDE.md` as **AT32**, after AT31. Marking attendance never requires a prior check-in; the first mark soft-transitions a `'scheduled'` session to `'in_progress'` with `check_in_at` left NULL; absent GPS is stored as NULL rather than sentinel coordinates; and `gps_flagged` is reserved for a real fix that failed the radius or accuracy test, never for the absence of a fix.

The rule is what turns C4 from a curiosity into a blocker. Once "no GPS" is the *normal* path rather than an edge case — which is exactly what not mandating check-in means — a system that reads absent coordinates as `(0, 0)` and alerts on the resulting 6,000 km will page the Sanchalak constantly. Part 0 of the prompt above must land before Part 3 puts real traffic through it.
