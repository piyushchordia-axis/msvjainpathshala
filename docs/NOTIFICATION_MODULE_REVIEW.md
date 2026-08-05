# Notification module — code review

Reviewed August 2026. Companion prompt pack: `docs/NOTIFICATION_FIX_PROMPTS.md`.

**Files in scope**

```
apps/api-server/src/lib/notify.ts                     central fan-out (notifyUsers)
apps/api-server/src/lib/push.ts                       Expo transport
apps/api-server/src/routes/v1/notifications.ts        inbox, push-token, birthday cron
apps/api-server/src/services/attendance-post-process.ts   AT31 debounce + streaks
apps/api-server/src/lib/niyam-badges.ts               direct sendPush caller
apps/api-server/src/routes/v1/niyam-submissions.ts    direct sendPush caller
apps/api-server/src/lib/homework-notify.ts            notifyUsers caller
apps/api-server/src/lib/gallery-wall-notify.ts        notifyUsers caller
lib/db/src/schema/notifications.ts                    notifications, device_push_tokens
```

---

## Summary

The core shape is right. `notifyUsers` is the correct central choke point, preference
gating exists, the birthday cron's advisory-lock idempotency is genuinely well built,
and the inbox routes are correctly scoped to `req.authUser.id`.

The defects are at the edges: push tokens are never reaped, push bodies ignore
`preferred_language`, and three call sites bypass the preference gate entirely by
calling `sendPush` directly.

---

## Critical issues

### C1 — Expo tickets are never inspected; dead tokens are never deactivated

`lib/push.ts:36-45` collects `ExpoPushTicket[]` and returns them. No caller reads the
return value, and nothing anywhere in `apps/api-server/src` ever sets
`device_push_tokens.is_active = false`.

Expo returns `status: 'error'` with `details.error === 'DeviceNotRegistered'` for a
token belonging to an uninstalled app. Those tokens accumulate permanently. Every
subsequent send carries more dead weight, and Expo throttles projects with a high
invalid-token ratio — so this degrades delivery for *live* users, not just dead ones.

The `is_active` column exists and is filtered on in four places. Nothing writes `false`
to it.

### C2 — Three call sites bypass the notification-preference gate

`prefsAllowKind` lives inside `notifyUsers` (`lib/notify.ts:17-23`). These call
`sendPush` directly and skip it:

| File | Line | Notification |
|---|---|---|
| `routes/v1/niyam-submissions.ts` | 428 | Niyam rejection |
| `lib/niyam-badges.ts` | 154 | Niyam badge earned |
| `routes/v1/notifications.ts` | 258 | Birthday wishes |

A parent who sets `notification_preferences.push = false` still receives all three.
CLAUDE.md's opt-out rule ("Check `users.notification_preferences` before enqueuing")
is enforced in exactly one of the four paths.

### C3 — Push-token registration re-points any token with no ownership proof

`routes/v1/notifications.ts:45-60` upserts on the unique `expo_token` and overwrites
`user_id` with the caller's id.

```ts
.onConflictDoUpdate({
  target: device_push_tokens.expo_token,
  set: { user_id: req.authUser!.id, ... },
})
```

Anyone who obtains another user's Expo token — a leaked log line, a shared device, a
debug build — can register it as their own. Their notifications, including child names
and attendance status, are then delivered to the victim's physical device. The comment
above the block frames this as a reinstall/device-handover convenience; it is that, but
it is also an unauthenticated redirect of someone else's notification stream.

---

## Correctness

### S1 — `sendParentAttendancePush` can name the wrong child

`services/attendance-post-process.ts:43-58`. The `studentId` parameter is accepted and
never used. The query joins `students → attendance → sessions` filtered only on
`sessionId`, then takes `.limit(1)`.

For any session with more than one marked student — i.e. every real session — this
returns an arbitrary row. The parent gets a push naming a different family's child,
with that child's attendance status.

### S2 — Push always sends English

