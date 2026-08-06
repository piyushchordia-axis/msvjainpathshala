# Code review — Library module

**Date:** 2026-08-06
**Scope reviewed:**

| File | Lines |
|---|---|
| `lib/db/src/schema/library.ts` | 39 |
| `apps/api-server/src/routes/v1/library.ts` | 419 |
| `apps/api-server/src/routes/v1/admin-modules.ts` (library section) | 866–897 |
| `apps/api-server/src/routes/v1/public.ts` (library section) | 143–162 |
| `apps/api-server/test/library.test.ts` | 14 tests |
| `apps/jain-pathshala/src/pages/admin/LibraryAdminPage.tsx` | 492 |
| `apps/jain-pathshala/src/pages/public/LibraryPage.tsx` | — |
| `apps/jain-pathshala-mobile/app/{guest,parent,student}/library.tsx` | — |
| `apps/jain-pathshala-mobile/components/LibraryView.tsx` | 89 |

**Checked against:** `CLAUDE.md` Q7 (library videos: embed URLs only), signed-URL security rule, soft-delete and audit conventions, bilingual requirements, AT-style scope discipline.

---

## Summary

The access-tier model in `library.ts` is thoughtfully built — `tiersForUser` resolves from what the caller *owns* rather than their role alone, the 404-instead-of-403 choice on out-of-tier items stops the catalogue being enumerable by probing, and `POST /:id/access` logs and delivers in one round trip. Fourteen tests cover the lifecycle, the tier gate, drafts and payload validation. All three mobile screens and the web page consume the member feed correctly.

The problems are around the edges of that good core, and three of them compound into one issue that matters more than any of them alone:

**Q7 is not enforced anywhere.** `embed_url` accepts any `http(s)` URL. There is no YouTube or Vimeo check on create or on patch, despite `CLAUDE.md` requiring one in as many words. Meanwhile a **second create route** (`POST /v1/admin/library`) lets `city_admin` and `state_admin` write to a table that has no scope column and is read by every user in the country — while the route right next to it restricts the same operation to `super_admin` and explains why in a comment. And on mobile that URL is handed straight to `Linking.openURL` with none of the `safeHref` sanitisation the web page applies.

So: a city admin in one city can publish an arbitrary link to every child on the platform, and it opens in their device browser. Each of those three is individually defensible-looking; together they are the finding.

**Verdict: Request changes.** C1–C3.

---

## Critical

### C1 — Two create routes, two different role gates, on an unscoped national table

`POST /v1/library` (`library.ts:274`) is `super_admin`-only, and says exactly why:

```ts
// library.ts:203-207
// The library is network-wide (no centre/city scoping column), so writes are
// restricted to super_admin. Lower admin roles may still read the admin list.
function isLibraryEditor(user: User): boolean {
  return user.role === "super_admin";
}
```

`POST /v1/admin/library` (`admin-modules.ts:875`) writes the same table:

```ts
router.post("/library", requireRole("super_admin", "state_admin", "city_admin"), …)
```

`library_items` has no `city_id`, `state_id` or `centre_id`, so there is nothing to scope a lower-role write *to*. A city_admin in Pune posting to the second route publishes to every student, parent and guest on the platform. The reasoning that produced the restriction is written down in one file and silently contradicted in another — and the second route is the older one, so anyone reading `library.ts` would reasonably believe the gate holds.

The duplicate is also functionally worse:

- `createLibrarySchema` in `admin-modules.ts:866` has **no `description_hi`** field, so items created there can never carry a Hindi description — a bilingual violation baked into the route.
- It has **no `.refine()` for deliverability**, so it can create an item with neither `embed_url` nor `file_url`. `PATCH /v1/library/:id` explicitly guards against exactly that state (`library.ts:359`), and `POST /v1/library` refuses it at `:223`. So one route creates the state another route calls invalid.

**Fix — confirmed clean.** The duplicate has **no live caller**. `AdminRoutes.tsx:19` routes `/admin/library` to `LibraryAdminPage.tsx`, which uses the super_admin-gated `/v1/library` routes. The only references to `/v1/admin/library` are `AdminListPages.tsx:385` and `:448`, inside `AddLibraryDialog` (`:368`) and `export function LibraryPage()` (`:447`) — neither of which `AdminRoutes.tsx` imports. They are an orphaned earlier version of the page.

So: delete the `admin-modules.ts` route and `createLibrarySchema`, and delete the two dead components in `AdminListPages.tsx`. Nothing user-facing changes. Keep the nav item at `min: 'city_admin'` for reading, but leave writes with `super_admin` until the table is scoped. If lower roles genuinely need to publish, that is a schema change — add scope columns and filter reads by them — not a second unguarded door.

### C2 — Q7 is not enforced: any URL can be embedded

`CLAUDE.md` Q7 is unambiguous: *"Validate that the URL is a valid YouTube or Vimeo link on creation."*

