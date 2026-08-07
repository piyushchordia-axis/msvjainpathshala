# Sanchalak round 2 — Cursor fix prompts

**Date:** 2026-08-07
**Scope:** five Sanchalak-reported defects across Notices, Niyam, Requests, Report generation and the Punya Wall — six prompts (Notices needs two).

Every prompt assumes Cursor has `CLAUDE.md` in context. If it does not, prefix with:

> Read `CLAUDE.md` before making any change. Pay attention to the bilingual requirements, the design-system token rules, the error-voice rule, and Q5/Q6.

**Migration numbering — read this first.** The next free number is **0049**. `lib/db/migrations/` currently contains **two files numbered 0043** (`0043_push_receipts.sql` and `0043_per_batch_rate_functions.sql`), and only `0043_push_receipts` is registered in `meta/_journal.json`. `0043_per_batch_rate_functions.sql` is an orphan that has never been applied. Do not renumber it as part of these prompts — flag it separately — but do not use 0043 either.

---

## Triage summary

| # | Report | Verdict | Real cause |
|---|---|---|---|
| 1 | Notice: no end date / expiry | **Confirmed** | No expiry column exists. `published_at` is a sort key only — it is never used as a predicate. Nothing ever hides a notice; once created it is visible forever until hard-deleted. |
| 2 | Notice: no EN→HI auto-translation | **Confirmed** | No translation capability exists anywhere in the repo. Every `_hi` field in every compose form is typed by hand. |
| 3 | Niyam: submitted content not viewable | **Partly misdiagnosed** | The reviewer queues *do* return signed proof URLs and render photos. Four real gaps sit elsewhere — see prompt 3. |
| 4 | Rename "Service requests" → "Requests" | **Confirmed, plus worse** | The same feature is called three different things: "Service requests" (admin), "My requests" (parent), "Open requests" (dashboard KPI). Zero of it is in `lib/i18n`. |
| 5 | Report generation not working | **Confirmed — root cause found** | Devanagari font `readFileSync` resolves to a non-existent path in the esbuild bundle, and `assets/` is never copied into the Docker image. Job is caught and written as `status:'failed'`. |
| 6 | Punya Wall not working | **Confirmed — root cause found** | `users.gallery_visibility_opt_in` has **no write path in production code**. The public wall query hard-requires it. Every row is excluded, always. |

Two of these (5 and 6) are single-cause defects with a definite fix. Confirm each in production before shipping:

```sql
-- Confirms #5: expect an ENOENT string mentioning NotoSansDevanagari
SELECT status, error_message, created_at
FROM centre_monthly_reports ORDER BY created_at DESC LIMIT 5;

-- Confirms #6: expect 0
SELECT count(*) FROM users WHERE gallery_visibility_opt_in;
```

---

## 1 — Notice end date / expiry

```
Read CLAUDE.md (bilingual requirements, error-voice rule), then:
  lib/db/src/schema/notices.ts
  apps/api-server/src/routes/v1/notices.ts        (ORDER line ~47, /public ~52, /feed ~110,
                                                   /admin ~246, noticeBodySchema ~286,
                                                   create ~397, editNotice ~482)
  apps/api-server/src/routes/v1/admin-resources.ts (the SECOND notice implementation:
                                                   createNoticeSchema ~1697, POST ~1711)
  apps/jain-pathshala/src/pages/admin/NoticesAdminPage.tsx
  apps/jain-pathshala-mobile/app/admin/notices.tsx

THE BUG
`notices` has exactly one domain date column — published_at (created_at/updated_at come from
the timestamps() helper) — and it is used ONLY as a sort key. Every occurrence that touches
the notices table: notices.ts:47,152,170,268,280,433 and admin-resources.ts:138,142,147,1758.
All of them are desc() ordering, a select projection, an ISO serialisation, or the insert
value. Not one is a WHERE predicate. (published_at also appears in competitions.ts and
registration.ts — different tables, also never predicates, out of scope here.)

There is no expiry column at all. A Sanchalak announcing "Pathshala closed this Sunday"
posts a notice that is still on the parents' feed in March.

There is a second, live bug in the same area. The legacy POST /v1/admin/notices takes
publish_now (admin-resources.ts:1697) and writes published_at = null when false — but
GET /v1/notices/public filters on is_public alone (notices.ts:66) and /feed filters on
audience/scope alone. A "draft" notice is therefore immediately public. Fix both together;
they are the same missing predicate.

=== Migration: lib/db/migrations/0049_notice_scheduling.sql ===

  ALTER TABLE notices ADD COLUMN expires_at timestamptz;
  ALTER TABLE notices ADD CONSTRAINT notices_expires_after_publish
    CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at);

  -- Feed queries filter on (published_at, expires_at) on every read.
  CREATE INDEX idx_notices_active ON notices (published_at DESC, expires_at)
    WHERE expires_at IS NULL OR expires_at > now();

Nullable, not defaulted. A notice with no end date never expires — that is the correct
default for a standing announcement ("Pathshala timings"), and back-filling an arbitrary
expiry onto existing rows would silently hide live notices on deploy.

Append the journal entry to lib/db/migrations/meta/_journal.json (idx 49).

=== Schema: lib/db/src/schema/notices.ts ===

Add after published_at:
  expires_at: timestamp("expires_at", { withTimezone: true }),

=== API: one shared visibility predicate ===

notices.ts has ORDER as a shared const at line ~47. Add a sibling next to it:

  /** A notice is live when it is published and has not expired. */
  const LIVE = and(
    sql`${notices.published_at} is not null`,
    sql`${notices.published_at} <= now()`,
    or(isNull(notices.expires_at), sql`${notices.expires_at} > now()`),
  );

Apply LIVE to /public (line ~66) and /feed (line ~110). DO NOT apply it to /admin
(line ~246) — an admin must be able to see and re-open an expired notice. Instead add
a computed `is_expired` boolean and `expires_at` to the /admin serialiser so the list
can show an "Expired" pill.

Adding published_at <= now() to the predicate is what makes publish_now:false actually
mean draft. Verify with the test named in the exit criteria.

=== Zod ===

lib/api-zod/src/contracts.ts currently has ONE notice schema — noticeItemSchema at :467,
a read shape for the public feed. The write validation lives inline in TWO route files
(notices.ts:286 and admin-resources.ts:1697) and they have already diverged: the
admin-resources copy has publish_now but is missing batch_id, state_id and city_id.

Do not add expires_at to both copies. Move the write shape into lib/api-zod as
noticeWriteSchema, add expires_at (z.string().datetime().nullable().optional()) and
publish_at, and import it in both route files. If admin-resources.ts:1711 can be deleted
outright in favour of notices.ts:397, do that instead and say so — but check for callers
first (apps/jain-pathshala/src/pages/admin/AdminListPages.tsx:169-290 posts to it, though
that component is unrouted dead code).

Reject expires_at <= published_at with ERR_VALIDATION_FAILED and a message that states the
problem AND the fix: "The end date must be after the publish date — pick a later date."

=== Web UI: NoticesAdminPage.tsx ===

Add a date field after the is_critical checkbox (~line 279), labelled
"Ends on (optional)" with helper text "Leave blank to keep this notice up indefinitely."
Sentence case, no emoji, tokens only. Add an "Expired" pill to the list rows using the
is_expired flag from the API.

=== Mobile UI: app/admin/notices.tsx ===

Same field in NoticeEditor (~line 296, beside the Pinned / Critical switches). Use the
existing Card/Row/Switch primitives and colours from constants/colors.ts — no hex literals.
While you are in this file, fix the adjacent bug: NoticeWriteBody at :142-153 never sends
is_public, so the API default (body.is_public ?? false, notices.ts:430/522) silently flips
a public notice to internal whenever a Sanchalak edits it from mobile. Send the existing
value through on edit.

EXIT CRITERIA
  pnpm db:generate && pnpm db:migrate
  pnpm typecheck
  pnpm --filter @workspace/api-server run test
  New tests, all shown passing:
    - an expired notice is absent from /v1/notices/public and /v1/notices/feed
    - the same notice IS present in /v1/notices/admin with is_expired: true
    - a notice created with publish_now:false is absent from /public   ← this fails today
    - expires_at <= published_at returns 400 ERR_VALIDATION_FAILED
```

