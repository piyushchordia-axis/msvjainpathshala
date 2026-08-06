# Library module — Cursor fix prompts

**Date:** 2026-08-06
Companion to [`LIBRARY_MODULE_REVIEW.md`](./LIBRARY_MODULE_REVIEW.md). Paste one block at a time into Cursor (Composer, Agent mode), verify, commit, then move on. Ordered by dependency and risk.

Every prompt assumes Cursor has `CLAUDE.md` in context. If it doesn't, prefix with:

> Read `CLAUDE.md` (Q7, signed-URL security rule, soft-delete and audit conventions, bilingual rules, error-code enum) before making any change.

Next free migration number is **0047** (`0046_notifications_inbox_keyset_index` exists). Remember `lib/db/migrations/meta/_journal.json`.

**Two things confirmed while writing these**, both of which make the work smaller than the review implied:

- The duplicate create route has **no live caller**. `AdminRoutes.tsx:19` routes `/admin/library` to `LibraryAdminPage.tsx` (which uses the correctly-gated `/v1/library`). The only references to `/v1/admin/library` sit in `AddLibraryDialog` and `LibraryPage` inside `AdminListPages.tsx`, and `AdminRoutes.tsx` imports neither. Prompt 1 is a pure deletion.
- `signUploadUrl` already handles this case. Its docstring reads: *"otherwise return it unchanged (external URLs, **e.g. admin-pasted library links**, are not ours to sign)"* — the helper was written anticipating library and simply never got wired in. Prompt 4 is close to a one-liner.

---

## 1 — Delete the duplicate create route (C1)

```
Read CLAUDE.md (role hierarchy) and apps/api-server/src/routes/v1/library.ts (isLibraryEditor,
line ~205), then remove the second library write path.

THE PROBLEM
library_items has no centre_id / city_id / state_id — it is a national table read by every user
on the platform. POST /v1/library (library.ts:274) restricts writes to super_admin and says why
in a comment. POST /v1/admin/library (admin-modules.ts:875) writes the SAME table with
requireRole("super_admin", "state_admin", "city_admin"), so a city_admin can publish to the whole
country. The duplicate is also worse in two ways: createLibrarySchema (admin-modules.ts:863) has
no description_hi field at all, and no .refine() for deliverability — so it can create an item
with neither embed_url nor file_url, exactly the state PATCH /v1/library/:id rejects at :359.

CONFIRMED SAFE TO DELETE — verify these two facts first, then proceed:
  1. AdminRoutes.tsx:19 lazily imports LibraryAdminPage from pages/admin/LibraryAdminPage, and
     routes it at /admin/library (line 122). That page uses /v1/library and /v1/library/admin.
  2. The only references to "/v1/admin/library" are AdminListPages.tsx:385 (inside AddLibraryDialog,
     defined at :368) and AdminListPages.tsx:448 (inside `export function LibraryPage()`, defined
     at :447). Neither is imported by AdminRoutes.tsx — grep it to confirm. They are an orphaned
     earlier version of the page.

DO:
- Delete router.post("/library", …) and createLibrarySchema from
  apps/api-server/src/routes/v1/admin-modules.ts. Remove any now-unused imports (library_items may
  still be used elsewhere in that file — check before removing the import).
- Delete AddLibraryDialog (:368) and export function LibraryPage() (:447) from
  apps/jain-pathshala/src/pages/admin/AdminListPages.tsx, plus the LibraryRow interface if it is
  not shared.
- Leave the nav item at min:'city_admin' — reading the admin list is fine for lower roles, and
  GET /v1/library/admin already allows it while returning can_edit: false so the page can hide
  the write controls. Verify LibraryAdminPage actually honours can_edit; if it renders the
  create/edit/delete affordances unconditionally, gate them on it, or a city_admin gets the same
  dead-end form we just fixed on the Niyams page.

If grep shows anything else calling /v1/admin/library, STOP and report rather than deleting.

Add a test in apps/api-server/test/library.test.ts asserting POST /v1/admin/library now 404s.

Run `pnpm typecheck`, `pnpm test`.
```

---

## 2 — Enforce Q7, and guard delivery server-side (C2 + C3)

