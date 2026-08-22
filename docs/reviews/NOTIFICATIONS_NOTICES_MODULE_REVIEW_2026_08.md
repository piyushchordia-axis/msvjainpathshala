# Notifications & Notice Module — Full Code Review

**Date:** 2026-08-20 · **Reviewer:** Claude (Cowork)
**Format:** persona → navigation → action → observed vs expected
**Commit reviewed:** `8c190ff` (Quiz fixes)

## Scope reviewed

| Layer | Files |
|---|---|
| API — notices CRUD, feeds, read receipts | `apps/api-server/src/routes/v1/notices.ts` (632 L) |
| API — inbox, push-token, birthday cron | `apps/api-server/src/routes/v1/notifications.ts` (380 L) |
| Delivery core | `lib/notify.ts` (158 L), `lib/push.ts` (173 L) |
| Emitters | `homework-notify.ts`, `quiz-notify.ts`, `push-quiz-feed.ts`, `shivir-notify.ts`, `join-notify.ts`, `gallery-wall-notify.ts`, `punya-tier-notify.ts`, `niyam-badges.ts`, `services/niyam-approve.ts`, `services/consecutive-absence.ts`, `services/attendance-post-process.ts`, `lib/library-requests-admin.ts`, `jobs/birthday-jobs.ts`, `lib/retention.ts` |
| Scope / RBAC | `lib/scope.ts`, `lib/route-helpers.ts`, `middlewares/auth.ts`, `lib/api-zod/src/contracts.ts` |
| Schema | `lib/db/src/schema/notices.ts`, `schema/notifications.ts`, `schema/enums.ts` |
| Migrations | `0043`, `0044`, `0045`, `0046`, `0049`, `0072`, `0075`, `0082`, `0095`, `0097` |
| Mobile | `app/notifications.tsx`, `app/notices.tsx`, `app/guest/notices.tsx`, `app/admin/notices.tsx`, `components/NotificationsInbox.tsx`, `components/NoticesFeedScreen.tsx`, `lib/push.ts`, `app/_layout.tsx`, `lib/queries.ts` (notice/notification hooks), `contexts/AuthContext.tsx` |
| Web | `pages/admin/NoticesAdminPage.tsx`, `pages/public/NoticesPage.tsx`, `routes/AdminRoutes.tsx`, `routes/PublicRoutes.tsx`, `components/admin/sidebar-nav.ts` |
| Tests | `test/notifications.test.ts` (1584 L), `test/notices.test.ts` (452 L) |

Persona hierarchy used: `super_admin → state_admin → city_admin → sanchalak → shikshak → parent → student` (+ guest).

---

## Verdict

**The delivery core is well-shaped and the authoring surface is where it breaks down.** `notifyUsers` is a real choke point, per-recipient language selection inside a batched send is correct (`notify.ts:103`), every `_hi` string in every emitter is genuine Devanagari rather than English copied across, the birthday cron's three-layer idempotency (queue job id + advisory lock + per-IST-day probe) is the best-engineered thing in the module, `shivir-notify`'s `announced_at` claim is a textbook at-most-once guard, and the inbox's keyset pagination is correct end-to-end from `queries.ts:1781` to `notifications.ts:131`. Direct `sendPush` calls — the headline defect of the previous review — are gone: the only two callers left are `notify.ts` and `push.ts` itself.

The failures cluster in five places:

1. **A user who turns off push loses the durable inbox as well.** `prefsAllowKind` returns `false` for `push:false` (`notify.ts:26`) and the same `allowedIds` list gates both the Expo send **and** the `notifications` insert (`notify.ts:72-83`). Only the birthday path escapes, because it writes its own row and passes `inbox:false`. Every other kind — homework, quiz, shivir, join, library, niyam, punya tier, attendance — vanishes entirely for that user. The schema comment calls the inbox "the fallback when push isn't delivered"; today it is the same switch.

2. **AT27 (three consecutive absences) has never fired.** `eligible_sessions` (`consecutive-absence.ts:49-66`) ranks by `scheduled_date desc` with no upper bound, and AT7 materialises sessions 60 days *forward*. "Last 3 sessions" is therefore the next three unheld ones, whose attendance rows don't exist, so `bool_and` over an all-NULL input never satisfies the `having`. The cron reports `{flagged: 0}` every night and the Sanchalak's alerts monitor — which shares the query — is permanently empty.

3. **A shared family phone silently redirects notifications.** There is no push-token deactivation route anywhere; `notifications.ts` exposes only `POST /push-token`, and nothing runs on sign-out. After parent A signs out and child B signs in on the same device, A's token stays `is_active` and bound to A, B's registration gets a 409 (`notifications.ts:118`) which the client swallows without a word (`mobile/lib/push.ts:82-86`), and the device keeps delivering A's notifications — child names, attendance, approvals — while B receives nothing, forever.

4. **Notice write authorisation is centre-level for a batch-level role.** `authorizeWrite` gates both `centre` and `batch` audiences on `inScope(scope, effectiveCentreId)` (`notices.ts:392`) — the `@deprecated` centre helper — and `loadScoped` does the same for edit and delete (`notices.ts:508`). `requireAdminPanel` admits `shikshak` (`contracts.ts:203-209`), whose `scope.batchIds` is populated and simply never consulted. A Guruji can publish to any batch in their centre, and edit or delete a Sanchalak's centre-wide notice.

5. **Deep links are dead and the inbox is a dead end.** The client routes on `data.route` only (`_layout.tsx:56-62`); of twelve emitters exactly one (quiz) sets it. Everything else ships `assignment_id` / `shivir_id` / `library_item_id` / `submission_id` into a handler that ignores them. Worse, the `notifications` table has **no data or entity column at all**, so the durable row can never deep-link even in principle — and `NotificationsInbox.tsx:35`'s `onPress` only marks read. A parent who taps "Homework approved" lands on a list of text.

**Headline count:** 5 Critical · 22 High · 34 Medium · 19 Low.

**Also worth stating plainly:** `is_critical` on a notice drives nothing. `notices.ts` never imports `notifyUsers` — there is no `notice` value in `notification_kind_enum` — so publishing a notice marked "Important / महत्वपूर्ण" sends no push to anyone. Delivery is pull-only. That may be deliberate, but the checkbox reads like it isn't.

---

# 0. Cross-cutting — the delivery pipeline

These sit under every persona below. A parent never navigates to `notify.ts`; they experience it as "I never got told."

### X-1 · Turning off push also deletes the in-app notification — **CRITICAL**

| | |
|---|---|
| **Navigation** | Mobile → any surface that writes `users.notification_preferences.push = false` |
| **Action** | Wait for any notification — homework graded, niyam approved, shivir scan, library book ready |
| **Observed** | `notify.ts:26` — `if (p.push === false) return false;` — is inside `prefsAllowKind`, whose output is the single `allowedIds` list. That list gates the inbox insert at `:72-83` *and* the token query at `:95`. So `push:false` suppresses the durable row too. The one exception proves the intent: `runBirthdayWishes` inserts its own rows inside the advisory-locked transaction and calls `notifyUsers({inbox:false})` with the comment *"so push-opt-out does not suppress the durable birthday notice"* (`notifications.ts:361-373`), and `notifications.test.ts:1377` asserts exactly that contract — for birthdays only. Eleven other kinds have no such protection. `schema/notifications.ts:45` describes the inbox as "the fallback when push isn't delivered." |
| **Expected** | Two independent gates: a **channel** gate (`push`) that suppresses only the Expo send, and a **kind** gate (`p[kind] === false`) that suppresses the notification entirely. The inbox insert should follow the kind gate alone. |

### X-2 · The three-consecutive-absence alert can never fire — **CRITICAL**

| | |
|---|---|
| **Navigation** | Nightly cron 02:00 IST, and Sanchalak → Attendance → Alerts (same query) |
| **Action** | A child misses three Pathshala sessions in a row |
| **Observed** | `consecutive-absence.ts:54-66` ranks sessions `row_number() over (partition by s.batch_id order by s.scheduled_date desc, s.id desc)` with `where s.status <> 'cancelled'` and **no upper bound on `scheduled_date`**. AT7 materialises sessions in a rolling 60-day *forward* window and a future session's status is `'scheduled'`, which passes the filter. So `last3` is the next three sessions that haven't happened. The left join to `attendance` (`:84-86`) yields `status = NULL` for all three, `bool_and` over an all-NULL input is NULL, the `having` at `:99` is false, `flagged` is empty. `runConsecutiveAbsenceCheck` returns `{flagged: 0}` unconditionally, and the docblock at `:6-7` confirms `GET /v1/admin/attendance/alerts` reads the same set — so the Sanchalak's monitor is empty for the same reason. |
| **Expected** | Bound the window to sessions that have occurred: `and s.scheduled_date < (now() at time zone 'Asia/Kolkata')::date`. AT27 runs at 02:00 IST the following day, so "yesterday and earlier" is the correct frame. |

### X-3 · Once X-2 is fixed, two absences plus one unmarked session flags the child — **HIGH**

| | |
|---|---|
| **Navigation** | Same cron |
| **Action** | A Guruji forgets to mark a roster; the child was absent the two sessions either side |
| **Observed** | `consecutive-absence.ts:98-99` — `having count(*) = 3 and bool_and(status = 'absent')`. `count(*)` counts the left-joined row whether or not attendance exists; `bool_and` **skips NULL inputs**. So `{absent, absent, unmarked}` gives `count = 3` and `bool_and(true, true) = true` → flagged. That escalates to the parent, the Sanchalak *and* the city_admin (`:151-164`). CLAUDE.md:208 (AT6) is explicit: *"unmarked students are NOT inferred absent. Absence is an affirmative observation, never an inference from silence."* AT27's own wording says "trigger only on three `'absent'` rows." |
| **Expected** | `having count(*) filter (where status = 'absent') = 3`. A family should not be escalated over a missed roster. |