---

## 2 — Notice auto-translation EN→HI

```
Read CLAUDE.md (Bilingual requirements — "Hindi must use proper Devanagari, transliteration
is never acceptable"; "Jain religious terms stay in Devanagari even in EN locale"), then:
  apps/api-server/src/routes/v1/notices.ts
  apps/jain-pathshala/src/pages/admin/NoticesAdminPage.tsx   (fields ~256-266, canSubmit ~163)
  apps/jain-pathshala-mobile/app/admin/notices.tsx           (fields ~182-207, validation ~126)
  lib/i18n/src/index.ts

CONTEXT
There is no translation capability anywhere in this repo. lib/i18n is a static catalogue
lookup (t(path, locale, vars)) over en.json / hi.json — it translates UI chrome, never user
content. There is no AI_SERVICE_URL, no LLM SDK, no OpenAI/Anthropic key in .env.example.
Every hit for "translate" in the codebase is a Tailwind translate-x utility class.

So this is a new capability, not a repair. Build it as a reviewed suggestion, never a
silent write.

WHY NOT SILENT AUTO-FILL
Two rules make an unreviewed machine translation unacceptable here. Hindi must be proper
Devanagari and never Hinglish — a model asked to translate "Pathshala starts at 9" will
sometimes return "पाठशाला 9 बजे start होती है". And Jain terms (Pathshala, Punya, Guruji,
Sanchalak, Niyam, Shivir / नियम, पुण्य, शिविर, गुरुजी, संचालक, अभिभावक) must survive
untranslated. Neither is enforceable without a human looking at the output. The Sanchalak
is the human who knows those words.

=== New: apps/api-server/src/services/translate.ts ===

  translateToHindi(text: string, opts: { context: 'notice' }): Promise<string>

- Provider behind an env var. Add to apps/api-server/.env.example:
    TRANSLATION_PROVIDER      # 'none' (default) | 'openai' | 'anthropic'
    TRANSLATION_API_KEY
    TRANSLATION_MODEL
  Default 'none' so nothing breaks in dev, CI, or a deployment that has not configured it.
  When 'none', the endpoint returns 503 ERR_TRANSLATION_UNAVAILABLE and the UI hides the
  button — it must not render a button that always fails.
- The system prompt must state: output Devanagari only, never Latin script for Hindi words,
  and leave this glossary of terms in their Devanagari forms untouched — pass the Jain-term
  glossary explicitly rather than hoping the model knows.
- Validate the response before returning it: reject output containing Latin letters outside
  a small allowlist (digits, times, proper nouns already Latin in the source). Devanagari
  range is ऀ-ॿ — apps/api-server/src/lib/pdf.ts:31 already has a hasDevanagari
  helper you can mirror.
- Add ERR_TRANSLATION_UNAVAILABLE and ERR_TRANSLATION_FAILED to lib/api-zod/src/errors.ts —
  NOT apps/jp-shared/src/errors.ts. fail() in apps/api-server/src/lib/envelope.ts:2 types its
  code parameter as ErrorCode from @workspace/api-zod; jp-shared/errors.ts holds only six
  attendance codes and adding there will not typecheck. (CLAUDE.md says error codes live in
  @jp/shared/errors — that line is stale. Flag it, do not follow it.)
  Never return a raw string — CLAUDE.md, API response envelope.

=== New route: POST /v1/translate ===

  body: { text: string (max 8000), target: 'hi', context: 'notice' }
  → 200 { data: { text: string } }

requireAuth + shikshak and above (this costs money per call). Rate-limit it in Redis the way
OTP send is limited — 20/hour/user is generous for notice composition and caps the blast
radius of a stuck retry loop. Put the limiter beside the existing OTP sliding-window helper,
do not write a second one.

=== Web: NoticesAdminPage.tsx ===

A "Translate to Hindi" button beside each Hindi field (title_hi ~259, content_hi ~265).
Disabled when the English source is empty or the feature is off. On success it FILLS the
Hindi field and leaves it editable, with helper text below: "Machine translation — please
check before publishing." Show a spinner on the button while in flight, never a blocking
modal. Sentence case, tokens only, no emoji.

=== Mobile: app/admin/notices.tsx ===

Same button in NoticeEditor. Note the validation at :126 already REQUIRES all four bilingual
fields on mobile ("Title and content are required in both English and Hindi.") while web
requires only title_en (canSubmit, :163). Leave the mobile requirement in place — the button
is what makes it cheap to satisfy. Do not loosen it, and do not tighten web to match in this
prompt; that is a separate decision.

DO NOT
- Do not auto-translate on save, in a queue job, or on a cron backfill. No unreviewed
  Devanagari reaches a parent.
- Do not add a translate button to any other bilingual form in this prompt. Notices first,
  measured, then extend.
- Do not translate Jain terms. If the provider returns "Merit" for पुण्य the validator
  should catch it — add a glossary assertion test.

EXIT CRITERIA
  pnpm typecheck
  pnpm --filter @workspace/api-server run test
  Tests, all shown passing:
    - TRANSLATION_PROVIDER unset → POST /v1/translate returns 503 ERR_TRANSLATION_UNAVAILABLE
    - a parent (role: parent) calling POST /v1/translate gets 403
    - the Devanagari validator rejects a mocked Hinglish response
    - the glossary assertion: a mocked response translating "Punya" → "Merit" is rejected
  Manual: compose a notice on web with the provider stubbed, confirm the Hindi field is
  filled and still editable, and that the helper text renders.
```