Both create paths and the patch path use `httpUrl(2000)` (`lib/validation.ts:19`), which checks only that the string parses as a URL with an `http:` or `https:` protocol. There is no host check anywhere in the module.

Two related drifts from the same rule:

- Q7 names the type `video_embed`. `libraryContentTypeEnum` is `pdf | video | audio | image` — the type Q7 legislates for does not exist, so even a host check would have nothing to key on. Either add the enum value or restate Q7 against `content_type='video'`.
- Q7 says the clients *"render these as embedded iframes/WebViews."* Neither client embeds: the web opens a new tab (`window.open`), mobile calls `Linking.openURL`. That is a product decision worth making deliberately — embedding keeps the child inside the app, where an external browser hands them YouTube's full recommendation surface — but right now it contradicts the rule without anyone having chosen to.

**Fix:** a `videoEmbedUrl()` validator alongside `httpUrl()` that whitelists `youtube.com`, `youtu.be`, `www.youtube.com`, `m.youtube.com`, `vimeo.com`, `player.vimeo.com` by parsed hostname (never substring matching — `youtube.com.evil.tld` must fail), applied when `content_type` is the video type on create and on patch. Reject anything else with a message stating the fix.

### C3 — Mobile opens admin-supplied URLs with no sanitisation

The web page sanitises before opening:

```tsx
// pages/public/LibraryPage.tsx:74-76
const safe = safeHref(res.url);
if (safe) { e.preventDefault(); window.open(safe, '_blank', 'noopener,noreferrer'); }
```

The three mobile screens do not:

```ts
// app/parent/library.tsx:76-84 (identical in guest/ and student/)
const res = await apiPost<{ url?: string }>(`/v1/library/${item.id}/access`, {});
const url = res?.url ?? fallback;
if (url) await Linking.openURL(url);
```

`Linking.openURL` will happily dispatch non-`http` schemes. Combined with C2 (no host validation) and C1 (a wider set of authors than intended), a stored URL reaches `Linking.openURL` unchecked on a children's app.

**Fix:** port `safeHref` into the mobile app — or better, put the guard on the server so every client inherits it: validate the scheme and host in `POST /:id/access` before returning `url`, and return `409 ERR_NO_CONTENT_URL` for anything that fails. Client-side checks are defence in depth; the server is where this belongs, and it also protects rows created before C2's validator existed.

---

## High

### H1 — `file_url` is delivered raw, never signed

`CLAUDE.md` security rules: *"Signed URLs: all media assets served via signed URLs with TTL — never public S3 URLs for private content."*

The member feed returns `file_url` verbatim (`library.ts:124`, `:141`), as does `POST /:id/access` via `deliveryUrl()`. `signUploadUrl` is used by gallery (`admin-resources.ts:441`), niyam media (`:445`), reports (`:825`) and donation receipts (`donations.ts:606`) — library is the one media surface that skips it.

The consequence is that the tier model is a UI nicety rather than access control. An `msv`-tier PDF handed to one qualifying parent has a URL that works forever, for anyone, with no auth — the 404-on-probe care taken in `POST /:id/access` is undone the moment the URL is pasted into a family WhatsApp group.

Today `file_url` is admin-pasted rather than uploaded, so it may often be an external link where signing is meaningless. That makes this latent rather than live — but the first time someone pastes an R2 key, private content leaks silently.

**Fix:** run `file_url` through `signUploadUrl` when it resolves to an internal storage key (the helper already distinguishes), leave external URLs alone, and give `msv`/`shikshak` tiers a short TTL. Add a test that a signed URL is returned for a stored file and that an expired token 403s.

### H2 — DELETE is a hard delete, and it destroys the access history

```ts
// library.ts:400
const deleted = await db.delete(library_items).where(eq(library_items.id, id))…
```

`library_access_logs.library_item_id` is `onDelete: "cascade"` (`schema/library.ts:26`), so removing one item silently deletes every access record for it. The audit entry written immediately after points at an `entityId` that no longer resolves to anything.

That conflicts with the DB conventions (soft delete for anything with history) and with the module's own admin list, which surfaces `access_count` as if usage data were durable. It also makes "which resources do our students actually use" unanswerable after any tidy-up.

**Fix:** add `deleted_at` to `library_items`, soft-delete, and filter it out of every read (member feed, public feed, admin list unless explicitly requested). Change the FK to `set null` or keep cascade but stop hard-deleting. If a genuine takedown is ever needed, that is a separate, audited, super_admin-only operation.

### H3 — Access logs grow without bound, and the docblock claims an idempotency the code does not have

The file header states:

> A `library_access_logs` row is written when an item's URL is handed out **(idempotent per user+item+url** via the `POST /:id/access` tracker that the clients call when a resource is opened).

The implementation is an unguarded insert (`library.ts:190-193`) — no unique index, no upsert, no de-duplication. Every tap writes a row. A student opening the same PDF ten times writes ten rows, and nothing ever prunes them: `auth.session.cleanup` handles retention for sessions; there is no equivalent for this table.

Two problems, and the comment is the worse one — a future reader will trust it and build on a guarantee that isn't there.