### X-4 · A shared family phone keeps delivering the previous account's notifications — **CRITICAL**

| | |
|---|---|
| **Navigation** | Mobile → sign out → a different family member signs in on the same device |
| **Action** | Wait for any notification |
| **Observed** | There is **no deactivation route**: `notifications.ts` exposes `POST /push-token`, `GET /`, `POST /read-all`, `POST /:id/read` and nothing else (verified by grep across `apps/`). Nothing in `AuthContext.tsx`'s sign-out path calls anything. The server correctly refuses to steal a live token — `claimedByOther` → 409 `ERR_PUSH_TOKEN_CLAIMED` (`notifications.ts:115-126`) — but the client's registration is wrapped in `catch (err) { if (__DEV__) console.warn(...) }` (`mobile/lib/push.ts:82-86`), so in production the 409 is invisible. The only thing that ever frees a token is Expo returning `DeviceNotRegistered` on a healthy device, which will not happen. Net effect: A's notifications (child names, attendance status, approvals) keep landing on B's phone; B gets nothing and is never told why. On this product a shared handset is the norm, not the edge case. |
| **Expected** | `POST /v1/notifications/push-token/deactivate` called from sign-out, setting `is_active = false` for that `expo_token`; and surface `ERR_PUSH_TOKEN_CLAIMED` to the user — its message is already written for them ("sign out on that device first"). |

### X-5 · `InvalidCredentials` deactivates every token in the send — **HIGH**

| | |
|---|---|
| **Navigation** | Server, any push |
| **Action** | The FCM service-account key is rotated or revoked |
| **Observed** | `push.ts:12` — `const DEAD_TOKEN_ERRORS = new Set(["DeviceNotRegistered", "InvalidCredentials"]);` and `:74` deactivates on either. `InvalidCredentials` is an *app-level* credentials fault, not a dead device — one expired key turns every ticket in every chunk into a token deactivation and wipes `is_active` across the install base. Recovery is not automatic: the only re-registration path is `registerPushTokenWithApi`, called from `AuthContext.tsx:67,89` on sign-in, so every user would have to sign out and back in. |
| **Expected** | Deactivate on `DeviceNotRegistered` only (arguably `MismatchSenderId` per-token). Treat `InvalidCredentials` as an alertable server error. |

### X-6 · The receipt sweep marks receipts checked that Expo hasn't produced yet — **HIGH**

| | |
|---|---|
| **Navigation** | Receipt sweep cron |
| **Action** | Sweep runs before Expo has finished processing a batch |
| **Observed** | `push.ts:138-141` pushes the id onto `checkedTicketIds` **before** testing whether a receipt came back: `for (const ticketId of chunk) { checkedTicketIds.push(ticketId); const receipt = receipts[ticketId]; if (!receipt || …) continue;`. Every one of those ids is then stamped `checked_at` at `:157-166` and permanently excluded from `where isNull(checked_at)` (`:123`). This defeats the module's stated purpose — `schema/notifications.ts:26-29` (FIX #3): *"DeviceNotRegistered often appears only on the async receipt, not the immediate ticket."* |
| **Expected** | Stamp only ids actually present in the receipts map; the 7-day delete at `:114` already bounds the retry window. |

### X-7 · The fan-out has no chunking and will hard-fail above ~11 000 recipients — **HIGH**

| | |
|---|---|
| **Navigation** | Super admin → publish a national push quiz, or a city shivir announcement |
| **Action** | Audience exceeds ~10 900 users |
| **Observed** | `notify.ts:73-82` is one `INSERT … VALUES` with 6 placeholders per row — Postgres caps bind parameters at 65 535, so it throws above ~10 922 recipients. `inArray(users.id, ids)` (`:58`) and `inArray(device_push_tokens.user_id, allowedIds)` (`:95`) fail above 65 535. Nothing chunks. `quiz-notify.recipientUserIds` for `scope: 'national'` returns every active student's parent **and** student login in the country; `shivir-notify.ts:118`'s own docblock says "a city with a few thousand families." The shivir case is the worst: `announced_at` is already claimed (`:151-169`) when the insert throws, and the design is deliberately at-most-once, so **the entire city's announcement is permanently lost**. |
| **Expected** | Chunk inside `notifyUsers` (≈500 rows per insert, ≈1 000 per IN-list) and continue past a failed chunk. |

### X-8 · A national quiz fans out inside the authoring request — **HIGH**

| | |
|---|---|
| **Navigation** | Admin → Quizzes → Start push quiz (national scope) |
| **Action** | Tap Start |
| **Observed** | `quiz-notify.ts:121-131` calls `await notifyUsers({userIds, …})` directly in the request path. The sibling module states the rule it is breaking: `shivir-notify.ts:121-130` — *"The fan-out is unbounded … so it must not run inside the API request that created the shivir"* — and enqueues on `QUEUE_NAMES.PARENT_NOTIFY`. Quiz does not. Combined with X-7, the request both blocks and then throws. |
| **Expected** | Enqueue, as shivir does. |

### X-9 · Deep links are dead for eleven of twelve emitters, and the inbox row cannot link at all — **HIGH**

| | |
|---|---|
| **Navigation** | Tap any push notification; or open Inbox and tap a row |
| **Action** | Try to reach the thing the notification is about |
| **Observed** | `_layout.tsx:56-62` reads **only** `data.route`: `if (typeof d.route === "string" && d.route.startsWith("/")) return d.route; return "/notifications";`. `kind` is destructured into the type and never used, despite the docblock at `:52-55` claiming it is honoured. Only `quiz-notify.ts:130,157` set `route`. Every other payload is inert: `homework-notify.ts:45` (`assignment_id`), `shivir-notify.ts:216`, `gallery-wall-notify.ts:63`, `library-requests-admin.ts:414`, `niyam-approve.ts:259`, `niyam-badges.ts:168`, `punya-tier-notify.ts:72`, `attendance-post-process.ts:89`, `join-notify.ts:59` — even though `homework-assignment/[id]`, `shivir/[id]`, `gallery`, `library/item/[itemId]` and `niyam-submissions` are all real routes (`_layout.tsx:96-149`). And the `notifications` table has **no data/entity column** (`schema/notifications.ts:49-59`), so the durable row carries no reference at all; `NotificationsInbox.tsx:35`'s `onPress` only marks read. `notifications.test.ts:954-973` "verifies" this by asserting on a `vi.spyOn(sendPush)` mock — it re-asserts the line directly above the mocked call and proves nothing end-to-end. |
| **Expected** | (a) Add `data jsonb` to `notifications` and persist `opts.data` at `notify.ts:73`; (b) map `kind` + entity id → `Href` on the client rather than requiring every emitter to remember `route`; (c) make inbox rows tappable. |

### X-10 · The birthday job's failure mode loses the entire day, and the retry is a guaranteed no-op — **HIGH**

| | |
|---|---|
| **Navigation** | Birthday cron, 06:00 IST |
| **Action** | Any one recipient's push throws (see X-12) |
| **Observed** | Inbox rows are inserted inside the advisory-locked transaction (`notifications.ts:343-352`); the push loop at `:363-375` is a bare `for … await notifyUsers(…)` with **no per-iteration catch**. A throw propagates → BullMQ retries → the dedupe SELECT at `:326-337` now finds today's rows for everyone → `pending` is empty → early return at `:356`. **Nobody gets a birthday push that day, and the retry cannot recover it.** The same shape (try/catch outside the loop) appears at `gallery-wall-notify.ts:54-65` and `library-requests-admin.ts:406-416`. |
| **Expected** | `.catch()` per recipient inside the loop; drive the push from a per-row "pushed" marker rather than from the inbox row's existence. |

### X-11 · The birthday inbox insert bypasses the preference gate entirely — **MEDIUM**

`notifications.ts:343-352` is a raw `tx.insert(notifications)` — `prefsAllowKind` is never called anywhere in `runBirthdayWishes`. A user who set `{birthday: false}` still gets an inbox row every year; only the push respects it. This is the exact mirror of X-1: one path over-gates, the other under-gates. **Expected:** one gate, applied once, with an explicit channel/durability split.

### X-12 · An unknown user id is force-allowed and then kills the whole batch — **MEDIUM**

`notify.ts:63-65` — `// Users missing from the prefs query (shouldn't happen) stay allowed.` followed by `for (const id of ids) if (!known.has(id)) allowedIds.push(id);`. But `notifications.user_id` is `references(() => users.id)` (`schema/notifications.ts:50`), so any id absent from the prefs SELECT is guaranteed to violate the FK — and the insert is one statement, so **one stale id discards the entire fan-out**. This is the most likely trigger for X-10. **Expected:** drop unknown ids; they cannot be notified anyway.

### X-13 · Deactivated and soft-deleted users still receive notifications — **MEDIUM**

`notify.ts:51-58` filters neither `users.is_active` nor `users.deleted_at`, though both are checked elsewhere in the same module (`notify.ts:147` for city admins, `push-quiz-feed.ts:79`, `quiz-notify.ts:104`). `sanchalakUserIdsForCentre` (`:119-130`) checks only the *assignment's* `is_active`, not the user's — a deactivated Sanchalak with a live assignment keeps getting centre alerts and join-queue pages. **Expected:** filter centrally in `notifyUsers`.