Ship these together. The write-side validator protects new rows; the delivery-side guard protects the ones already in the table.

```
Read CLAUDE.md Q7, apps/api-server/src/lib/validation.ts (httpUrl, line ~19),
apps/jain-pathshala/src/lib/safe-url.ts (safeHref), and
apps/api-server/src/routes/v1/library.ts (deliveryUrl :86, POST /:id/access :154).

THE PROBLEM
Q7: "Library items of type='video_embed' store a YouTube or Vimeo URL in embed_url. … Validate
that the URL is a valid YouTube or Vimeo link on creation."

Nothing validates the host. embed_url uses httpUrl(2000), which only checks the string parses and
uses http(s). And on mobile the resulting URL goes straight to Linking.openURL with none of the
safeHref sanitisation the web applies (app/{guest,parent,student}/library.tsx, ~line 84). So an
arbitrary link can be stored and opened in a child's device browser.

=== Part A: host whitelist on write ===
In apps/api-server/src/lib/validation.ts, next to httpUrl, add:

  /** Q7 — video embeds must be YouTube or Vimeo. Hostname match, never substring. */
  export function videoEmbedUrl(max = 2000)

Allowed hostnames, compared against `new URL(u).hostname.toLowerCase()` with EXACT equality:
  youtube.com, www.youtube.com, m.youtube.com, youtu.be,
  vimeo.com, www.vimeo.com, player.vimeo.com
Substring or endsWith matching is NOT acceptable — "youtube.com.evil.tld" and
"notyoutube.com" must both fail. Require https (not http) for embeds.
Error message states the fix: "Video links must be a YouTube or Vimeo URL."

Apply it in apps/api-server/src/routes/v1/library.ts:
- createSchema and updateSchema: when content_type is the video type, embed_url must satisfy
  videoEmbedUrl. Use a superRefine on the object (content_type and embed_url need to be checked
  together, and on PATCH content_type may be absent — fall back to the stored row's value, which
  the handler already loads at :346).
- Non-video types keep httpUrl.

Q7 names the type 'video_embed'; libraryContentTypeEnum is pdf | video | audio | image, so that
value does not exist. Do NOT add an enum value in this prompt — key the check off 'video' and
report the naming mismatch so CLAUDE.md can be amended to match the schema (or vice versa) as a
deliberate decision.

=== Part B: guard delivery (protects existing rows) ===
In POST /v1/library/:id/access, after resolving `url` via deliveryUrl() and before returning it:
- Parse it. Reject anything whose protocol is not http:/https: with 409 ERR_NO_CONTENT_URL.
- If the item's content_type is the video type, apply the same hostname whitelist.
- Log a warning (logger.warn with the item id — NOT the URL, it may contain a token) when a stored
  row fails the check, so pre-existing bad rows surface in ops rather than silently 409ing.

This is the load-bearing half: rows created before Part A exist and will not be revalidated.

=== Part C: mobile ===
Create apps/jain-pathshala-mobile/lib/safe-url.ts mirroring the web's safeHref — same
protocol-only check, no window.location (there is no origin on native, so require an absolute URL).
Apply it in all three of app/{guest,parent,student}/library.tsx before every Linking.openURL,
both on the member path and the `fallback` path. Show the existing error state if it returns
undefined; do not silently do nothing.

(Prompt 6 collapses these three files into one component. If you run that first, apply this once
there instead.)

=== Tests ===
apps/api-server/test/library.test.ts:
- creating a video item with a non-YouTube/Vimeo embed_url → 422;
- creating with https://youtube.com.evil.tld/watch?v=x → 422 (the substring trap);
- creating with https://youtu.be/abc123 and https://player.vimeo.com/video/123 → 201;
- patching a video item's embed_url to a disallowed host → 422;
- a pdf item with an arbitrary https URL still succeeds (non-video types are unrestricted);
- POST /:id/access on a row whose stored embed_url is a javascript: URI (insert it directly via the
  test db handle, bypassing the route) → 409 ERR_NO_CONTENT_URL.

Run `pnpm typecheck`, `pnpm test`.
```

---

## 3 — Soft delete (H2)