---

## 3 — Niyam submitted content

```
Read CLAUDE.md (Q5 — niyam rejection 30-day window; Q6 — gallery opt-in), then:
  apps/api-server/src/routes/v1/me.ts                        (niyams handler ~289-315)
  lib/api-zod/src/contracts.ts                               (niyamSubmissionRowSchema ~584)
  apps/api-server/src/routes/v1/niyam-submissions.ts         (/pending serialiser ~775-803,
                                                              reject ~930, rejection_reason
                                                              write ~1002)
  apps/api-server/src/routes/v1/admin-resources.ts           (admin list serialiser ~434-457)
  apps/jain-pathshala-mobile/components/NiyamReviewScreen.tsx (media strip ~389-423)
  apps/jain-pathshala-mobile/lib/queries.ts                   (admin row type ~764-772)
  apps/jain-pathshala-mobile/app/student-detail/[id].tsx      (NiyamPanel ~797-840)

FIRST, WHAT IS NOT BROKEN — do not "fix" these
The reviewer queues already return signed, viewable proof. GET /v1/niyam-submissions/pending
signs proof_url and every media[].url (niyam-submissions.ts:775-803) and batches the media
query with inArray — no N+1. Both review UIs render photo thumbnails: the web at
NiyamReviewPage.tsx:135-152, mobile at NiyamReviewScreen.tsx:59-88 with a pinch-zoom viewer.
Leave all of that alone.

There are FOUR real gaps. Fix 1 and 2; 3 and 4 are smaller and can follow.

--- GAP 1: a parent can never see what their own child submitted ---

me.ts:296-311 selects id, niyam_title_en, niyam_title_hi, niyam_type, submission_date,
status, points_awarded, is_featured. No proof_url. No media. No notes. No rejection_reason.
The Zod contract confirms it (contracts.ts:584-593). So NiyamSubmissionsList.tsx,
app/niyam-submissions.tsx, app/parent/niyams.tsx and app/student/niyams.tsx all render a
status with no way to see what was actually sent.

This is the gap the Sanchalak is reporting. Fix it:
- Extend the me.ts select with notes, rejection_reason, and a batched media join in the
  same shape /pending uses. Sign every URL with signUploadUrl — copy the call, do not
  invent a second signing path.
- Extend niyamSubmissionRowSchema in lib/api-zod to match.
- Render proof in NiyamSubmissionsList.tsx using the existing ProofThumb + ImageViewerModal
  from NiyamReviewScreen.tsx. Extract them into components/ if they are not already
  shareable — do not copy-paste a second image viewer.

--- GAP 2: rejection_reason is written and never read ---

niyam-submissions.ts:1002 writes it. Grep the repo: it appears in the schema, that write, and
one test. Nothing reads it back. A parent learns why only from a transient push notification
(niyam-submissions.ts:339-340) — miss the push and the reason is gone forever, while the
submission sits there marked "rejected" with no explanation.

Add rejection_reason to the me.ts select (above) and render it under a rejected row. This is
where the error-voice rule applies to product copy, not just errors: show the Guruji's actual
reason, not "Rejected".

--- GAP 3: video and audio proof is unviewable on mobile review ---

NiyamReviewScreen.tsx:401-419 renders video and audio as inert icons — videocam-outline and
musical-notes-outline, no onPress, no player, no link. firstPhotoUrl at :54-57 is
`fromMedia ?? row.proof_url ?? null`, so a video-or-audio-only submission with no legacy
proof_url gives the collapsed row an empty placeholder and the Guruji approves blind.

Minimum fix: make them tappable and open the signed URL in the system player (Linking.openURL
or expo-av). The web admin already degrades correctly to an "Open video" / "Open audio" link
(NiyamReviewPage.tsx:154-170) — mobile should be at least that good. Also make firstPhotoUrl
fall back to a kind-appropriate placeholder so the row reads "video proof" rather than blank.

--- GAP 4: admin mobile student-detail discards proof it already received ---

app/student-detail/[id].tsx:797-840 (NiyamPanel) calls /v1/admin/niyam-submissions, which
DOES return signed proof_url and media[]. The row type at queries.ts:763-771 carries
proof_url but omits media, so the media array is dropped at the type boundary and the render
at :826-838 shows only title/status/date/points — not even the proof_url it already has.
Add media to the type and the thumbnail to the render. Cheapest fix in this prompt — the
data is already on the wire.

DO NOT
- Do not add a GET /v1/niyam-submissions/:id detail endpoint for this. Both queues are
  list-shaped and already carry everything; a detail route is a new surface to secure for
  no gain.
- Do not touch the 30-day reversal window (Q5) or the reject→gallery-hide path
  (niyam-submissions.ts:1050-1060).
- Do not fix apps/api-server/src/services/niyam-submit-sync.ts:96 in this prompt. That line is
  `proof_url: opts.proofAssetId ?? null` — it writes an ASSET ID into the proof_url column,
  never inserts niyam_submission_media, and never awards punya. It is real and it is wrong —
  but no mobile code calls it today (the producer is implemented only for homework,
  sync-engine.ts:214). File it separately so it gets the attention it needs rather than
  riding along here.

EXIT CRITERIA
  pnpm typecheck
  pnpm --filter @workspace/api-server run test
  Tests, all shown passing:
    - GET /v1/me/students/:id/niyams returns media[] with signed URLs for a submission
      that has proof
    - the same endpoint returns rejection_reason for a rejected submission
    - a parent cannot read another parent's child's submission (ownedStudentId still holds)
  Manual: submit a photo proof as a parent, view it back in the parent's own list.
```