### X-14 · One failed Expo chunk abandons every remaining chunk — **MEDIUM**

`push.ts:66-86` — the `try` wraps the whole `for (const chunk of …)` loop and the handler is `logger.warn(…); return tickets;`. A transient socket error on chunk 3 of 50 silently drops 4 800 recipients. AT31's SLO is 5 000 marks in 60 s, so multi-chunk sends are routine. **Expected:** try/catch per chunk, continue, report per-chunk outcomes.

### X-15 · Four emitters have no idempotency guard — **MEDIUM**

| Emitter | Line | Re-fires on |
|---|---|---|
| `homework-notify.ts` | `:38-46`, `:122-134` | re-publish, retried request, re-grade (approved → starred → approved) |
| `quiz-notify.ts` | `:113-137`, `:140-162` | double-tap Start, a re-opened event window |
| `gallery-wall-notify.ts` | `:80-91` | BullMQ retry, unfeature → re-feature |
| `join-notify.ts` | `:52-60` | every resubmission pages the whole reviewer set again |

`shivir-notify.ts:141-169` shows the correct primitive in the same codebase — a conditional `UPDATE … SET announced_at … WHERE announced_at IS NULL … RETURNING` — and `consecutive-absence.ts:126-135` shows the other (a unique claim row). **Expected:** a claim column or dedupe key per (entity, event).

### X-16 · The child's own account is skipped by four emitters (Q4) — **MEDIUM**

`homework-notify.ts:12-26` selects `parent_id` only; `shivir-notify.ts:48-63`, `punya-tier-notify.ts:55-60` and `niyam-badges.ts:149-154` do the same (the badge helper's signature is literally `parentUserId: string | null`, so the child cannot be a recipient by construction). `niyam-approve.ts:247-249` is the reference implementation and states the reason: *"a student aged 8+ on their own OTP account (Q4) is the person who kept the niyam, and a parent_id-only send left exactly that child hearing nothing."* So the same child gets the niyam approval but not the badge for it. **Expected:** `[parent_id, user_id]`, deduped, everywhere.

### X-17 · The library publish path flips to a terminal state before notifying — **MEDIUM**

`library-requests-admin.ts:385-416` updates every row to `published` (terminal — `ADMIN_TRANSITIONS.published: []`, `:80`) and *then* loops notifying. The `where` requires `accepted`, so a re-run notifies nobody. If recipient #1 throws, the outer catch logs "publish fan-out failed" and returns 0 while the rows stay published — the rest of the requesters can never be told. Separately, **a rejected request never reaches the requester at all** (`decideRequest`, `:216-261`, writes `admin_note` and returns without notifying), despite the note field existing to tell them something. **Expected:** a per-row `notified_at`; notify on reject.

### X-18 · A centre with no active Sanchalak and no city_admin queues registrations to nobody — **MEDIUM**

`join-notify.ts:34-39` resolves reviewers as sanchalaks + `cityAdminUserIdsForCentre`, and `:49-50` is `if (userIds.length === 0) return;` with no log. `cityAdminUserIdsForCentre` (`notify.ts:132-150`) needs a `centres.city_id` **and** a matching active `city_admin`; a brand-new centre satisfies neither. state_admin and super_admin, who can certainly clear the queue, are never included. The payload also carries no registration id (`:59`), so a reviewer who *is* notified lands on the generic inbox and must find the record by hand. **Expected:** fall back up the role ladder; log a zero-reviewer outcome; include the id.

### X-19 · The absence cron does N+1 reviewer lookups and its chunking is decorative — **MEDIUM**

`consecutive-absence.ts:121-154` — the outer `for (let i = 0; i < rows.length; i += NOTIFY_CHUNK)` does no batching, no concurrency and no pause; it is byte-identical to a flat loop. Inside it, `sanchalakUserIdsForCentre` and `cityAdminUserIdsForCentre` run **per student** (the latter is itself two round trips). 200 flagged students at one centre ≈ 600 redundant queries and 200 separate fan-outs. **Expected:** resolve reviewers once per distinct centre; delete the fake chunking or make it real.

### X-20 · The absence alert uses `kind: "general"` with an empty payload — **MEDIUM**

`consecutive-absence.ts:156-164`. `attendance` and `attendance_streak` are both declared kinds (`0045_notification_kinds_attendance.sql`). Using `general` means muting the catch-all also mutes 3-absence escalations, and muting absence alerts specifically is impossible. With no `data`, a Sanchalak cannot tap through to the student. **Expected:** a dedicated kind plus `{student_id, centre_id, route}`.

### X-21 · The retention prune is an unindexed sequential scan, re-run per batch — **MEDIUM**

`retention.ts:52-65` — `WHERE read_at IS NOT NULL AND created_at < now() - 90 days ORDER BY created_at LIMIT 5000` in a `for(;;)` loop. No index leads with `read_at` or `created_at` (`idx_notifications_user_read` starts with `user_id`). Every batch is a full seq scan plus a top-N sort of the fastest-growing table in the schema — a self-reinforcing failure as the table grows. Also, unread rows are never pruned by design (`:48`), so an inactive user's inbox grows without bound. **Expected:** `CREATE INDEX … ON notifications (created_at) WHERE read_at IS NOT NULL;` plus a long-horizon cap on unread.

### Medium / Low — pipeline

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| X-22 | M | Publish a gallery feature for a parent with two featured children | `gallery-wall-notify.ts:43-52` keeps only the first child per parent (`if (!byParent.has(...))`). Deduping the notification is right; dropping the second child's name from the copy is not — the parent never learns about Diya. **Expected:** merge names into one body. |
| X-23 | M | Any bulk fan-out to distinct parents | `gallery-wall-notify.ts:54-65` and `notifications.ts:363-375` issue **one `notifyUsers` per recipient** — 3 queries + 1 Expo HTTP round trip each, serially. For 400 birthdays that is ~1 200 queries and 400 Expo requests, defeating `chunkPushNotifications` (100/request). **Expected:** group by identical copy; one batched `sendPush`. |
| X-24 | M | Two children share a birthday, one parent | `notifications.ts:294-302` keys `seen` on the *user*, so the second child is dropped entirely rather than merged. Parent gets one wish naming one twin. |
| X-25 | M | A quiz saved with `scope: 'city'` and an empty city list | `quiz-notify.ts:78-84` renders `ARRAY[]::uuid[]`, matching nobody, then `if (userIds.length === 0) return;` — no log, no metric, no signal to the Guruji. `quizAudienceSize` (`:165`) already exists but is "exported for tests". |
| X-26 | M | Bulk-grade homework for 30 students | `homework-notify.ts:121` uses `opts.studentIds.length` for the body, so a parent of one child reads "(30 submissions)". |
| X-27 | L | Grade a withdrawn/soft-deleted student | `homework-notify.ts:64-66` and `:152-154` filter on `students.id` only, while the batch helper at `:17-23` correctly adds `status = 'active'` and `deleted_at is null`. |
| X-28 | L | Register a junk push token | `notifications.ts:48-51` accepts any `z.string().min(1).max(500)` with no `isValidExpoPushToken` check; `push.ts:49` then drops it silently on every send, forever, while the row stays `is_active`. |
| X-29 | L | 29 February birthday, non-leap year | `notifications.ts:283-284` matches on exact month/day with no 28-Feb fallback. |
| X-30 | L | Same birthday event, two surfaces | `notifications.ts:349` vs `:369` — the inbox body says "…from all of us at Jain Pathshala", the push body doesn't, while `body_hi` is identical in both. Two literals for one message will drift. |
| X-31 | L | Any zero-audience outcome | `notify.ts:48,66`, `join-notify.ts:50`, `quiz-notify.ts:122,149`, `gallery-wall-notify.ts:24`, `shivir-notify.ts:206`, `homework-notify.ts:36` — every one is a bare `return` with no log. A misconfigured scope is indistinguishable from a successful send. |
| X-32 | L | Reading the code | `notify.ts:50` and `homework-notify.ts:3` both cite **AT31** for the preference rule. AT31 is the debounced-attendance-push spec; the preference rule lives in the pitfalls table (CLAUDE.md:935). |
| X-33 | L | `push-quiz-feed.ts:148,166-168` | Middleware is registered on the **RegExp** namespace (`server.of(NAMESPACE_RE).use(...)`, `:117-128`) but emits address a **string** namespace (`io.of(\`/push-quizzes/${id}\`)`). In socket.io v4 `Server.of(string)` mints a plain namespace inheriting none of the parent's middleware — so an emit that runs before any client connects could leave that namespace unguarded. Blast radius is limited to lifecycle payloads (the `staff` room is only joined in the parent's handler). ***Needs verification against the installed socket.io version — I could not confirm this from repo source alone.*** |

---

# 1. Guest / public visitor

**Entry points:** Web `/notices` (`PublicRoutes.tsx`), mobile `app/guest/notices.tsx` → `NoticesFeedScreen`. Both correctly unauthenticated, both hit `GET /v1/notices/public`. ✅

### G-1 · The web composer defaults every notice to world-readable, and the public feed strips its context — **CRITICAL**