```
Read CLAUDE.md (database conventions — soft delete), lib/db/src/schema/library.ts, and
apps/api-server/src/routes/v1/library.ts (DELETE handler, line ~389).

THE PROBLEM
DELETE /v1/library/:id does `db.delete(library_items)`. library_access_logs.library_item_id is
onDelete: "cascade" (schema/library.ts:26), so removing one item silently destroys every access
record for it — the same usage data the admin list surfaces as access_count. The audit entry
written immediately afterwards points at an entityId that no longer resolves.

DO:
- Migration lib/db/migrations/0047_library_soft_delete.sql:
    ALTER TABLE library_items ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
    CREATE INDEX IF NOT EXISTS idx_library_items_alive ON library_items (created_at DESC)
      WHERE deleted_at IS NULL;
  Also change the library_access_logs FK from ON DELETE CASCADE to ON DELETE SET NULL and make
  library_item_id nullable, so a future hard purge cannot take the history with it. Keep the
  existing rows.
- Add deleted_at to lib/db/src/schema/library.ts (both tables where relevant).
- DELETE handler: set deleted_at = now() instead of deleting. Keep returning 404 when the row is
  already soft-deleted, so the endpoint stays idempotent-looking to clients.
- Add `isNull(library_items.deleted_at)` to EVERY read: the member feed (:115), POST /:id/access
  (:162), GET /v1/library/admin (:241), and GET /v1/public/library in public.ts:146. Missing one
  means deleted content stays visible — grep for `from(library_items)` and check each hit.
- The admin list may optionally accept ?include_deleted=true for super_admin, showing a "Removed"
  badge. Only if it is cheap; not required.

Tests: deleting hides the item from the member feed, the public feed and the admin list; its
access_count survives the delete; deleting twice returns 404 the second time.

Run `pnpm db:migrate`, `pnpm typecheck`, `pnpm test`.
```

---

## 4 — Sign internal file URLs (H1)

```
Read CLAUDE.md (security rules — signed URLs) and apps/api-server/src/lib/file-tokens.ts.

THE PROBLEM
The member feed returns file_url verbatim (library.ts:124, :141) and so does POST /:id/access via
deliveryUrl(). Gallery, niyam media, reports and donation receipts all pass media URLs through
signUploadUrl; library is the one media surface that does not. An msv-tier PDF's URL therefore
works forever, for anyone, with no auth — the tier gate is undone the moment it is pasted into a
family WhatsApp group.

signUploadUrl already does exactly the right thing and its docstring names this case:
  "If url points to our /uploads storage, append a short-lived signature so the /uploads route
   will serve it; otherwise return it unchanged (external URLs, e.g. admin-pasted library links,
   are not ours to sign)."

DO:
- Import signUploadUrl from ../../lib/file-tokens in library.ts.
- Wrap file_url in deliveryUrl(), in the member feed row mapping, and in the response from
  POST /:id/access. Do NOT wrap embed_url — hosted video links are never ours.
- Use a short TTL for non-public tiers. Signature is signUploadUrl(url, ttlSeconds); pick ~1 hour
  for student/msv/shikshak and leave the default for public. The point is that a leaked link
  expires, not that it is unguessable.
- GET /v1/library/admin should also sign, so the admin preview link works.

Tests: a file_url pointing at /uploads/ comes back with a signature on the member feed; an
external https URL comes back unchanged; an expired signature is rejected by the /uploads route
(verifyUploadAccess already covers this — assert the integration, not the crypto).

Run `pnpm typecheck`, `pnpm test`.
```

---

## 5 — Make the access-log comment true (H3)