---

## 4 — Rename "Service requests" → "Requests"

```
Read CLAUDE.md (Bilingual requirements; UI tone rules — sentence case, no emoji), then:
  apps/jain-pathshala/src/components/admin/sidebar-nav.ts:103
  apps/jain-pathshala/src/pages/admin/ServiceRequestsAdminPage.tsx:142,234,235,245
  apps/jain-pathshala/src/pages/public/MyServiceRequestsPage.tsx
  apps/jain-pathshala/src/pages/admin/DashboardPage.tsx:109
  apps/jain-pathshala/src/pages/admin/AnalyticsPage.tsx:71
  apps/jain-pathshala/src/components/public/Footer.tsx:23
  apps/jain-pathshala-mobile/components/QuickActions.tsx:64-68
  apps/jain-pathshala-mobile/app/_layout.tsx:98-99
  apps/jain-pathshala-mobile/app/admin/service-requests.tsx:270,474,475,513
  apps/jain-pathshala-mobile/app/service-requests.tsx:255,257
  apps/jain-pathshala-mobile/app/parent/profile.tsx:101
  apps/jain-pathshala-mobile/app/student/profile.tsx:88
  apps/api-server/src/routes/v1/service-requests.ts:55,217,301,331,344,353,374,392
  lib/i18n/src/locales/en.json, hi.json

SCOPE — LABELS ONLY
Change what a user reads. Do NOT change:
  - DB: service_requests, service_request_messages, service_request_status_enum,
    the 6 indexes, SERVICE_REQUEST_STATUSES
  - API: /v1/service-requests and its 7 endpoints, audit entityKind "service_request"
  - Frontend route paths /admin/service-requests and /my-requests
  - Component names, file names, React Query keys
Renaming any of those buys nothing a user can see and costs a migration plus a deprecation
window for already-shipped mobile builds.

THE ACTUAL PROBLEM IS BIGGER THAN THE NAME
One feature currently has three names. Admin web and admin mobile say "Service requests".
Parent web and parent mobile say "My requests" / "Support". The dashboard KPI says
"Open requests". Hindi is worse: सेवा अनुरोध on admin surfaces, मेरे अनुरोध on consumer
surfaces. A Sanchalak on the phone to a parent is using a different word than the parent is
reading. Settle it in one pass.

Canonical terms:
  Admin surfaces      EN "Requests"        HI "अनुरोध"
  Parent/student      EN "My requests"     HI "मेरे अनुरोध"
  Dashboard KPI       EN "Open requests"   HI "खुले अनुरोध"
  Single item         EN "Request"         HI "अनुरोध"

=== Put it in lib/i18n — this is the part that matters ===

lib/i18n/src/locales/en.json and hi.json currently have exactly two namespaces: errors and
mediaCuration. Every single service-request string in web and mobile is a hardcoded inline
`hi ? "…" : "…"` ternary, or English-only on the admin web page. That is why three names
drifted apart in the first place — there was no single place where they could be seen
side by side.

Add a `requests` namespace to BOTH locale files, mirroring the shape of mediaCuration:
navLabel, title, subtitle, myTitle, mySubtitle, itemTitle, kpiOpen, statusSubmitted,
statusInReview, statusResolved, empty, emptyHint, plus the form and thread copy currently
inlined in MyServiceRequestsPage.tsx (lines 67-72, 82-84, 137, 145, 156, 161, 168, 172, 187,
208, 221, 228, 234, 303, 345, 377, 382, 392, 513) and app/admin/service-requests.tsx.

Then replace the ternaries with t() calls. Every key must exist in both files with proper
Devanagari — no transliteration, no English fallback left in hi.json.

=== API-facing strings ===

service-requests.ts:55,217,301,344,353 return English messages containing "service request".
Update the wording, and check each one satisfies the error-voice rule — state the problem AND
the fix. "Service request not found." becomes something a parent can act on.

:331, :374 and :392 are audit-log summary strings, not user-facing. Update them for
consistency if you like, but they are not covered by the error-voice rule and changing them
alters historical-looking audit text — leaving them alone is defensible.

=== Leave alone, deliberately ===

  - apps/jain-pathshala/src/pages/admin/AdminListPages.tsx:1312 ServiceRequestsPage — dead
    code: exported, never imported, never routed, and it queries /v1/admin/sessions while
    titled "Service requests". Delete it in a separate cleanup, not here.
  - apps/jain-pathshala-mobile/fastlane/metadata/android/en-US/full_description.txt:19 —
    store listing copy; changing it triggers a store review. Batch it with the next
    release notes.
  - SPEC.md §5.15 / §6.19 and the docs/ mentions — internal prose, and SPEC.md has already
    drifted from the code on this feature (it names assigned_to_user_id where the DB has
    assigned_to, and admin routes under /v1/admin/service-requests/:id/respond that were
    never built). Fix the drift in a SPEC pass, not a rename pass.

EXIT CRITERIA
  pnpm typecheck
  pnpm --filter @workspace/jain-pathshala run build
  grep -rn "Service request" apps/jain-pathshala/src apps/jain-pathshala-mobile/app \
    apps/jain-pathshala-mobile/components   → no hits outside comments
  Every key added to en.json exists in hi.json:
    node -e "const e=require('./lib/i18n/src/locales/en.json'),h=require('./lib/i18n/src/locales/hi.json');const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?f(v,p+k+'.'):[p+k]);const m=f(e).filter(k=>!f(h).includes(k));console.log(m.length?m:'ok')"
  Manual: sidebar, dashboard KPI, parent profile entry point and mobile QuickActions all
  read consistently in both EN and HI.
```