`lib/notify.ts:79-86` passes `opts.title_en` / `opts.body_en` unconditionally, while
`lib/niyam-badges.ts:146-152` correctly branches on `users.preferred_language`. Every
notification except niyam badge/rejection reaches Hindi-preference users in English.

`preferred_language` is on `users`, the same row `notifyUsers` already selects for
preferences — this is a one-column addition to an existing query, not a new lookup.

### S3 — The catch block swallows inbox-insert failures

`lib/notify.ts:88-90` wraps the whole body, including `db.insert(notifications)`. A
failed insert logs `warn` and returns normally, so the BullMQ job records success and
never retries. Push is legitimately best-effort; the durable inbox row is not.

### S4 — `title_hi` / `body_hi` nullable but always required in practice

`lib/db/src/schema/notifications.ts:36-38` declares both nullable. `notifyUsers`
requires them in its signature. Any direct insert elsewhere produces a row that renders
blank for Hindi users, with no constraint to catch it.

---

## Data model

### S5 — No `attendance` notification kind

`NOTIFICATION_KINDS` (`lib/db/src/schema/enums.ts:120`) is:

```
general, birthday, homework, quiz, competition, service_request,
exam, shivir, niyam_rejected, niyam_badge
```

Attendance, gallery-wall, and donation notifications are all filed as `general`. Two
consequences: a user disabling `general` silently loses unrelated notifications, and
the inbox cannot filter or icon-code attendance rows.

`attendance-post-process.ts:30-36` works around this with its own `prefsAllowAttendance`
reading a `p.attendance` key that no enum value corresponds to.

---

## Performance

### S6 — N+1 in `runAttendancePostProcess`

`services/attendance-post-process.ts:213-220` loops per marked student. Each iteration
runs `recomputeAndAwardStreak` (student lookup + holiday lookup + full attendance
history join + an update, plus a Punya award per milestone) and a separate queue
enqueue.

AT31 sets the load-test SLO at 5,000 marks in 60 seconds. At roughly four round-trips
per student that is ~20,000 sequential queries inside one job.

---

## Product completeness

### S7 — Inbox has no pagination cursor

`routes/v1/notifications.ts:66-97` is limit-only, clamped at 200. A parent with more
history than that can never reach it. `routes/v1/niyam-submissions.ts` already has a
keyset cursor helper to copy.

### S8 — No deep-link payload

`notifyUsers` never passes `data` to `sendPush`, though `PushPayload.data` exists and
the niyam paths use it. Tapping a push cannot route to the entity.

### S9 — No mark-all-read endpoint

Clients must call `POST /:id/read` once per notification.

---

## What looks good

- The birthday cron's `pg_advisory_xact_lock` keyed on the IST calendar date, with the
  Expo call deliberately outside the transaction and scoped to only the rows this run
  inserted. Correct shape, and the comments explain *why* rather than *what*.
- `enqueueDebouncedJob` with a stable `attn-parent:{student}:{session}` job id is a
  proper sliding-window debounce, and the inline fallback when Redis is absent keeps
  the test suite honest.
- Inbox and read routes are ownership-scoped, with a UUID pre-check that avoids leaking
  existence through a Postgres cast error, and `read_at` set idempotently.
- SMS and email providers share one selector pattern with a deliberate asymmetry —
  fail-fast in prod for SMS because it gates login, warn-only for email because it does
  not. That is the right call and it is documented in the file header.

---

## Spec drift

CLAUDE.md describes NestJS in `apps/api` with 30 BullMQ queues including
`notifications.fanout`, `notifications.push`, `notifications.sms`,
`notifications.email`.

The running code is Express in `apps/api-server` with 18 queues
(`apps/jp-shared/src/constants.ts`) and no fanout layer — pushes go out synchronously
inside request and job handlers.

This is a documentation problem, not a code problem. Either update CLAUDE.md's stack
table and queue list, or every future spec-conformance review of this module reports
the same four phantom findings.

---

## Verdict

**Request changes.** C1, C2, C3 and S1 should land before this module carries
production traffic. The rest is scheduled follow-up.