| | |
|---|---|
| **Navigation** | Web admin → **Notices** → New notice |
| **Action** | A sanchalak writes "Pathshala closed tomorrow — Andheri centre", audience **Centre**, leaves the pre-checked box alone, clicks Publish |
| **Observed** | `NoticesAdminPage.tsx:130` — `emptyForm()` returns `is_public: true`. Every other surface defaults to **false**: the server (`notices.ts:453`, `body.is_public ?? false`), the DB (`schema/notices.ts:24`, `.default(false)`) and the mobile composer (`app/admin/notices.tsx:57`). The checkbox label is honest ("Show on the public website & guest app") but it is checked before the author touches it. And `GET /public` filters on **`is_public` and liveness only** — audience is not in the predicate (`notices.ts:99`) — while the payload (`:88-97`) carries no `audience`, `centre_id` or centre name. So a centre-scoped internal notice appears on the public marketing site and in the guest app, addressed to the entire country, with no indication which centre it refers to. |
| **Expected** | Default `is_public: false` to match every other surface; make the consequence explicit for non-national audiences ("Anyone on the internet will see this, without the centre name"); either return audience context from `/public` or refuse `is_public` on centre/batch audiences. |

### G-2 · The public notices page bypasses the shared API client — **MEDIUM**

| | |
|---|---|
| **Navigation** | Public site → **Notices** |
| **Action** | Load the page on any deployment where the API is not co-hosted |
| **Observed** | `NoticesPage.tsx:38` — `fetch('/v1/notices/public?limit=50', { headers: { Accept: 'application/json' } })`. This is the only raw `fetch(` in the staged web sources; everything else uses `apiGet` from `@/lib/api-client`. It hardcodes same-origin and skips whatever the shared client does for envelope normalisation, request ids and timeouts. A separate `api.` host or a base-path mount turns this one page into a permanent error card while the rest of the app works. |
| **Expected** | `apiGet`, like the rest of the module. |

### Medium / Low — public

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| G-3 | M | Public feed or member feed, 51st notice | `NoticesPage.tsx:38` and `NoticesFeedScreen.tsx:44` both request `limit=50`; neither `/public` (`notices.ts:85-105`) nor `/feed` (`:143-212`) implements a cursor, and neither FlatList has `onEndReached`. The 51st notice is unreachable with **no truncation signal** — the exact bug already fixed for notifications (`queries.ts:1770-1780`). **Expected:** keyset cursor mirroring the inbox, or a "showing latest 50" footer. |
| G-4 | L | Hindi visitor reads a notice date | `NoticesPage.tsx:17-23,105` hardcodes `toLocaleDateString('en-IN', …)` even when `hi === true`, with **no `timeZone: 'Asia/Kolkata'`** — while the same module pins IST carefully for the date input (`NoticesAdminPage.tsx:94-99`). It also renders `created_at`, though `/public` **orders by `published_at`** (`notices.ts:100`) and never returns it — so a backdated notice shows a date inconsistent with its position. |
| G-5 | L | Read a three-paragraph announcement | `NoticesPage.tsx:110` — `<p className="mt-2 text-sm …">{body}</p>`. The source is a multi-line `<Textarea>`; HTML collapses the newlines into one run-on block. **Expected:** `whitespace-pre-line`. |
| G-6 | L | Hindi visitor, notice saved with an empty Hindi title | `NoticesPage.tsx:88-89` uses `??`, which only falls through on null/undefined — a stored `""` survives, and `{title ? <h2> : null}` (`:107`) drops the heading entirely, leaving a dated card with only a body. **Expected:** `||`, or normalise empty strings to null server-side. |
| G-7 | L | Fast retry on the public page | `NoticesPage.tsx:34-55` has an `active` flag but no `AbortController`, so two requests can be in flight. |

**Solid here:** the public page's error handling is correct and is usually the thing that's wrong — `!r.ok` throws into a real error state with a retry (`:38-55, 71-80`), and a network failure is **never** rendered as "no notices". No `dangerouslySetInnerHTML` anywhere in the web tree; notice bodies are plain text nodes.

---

# 2. Parent / Student (member)

**Entry points:** Mobile `app/notifications.tsx` (a hub with two segments: Inbox + Notices), `app/notices.tsx` → `NoticesFeedScreen`, push notifications via `_layout.tsx`. Server: `GET /v1/notifications`, `GET /v1/notices/feed`.

### P-1 · Opening the Notices tab marks every notice read, including the critical ones — **HIGH**

| | |
|---|---|
| **Navigation** | Mobile → **Notices** (or the Notices segment of the Inbox hub) |
| **Action** | Let the screen render. Do nothing else. |
| **Observed** | `NoticesFeedScreen.tsx:72-78`: <br>`useEffect(() => { if (!isMember \|\| !memberFeed.data?.items) return; const unread = …filter(n => !n.read_at); if (unread.length === 0) return; for (const n of unread) markRead.mutate(n.id); }, [isMember, memberFeed.data]);`<br>Three problems compound. (a) It destroys the feature — the "नया / New" pill (`:94`) and the server's `unread_count` are zeroed the instant the list paints, whether or not anything was read, including `is_critical` notices. (b) It fires up to 50 parallel POSTs. (c) Each `onSuccess` invalidates `["me","notices-feed"]` (`:65`), which produces a **new `memberFeed.data` identity — the effect's own dependency**. If any receipt hasn't committed before the refetch returns, the effect re-fires and re-mutates. That is a request loop, not a burst; the `eslint-disable exhaustive-deps` at `:77` is what hides it. |
| **Expected** | Mark read on explicit interaction or a viewability threshold, batched into one request, with the effect keyed on stable ids rather than the data object. |

### P-2 · A momentary blip while scrolling wipes the whole inbox — **HIGH**

| | |
|---|---|
| **Navigation** | Mobile → **Inbox** → scroll past 50 items |
| **Action** | `fetchNextPage` fails (patchy connection, or a 422 from a stale cursor — `notifications.ts:141`) |
| **Observed** | `NotificationsInbox.tsx:72` — `if (notifications.isError)` returns the full-screen error card. In React Query v5 an infinite query has a single error slot: a rejected `fetchNextPage` sets `status: "error"` while `data` is retained. So the 50 rows already on screen are discarded and replaced with "सूचनाएँ लोड नहीं हुईं।" |
| **Expected** | Gate the full-screen error on `isError && !data`; render `isFetchNextPageError` as an inline footer with retry. |

### P-3 · Tapping a notification produces no visible change and fails silently — **HIGH**

| | |
|---|---|
| **Navigation** | Mobile → **Inbox** → tap an unread row |
| **Action** | Tap, then tap another row while the first is in flight |
| **Observed** | `queries.ts:1806-1812` is `mutationFn` + `onSuccess: invalidate` and nothing else — **no `onMutate`, no `onError`, no `setQueryData`**. The "New" pill stays until the whole infinite query round-trips; on failure it stays forever with no message, so the user taps again. Meanwhile `NotificationsInbox.tsx:17-23` guards `if (!isUnread \|\| markRead.isPending) return;` — a single in-flight mutation silently swallows every other row's tap. And the invalidation refetches **every loaded page** (a user on page 5 marking 6 rows read issues ~30 requests). |
| **Expected** | `onMutate` writes `read_at` into the cached page and decrements `unread_count`; `onError` restores and surfaces a toast; per-row pending state instead of a global one. |

### P-4 · The inbox is a dead end — no tap-through, no mark-all-read — **HIGH**

| | |
|---|---|
| **Navigation** | Mobile → **Inbox** |
| **Action** | Try to open the homework that was just approved; then try to clear 40 unread rows |
| **Observed** | `NotificationsInbox.tsx:35`'s `onPress` only marks read; `NotificationRow.kind` is fetched (`queries.ts:1755`) and never used; the row carries no entity id because the table has no column for one (X-9). And `POST /v1/notifications/read-all` is implemented (`notifications.ts:203-211`) and tested three times (`notifications.test.ts:522,583,613`) with **zero clients** — no `useMarkAllNotificationsRead` in `queries.ts`, no button anywhere. |
| **Expected** | Tappable rows once `data` is persisted; a "Mark all read" affordance in the inbox header. |

### P-5 · Any authenticated user can mark any notice read, including unpublished drafts — **MEDIUM**

| | |
|---|---|
| **Navigation** | `POST /v1/notices/:id/read` with any notice uuid |
| **Action** | Post a receipt for a notice targeted at a different city |
| **Observed** | `notices.ts:259-267` looks the notice up by id with **no visibility predicate** and inserts the receipt. It also returns 200 vs 404 on existence, which is an id oracle for drafts. Contrast the same file's read paths, which are scrupulously scoped. |
| **Expected** | Resolve the notice through `memberVisibility` / `adminFeedWhere` before recording the receipt. |

### P-6 · Push permission denial and registration failure are both invisible — **MEDIUM**

`mobile/lib/push.ts:58` — `if (status !== "granted") return null;` with no explainer before the OS prompt, no post-denial state and no Settings deep link. `getPermissionsAsync()` returns `canAskAgain` (`:52`) and it is discarded, so the app cannot distinguish "never asked" from "hard denied" — on iOS the second request resolves denied without a prompt and the user is stuck. Registration failures (including the 409 in X-4) are swallowed at `:82-86`. There is also **no `setNotificationChannelAsync`** anywhere, so on Android 8+ everything lands on the default channel at default importance — an `is_critical` notice gets the same treatment as a routine one — and no `addPushTokenListener`, so a rotated token is never re-registered. **Expected:** an explainer + recoverable denied state; an Android channel (a high-importance one for critical kinds); surface `ERR_PUSH_TOKEN_CLAIMED`.

### P-7 · Cold-start deep links race the navigator, replay stale taps, and leak a listener — **MEDIUM**