---

## 5 — Report generation

```
Read CLAUDE.md, then:
  apps/api-server/src/lib/pdf.ts                  (lines 21-22, 42-49, 51-57)
  apps/api-server/build.mjs
  apps/api-server/Dockerfile                      (lines 41, 56, 58)
  apps/api-server/src/jobs/report-jobs.ts         (handler 14-69, registration 71-79)
  apps/api-server/src/jobs/derived-data-jobs.ts   (monthly_reports stub 164-170)
  apps/api-server/src/lib/centre-monthly-report.ts (line ~244)

THE WIRING IS FINE. DO NOT REBUILD IT.
Before changing anything, understand that this module is complete: the queue name is in
QUEUE_NAMES (jp-shared/src/constants.ts:35), the handler is registered from register-all.ts:23
and again at admin-resources.ts:63 for the no-Redis path, it is in LONG_RUNNING_QUEUES
(queues.ts:65), the centre_monthly_reports table and migration 0042 exist, both routes exist
(POST /v1/admin/centres/:id/reports/monthly at admin-resources.ts:719, GET at :782), and both
UIs call the correct paths and poll correctly. The handler is fully implemented, not a stub.

It fails at one line, at runtime, in the built artifact only.

THE BUG

pdf.ts:21-22
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const DEVANAGARI_FONT_PATH = join(__dirname, "../../assets/fonts/NotoSansDevanagari-Regular.ttf");

pdf.ts:55, unguarded
    const bytes = readFileSync(DEVANAGARI_FONT_PATH);

Two independent defects stack:

1. esbuild bundles to dist/index.mjs and dist/worker.mjs (build.mjs:18-26). At runtime
   import.meta.url is …/apps/api-server/dist/worker.mjs, so __dirname is
   apps/api-server/dist and "../../assets/fonts" resolves to apps/assets/fonts — a directory
   that exists in no layout.

   This is NOT works-in-dev-fails-in-prod. There is no tsx in this repo: scripts/dev.mjs and
   scripts/dev-worker.mjs both run `pnpm run build` then `start`, so dev executes the same
   bundle from dist/ and the path is equally broken there. The ONLY context where
   "../../assets/fonts" resolves is vitest, which transpiles in place — which is exactly why
   the test suite is green while the feature has never once worked. Do not trust a passing
   test as evidence of the fix; see the exit criteria.

2. Dockerfile:56 copies only dist; :58 copies the admin SPA. assets/ is never copied. So
   even with a corrected path the file is absent from the image.

Failure chain: readFileSync throws ENOENT → createBilingual() throws → the report build
throws → caught at report-jobs.ts:56-68 → row written as status:'failed' with the ENOENT
string in error_message → the UI faithfully renders "failed" plus a path. The user reports
"report generation is not working". The code is behaving exactly as designed around a
missing file.

Corroboration that pins it: PdfBuilder.create() (pdf.ts:42-49) reads no file, so donation
receipts (pdf.ts:200-237) and progress reports (progress.ts:426-456) still work. ONLY the
bilingual centre monthly report fails — which is exactly the shape of the bug report.

=== FIX A: get the font into the bundle's reach ===

Preferred — embed the bytes so there is no filesystem dependency at all. esbuild 0.27.3
(the pinned version) supports the binary loader. Add to build.mjs:
    loader: { ".ttf": "binary" }
and in pdf.ts:
    import devanagariFont from "../../assets/fonts/NotoSansDevanagari-Regular.ttf";
The 219 KB font is inlined into the bundle. No path resolution, no Docker copy, nothing to
forget on the next deployment change.

THIS NEEDS TWO PIECES OF PLUMBING OR IT WILL NOT TYPECHECK OR TEST — do both:
  - an ambient declaration (e.g. apps/api-server/src/types/ttf.d.ts):
        declare module "*.ttf" { const bytes: Uint8Array; export default bytes; }
  - a .ttf handler in apps/api-server/vitest.config.ts, which currently has none. Vite's
    ?arraybuffer suffix or assetsInclude both work; pick one and keep the import identical
    in both builds.
Without these, `pnpm typecheck` and the vitest suite — both in the exit criteria — fail on
the import before you ever reach the runtime bug.

If the binary loader causes trouble with the ESM output, fall back to: copy assets/ in
build.mjs after esbuild, resolve the path relative to process.cwd() (the Dockerfile pins
WORKDIR to /repo/apps/api-server at :41 precisely so build-time and run-time paths match —
read the comment above it before touching anything path-related), and add
    COPY --from=builder /repo/apps/api-server/assets ./assets
to the Dockerfile beside line 56. Do the copy, not just the path fix — either alone still fails.

=== FIX B: fail loudly, not silently ===

Wrap the readFileSync in a try/catch that throws an error naming the resolved path and the
fact that the Devanagari font is required for bilingual reports. Today a missing asset
surfaces to a Sanchalak as a red "failed" with a raw ENOENT — state the problem and the fix,
the same rule the API error voice follows. Better still: add a startup assertion in worker.ts
so the process complains at boot rather than at the first report of the month.

=== FIX C: the monthly cron is a stub (separate defect, same module) ===

derived-data-jobs.ts:164-170 is:
    async () => { logger.info("notifications.monthly_reports tick (report worker hooks later)"); }

It never enqueues REPORT_GENERATION. Automatic monthly reports have never run — every report
that exists was produced by someone pressing "Generate". Implement the tick: for each active
centre, insert a centre_monthly_reports row for last month and enqueue REPORT_GENERATION.
Import the queue name from @jp/shared/constants; never a string literal. The insert must be
idempotent — a UNIQUE (centre_id, month) upsert, or a restarted worker double-generates every
centre's report. Check whether 0042 already has that constraint before adding one.

This CHANGES THE FROZEN CRON TABLE and you must update it in the same commit. CLAUDE.md
currently lists notifications.monthly_reports with Kind "schedule" / "Tick registered; report
worker hooks later", and separately declares report.generation event-driven with no
CRON_EXPRESSIONS entry. After this fix the first becomes Kind "queue" and the note changes.
Edit the table. A frozen table that silently stops matching the code is worse than no table.

Same file has three more stubs at :204-206 (digest.weekly.email), :227-233
(media.cleanup_unfinalized) and :235-241 (donation.eightyg.year_end_summary). Leave them.
They are separate work and CLAUDE.md's cron table already documents them as ticks.

EXIT CRITERIA
  pnpm --filter @workspace/api-server run build
  node -e "const s=require('fs').statSync('apps/api-server/dist/worker.mjs');console.log(s.size)"
    → shown before and after, demonstrating the font is inlined (if using Fix A)
  docker build + docker run, then generate one centre monthly report end to end:
    the row reaches status 'ready' with a non-null pdf_url, and the PDF opens with
    Devanagari rendering (not tofu, not stripped by sanitize()).
  pnpm --filter @workspace/api-server run test
  A test that asserts PdfBuilder.createBilingual() resolves in the BUILT artifact, not only
  under tsx — this is the regression that would otherwise recur on the next build change.
```

