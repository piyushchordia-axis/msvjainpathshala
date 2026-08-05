# Cursor prompt pack — Notification module fixes

Companion to `docs/NOTIFICATION_MODULE_REVIEW.md`. Twelve prompts covering every
finding, grouped into four phases, each phase with an orchestration prompt.

**How to use**

1. Paste **§0 Shared context** into Cursor once per session (or save it as a
   `.cursor/rules` entry so it rides along automatically).
2. Run either the phase orchestration prompt (bigger diff, fewer round trips) or
   the individual fix prompts in order (small, reviewable commits).
3. Every prompt is test-first. Do not accept a "done" without pasted command output.

**Real commands in this repo**

| Purpose | Command |
|---|---|
| Typecheck everything | `pnpm typecheck` |
| API tests | `pnpm --filter @workspace/api-server test` |
| One API test file | `pnpm --filter @workspace/api-server test notifications` |
| Generate migration | `pnpm db:generate` |
| Apply migration | `pnpm db:migrate` |

---

## Contents

- [§0 Shared context](#0--shared-context-paste-once)
- [Phase 1 — Blocking (#1–#4)](#phase-1--blocking)
- [Phase 2 — Contract correctness (#5–#8)](#phase-2--contract-correctness)
- [Phase 3 — Data model and product completeness (#9–#11)](#phase-3--data-model-and-product-completeness)
- [Phase 4 — Performance (#12)](#phase-4--performance)

---

## §0 — Shared context (paste once)

```
You are working in the Jain Pathshala monorepo (pnpm workspaces + TypeScript).

IMPORTANT — the running stack differs from CLAUDE.md in one respect. CLAUDE.md
describes NestJS in apps/api. The ACTUAL backend is Express 5 in apps/api-server,
with Drizzle exported from the @workspace/db package and Zod contracts in
@workspace/api-zod. Do NOT refactor toward NestJS, and do not "fix" imports to
match CLAUDE.md's directory table. Match the surrounding code.

CLAUDE.md also lists BullMQ queues notifications.fanout / .push / .sms / .email.
Those do not exist. The real queue list is apps/jp-shared/src/constants.ts and the
only notification queues are notifications.parent (PARENT_NOTIFY) and
notifications.birthday. Do NOT create the missing queues as part of any fix here.

Surfaces:
  apps/api-server              Express API (this is the backend)
  apps/jain-pathshala          Web admin panel (React)
  apps/jain-pathshala-mobile   Expo app
  lib/db                       Drizzle schema + migrations (@workspace/db)
  lib/api-zod                  shared Zod contracts + role helpers
  apps/jp-shared               queue names + cron expressions (@jp/shared)

Read before writing any code:
  1. CLAUDE.md at the repo root. It is authoritative over SPEC.md. Pay particular
     attention to AT22, AT27, AT31, the "Bilingual requirements" section, and the
     "SMS to opted-out users" row in "Common pitfalls to avoid".
  2. docs/NOTIFICATION_MODULE_REVIEW.md — the review these fixes come from.
  3. The files named in the prompt AND their immediate neighbours, so your change
     matches the conventions already in use.

Conventions you must follow:
  - Responses go through ok(res, data, meta) / fail(res, status, CODE, message)
    from src/lib/envelope. Never res.json() directly.
  - Error codes are ERR_SCREAMING_SNAKE.
  - Error copy states the problem AND the fix, e.g.
    "That device is already registered to another account — sign out on that device
    first." Not "Conflict."
  - Every user-facing string ships _en and _hi. Hindi is proper Devanagari, never
    transliterated Hinglish.
  - Jain terms stay untranslated: Pathshala, Punya, Guruji, Sanchalak, Niyam, Shivir.
  - Drizzle query builder by default; only reach for sql`` where the surrounding
    code already does.
  - British spelling in schema names: centres, not centers.
  - No emoji in product UI. Sentence case for buttons and headings.
  - Never inline a Punya point value — resolve from punya_features.

Definition of done — every prompt, no exceptions:
  1. Write the failing test FIRST. Run it. Paste the FAILING output.
  2. Make the change.
  3. Re-run the test. Paste the PASSING output.
  4. Run `pnpm typecheck` from the repo root. Paste the output.
  5. Commit with the exact message given in the prompt.
Do not report a task complete without pasted, real command output. If a step is
blocked, say so explicitly rather than skipping it.
```

---

# Phase 1 — Blocking

Four defects. C2 and C3 are security. C1 degrades delivery for every user over time.
S1 sends one family's attendance data to another family.

### Phase 1 orchestration prompt

```
Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #1, #2, #3, #4 — in that
order, which is deliberate. #1 is a one-line predicate fix with an obvious test. #2
routes the three rogue call sites through notifyUsers, which is the precondition for
#3 (receipt handling only has one place to live once all pushes go through one
function). #4 is the token-ownership change and is independent, so it goes last and
cannot destabilise the others.

One commit per fix. After each commit, stop and print a short diff summary so I can
review before you continue. Do not batch them into one commit.
```

---

### FIX #1 — Scope the parent attendance push to the actual student

```
FIX #1 — sendParentAttendancePush names an arbitrary child (correctness, blocking)

File: apps/api-server/src/services/attendance-post-process.ts  (~lines 39-72)

PROBLEM
The function takes studentId and never uses it. The query is:

  .from(students)
  .innerJoin(attendance, and(eq(attendance.student_id, students.id),
                             eq(attendance.session_id, sessionId)))
  .innerJoin(sessions, eq(sessions.id, sessionId))
  .leftJoin(users, eq(users.id, students.parent_id))
  .limit(1)

Nothing constrains the row to studentId. For any session with more than one marked
student — every real session — Postgres returns an arbitrary row and .limit(1) takes
it. The debounced job then pushes THAT child's name and attendance status to THIS
child's parent.

The debounce jobId is `attn-parent:${studentId}:${sessionId}`, so the job is correctly
per-student. Only the query forgot.

TEST FIRST — apps/api-server/test/notifications.test.ts
  "the parent attendance push names the student it was queued for"
  Seed one session with at least THREE students marked, each with a DIFFERENT parent
  and a different status (present / absent / late). Call sendParentAttendancePush
  directly for the middle student. Assert:
    a) exactly one notifications row was inserted,
    b) its user_id is that student's parent_id,
    c) its body_en contains that student's full_name and no other student's.
  Then call it for each of the three in turn and assert each parent got their own
  child's name. A test with one student passes against the broken code — do not
  write that test.

CHANGE
  Add the missing predicate to the join:
    eq(attendance.student_id, studentId)
  and select students by id rather than relying on limit(1):
    .where(eq(students.id, studentId))
  Keep .limit(1) as a belt-and-braces guard. Do not otherwise restructure the query.

While you are in the file, check whether any OTHER function in it accepts an id it
does not use in its WHERE clause. Report what you find; do not fix it here.

COMMIT: fix: scope parent attendance push to the queued student
```

---

### FIX #2 — Route every push through `notifyUsers`

```
FIX #2 — Three call sites bypass the notification-preference gate (security, blocking)

Files:
  apps/api-server/src/lib/notify.ts                     (notifyUsers, prefsAllowKind)
  apps/api-server/src/routes/v1/niyam-submissions.ts    (~line 428)
  apps/api-server/src/lib/niyam-badges.ts               (~line 154)
  apps/api-server/src/routes/v1/notifications.ts        (~line 258, birthday cron)

PROBLEM
prefsAllowKind lives INSIDE notifyUsers (notify.ts:17-23). It reads
users.notification_preferences and drops the user when prefs.push === false or
prefs[kind] === false.

The three files above call sendPush() directly. A parent who has turned push off in
the app still receives niyam-rejection, niyam-badge, and birthday pushes. CLAUDE.md's
"Common pitfalls" table requires checking users.notification_preferences before
enqueuing; right now exactly one of four paths does.

Note the niyam paths ALSO do something notifyUsers does not — they branch on
users.preferred_language for the push copy. Do not lose that behaviour. FIX #5 moves
language handling into notifyUsers; if you are running these prompts in order, do
FIX #5's language lookup as part of THIS commit rather than pushing English copy
through the niyam paths in the interim. Say which you did.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "a parent with push disabled gets no niyam-rejection push"
     Set the parent's notification_preferences to { push: false }. Trigger the niyam
     rejection path. Assert sendPush was not called with that parent's token.
  b) "a parent with niyam_badge disabled still gets birthday notifications"
     Set { niyam_badge: false }. Assert the badge push is suppressed and the birthday
     push is not — this proves per-kind gating, not a blanket mute.
  c) "a parent with push disabled gets no birthday push but still gets the inbox row"
     The durable inbox row is not a push and must survive the opt-out. If you decide
     the row should also be suppressed, STOP and ask — do not decide it silently.
  Stub the Expo transport at the lib/push module boundary; do not hit the network.

CHANGE
  1. In niyam-submissions.ts and niyam-badges.ts, replace the hand-rolled
     device_push_tokens query + sendPush with a notifyUsers call passing the correct
     kind ('niyam_rejected' / 'niyam_badge' — both already exist in
     NOTIFICATION_KINDS) and the data payload those sites currently send.
     notifyUsers does not yet forward `data` — add that parameter as part of this
     fix (it is FIX #7; pulling it forward is correct here because deleting the
     direct sendPush would otherwise drop the deep-link payload).
  2. In notifications.ts runBirthdayWishes, the inbox insert already happens inside
     the advisory-lock transaction and MUST stay there — do not move it into
     notifyUsers. Replace only the trailing sendPush block (~line 246-266) with a
     push that filters newlyNotifiedIds through the same prefsAllowKind check.
     Extract prefsAllowKind from notify.ts into an exported helper rather than
     copying it. A second copy will drift.
  3. Delete the now-dead device_push_tokens imports from the two niyam files.

CONSTRAINT
  After this commit, `rg "sendPush\(" apps/api-server/src` must return matches ONLY in
  src/lib/notify.ts and src/lib/push.ts. Paste that rg output as part of your
  completion report.

COMMIT: fix: route niyam and birthday pushes through the preference gate
```

---

### FIX #3 — Process Expo tickets and receipts; deactivate dead tokens

```
FIX #3 — Dead push tokens are never reaped (reliability, blocking)

Files:
  apps/api-server/src/lib/push.ts        (sendPush, ~lines 26-46)
  apps/api-server/src/lib/notify.ts      (the only remaining caller after FIX #2)
  apps/jp-shared/src/constants.ts        (new queue + cron name)
  apps/api-server/src/jobs/derived-data-jobs.ts   (handler registration)

PROBLEM
sendPush builds ExpoPushTicket[] and returns them. No caller reads the return value.
`rg "is_active: false" apps/api-server/src` shows writes in auth.ts and
admin-staffing.ts — never for device_push_tokens. So is_active is filtered on in four
places and set to false in zero.

Expo signals a dead token two ways:
  - Ticket (immediate): status 'error', details.error 'DeviceNotRegistered'
  - Receipt (async, fetched by ticket id): same shape, and this is where MOST
    DeviceNotRegistered results actually appear — the ticket is usually 'ok'
Handling only tickets catches a minority of cases. Handle both.

Expo throttles projects with a high invalid-token ratio, so this degrades delivery for
LIVE users, not just uninstalled ones.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "a DeviceNotRegistered ticket deactivates that token and no others"
     Register two tokens for two users. Stub the Expo transport to return
     [{ status:'error', message:'...', details:{ error:'DeviceNotRegistered' } },
      { status:'ok', id:'receipt-1' }]
     Send to both. Assert token 1 is_active === false and token 2 is_active === true.
  b) "a MessageRateExceeded ticket does NOT deactivate the token"
     Rate limiting is transient. Deactivating on it silently mutes a real device.
  c) "a DeviceNotRegistered receipt deactivates the token"
     Stub getPushNotificationReceiptsAsync to return that error for a stored ticket id.
  d) "sendPush still resolves when the Expo call throws"
     Push is best-effort — the existing never-throws contract must hold.

CHANGE
  1. sendPush must keep its "never throws" contract and its ExpoPushTicket[] return.
     Add: build the messages array so index i maps back to the token that produced it
     (the current code flattens p.to arrays and loses that mapping — fix it). On an
     'error' ticket with details.error === 'DeviceNotRegistered' or
     'InvalidCredentials', deactivate that token. Ignore every other error code.
  2. Persist 'ok' ticket ids for the receipt sweep. Add a small table via
     lib/db/src/schema/notifications.ts:
       push_receipts(id uuid pk, ticket_id text notNull unique, expo_token text
       notNull, created_at, checked_at nullable)
     Follow the timestamps() helper and index conventions already in that file.
  3. Add a queue + cron for the sweep in apps/jp-shared/src/constants.ts:
       NOTIFICATIONS_PUSH_RECEIPTS: "notifications.push_receipts"
       cron "*/30 * * * *"
     Register the handler in jobs/derived-data-jobs.ts alongside the existing ones.
     The handler chunks unchecked ticket ids via expo.chunkPushNotificationReceiptIds,
     calls getPushNotificationReceiptsAsync, deactivates on DeviceNotRegistered, and
     stamps checked_at. Delete rows older than 7 days in the same pass — Expo does
     not retain receipts beyond that and unbounded growth is its own bug.
  4. Deactivation is is_active = false. NEVER delete the row — it is the audit trail
     for which device stopped receiving, and it matches the soft-delete convention
     used everywhere else in this repo.

MIGRATION
  pnpm db:generate then pnpm db:migrate. Paste both outputs. Confirm the generated SQL
  in lib/db/migrations only ADDS a table — if it drops or alters anything else, stop
  and show me the diff before applying.

COMMIT: fix: deactivate push tokens on DeviceNotRegistered tickets and receipts
```

---

### FIX #4 — Bind push-token registration to proven ownership

```
FIX #4 — Push-token registration re-points any token to the caller (security, blocking)

File: apps/api-server/src/routes/v1/notifications.ts  (~lines 34-63)

PROBLEM
  .onConflictDoUpdate({
    target: device_push_tokens.expo_token,
    set: { user_id: req.authUser!.id, platform, is_active: true },
  })

The unique key is the token, and the update overwrites user_id with whoever called.
Anyone holding another user's Expo token — leaked log line, shared or resold device,
a debug build, a screenshot of dev tools — can POST it and become its owner. Their
notifications, including child names and attendance status, are then delivered to the
victim's physical device.

The existing comment frames this as reinstall/device-handover convenience. That use
case is real and must keep working. What must not keep working is a silent takeover by
someone who never held the device.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "user B cannot claim user A's active push token"
     A registers a token. B POSTs the same token. Assert the row's user_id is still A.
     Assert the response is 409 ERR_PUSH_TOKEN_CLAIMED (not 200 — a silent no-op would
     leave B's app believing it is registered and then silently receiving nothing).
  b) "re-registering your own token is idempotent and reactivates it"
     A registers, the token is deactivated by the receipt sweep, A registers again ->
     200, is_active true, same row id.
  c) "a token deactivated by DeviceNotRegistered can be claimed by a new user"
     This is the genuine device-handover / reinstall path and MUST still work.

CHANGE
  Split the upsert into an explicit read-then-write inside a transaction:
    - No existing row               -> insert, 200.
    - Existing row, same user_id    -> update platform + is_active true, 200.
    - Existing row, different user, is_active = false  -> reassign, 200.
      (A dead token means the app was uninstalled or the device wiped. That is a real
      handover and the only safe automatic reassignment.)
    - Existing row, different user, is_active = true   -> 409 ERR_PUSH_TOKEN_CLAIMED.
      Message per the error-copy rule: state the problem AND the fix. Something like
      "That device is registered to another account — sign out on that device first."
  Add ERR_PUSH_TOKEN_CLAIMED wherever this repo's error codes are declared; grep for
  an existing ERR_ constant to find the file rather than inventing a location.

  Wrap the read-then-write in db.transaction with a row lock (.for("update")) or an
  advisory lock keyed on the token. Two devices registering concurrently is a real
  check-then-act race — runBirthdayWishes in this same file shows the advisory-lock
  pattern this codebase already uses.

MOBILE FOLLOW-UP — report only, do not implement
  Find where apps/jain-pathshala-mobile posts to /v1/notifications/push-token and tell
  me whether it surfaces a 409 to the user or swallows it. Do not change mobile code in
  this commit.

COMMIT: fix: reject push-token claims on another user's active device
```

---

# Phase 2 — Contract correctness

Nothing here is exploitable. All four are ways the module quietly does the wrong thing.

### Phase 2 orchestration prompt

```
Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #5, #6, #7, #8 — in that
order. #5 and #7 both widen the notifyUsers signature, so doing them adjacently keeps
the churn in one place. #6 changes error semantics and wants a clean base. #8 is a
migration and goes last so a schema rollback does not drag code changes with it.

If you already pulled #5's language lookup or #7's data payload forward into Phase 1
(both prompts allow it), say so and skip the duplicated work rather than doing it
twice.

One commit per fix. Stop after each and print a diff summary.
```

---

### FIX #5 — Send push copy in the recipient's language

```
FIX #5 — Push always sends English (bilingual contract)

Files:
  apps/api-server/src/lib/notify.ts       (~lines 46-87)
  apps/api-server/src/lib/niyam-badges.ts (~lines 146-152 — the correct reference)

PROBLEM
notifyUsers passes opts.title_en / opts.body_en to sendPush unconditionally. The inbox
row correctly stores both variants, so the in-app list renders fine — but the PUSH,
which is the notification most users actually read, is English for everyone.

niyam-badges.ts already does this right:
  const hi = parent?.preferred_language === "hi";
  title: hi ? titleHi : titleEn

CLAUDE.md "Bilingual requirements": all user-facing content ships _en and _hi and the
client renders per preferred_language. A push has no client-side render step, so the
server must pick.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "a Hindi-preference user receives the Devanagari push body"
     Two users, one preferred_language 'hi', one 'en', both with active tokens. One
     notifyUsers call. Assert the stubbed transport received the Devanagari strings
     for the first and the English for the second — from a SINGLE call, which is the
     part the current code cannot do.
  b) "a user with no preferred_language falls back to English"
     Null must not produce an empty push body.

CHANGE
  notify.ts already selects from users to read notification_preferences (~line 48).
  Add preferred_language to that same select — no new query. Build the sendPush
  payloads per user from the token rows joined back to that map.

  Note the current token query (~line 72) selects only expo_token, so it cannot map a
  token to a user. Add user_id to it, the way runBirthdayWishes already does at
  ~line 247.

  Keep the inbox insert storing BOTH variants unchanged. Language selection applies to
  the push transport only.

COMMIT: fix: send push notifications in the recipient's preferred language
```

---

### FIX #6 — Stop swallowing inbox-insert failures

```
FIX #6 — notifyUsers' catch hides durable-write failures (correctness)

File: apps/api-server/src/lib/notify.ts  (~lines 46-91)

PROBLEM
The try block spans the preference read, the notifications INSERT, the token read, and
the push. The catch logs warn and returns.

Push being best-effort is correct and documented in the file header. The inbox row is
NOT best-effort — it is the durable record and the fallback when push does not land.
Today a failed insert returns normally, so the BullMQ job that called it records
success and never retries. The notification is gone with a single warn line.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "notifyUsers throws when the inbox insert fails"
     Stub the insert to reject. Assert notifyUsers rejects.
  b) "notifyUsers resolves when only the push transport fails"
     Stub the Expo transport to throw. Assert notifyUsers resolves AND the inbox row
     exists.
  c) "a caller in a fire-and-forget path is unaffected"
     Find the callers that do not await or that .catch() — gallery-wall-notify.ts
     wraps its own body in try/catch already. Confirm none of them now crash a request
     handler. List every notifyUsers call site and its await/catch posture in your
     report.

CHANGE
  Narrow the try/catch to the push section only. Let the preference read and the
  notifications insert propagate.

  Then check each caller. Anything running inside a BullMQ handler SHOULD propagate so
  the job retries — attendance-post-process.ts:63 is the important one and it already
  documents "Do not swallow — failed streak must surface on the queue job" for its
  sibling call, so this matches existing intent. Anything running inline in a request
  handler needs an explicit .catch() at the call site, not a swallow inside notifyUsers.

  Update the file header comment. It currently promises "Never throws." That will no
  longer be true and a stale contract comment is worse than none.

COMMIT: fix: let notifyUsers surface inbox insert failures to the queue
```

---

### FIX #7 — Carry a deep-link payload on every push

```
FIX #7 — notifyUsers sends no data payload (product completeness)

Files:
  apps/api-server/src/lib/notify.ts   (~lines 25-43 signature, ~79-86 send)
  apps/api-server/src/lib/push.ts     (PushPayload.data already exists)

PROBLEM
PushPayload has an optional `data` field and niyam-submissions.ts uses it:
  data: { kind: "niyam_rejected", submission_id: opts.submissionId }
notifyUsers never passes one. So every attendance, homework, gallery and birthday push
opens the app at whatever screen it was last on, with no route to the thing the
notification is about.

SKIP THIS PROMPT if you already pulled the `data` parameter forward while doing FIX #2
— that prompt permits it because deleting the direct sendPush calls would otherwise
drop the niyam deep links. Say so and move on.

TEST FIRST — apps/api-server/test/notifications.test.ts
  "the push payload carries kind and entity id"
  Assert the stubbed transport received data.kind matching the notification kind and
  data.entity_id matching what the caller passed.

CHANGE
  1. Add an optional `data?: Record<string, unknown>` to the notifyUsers opts and
     forward it to sendPush, merged with a default { kind } so kind is always present
     even when the caller passes nothing.
  2. Populate it at the call sites that have an obvious target entity:
       attendance-post-process.ts  -> { kind:'attendance', session_id, student_id }
       homework-notify.ts          -> { kind:'homework', assignment_id }
       gallery-wall-notify.ts      -> { kind:'gallery', gallery_item_id }
     Read each file first — use the ids already in scope, do not add queries to fetch
     new ones.

MOBILE FOLLOW-UP — report only, do not implement
  Find the Expo notification response handler in apps/jain-pathshala-mobile and tell me
  which data.kind values it already routes on, so the strings above match rather than
  inventing a parallel vocabulary. If it routes on nothing, say that — it means these
  payloads are groundwork, not a working feature, and I need to know that.

COMMIT: feat: carry deep-link data payload on notification pushes
```

---

### FIX #8 — Make the Hindi columns non-null

```
FIX #8 — title_hi / body_hi are nullable but always required (data model)

File: lib/db/src/schema/notifications.ts  (~lines 36-38)

PROBLEM
  title_hi: text("title_hi"),      <- nullable
  body_hi: text("body_hi"),        <- nullable
while notifyUsers' signature requires both. So the type system enforces bilingual copy
at one call site and the database enforces it nowhere. Any direct insert — a future
service, a backfill script, a seed — produces a row that renders blank for a Hindi
user, with nothing to catch it.

CLAUDE.md: "All user-facing content must have _en and _hi variants."

TEST FIRST — apps/api-server/test/notifications.test.ts
  "an insert without Hindi copy is rejected"
  Attempt a raw db.insert(notifications) with title_hi omitted. Assert it rejects.
  This test is the whole point of the fix — if it passes before your change, the
  constraint is already there and you should stop and tell me.

CHANGE
  1. Backfill FIRST, in the migration, before the NOT NULL: any existing row with a
     null title_hi/body_hi gets the English text copied across. Losing an old
     notification to a failed migration is worse than an English string in a Hindi
     inbox.
  2. Add .notNull() to both columns.
  3. pnpm db:generate, inspect the generated SQL in lib/db/migrations, confirm the
     backfill UPDATE precedes the ALTER ... SET NOT NULL. Drizzle will NOT generate the
     backfill for you — hand-edit the migration to add it. Then pnpm db:migrate.
     Paste the generated SQL and both command outputs.
  4. Check whether any seed or script inserts notifications without Hindi copy:
       rg "insert\(notifications\)" --type ts
     Fix any that would now fail.

COMMIT: fix: require Hindi copy on notification rows
```

---

# Phase 3 — Data model and product completeness

### Phase 3 orchestration prompt

```
Work through docs/NOTIFICATION_FIX_PROMPTS.md prompts FIX #9, #10, #11 — in that
order. #9 is a Postgres enum change and wants to land alone. #10 and #11 are additive
route work with no schema impact.

One commit per fix. Stop after each and print a diff summary.
```

---

### FIX #9 — Give attendance its own notification kind

```
FIX #9 — Everything non-specific is filed as 'general' (data model)

Files:
  lib/db/src/schema/enums.ts                              (~line 120)
  apps/api-server/src/services/attendance-post-process.ts (~lines 30-36, 63-71)
  apps/api-server/src/lib/gallery-wall-notify.ts          (~line 53)
  apps/api-server/src/lib/notify.ts                       (kind union, ~lines 27-37)

PROBLEM
NOTIFICATION_KINDS is:
  general, birthday, homework, quiz, competition, service_request, exam, shivir,
  niyam_rejected, niyam_badge

Attendance, gallery-wall and donation notifications all pass kind:'general'. Two
consequences:
  1. A user who disables 'general' to mute chatter also loses everything else generic.
     prefsAllowKind cannot distinguish them because the enum cannot.
  2. attendance-post-process.ts:30-36 has its own prefsAllowAttendance reading a
     `p.attendance` preference key that no enum value corresponds to — so the mobile
     settings screen has a toggle whose key matches nothing in the notification kind
     vocabulary. Check whether the app actually writes that key; if it does not, the
     attendance opt-out has never worked.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "attendance notifications are stored with kind 'attendance'"
  b) "disabling 'attendance' does not suppress 'general' notifications, and vice versa"
     This is the behaviour the missing enum value costs today.

CHANGE
  1. Add to NOTIFICATION_KINDS: 'attendance', 'attendance_streak', 'donation',
     'gallery'. Keep 'general' — it is the correct default for genuinely
     uncategorised notifications.
  2. Widen the notifyUsers kind union in notify.ts to match. Better: derive it from
     NOTIFICATION_KINDS rather than restating the list — two hand-maintained copies of
     the same union will drift, and one already has.
  3. Update the call sites to pass the specific kind.
  4. Once attendance rows carry kind 'attendance', prefsAllowAttendance in
     attendance-post-process.ts is redundant with prefsAllowKind. Delete it and let
     notifyUsers gate. Confirm the p.push === false branch is preserved by
     prefsAllowKind before you delete — it is, but check rather than trust me.

MIGRATION
  Postgres ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older
  versions and Drizzle wraps migrations. Generate, then READ the SQL, and if it needs
  splitting say so before applying. Paste the generated SQL.

MOBILE FOLLOW-UP — report only
  Find the notification-preferences screen in apps/jain-pathshala-mobile and list the
  keys it writes to notification_preferences. If they do not match the new enum values,
  that mismatch is the real bug and I want it as a separate ticket.

COMMIT: feat: add attendance, streak, donation and gallery notification kinds
```

---

### FIX #10 — Paginate the inbox

```
FIX #10 — The inbox is limit-only and caps at 200 (product completeness)

Files:
  apps/api-server/src/routes/v1/notifications.ts        (~lines 66-97)
  apps/api-server/src/routes/v1/niyam-submissions.ts    (cursor helpers — copy these)

PROBLEM
GET /v1/notifications takes limit (clamped 50/200) and nothing else. A parent with more
than 200 notifications can never see the 201st. There is no cursor, no offset, no
before/after.

niyam-submissions.ts already has encodeSubmissionCursor / its decode partner using
base64url over a composite key. Match that pattern — do not invent a second cursor
format in the same codebase.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "the inbox pages through more notifications than the limit"
     Seed 5, request limit 2, follow the cursor twice, assert you see all 5 exactly
     once with no duplicates and no gaps.
  b) "a cursor from another user's inbox returns that user nothing"
     The cursor must not act as an access grant — it is a position, and the user_id
     filter still applies independently.
  c) "an invalid cursor returns 422, not a 500"

CHANGE
  Keyset on (created_at DESC, id DESC) — id breaks the tie, because two notifications
  inserted by the same notifyUsers batch share a created_at to the microsecond and a
  created_at-only cursor will drop or repeat rows at the page boundary.

  Add an index to lib/db/src/schema/notifications.ts:
    (user_id, created_at DESC, id DESC)
  The existing idx_notifications_user cannot serve this scan.

  Keep unread_count in the response — but compute it ONLY on the first page (no
  cursor). Recomputing a full count on every page is a wasted scan and the number does
  not change as you page.

  Response shape follows this repo's meta convention: ok(res, { items, unread_count },
  { count, next_cursor }). Check how niyam-submissions returns its cursor and match it
  exactly.

MIGRATION
  pnpm db:generate + pnpm db:migrate for the index. Paste both.

COMMIT: feat: keyset pagination on the notification inbox
```

---

### FIX #11 — Mark-all-read endpoint

```
FIX #11 — No bulk mark-read (product completeness)

File: apps/api-server/src/routes/v1/notifications.ts

PROBLEM
Clients must call POST /:id/read once per notification. A parent returning after a week
makes 40 requests to clear a badge.

TEST FIRST — apps/api-server/test/notifications.test.ts
  a) "mark-all-read clears only the caller's unread notifications"
     Seed unread rows for two users. Call as user A. Assert A's unread_count is 0 and
     B's is unchanged.
  b) "mark-all-read preserves already-read timestamps"
     A row read yesterday keeps yesterday's read_at, not today's. The single-item route
     is already idempotent this way (~line 119) — match it.
  c) "mark-all-read on an empty inbox returns 200 with updated: 0"

CHANGE
  POST /v1/notifications/read-all
    UPDATE notifications SET read_at = now()
    WHERE user_id = :caller AND read_at IS NULL
  Return ok(res, { updated: <rowcount> }).

  Use the hyphenated route style — the frozen attendance route table in CLAUDE.md uses
  check-in / check-out, so read-all matches. Do not use readAll or read_all.

  This route is not in CLAUDE.md's route tables (those cover attendance only), so no
  frozen-table conflict. Do not add it to that table.

COMMIT: feat: add mark-all-read to the notification inbox
```

---

# Phase 4 — Performance

### FIX #12 — Batch the attendance post-process

```
FIX #12 — N+1 in runAttendancePostProcess against the AT31 SLO (performance)

File: apps/api-server/src/services/attendance-post-process.ts  (~lines 199-221, 103-193)

PROBLEM
runAttendancePostProcess loops per marked student. Each iteration:
  recomputeAndAwardStreak -> students lookup + centre_holidays lookup + full attendance
                             history join + an UPDATE (+ a Punya award per milestone)
  enqueueParentAttendanceNotify -> a queue round-trip (which itself does getJob +
                                   remove + add)

AT31 sets the load-test SLO at 5,000 marks in 60 seconds. At roughly four sequential
round-trips per student that is ~20,000 queries inside a single job, serialised by
await in a for loop.

Read infra/load-tests before starting — if there is an existing k6 script for this
path, run it and paste the BEFORE numbers. If there is not, say so; do not write one
as part of this fix.

TEST FIRST
  a) Correctness, apps/api-server/test — the existing streak tests must pass unchanged.
     If you cannot find streak tests, that is the finding: write them BEFORE optimising.
     Optimising uncovered arithmetic is how AT22 silently breaks.
  b) "post-process issues a bounded number of queries for a full session"
     Count queries via a db spy for a 30-student session. Assert the count does not
     scale linearly with student count. Pick the threshold from the batched design, not
     from whatever the code happens to do.

CHANGE
  1. Hoist the per-student lookups out of the loop. All students in one session share a
     batch and a centre, so the centre_holidays fetch is ONE query, not N.
  2. Fetch the attendance history for all students in the session in one query, group
     in memory by student_id, and run the existing streak walk per group. Do not change
     the streak ARITHMETIC — AT22 is exact: 20 points every 4 consecutive attended,
     repeating; 'excused' skips; 'absent' resets; holidays and cancelled sessions
     skipped. Keep the idempotency key
     `attendance_streak:{studentId}:{sessionId}` unchanged (AT22 requires the
     triggering session_id in the key).
  3. Batch the students UPDATE — one statement with a CASE or an unnest join, not N.
  4. Keep the per-student enqueue: the debounce jobId is deliberately per (student,
     session) and collapsing it would break AT31's 5-minute settle window. If BullMQ's
     addBulk can preserve distinct jobIds, use it; otherwise leave the loop and say so.
  5. Punya awards stay one call per milestone. AT20 is explicit that the guarded insert
     is what protects the balance — do not batch them into an unguarded bulk write.

CONSTRAINT
  Paste BEFORE and AFTER query counts from the spy test. "It feels faster" is not a
  result.

COMMIT: perf: batch attendance post-process queries per session
```

---

## Appendix — spec drift to resolve separately

Not a code fix. CLAUDE.md's stack table says NestJS in `apps/api` with 30 BullMQ
queues including `notifications.fanout`, `notifications.push`, `notifications.sms`,
`notifications.email`. The running code is Express in `apps/api-server` with 18 queues
and no fanout layer.

Until CLAUDE.md is reconciled, every spec-conformance review of this module will report
the same four phantom findings. Suggested prompt:

```
Reconcile CLAUDE.md with the running stack. Do NOT change any code.

Read apps/jp-shared/src/constants.ts and apps/api-server/src/app.ts, then update
CLAUDE.md so that:
  - the stack table names Express 5 in apps/api-server, not NestJS in apps/api
  - the monorepo structure block matches the real directory layout
  - the "All 30 BullMQ queues" list matches QUEUE_NAMES exactly, with the
    schedule-kind vs queue-kind distinction preserved
  - the cron table matches CRON_EXPRESSIONS exactly

Where a CLAUDE.md rule is aspirational rather than implemented, keep it but mark it
"NOT YET IMPLEMENTED" with a one-line note. Do not silently delete a rule that the
code has not caught up to — that is how a requirement disappears.

Show me a diff of CLAUDE.md before committing.
```