**Fix:** decide which you want. If the intent is *"how many distinct members opened this"*, add `UNIQUE (library_item_id, user_id)` and upsert with a `last_accessed_at` bump. If the intent is a full access trail, keep the append-only insert but correct the comment and add a retention prune to the existing `auth.session.cleanup` job. Either way the admin list's `access_count` should say which it is counting.

---

## Medium

**M1 — `LibraryView.tsx` is dead code.** 89 lines, imported nowhere (grep finds only its own definition). It is the pre-refactor version: it reads `useLibrary()` → `/v1/public/library`, so it never sees tiered content and never logs access. The three screens each carry their own near-identical implementation instead. Delete it, or — better — invert it: extract the shared card/list into `LibraryView` and have guest/parent/student render it with props. Three copies of the same list is how C3 came to be missing from all three at once.

**M2 — No scope, no age groups.** `library_items` has no geography columns and no `age_groups`, while `niyams`, `quiz_events`, `questions` and `competitions` all do. A Bal-age child and a Yuva student see an identical catalogue, and no city can curate its own. Given C1, the scope gap is the more urgent of the two.

**M3 — No pagination, and a correlated subquery per admin row.** Both feeds are `limit`-only with no cursor (`clampLimit(…, 60, 200)` member, `(…, 100, 300)` admin), so the catalogue silently truncates as it grows. The admin list also runs `select count(*) from library_access_logs where library_item_id = …` per row (`library.ts:254-257`). The index exists so it is survivable, but a `GROUP BY` join is the right shape.

**M4 — No search, category, tags or ordering.** Nothing beyond `content_type` and `access_tier` filters, ordered by `created_at desc`. A library is the one module where browsing *is* the feature; at fifty items this is already hard to use, and there is no way to promote a resource or group a scripture series.

**M5 — `tiersForUser` grants every tier to `canAccessAdminPanel`.** That includes `sanchalak` and `shikshak` (`library.ts:57`). The comment justifies it as needed "to curate/preview", but neither role can create or edit anything (C1's intent), so there is nothing for them to curate. Worth narrowing to the `shikshak` tier plus `public`, or restating the justification.

**M6 — `image` content type has no viewer.** `ICONS` maps it and the enum allows it, but both clients only offer "open in browser". An image resource is the one type that would benefit most from rendering in place.

---

## Low

**L1** — No `created_by` on `library_items`. Every comparable table records its author; the audit log is the only trace of who published a resource.

**L2** — `library_access_logs` carries both `accessed_at` and `...timestamps()`, so `created_at` duplicates `accessed_at` on every row. Drop one.

**L3** — `updated_at` is never set on patch (`library.ts:375` sets only the patch fields), so the column keeps its insert value and cannot be used to sort recently-edited items.

**L4** — The member feed returns `embed_url`, `file_url` *and* a derived `url` that is one of the two. Three fields for one value invites clients to pick differently — and they do: the web uses `itemUrl(it)`, mobile uses `deliveryUrl(item)`, each reimplementing the server's `deliveryUrl`. Return `url` only.

**L5** — 14 tests, none covering: the `admin-modules` duplicate route, a non-YouTube embed URL, an unsigned `file_url`, or the tier of a parent whose child's `msv_status` changes. The suite tests what was built rather than what the rules require.

---

## What looks good

- **`tiersForUser` resolves from ownership, not role.** A parent gets the `msv` tier because a child of theirs is MSV-approved — the correct model, and it keeps working when a student's status changes without any cache to invalidate.
- **404, not 403, on out-of-tier items** (`library.ts:175-180`), with a comment explaining that it stops the catalogue being enumerable. That is the right instinct and it is rare to see it stated.
- **`POST /:id/access` logs and delivers in one round trip**, and the log write is wrapped so a logging failure never blocks content — non-critical work correctly treated as non-critical.
- **The patch route refuses to edit an item into an undeliverable state** (`:359`). Good defensive thinking about a state the create route also guards.
- **The public feed is correctly filtered** — `is_published = true AND access_tier = 'public'` (`public.ts:157`), and it returns no `file_url`. The docblock's claim about the public surface holds.
- **`safeHref` on the web open path.** The right idea; it just needs to exist on mobile too, and preferably on the server.

---

## Recommended order

1. **C1** — delete the duplicate route. One line of routing, closes a national-publish hole, and confirm the web already uses the survivor.
2. **C2 + C3** — host whitelist on write, scheme/host guard on `POST /:id/access` so every client inherits it. Ship together; C3's server-side guard is what protects rows created before C2 existed.
3. **H2** — soft delete, before more access history is lost.
4. **H1** — sign `file_url` for internal keys. Latent today, silent when it lands.
5. **H3** — pick a semantic for the access log and make the comment true.
6. **M1** — collapse the three library screens onto one component, so the next fix lands once instead of three times.
7. **M2–M6, L1–L5** — as capacity allows. M4 (search/categories) is the one users will ask for first.