---

## 6 — Punya Wall

```
Read CLAUDE.md Q6 (gallery opt-in is a single blanket toggle per parent, with backfill in
both directions) before making any change, then:
  apps/api-server/src/routes/v1/gallery.ts     (public query 140-160, requireFeatureMedia 96-102,
                                                admin queue can_publish ~750)
  lib/db/src/schema/identity.ts:42
  lib/api-zod/src/contracts.ts:167-169          (canFeatureMedia)
  apps/api-server/src/lib/gallery-feature.ts
  apps/api-server/src/routes/v1/me.ts
  apps/jain-pathshala-mobile/app/parent/profile.tsx
  apps/jain-pathshala/src/pages/admin/MediaCurationPage.tsx

THE BUG — the consent flag has no write path anywhere in production code

users.gallery_visibility_opt_in is NOT NULL DEFAULT false (identity.ts:42,
0000_baseline.sql:84). Every reference in apps/api-server/src is a READ:
auth-user-cache.ts:23, gallery.ts:155, 339, 348, 381, 722. The only writes in the whole
repo are lib/db/src/seed.ts:279,357, seed-indore.ts:380, and test fixtures. There is no
endpoint, no admin screen, and no mobile toggle that ever sets it true.

The public wall query hard-requires it (gallery.ts:146-158):
    eq(gallery_items.is_public, true),
    eq(featuredCol, true),
    isNull(gallery_items.deleted_at),
    sql`image_url is not null`,
    or(isNull(gallery_items.student_id), eq(owner.gallery_visibility_opt_in, true))

and niyam-approve.ts:66 always sets student_id, so isNull(student_id) is never true for an
auto-produced item. Therefore the consent clause excludes 100% of rows, in any deployment
that was not seeded. GET /v1/gallery?surface=wall returns { items: [] } and the mobile
screen renders "New moments will appear here soon." (app/gallery.tsx:116-125) — forever.

The tests pass only because they flip the flag by hand first (gallery.test.ts:170,187,199…).

Confirm before you start: SELECT count(*) FROM users WHERE gallery_visibility_opt_in;
Expect 0.

=== FIX A (root cause): give parents a way to consent ===

New endpoint on the /v1/me router (me.ts — it already has requireAuth and the ownership
helpers):

  PATCH /v1/me/gallery-visibility   body { opt_in: boolean }

It is a SINGLE BLANKET TOGGLE PER PARENT covering all their children.

**WRITE NO BACKFILL. This is the one instruction in this document most likely to be got
wrong.** CLAUDE.md Q6 describes the toggle as backfilling in both directions ("when toggled
off, ALL existing gallery items from their children are hidden (backfill)"). That wording is
stale — it describes a design that was deliberately superseded. The shipped design resolves
consent at QUERY time, via the join you can read at gallery.ts:146-158. Two sources lock it:

  .cursor/rules/20-niyam-fix-pass.mdc:17 — "the consent join in routes/v1/gallery.ts is the
  correct design: toggling is instant and needs no backfill. Do not replace it with a
  write-time check or a backfill job. Gallery rows are created for every approved submission
  regardless of opt-in; visibility is decided on read."

  SPEC.md:3445 — "handled via a query-time filter, not a backfill."

So the endpoint sets one boolean. Hiding and restoring are automatic and instant, because
nothing was ever written per-item. A backfill job here would be a no-op at best and would
fight the query-time gate at worst. It also means there is no opt-out/takedown ambiguity to
resolve: opt-out never touches deleted_at, so an admin takedown stays a takedown.

(Q6's backfill wording in CLAUDE.md should be corrected to match. Raise it — do not silently
implement either version.)

SPEC.md:3446 already specced this exact screen — "Parent profile settings UI (mobile):
blanket Gallery visibility toggle with clear copy on what it means." It was never built.
That is the whole defect.

Write an audit entry on every change (CLAUDE.md, Database conventions — a consent change is
at least as consequential as an admin action). Invalidate the auth user cache
(invalidateAuthUserCache is already imported at me.ts:45).

Mobile UI: a Switch in app/parent/profile.tsx, in its own Card near the Support card
(~line 96). Copy, in both languages:
  Title  "Gallery visibility" / "गैलरी में दिखाएँ"
  Body   "Allow your children's approved photos to appear on the Punya Wall and the public
          site. You can turn this off at any time — photos disappear immediately."
          / proper Devanagari equivalent
Use the existing Card/Row/Title/Body primitives and colours from constants/colors.ts. No hex
literals, no emoji, sentence case.

Also add it to app/student/profile.tsx if a 13+ student in student view should be able to
see (not necessarily change) the setting — check Q4 and the student-view rules before
deciding; if in doubt make it read-only in student view and say so in the PR.

=== FIX B: let the Sanchalak curate — REQUIRES A PRODUCT DECISION FIRST, DO NOT JUST DO IT ===

requireFeatureMedia (gallery.ts:96-102) rejects anyone below city_admin via canFeatureMedia
(contracts.ts:169). A Sanchalak gets 403 with "Only city admins and above can feature gallery
media." The people who know the children in the photos cannot put them on the wall; a
city_admin two levels up must do it.

STOP AND READ contracts.ts:160-166 BEFORE TOUCHING THIS. There is an explicit standing
prohibition there:

  "Deliberately NARROWER than canAccessAdminPanel — sanchalak and shikshak can open the
   admin panel but must NOT feature media. Do not 'fix' this by reusing ADMIN_PANEL_ROLES."

That comment is a decision someone made on purpose. Nothing in CLAUDE.md overrides it: Q12
governs niyam approve/reject scope via inBatchWriteScope and says nothing about media
featuring, so do not cite Q12 as authority the way an earlier draft of this document did.

Therefore: this change is an OVERRIDE of a locked decision, and it needs a human to sign off
before any code moves. The argument for it is that reach should follow who knows the child —
the same reasoning Q12 applies to niyam review — and that a wall nobody near the children can
populate is a wall that stays empty. The argument against is blast radius: featuring publishes
a child's photograph to a public surface, and the current author of that comment evidently
wanted that decision made above centre level. Both are reasonable. Put it to the product owner.

If and only if it is approved, implement it as a SCOPE gate, not a level gate — a sanchalak
may feature only items from students at a centre they are assigned to. The scope helpers
already exist (gallery-feature.ts:26,62 and the inScope family). Replace the comment at
contracts.ts:160-166 with the new decision and the reason, so the next person does not undo it.

Two consequences to handle:
  - featured_home (the public homepage carousel) should stay city_admin+. A sanchalak
    featuring onto the national homepage is a different blast radius than featuring onto the
    wall. Split the guard: featured_gallery → sanchalak+ in scope; featured_home → city_admin+.
    canFeatureMedia currently gates both.
  - sidebar-nav.ts:95 gates the Media curation nav item on min:'city_admin' AND
    gate:'featureMedia'. Lower the min and let the scope guard do the work, or the sanchalak
    still cannot reach the page.

=== FIX C: admin visibility — mostly already done, finish it ===

The API already returns consent_opt_in and can_publish per row (gallery.ts:~750, comment:
"Explicit so admins see why featuring would not publish"), and MediaCurationPage.tsx already
consumes them (:156, :194, :201, :394, :458) with i18n strings consentOptOut and
consentTooltip already present in both locale files. Do not rebuild this.

What is missing is the aggregate. When 100% of a queue is unpublishable, a per-card tooltip
does not communicate it — the admin sees a full grid, features things, and nothing appears.
Add a banner above the grid when selectableCount is 0 and items.length > 0:
"None of these photos can be published yet — no family in this view has turned on gallery
visibility." Use the existing tr(locale, …) mechanism and add the key to both locale files.

DO NOT
- Do not weaken or remove the consent clause at gallery.ts:153-156. It is Q6 and it is
  correct. The wall being empty is the consent system working; the missing piece is consent
  never being obtainable.
- Do not auto-feature on niyam approval. niyam-approve.ts:71-72 hardcodes
  featured_gallery:false deliberately, and 0019_gallery_curation.sql:31-36 cleared the flags
  on deploy on purpose ("Wall empty on deploy until admins curate (intended)"). Curation
  stays human.
- Do not default gallery_visibility_opt_in to true, and do not backfill it to true for
  existing users. Opt-in means opt-in.
- Do not touch monthly_leaderboard_snapshots or punya.leaderboard.refresh. They are a
  different feature and both work. (Note for the CLAUDE.md maintainer: the materialised-view
  table still lists mv_monthly_leaderboard_city, but 0017:168 dropped it in favour of the
  monthly_leaderboard_snapshots TABLE. That row is stale and will mislead the next person
  debugging. Six of the seven listed MVs exist; that one does not.)

EXIT CRITERIA
  pnpm typecheck
  pnpm --filter @workspace/api-server run test
  Tests, all shown passing:
    - PATCH /v1/me/gallery-visibility {opt_in:true} makes a previously-featured item appear
      in GET /v1/gallery?surface=wall
    - {opt_in:false} hides ALL items across ALL of that parent's children in the SAME
      request cycle, with no job run in between (proves the query-time gate, and proves
      no backfill was added)
    - toggling back on restores them, again with no job run
    - an item soft-deleted by an admin takedown stays hidden through both toggles
    - an audit row is written on every consent change
  Only if Fix B was approved:
    - a sanchalak can feature an item at their own centre (200) and cannot at another
      centre (403)
    - a sanchalak still gets 403 on featured_home
  Manual: on a fresh DB, opt in as a parent, feature the item as a sanchalak, and see it on
  the mobile Punya Wall.
```