`_layout.tsx:219-260`. Four distinct problems in one effect: (a) the effect runs on mount while `RootLayout` still returns `null` until fonts resolve (`:262`), so `router.push` at `:240` can fire before the `<Stack>` exists; (b) `getLastNotificationResponseAsync()` is read on **every** launch and never cleared, so re-opening the app from the icon days later re-navigates to an old notification's route; (c) that call and `addNotificationResponseReceivedListener` (`:245`) are both armed with no dedupe by response identifier, so one tap can push twice; (d) `sub` is assigned *after* an `await`, so a cleanup that runs first sees `undefined` and the listener is never removed. **Expected:** gate on `useRootNavigationState()`, record handled identifiers, register the listener before the awaits.

### P-8 · Tapping a push while signed out lands on an authenticated screen — **MEDIUM**

`routeForNotificationData` always falls back to `/notifications`, and `app/notifications.tsx:84` calls `useNotifications()` with no auth gate — a signed-out user gets a 401 rendered as "Could not load notifications." rather than a sign-in redirect.

### P-9 · Members briefly see the guest feed — **MEDIUM**

`NoticesFeedScreen.tsx:58-70` — `isMember = !!user`, and while `AuthContext` hydrates `user` is null, so the member's screen renders `/v1/notices/public` results and then swaps; internal notices pop in a beat late and the list reflows. `useNotices()` also has no `enabled` guard (`queries.ts:244-248`), so the public feed is fetched on every mount even for signed-in members whose result is discarded.

### Medium / Low — member surfaces

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| P-10 | M | Hindi user reads the hub, inbox or feed | Missing `lineHeight` on Devanagari against CLAUDE.md's 22 px floor: `notifications.tsx:62-68` (the segment labels **अधिसूचनाएँ / घोषणाएँ**), `NotificationsInbox.tsx:43,44,51` (overrides `fontSize` with no `lineHeight` at all), `NoticesFeedScreen.tsx:107`. The sibling line `NoticesFeedScreen.tsx:103` sets `lineHeight: 22` correctly, so this is drift, not an unset convention. |
| P-11 | M | Hindi user navigates the module | Four renderings of two concepts: notices are **घोषणाएँ** in `notifications.tsx:31` and `NoticesFeedScreen.tsx:184` but **सूचनाएँ** in `_layout.tsx:94` and `admin/notices.tsx:550`; notifications are **अधिसूचनाएँ** (`notifications.tsx:30`), **इनबॉक्स** (`_layout.tsx:109`) and **सूचनाएँ** (`NotificationsInbox.tsx:78`). `NotificationsInbox` contradicts itself on one screen — error text says **सूचनाएँ** (`:78`), empty state says **अधिसूचना** (`:102`). |
| P-12 | M | Screen-reader user in the inbox | `NotificationsInbox.tsx:35` — a bare `<Pressable onPress … disabled={!isUnread}>` with **no `accessibilityRole`, no `accessibilityLabel`, no `accessibilityState`**. Once read it is announced as a disabled control with no explanation. |
| P-13 | M | Whole module | ~60 inline `hi ? "…" : "…"` ternaries across these five files; nothing imports the i18n package, against CLAUDE.md:581. Systemic — flagged once. |
| P-14 | L | Cold start with a persisted cache | `unread_count` is a page-0 snapshot (`queries.ts:1800-1801`) that never decrements client-side and is never refreshed on focus/AppState, so a cold start renders yesterday's count until the network lands. |
| P-15 | L | Any render | `queries.ts:1793-1804` builds a **new** `data` object and a **new** `items` array every render, which `NotificationsInbox.tsx:89` feeds straight into `FlatList data` — defeating its identity bail-out. `onPressRow` also depends on the whole `markRead` object, so every visible row re-renders on each tap. `useNotifications()` is additionally instantiated twice for the same screen (`notifications.tsx:84` + `NotificationsInbox.tsx:13`). |
| P-16 | L | Navigate to `/notices` or `/notifications` | `_layout.tsx:94,109` register titled stack headers while the screens draw their own `AppHeader` (`notifications.tsx:108-111`) — a second bar over the same screen. The file's own convention says otherwise at `:150-152`. `notices` is a pure `<Redirect>`, so it flashes a titled header before bouncing. ***Verify against `AppHeader`.*** |
| P-17 | L | Inbox date | `NotificationsInbox.tsx:45` and `NoticesFeedScreen.tsx:108` call `formatDate(...)` with no locale argument, while every other locale-sensitive value in these files threads `hi` explicitly. ***Verify `lib/format.ts`.*** |

**Solid here:** the inbox's keyset pagination is correct end to end, including the non-obvious details (cursor in `data` not `meta`, `unread_count` on page 0 only) with the reasoning written down at `queries.ts:1770-1780`. All three lists branch `isLoading → isError → empty` in that order with a retry, so a network failure is never presented as an empty state. The union narrowing at `NoticesFeedScreen.tsx:88` (`"audience" in n`) is genuinely careful. Push registration degrades gracefully in web, simulator, Expo Go and placeholder-projectId environments, with a dev-only explanation of why.

---

# 3. Shikshak (Guruji / Didi) — `role: shikshak`

`contracts.ts:203-209` puts `shikshak` in `ADMIN_PANEL_ROLES`; `requireAdminPanel` (`middlewares/auth.ts:89-96`) is the only gate on `GET /admin` and all three write routes, and `canSeeEverythingInScope` (`notices.ts:215-223`) lists shikshak explicitly. The sidebar agrees (`sidebar-nav.ts:102`, `min: 'shikshak'`). So a shikshak reaching `/admin/notices` is **intended**. What is not intended is which notices they can write.

### SH-1 · Can publish to, edit and delete any batch's notices at their centre — **CRITICAL**

| | |
|---|---|
| **Navigation** | Web `/admin/notices` → New notice → audience **Batch**; or `POST /v1/notices/admin` directly |
| **Action** | Select a batch taught by a different Guruji at the same centre |
| **Observed** | `notices.ts:392` — the only check for **both** `centre` and `batch` audiences is `if (!inScope(scope, effectiveCentreId))`. `inScope` is the centre-level helper (`route-helpers.ts:24-28`), and its twin in `scope.ts:143-146` is marked `@deprecated` — *"Prefer inCentreScope"*. A shikshak's `scope.batchIds` **is** populated (`scope.ts:86-111`) and is never consulted; the canonical gate `inBatchWriteScope` (`scope.ts:128-141`) is not imported by this file. `resolveTargetColumns` resolves the batch's centre (`:361`), `inScope` passes, published. `loadScoped` (`:508`) repeats the same centre-level test, so the same Guruji can **edit and delete** any centre- or batch-targeted notice at their centre — including a Sanchalak's centre-wide announcement. Q12 (CLAUDE.md:172-177) states the principle — "a shikshak decides only on … batches they are assigned to" — and it is enforced for niyam review and not here. |
| **Expected** | `case "batch"` → `inBatchWriteScope(scope, body.batch_id, effectiveCentreId)`; `case "centre"` → require `scope.batchIds === null` (sanchalak+), since a centre-wide broadcast is not a batch-bound action. Apply the same split in `loadScoped`. |

### SH-2 · A shikshak can publish a centre-wide notice at all — **HIGH**

Same line, different consequence. Every neighbouring centre-level write in this codebase carries a role floor above admin-panel access; `notices.ts` has none. A Guruji can address every family at the centre in the Sanchalak's voice, and the audit row (`:462-468`) records it after the fact rather than preventing it. **Expected:** an explicit `isSanchalakPlus` floor for the `centre` audience.

---

# 4. Sanchalak — mobile composer (`app/admin/notices.tsx`)

### SN-1 · The editor overwrites what the author is typing — **HIGH**

| | |
|---|---|
| **Navigation** | Mobile admin → **Notices** → Edit on any row |
| **Action** | Start typing a correction; a background refetch lands |
| **Observed** | `app/admin/notices.tsx:522-535` builds `initialForm` as a **brand-new object on every parent render**, and `:150-159` depends on it: `useEffect(() => { if (!open) return; setForm(initial ?? emptyForm()); … }, [open, initial]);`. Any parent re-render while the modal is open — the `useAdminNotices` background refetch, a mutation state change, `usePersistedCentreId` settling — recreates `initialForm`, re-runs the effect and **replaces the half-typed form with the original row**. It also re-issues `GET /v1/translate` and clears the machine-translation warnings each time. Create mode escapes only by luck (`initial` is a stable `null`). |
| **Expected** | `useMemo(..., [editing])` on `initialForm`; key the reset effect on `[open, editing?.id]`. |

### SN-2 · The batch picker shows the wrong centre's batches when editing — **HIGH**