```
Read apps/api-server/src/routes/v1/library.ts (file header, lines 10-13, and the insert at :189).

THE PROBLEM
The header claims a guarantee the code does not provide:
  "A library_access_logs row is written when an item's URL is handed out (idempotent per
   user+item+url via the POST /:id/access tracker …)"
The insert is unguarded — no unique index, no upsert. Every tap writes a row, nothing prunes them,
and there is no retention job (auth.session.cleanup handles sessions; library has no equivalent).
The false comment is the worse half: someone will build on a guarantee that isn't there.

Pick ONE and make the code and comment agree. Default to (a) unless you know the analytics need
per-open granularity:

(a) DISTINCT REACH — "how many members opened this"
    Migration 0047+: add last_accessed_at timestamptz and access_count integer not null default 1
    to library_access_logs; de-duplicate existing rows keeping the earliest per (item, user);
    then CREATE UNIQUE INDEX on (library_item_id, user_id) WHERE user_id IS NOT NULL.
    Change the insert to ON CONFLICT DO UPDATE SET last_accessed_at = now(),
    access_count = library_access_logs.access_count + 1.
    The admin list's access_count then means distinct members — relabel the column in
    LibraryAdminPage.tsx to say so.

(b) FULL TRAIL — keep append-only
    Correct the header comment to say the log is append-only, one row per open.
    Add a prune to the existing auth.session.cleanup job (or a new tick in the frozen cron table
    — if you add one, it must go in CRON_EXPRESSIONS and the CLAUDE.md cron table together, not
    just one of them) deleting rows older than a retention window, 180 days unless told otherwise.
    Keep the admin count but label it "opens", not "members".

Either way, while you are in that query: the admin list runs a correlated
`select count(*) from library_access_logs where library_item_id = …` per row (library.ts:254-257).
Replace it with a LEFT JOIN + GROUP BY.

Tests: whichever semantic you choose, assert it — two opens by the same user produce either one
row with access_count 2, or two rows, and the admin figure matches.

Run `pnpm db:migrate` (if (a)), `pnpm typecheck`, `pnpm test`.
```

---

## 6 — Collapse the three library screens (M1)

```
Read apps/jain-pathshala-mobile/app/guest/library.tsx, app/parent/library.tsx,
app/student/library.tsx and components/LibraryView.tsx.

THE PROBLEM
The three screens are near-identical copies (same query, same open() handler, same card list).
components/LibraryView.tsx is an orphaned earlier version — 89 lines, imported nowhere (grep finds
only its own definition), still reading useLibrary() → /v1/public/library, so it never sees tiered
content and never logs access.

Three copies is why the safeHref gap in prompt 2 is missing from all three at once.

DO:
- Rewrite components/LibraryView.tsx as the single shared implementation: the authed/public query
  switch, the open() handler (with the safe-url guard from prompt 2), and the card list.
- Delete useLibrary() from lib/queries.ts if nothing else uses it, or repoint it at the member feed.
- app/{guest,parent,student}/library.tsx each become a thin wrapper rendering <LibraryView /> with
  whatever persona-specific header copy differs. If nothing differs, they are three one-liners —
  that is the correct outcome, not a sign something is wrong.
- Keep the access-tier pill (parent/student show it; check guest does too, since a guest seeing
  "MSV" on an item they cannot open is useful signposting, not a leak — the feed already filters).

Design rules: tokens only, no raw hex; sentence case; no emoji; bilingual with the
`hi ? x_hi ?? x_en : x_en` fallback; Devanagari line-height >= 22; +35% Hindi length tolerance.

Run `pnpm typecheck` and open the library on all three personas.
```

---

## Build order

| # | Prompt | Why here |
|---|---|---|
| 1 | Delete duplicate route | Pure deletion, no live caller, closes a national-publish hole. |
| 2 | Q7 + delivery guard | The security fix. Part B protects rows that already exist, so don't ship Part A alone. |
| 3 | Soft delete | Before more access history is lost. Touches every read, so do it while the file is fresh. |
| 4 | Sign file URLs | Near one-line; latent today, silent when it lands. |
| 5 | Access-log semantics | Housekeeping, but the false comment should not survive another reviewer. |
| 6 | Collapse the screens | Last, so prompt 2's guard is written once rather than merged three ways. |

## Left for later

**M2 (scope + age groups), M4 (search/categories/tags/ordering).** Both are schema changes and both are worth doing, but they are product decisions rather than fixes — scoping the library changes who may publish what, and categorisation needs someone to decide the taxonomy. M4 is the one users will ask for first; a library where browsing *is* the feature currently offers only `content_type` and `access_tier` filters ordered by newest.