---

## Suggested order

1. **5 (reports)** and **6 (Punya Wall)** — two broken features, both single-cause, both fixable this week.
2. **3 (niyam proof)** — the parent-facing gap is a trust problem: a family submits a photo and can never see it again.
3. **1 (notice expiry)** — carries a live bug with it (`publish_now:false` publishes anyway).
4. **4 (rename)** — mechanical, and the `lib/i18n` namespace it forces is worth more than the rename.
5. **2 (translation)** — new capability, new external dependency, new cost line. Last, and worth a small spike on provider quality with real Jain-term notices before committing.

---

## Doc drift found during this pass (fix separately, do not fold into the prompts)

Each of these is a place where `CLAUDE.md` or the repo layout no longer matches the code. None of them break anything today; all of them will mislead the next person debugging.

| Where | Says | Actually |
|---|---|---|
| `CLAUDE.md` Q6 | Toggling `gallery_visibility_opt_in` backfills gallery items in both directions | Consent is resolved at query time (`gallery.ts:146-158`). `.cursor/rules/20-niyam-fix-pass.mdc:17` and `SPEC.md:3445` both explicitly forbid a backfill. **Q6's wording is the outlier and should be corrected** — this is the highest-value item in this table, because Q6 is the rule most likely to be implemented from memory. |
| `CLAUDE.md` → Materialised view names | Lists `mv_monthly_leaderboard_city` as canonical | Dropped at `0017:168` in favour of the `monthly_leaderboard_snapshots` TABLE. Six of the seven listed views exist; this one does not. `derived-data-jobs.ts:27-35` already lists only six. |
| `CLAUDE.md` → API response envelope | "Error codes are defined in `@jp/shared/errors`" | `fail()` types its code as `ErrorCode` from `@workspace/api-zod` (`lib/api-zod/src/errors.ts`, 205 codes). `apps/jp-shared/src/errors.ts` holds six attendance codes only. |
| `CLAUDE.md` → Bilingual requirements | i18n strings live in `packages/i18n/src/locales/` | They live in `lib/i18n/src/locales/`. The "Design system file locations" section already says so correctly — the two sections disagree with each other. |
| `lib/db/migrations/` | — | `0043_per_batch_rate_functions.sql` collides with `0043_push_receipts.sql` and is absent from `meta/_journal.json`. It has never been applied. Decide: renumber to 0049+ and apply, or delete. |
| `SPEC.md` §5.15 / §6.19 | `assigned_to_user_id`; admin routes `/v1/admin/service-requests/:id/respond`, `/status`, `/reassign` | DB column is `assigned_to`; routes are `/v1/service-requests/:id/messages`, `/assign`, `/resolve`. SPEC also omits the `subject` column that exists. |
| `apps/jain-pathshala/src/pages/admin/AdminListPages.tsx` | — | Two exported-but-unrouted components: `NoticesPage` (`:169-290`, posts to the legacy notice route) and `ServiceRequestsPage` (`:1312`, titled "Service requests" but queries `/v1/admin/sessions`). Dead code that reads as live. |