| | |
|---|---|
| **Navigation** | Mobile admin → **Notices** → Edit a batch notice belonging to Centre A while the switcher is on Centre B |
| **Action** | Open the editor; optionally tap a batch chip |
| **Observed** | `centreBatches` is derived from the switcher (`:508-514`, `b.centre_id === selectedCentreId`) but the **list is not filtered by centre** (`:517-520` filters on audience only), and a Sanchalak's `adminFeedWhere` scope can span several centres. So the picker shows B's batches, `form.batch_id` (A's batch) matches none of them, no chip is highlighted, and the section looks empty while `batch_id` still silently points at A. Saving untouched re-submits A's batch under a UI that displayed B; tapping any visible chip **re-targets the notice into a different centre**. |
| **Expected** | Derive from `editing?.centre_id ?? selectedCentreId` — the same expression already used for `centreId` at `:672`. |

### SN-3 · The list says "No notices yet" while the API returned a full page — **HIGH**

| | |
|---|---|
| **Navigation** | Mobile admin → **Notices**, as a city_admin or state_admin |
| **Action** | Open the screen at a city with more than 100 notices |
| **Observed** | `queries.ts:1384` fetches `?limit=100`, then `:517-520` throws rows away client-side: `all.filter(n => n.audience === "centre" \|\| n.audience === "batch")`. For a city+/state+ caller `adminFeedWhere` (`notices.ts:231-250`) also returns national, msv, state and city rows — so 100 city-level notices produce an empty filtered set and the screen renders `"No notices yet."` (`:596`) on top of a successful, full response. |
| **Expected** | A server-side `audience` filter param, or fetch until the filtered set is non-empty. |

### Medium / Low — mobile composer

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| SN-4 | M | Type "31/12/2026" in **Ends on** | `:463-468` is a bare `TextInput` — no placeholder, no `keyboardType`, no picker, no format hint. `endsOnToIso` (`:77-82`) returns `null` on `NaN`, and the server reads null as **never expires** (`notices.ts:457`). The admin gets a success toast for a notice that will never come down. **Expected:** validate before submit with the same `Alert` used for the other two rules, or use a date picker. |
| SN-5 | M | Same notice, two authors, two devices | Mobile has **no `is_public` control at all** (`:57` sets `false`, `:217` sends it, no `Switch` exists in 691 lines) while web defaults it to `true` and exposes a checkbox. The identical authoring action produces opposite public visibility depending on which client was used. See G-1. |
| SN-6 | M | Try to save a draft or schedule a notice | `NoticeWriteBody` (`queries.ts:1708-1720`) has no `publish_now` / `publish_at`, and neither does the web body (`NoticesAdminPage.tsx:153-169`). `resolvePublishedAt` (`notices.ts:67-71`) always falls through to `new Date()`. A shipped, migrated, tested feature (`notices.test.ts:375-431`) is unreachable from **any** UI. **Expected:** expose it, or drop the columns. |
| SN-7 | M | Scroll a centre with 100 notices | `:599-664` maps up to 100 cards into one `ScrollView` — precisely the pattern `NoticesFeedScreen.tsx:82-83` documents as fixed for a 50-item feed (GST-PRF-02), at double the count. |
| SN-8 | M | Any failure | `:653` and `:679` fall back to the literal `"Action failed"` — English-only on a Hindi-first app — and pass through server strings that are themselves English-only (`notices.ts:60-61,393`). |
| SN-9 | M | Screen-reader / large-text user | Audience chips (`:373-400`) and batch chips (`:418-438`) convey selection **only via `backgroundColor`**, with no `accessibilityRole` or `accessibilityState` — while the hub segment at `notifications.tsx:50-61` does it correctly. Touch targets: segments ≈37 pt (`notifications.tsx:56-60`), audience chips ≈40 pt (`:382-387`), translate links ≈22 pt with no `hitSlop` (`:273-283`). Text inputs have no `accessibilityLabel` and the `Field` label (`:103-120`) is an unlinked sibling. |
| SN-10 | M | Delete one row | `:635` correctly spins only the matching row, but every **other** Delete button stays live during an in-flight delete, and no mutation is optimistic (`queries.ts:1726,1735,1743` all just invalidate), so a deleted row sits on screen until the refetch lands. |
| SN-11 | L | Compose after creating a batch elsewhere | `:570-574` refreshes notices and centres but **not** batches, so a new batch never appears until app restart. |
| SN-12 | L | Open the screen with no centre selected | `:555` renders a greyed "लिखें / Compose" with no hint that a centre must be picked first — against CLAUDE.md:585 ("Errors must state the problem AND the fix"). |
| SN-13 | L | Any raw `<Text>` in the composer | `:247` (**बंद करें**) is the only one with no `fontSize` and no `lineHeight`; every sibling sets `lineHeight: 22`. |

**Solid here:** bilingual validation is actually enforced before submit (`:195-203`), which web does not do (CA-6); the machine-translation guard is shown and correctly cleared on manual edit (`:266-269, 300-306`); delete is behind a destructive confirm; and `isoToEndsOn`/`endsOnToIso` (`:63-82`) pin `Asia/Kolkata` correctly, matching both the server and the web helper.

---

# 5. City admin / State admin — web composer (`NoticesAdminPage.tsx`)

### CA-1 · Edit and Delete render on rows that can only ever 404 — **HIGH**

| | |
|---|---|
| **Navigation** | Web `/admin/notices` as a city_admin |
| **Action** | Click Edit on the super_admin's national notice sitting in the list |
| **Observed** | `adminFeedWhere` unconditionally seeds every non-super-admin's list with national **and** msv rows (`notices.ts:234`), and the page renders actions with no predicate (`NoticesAdminPage.tsx:546-547`). `loadScoped` (`:504-517`) has no branch for those audiences below super_admin, so both edit and delete return **404 "Notice not found."** — which `notices.test.ts:189-196` asserts as correct. The dialog then opens with audience `national`, which is not in `audiencesForRole('city_admin')` (`:69`), so no `SelectItem` matches and the trigger renders **blank**. The author retypes the notice, saves, and is told the notice does not exist. It does; they simply may not touch it. |
| **Expected** | Derive an `editable` flag per row (super_admin, or audience ∈ allowed **and** target in scope) and hide or disable the controls with a reason — or return `can_edit` per row from the server. Never render a control whose only outcome is a 404. |

### CA-2 · Drafts and scheduled notices sort to the top and look live — **HIGH**

| | |
|---|---|
| **Navigation** | Web `/admin/notices` |
| **Action** | Scan the list for what is actually published |
| **Observed** | `ORDER` is `[desc(pinned), desc(published_at), desc(created_at)]` (`notices.ts:51`) and `/admin` applies **no** `LIVE` filter (`:311`). Postgres sorts NULLs first under `DESC`, so `published_at IS NULL` drafts sort **above every live notice**; future-dated scheduled rows sort next. The table's column is headed "Published" and renders `fmtDate(n.published_at ?? n.created_at)` (`NoticesAdminPage.tsx:543`) — so a draft displays its **creation** date under a "Published" heading — and the badge row carries only Pinned / Important / Expired (`:535-537`). There is no Draft pill and no Scheduled pill. An author reading that row concludes the notice is live to parents; it is invisible on `/feed` and `/public`. |
| **Expected** | `published_at == null` → render "Draft" (never fall back to `created_at`); `published_at > now` → "Scheduled · <date>"; add `nullsLast()` to the admin ordering. |

### CA-3 · "MSV members" is offered to roles the server refuses — **MEDIUM**

`audiencesForRole` returns `msv` for both `state_admin` and `city_admin` (`NoticesAdminPage.tsx:68-69`), while `authorizeWrite` restricts `national` **and** `msv` to super_admin (`notices.ts:407-409`). A city_admin composes a full bilingual notice and gets a 403 on submit — which is precisely the regression the function's own docstring says it fixed (`:61-65`): *"the dialog offered everything and defaulted to National, so a sanchalak composed a full notice and only then got a 403."* The fix removed `national` from the lower roles and left `msv`, which has the identical rule.

### Medium / Low — web composer

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| CA-4 | M | `/admin/notices` during a 500 | `NoticesAdminPage.tsx:516` renders the error banner and `:526` renders "No notices yet." beneath it — the empty-row condition never consults `error`. **Expected:** `{!error && items.length === 0 && !loading ? … }`. |
| CA-5 | M | Scroll past 200 notices | The page wires an `AdminLoadMore` footer to `loadMore()` (`:523`), but `GET /admin` reads only `limit` (`notices.ts:284`) and returns `{items}` + `meta.count` with **no cursor** (`:323`). Either the footer is dead code or it re-fetches page 1. Every other admin list in this codebase already uses `encodeTimeCursor`/`decodeTimeCursor` (`route-helpers.ts:37-52`). |
| CA-6 | M | Publish English-only from the web | `canSubmit = form.title_en.trim().length > 0 && targetValid(form)` (`:254`); only `title_en` is `required`, and the Hindi title's placeholder literally reads **शीर्षक (वैकल्पिक)** — "optional". Mobile refuses to save without all four (`app/admin/notices.tsx:195-203`), and CLAUDE.md:576 requires `_en` and `_hi` for all user-facing content. Every Hindi-preference parent then reads the English text via the fallback chain — on a Hindi-first product with a working "Translate to Hindi" button one click away (`:361-375`). |
| CA-7 | M | Any partial `PATCH /v1/notices/admin/:id` | `notices.ts:587-589` sets `is_public: body.is_public ?? false`, `pinned: … ?? false`, `is_critical: … ?? false` — the canonical PATCH verb with full-replace semantics. The module's own test does this without noticing (`notices.test.ts:138-142` patches title+content and thereby un-publishes and un-pins the notice). Web is safe only because it always sends the full body. A contract landmine. **Expected:** treat undefined as "unchanged", as `expires_at` already does at `:548-553`. |
| CA-8 | M | Screen-reader user opens the composer | `FormRow` (`:79-81`) renders `<Label>` as a **sibling** with no `htmlFor`, and no control has an `id` — `htmlFor` appears zero times in the staged web sources. All eleven fields are affected; the `Select` triggers additionally have no `aria-label` and an empty `SelectValue` until chosen, so they are entirely unnamed. |
| CA-9 | M | Super admin picks a centre at national scale | `:213-214` fetch `/v1/admin/centres` and `/v1/admin/batches` with **no `limit`**, while every admin list route clamps to a small default (the notices test itself has to pass `?limit=300` to enumerate them). Both are plain `Select`s with no typeahead. A centre beyond the first page is simply absent with no explanation. ***Verify the two routes' `clampLimit` defaults.*** |
| CA-10 | L | Pick an end date in the past | `:430-435` has no `min`, and `canSubmit` (`:254`) ignores expiry — so the round trip is required to learn it. The server's message is good (`notices.ts:60-61`); the client just doesn't pre-empt it. |
| CA-11 | L | State admin scans the list | `:496-497` can only name centres and batches; `state_id`/`city_id` are selected by the server (`notices.ts:295-296`) but no `states`/`cities` join supplies names, so every geographic notice shows a bare "State" / "City" pill. |
| CA-12 | L | Delete a notice with the keyboard | `:457-468` — Radix restores focus to the `DialogTrigger`, which lives inside the row that `reload()` just removed, so focus falls back to `<body>` and the user is dropped to the top of the admin shell. |
| CA-13 | L | Any error toast | `:263-274, 461-465` are English-only ("Failed to publish notice."), consistent with the whole admin panel — but they also carry no fix, against CLAUDE.md:434. |

**Solid here:** the audience → target-column mapping is correct in every branch on both sides — `toBody`/`targetValid` (`:153-177`) send exactly one id, and `resolveTargetColumns` (`notices.ts:333-370`) nulls the rest so re-targeting on edit can never leave stale scope columns. `AdminRouteGuard` (`AdminRoutes.tsx:98-117`) derives its floor from the single `ADMIN_NAV` source and shows a named "Restricted page" card. Delete has a real confirmation with the title and an irreversibility warning. Every control is a real interactive element inside a Radix dialog, so focus trap and keyboard operability are inherited rather than reimplemented.

---

# 6. Super admin — module-level structure

| # | Sev | Navigation → Action | Observed vs Expected |
|---|---|---|---|
| SU-1 | H | Delete a city, state, centre or batch | `schema/notices.ts:18,19,20,23` — all four scope FKs are `onDelete: "cascade"`. Deleting a geography or org row **silently hard-deletes every announcement that ever targeted it**, and cascades onward through `notice_reads`. It is worse for `centre_id`: batch notices denormalise their batch's centre (`notices.ts:361`), so deleting one centre destroys both centre- and batch-targeted history. Every *intentional* delete is audited (`:622-627`); this path produces no audit row at all. **Expected:** `set null` (degrading the notice to a draft) or `restrict`. |
| SU-2 | M | Delete a notice | `notices.ts:620` is a hard `db.delete`, and `notices` has no `deleted_at` — while `students`, `batches` and `centres` all do. The audit summary is the bare string `"Deleted notice."` (`:626`), which captures none of the content. **Expected:** soft delete, or at least record the content in the audit metadata. |
| SU-3 | M | Ask "who published this?" | `notices.created_by` is written at `:458` and **never selected anywhere** (repo-wide grep returns the schema line and that one write). There is no `updated_by` at all. Authorship is answerable only from `audit_logs`. |
| SU-4 | M | Publish a notice marked **Important / महत्वपूर्ण** | Nothing happens beyond a coloured pill. `notices.ts` never imports `notifyUsers`, and there is no `notice` member in `notification_kind_enum`. Delivery is pull-only. Plausibly deliberate — but the checkbox reads like it isn't, and `is_critical` doesn't even affect list ordering (`ORDER` at `:51` is pinned-first), so a critical notice sorts below any pinned routine one. |

---

# 7. Emitter matrix

One row per emitter, so gaps are comparable at a glance.

| Emitter | Audience correct? | Via `notifyUsers`? | Idempotent? | Off request path? | Deep link works? |
|---|---|---|---|---|---|
| `niyam-approve.ts` | ✅ parent + child (Q4) | ✅ | ✅ status claim | ✅ post-commit | ❌ no `route` |
| `shivir-notify.ts` (announce) | ✅ city + MSV filter | ✅ | ✅ `announced_at` | ✅ queued | ❌ |
| `shivir-notify.ts` (scan) | ⚠️ parent only | ✅ | ⚠️ retry re-sends | ✅ queued | ❌ |
| `homework-notify.ts` | ⚠️ parent only | ✅ | ❌ | ⚠️ in-request | ❌ |
| `quiz-notify.ts` | ⚠️ no `deleted_at` filter | ✅ | ❌ | ❌ **in-request, unbounded** | ✅ (only one) |
| `gallery-wall-notify.ts` | ⚠️ 1st child only | ✅ | ❌ | ⚠️ inline without Redis | ❌ |
| `join-notify.ts` | ❌ can be empty | ✅ | ❌ | ✅ | ❌ no id at all |
| `punya-tier-notify.ts` | ⚠️ parent only | ✅ | ✅ tier transition | ✅ (`punya.ts:361`) | ❌ |
| `niyam-badges.ts` | ❌ parent only by signature | ✅ | ✅ badge unique | ✅ in-tx award | ❌ |
| `library-requests-admin.ts` | ⚠️ publish only, no reject | ✅ | ❌ terminal-first | ✅ | ❌ |
| `consecutive-absence.ts` | ✅ parent + sanchalak + city | ✅ | ✅ alert row | ✅ cron | ❌ empty payload |
| `attendance-post-process.ts` | ✅ | ✅ | ✅ AT31 debounce | ✅ | ❌ no `route` |
| `runBirthdayWishes` | ⚠️ twins merged wrong | ⚠️ inbox bypasses gate | ✅ 3 layers | ✅ cron | ❌ |

---

# 8. Tests — what would still pass if the code broke

The suites are large (2 036 lines) and mostly good. These specific tests cannot fail:

| # | Sev | Test | Why it can't fail |
|---|---|---|---|
| T-1 | H | `notifications.test.ts:633` — keyset paging | `new Date(Date.UTC(2024, 5, 1, 12, 0, i))` puts `i` in the **seconds** field, so all five rows get distinct `created_at`. The `and(eq(created_at, cursor.createdAt), lt(id, cursor.id))` tie-break (`notifications.ts:151`) — the entire reason `id` is in the cursor, and the reason migration `0046` exists — is never executed. Delete that clause and the suite stays green, while a `notifyUsers` batch insert (which stamps N rows with one `now()`) drops or repeats rows at page boundaries. |
| T-2 | H | `notifications.test.ts:683` — "a cursor from another user's inbox returns nothing" | The previous test's `finally` deleted all of userA's rows (`:679`), so at cursor time userA owns exactly one row and **the cursor points at it**. `[]` comes back whether or not `eq(notifications.user_id, uid)` is in the query. Remove the user scoping from the inbox and this test still passes. |
| T-3 | H | `notifications.test.ts:238-242` — mark-read idempotency | Asserts only `status === 200`. The contract is the **timestamp** (`notifications.ts:232`, "re-calling keeps the timestamp"). Remove the `if (!row.read_at)` guard and every re-read overwrites `read_at`; this test still passes. `notices.test.ts:287` does it correctly — `expect(rowAfter2.read_at).toBe(rowAfter.read_at)`. |
| T-4 | H | `notices.test.ts:229-242` — foreign-city exclusion | `memberVisibility` only adds the city clause `if (args.cityId)` (`notices.ts:127`). If the parent's `city_id` were null, or if the clause were deleted outright, the Ahmedabad notice is excluded anyway. And **no test asserts a member sees a notice targeted at their own city or state** — so the entire geography half of `memberVisibility` can be removed without a red test. |
| T-5 | H | `notices.test.ts:171-183` — city_admin authz | Only the two **deny** paths are asserted. `authorizeWrite`'s allow branches for city (`:400`), state (`:397`) and centre/batch (`:392`) have no test at all. Replace the whole `case "city":` block with a 403 and the suite stays green while every city_admin loses the ability to publish. |
| T-6 | H | `adminFeedWhere` (`notices.ts:231-250`) | **Never executed by any test.** No test calls `/feed` or `/admin` as super_admin, state_admin, city_admin, sanchalak or shikshak. Both failure directions — an admin sees the whole country, or sees nothing — are silent. |
| T-7 | M | `notifications.test.ts:954-973` — "FIX #7, the push payload carries kind and entity id" | Asserts on a `vi.spyOn(pushModule, "sendPush")` mock — i.e. re-asserts `const data = { kind, ...opts.data }` (`notify.ts:100`), the line directly above the mocked call. It proves nothing about deep links, which are broken end-to-end (X-9). The name claims coverage of a capability that does not exist. |
| T-8 | M | `notifications.test.ts:217` and five siblings | `expect(unread_count).toBeGreaterThanOrEqual(1)` is satisfied by a count that dropped the `user_id` filter and counted every user's unread rows. Only `:532` (`toBe(0)`) pins it, and only after mark-all-read. |
| T-9 | M | Advisory locks, both sites | `notifications.ts:72` (push-token) and `:324` (birthday) exist solely to survive autoscale. **Neither is ever contended by a test** — every call is serial. Remove `pg_advisory_xact_lock` from both and nothing goes red; production gets duplicate birthday inboxes and a lost token claim. |
| T-10 | M | Enum drift | `NotificationKind` derives from the TS array `NOTIFICATION_KINDS` (`enums.ts:161`); the Postgres type is mutated by hand-written `ALTER TYPE … ADD VALUE` files. **Nothing ties them together** — zero occurrences of `enum_range` or `pg_enum` in any `.ts` file. Adding a kind to the array without a migration produces `invalid input value for enum` on the insert at `notify.ts:73` — i.e. a 500 on the *user-facing action*, not on a background job. One test closes this permanently. |
| T-11 | L | `notices.test.ts:184` | Bare `expect(status).toBe(403)` with no error-code assertion, unlike its sibling at `:176` — a 403 from `requireAdminPanel` for an entirely different reason is indistinguishable. |
| T-12 | L | `notifications.test.ts:929` | Asserts migration `0044`'s `SET NOT NULL` by inserting through `db` directly, bypassing every route. It tests Postgres, not the application — and no application path can produce a Hindi-less row anyway, since `notifyUsers` requires both in its TS signature. |

**Untested behaviours worth adding, ranked:** `authorizeWrite` allow-branches (all four roles) · `adminFeedWhere` for all five admin roles · batch → `centre_id` denormalisation · `msv` audience end-to-end · future `publish_at` scheduling · `POST /admin/:id` (the web-only alias — every test uses PATCH, so the entire web edit flow can break green) · birthday backfill for a non-today date (`notifications.ts:335` dedupes on `now()`, not on the `today` argument, so a manual backfill either double-sends or does nothing) · the 409 push-token path under concurrency · `notice_reads` cascade on delete · `clampLimit` on all four list endpoints.

---

# 9. Schema, indexes and migrations

| # | Sev | Finding |
|---|---|---|
| DB-1 | H | **`notifications` has no `data`/`entity_id` column.** `notifyUsers` accepts `data` (`notify.ts:45`) and merges it into the push only (`:100`). Eight emitters build real payloads that die with the push. Root cause of X-9. |
| DB-2 | H | **The retention prune has no index.** `retention.ts:52-65` seq-scans and top-N sorts the whole table per 5 000-row batch. Wants `CREATE INDEX … ON notifications (created_at) WHERE read_at IS NOT NULL;` |
| DB-3 | H | **`0049_notice_scheduling.sql` is the only non-idempotent migration in the set** — no `IF NOT EXISTS` on the column (`:1`), the constraint (`:2`) or the index (`:8`), and **no `--> statement-breakpoint` markers at all**, so its three statements go to the driver as one string. A partial failure (most plausibly on the index) leaves a retry aborting on `column "expires_at" … already exists`. Every other migration here is guarded. |
| DB-4 | M | **`notices.audience` is unindexed.** Both `/feed` (`notices.ts:175`) and `/admin` (`:311`) run a six-way OR over `audience` plus per-column equality; with no access path for the `national`/`msv` disjuncts the BitmapOr can't form and the per-column indexes go unused. |
| DB-5 | M | **Redundant index.** `idx_notifications_user_created` (user_id, created_at) is a strict prefix of `idx_notifications_user_created_id` added by `0046`. The hottest insert path in the app maintains three B-trees where two suffice. The schema comment at `notifications.ts:62` shows awareness of exactly this pattern one generation earlier ("subsumes old `idx_notifications_user`"). |
| DB-6 | M | **Index direction drift.** `0046:2-3` deploys `(user_id, created_at DESC, id DESC)`; `schema/notifications.ts:65-69` declares all-ASC. Runtime is unaffected (backward scan), but `drizzle-kit generate` will emit a spurious drop-and-recreate on the app's highest-traffic index — with an ACCESS EXCLUSIVE lock unless someone remembers `CONCURRENTLY`. |
| DB-7 | M | **`notices.title_hi` is nullable while `notifications.title_hi` is NOT NULL** (`0044`). The two clients disagree accordingly: mobile refuses to submit without it, web calls it optional (CA-6). |
| DB-8 | L | **Write-only columns:** `notices.created_by` (never read), `notices.updated_at` (never read), `notifications.updated_at` (never written *or* read — `read-all` and `:id/read` both leave it stale, which is actively misleading), `device_push_tokens.platform` (written three times, never read). |
| DB-9 | L | **`push_receipts.expo_token` has no FK** to `device_push_tokens.expo_token`, which does carry a unique index. A deleted token leaves receipts that sweep to nothing. |
| DB-10 | L | **Declared-but-unemitted kinds:** `competition`, `service_request`, `exam`, `attendance_streak`, `donation`. `0095:7-8` already documents `attendance_streak` as dead ("a declared kind that nothing ever sent (M5)") and it is still dead. |
| DB-11 | L | **`/public` orders by `published_at` but never selects it** (`notices.ts:88-100`), so the client renders `created_at` against a `published_at` sort. |

**Migration hygiene worth preserving:** every `ALTER TYPE … ADD VALUE` sits in its own file with `IF NOT EXISTS` and a comment explaining why it is isolated (`0045`, `0072`, `0075`, `0082`, `0095`) — that is correct, since the value can't be used in the transaction that adds it. `0044` backfills before tightening and says why (`:2`).

---

# 10. Fix order

**Ship-blockers**

1. **X-1** — split the push channel gate from the kind gate in `notify.ts`. One-line cause, eleven-kind blast radius, and it silently defeats the durable-inbox design.
2. **X-2 + X-3** — bound the absence window to past sessions **and** switch to `count(*) filter (where status = 'absent') = 3` in the same change. Fixing one without the other turns a dead feature into a wrong one.
3. **X-4** — add a push-token deactivation route and call it on sign-out; surface `ERR_PUSH_TOKEN_CLAIMED`.
4. **SH-1** — `inBatchWriteScope` for the batch audience in both `authorizeWrite` and `loadScoped`; a sanchalak+ floor for the centre audience.
5. **G-1** — default `is_public: false` on web; decide whether `/public` should carry audience context or refuse non-national audiences.

**Next**

6. **X-5, X-6, X-7, X-14** — the push transport set: narrow `DEAD_TOKEN_ERRORS`, stamp only received receipts, chunk the fan-out, per-chunk error handling. All four are inside two files.
7. **X-9 + DB-1** — add `notifications.data jsonb`, persist it, and route on `kind` client-side. This is what makes the inbox worth opening.
8. **X-10 + X-12** — per-recipient `.catch()` and dropping unknown ids; together they stop one bad row from losing a whole day's sends.
9. **P-1, P-2, P-3** — the three mobile inbox/feed defects a parent hits on day one.
10. **CA-1, CA-2, SN-1, SN-2, SN-3** — the authoring surface: don't render controls that 404, label drafts, stop overwriting typed input, fix the batch picker's centre, stop truncating before filtering.

**Then**

11. **T-1 … T-6** — six tests that currently cannot fail, each guarding a behaviour with its own FIX number, migration or code comment. Plus **T-10**, the enum-drift test: one test, permanently closes a class of 500s on user-facing actions.
12. **X-15, X-16** — idempotency claims and the Q4 dual audience across the four emitters missing them.
13. **DB-2, DB-3, DB-4, SU-1** — the retention index, `0049`'s idempotency, the `audience` index, and the cascade FKs that can erase announcement history without an audit row.
14. Everything else in the Medium/Low tables.

---

## What's solid — worth protecting in any refactor

- **`services/niyam-approve.ts:247-263`** is the reference emitter: dual audience (parent + the child's own Q4 login, deduped), fired strictly after the transaction commits and after the audit write, `.catch()`-guarded so an approval never fails on notify, and idempotent via the `status = 'pending'` claim at `:159`.
- **`shivir-notify.ts:141-169`** — a real at-most-once claim (`UPDATE … SET announced_at … WHERE announced_at IS NULL … RETURNING`) with the at-most-once/at-least-once trade-off argued in the docblock, a properly narrowed audience, and the fan-out correctly pushed onto `QUEUE_NAMES.PARENT_NOTIFY`.
- **`runBirthdayWishes` idempotency** — a transaction-scoped advisory lock on `birthday-wishes:<IST date>`, a per-(user, IST day) dedupe probe, and queue-level `dailyCronJobId("birthday", todayIst())` underneath. Three independent guards against the autoscale double-fire, with the reasoning written down, and the cron correctly split out of the router so importing the HTTP routes doesn't schedule work on every instance.
- **Per-recipient language inside a batched send** — `notify.ts:103` picks `title_hi`/`body_hi` per token rather than per call, so one batch is never one hardcoded language. Every `_hi` string across all twelve emitters is genuine Devanagari, not English copied across, and `0044` makes that structural with a backfill-then-`SET NOT NULL`.
- **Inbox keyset pagination**, end to end: validated opaque cursor, matching index from `0046`, `unread_count` on page 1 only, every query scoped to `req.authUser.id`, 422 on a bad cursor rather than a silent reset — and the client (`queries.ts:1770-1805`) matches it exactly, including the non-obvious details.
- **The push-token claim** is done under an advisory lock with a **409 and a user-actionable message** rather than silently stealing another account's device — the right call, undermined only by the client swallowing it (X-4).
- **Notice targeting** — `resolveTargetColumns` nulls every non-matching scope column, so re-targeting on edit can never leave stale targeting; batch notices denormalise their centre so one filter serves both audiences; expiry is enforced in three places that agree (DB CHECK, `expiresAfterPublish`, both write paths) with a message that states the problem *and* the fix; out-of-scope rows 404 rather than 403; every mutation is audited; mark-read is genuinely idempotent against a unique index.
- **Error state is never rendered as empty state** on any of the three lists, or on the public web page. That is the thing that is usually broken, and here it isn't (except on the admin list — CA-4).
- **`push-quiz-feed.ts`** — the two-audience split (lifecycle to the namespace, roster to the `staff` room) reuses the same visibility predicates as the HTTP paths, matching the spec line for line.
- **Failure isolation as a policy** — every emitter treats push as best-effort and refuses to fail the user-visible action, and each says why in a comment. The policy is right; the defects above are places where "best-effort" swallows more than it should.
