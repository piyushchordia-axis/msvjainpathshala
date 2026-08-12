# Code Review: Library module

**Date:** 2026-08-12
**Scope:** `lib/db/src/schema/library.ts`, migrations 0047/0048/0056/0057, `apps/api-server/src/routes/v1/library.ts` + `admin-library.ts` + the library part of `public.ts`, `apps/api-server/src/lib/library-{tree,manifest,publish,media,audio,sanitize-html}.ts`, web admin/public library pages, mobile library screens/components, and the two library test files. ~7 800 lines.

---

## Summary

The architecture is sound — the draft/published split is clean, the guest-vs-member redaction is enforced server-side in one place and covered by tests, and the authorization chain (editor = `city_admin`, publisher = `super_admin`) is correctly layered. What blocks a merge is not design: an agent debug-instrumentation session was committed across the whole module, including an unauthenticated file-write endpoint on the public API, and the module ships a documented business rule (Q7) unimplemented.

**Verdict: Request changes.** Items 1–2 must be removed before any deploy; 3–7 before the module is considered done.

---

## Critical

| # | File | Line | Issue |
|---|---|---|---|
| 1 | multiple | — | Agent debug telemetry committed across the module | 🔴 Critical |
| 2 | `routes/v1/public.ts` | 19–37 | Unauthenticated debug-log write endpoint | 🔴 Critical |

### 1. Agent debug telemetry committed across the module

Server:

- `routes/v1/admin-library.ts:298–316` — `GET /` wrapped in try/catch purely to POST the error to `http://127.0.0.1:7744/ingest/…`, including `hasAuth`.
- `routes/v1/public.ts:203–236` — fires on the **success** path of `GET /v1/public/library`, i.e. one outbound `fetch` per anonymous request.
- `app.ts:123–126`.

Web: `pages/public/LibraryPage.tsx:45,61,85,102`, `pages/public/LibrarySectionPage.tsx:70`, `pages/admin/library/useLibraryAdminTree.ts:15,32` — all hardcoded to `127.0.0.1:7744`.

Mobile: `lib/library/agent-debug-log.ts` plus call sites in `LibraryAudioContext`, `LibraryTextSheet`, `LibraryMiniPlayer`, `LibraryAudioButton`, `app/library/[sectionId].tsx`, `lib/library/download-queue.ts`.

Every block is marked `// #region agent log`, so removal is mechanical. Leaving it costs a failed DNS/connect per request on the hottest public route and leaks error internals and auth state to whatever answers on port 7744.

**Fix:** strip every `#region agent log` block and delete `agent-debug-log.ts`. Add a lint rule or CI grep for `7744` / `#region agent log`.

### 2. Unauthenticated debug-log write endpoint

```ts
// public.ts:19
const DEBUG_LOG_PATH = path.resolve(process.cwd(), "../../.cursor/debug-4f6edb.log");

router.post("/debug-log", async (req, res) => {
  await mkdir(path.dirname(DEBUG_LOG_PATH), { recursive: true });
  await appendFile(DEBUG_LOG_PATH, `${JSON.stringify({ ...(req.body ?? {}), … })}\n`);
```

No auth, no rate limit, no `NODE_ENV` guard, no size cap beyond the global JSON body limit. Anyone who can reach the API can append arbitrary JSON to a file **outside the app directory**, indefinitely — an unbounded disk-fill DoS plus log injection. The catch returns `err.message` verbatim, disclosing the server path.

**Fix:** delete the route. Its only caller is `agentDebugLog`, which goes away with item 1.

---

## High

### 3. Q7 not implemented — `youtube_url` accepts any string

`admin-library.ts:677` and `:775` declare `youtube_url: z.string().nullable().optional()`. No URL parse, no host allowlist, and no client-side check either (`LibraryItemsPanel.tsx:491` is a bare `<Input>`). CLAUDE.md Q7 requires validating the URL is a valid YouTube or Vimeo link on creation.

`safeHref` (`lib/safe-url.ts:10`) restricts to `http:`/`https:` at render time on both platforms, so this is not XSS — but any admin-pasted link still opens on a child's device via `Linking.openURL` / `window.open`. `icon_url` and `deeplink_target` have the same gap; `deeplink_target` is additionally handed to guests by `library-tree.ts:150`.

**Fix:** a shared Zod refinement in `@workspace/api-zod` — parse the URL, require `https:`, host in `{youtube.com, www.youtube.com, youtu.be, m.youtube.com, vimeo.com, player.vimeo.com}`. Apply to create and patch.

### 4. Publish after reorder throws a unique violation

`library_sections` carries `idx_library_sections_order` — `UNIQUE (order_index) WHERE deleted_at IS NULL` (schema/library.ts:53). `publishSection` (`library-publish.ts:20–36`) copies `draft_order_index` → `order_index` in a single UPDATE.

Reorder swaps sections A and B (drafts become 1 and 0; published still 0 and 1), then publishing B sets `order_index = 0` while A still holds 0 → `23505`, HTTP 500, and the admin has no way to complete the publish. Same for `library_subsections` on `(section_id, order_index)`.

The reorder endpoints already solve this with a two-phase `100_000 + i` offset; publish does not.

**Fix:** publish the whole section list in one transaction with the same two-phase write, or make the published-order indexes `DEFERRABLE INITIALLY DEFERRED`.

### 5. Orphan cleanup can delete in-flight uploads

`cleanupLibraryOrphans` (`library-media.ts:104`) treats any `library/*` key not currently referenced by a live row as an orphan and hard-deletes it from storage. There is no age or grace window and no soft-delete of the storage object. An MP3 uploaded seconds ago but not yet attached to a draft — or attached in a request that is still in flight — is silently destroyed. The repo already has a `media.cleanup_unfinalized` cron for exactly this class of problem; this route bypasses that discipline.

**Fix:** only consider keys older than 24–48 h (`upload_objects.created_at`), and require an explicit confirmation of the key list rather than defaulting to "delete everything unreferenced" when `keys` is empty (`:114`).

### 6. Most write routes skip the audit log

CLAUDE.md: *"All admin actions must write an audit entry."*

Present on: section create / patch / delete / publish / unpublish, item create, orphan cleanup.

**Missing on:** subsection patch (`:581`), delete (`:605`), publish (`:619`), unpublish (`:628`); item patch (`:754`), delete (`:800`), publish (`:814`), unpublish (`:823`); all three reorder routes (`:500`, `:637`, `:832`); every panchang route (`:1071`, `:1120`, `:1157`, `:1214`, `:1233`); both audio upload routes (`:901`, `:955`).

Publishing content to the whole network and deleting items are precisely the actions that need a trail.

### 7. No integration tests for the admin write surface

1 279 lines of admin routes are covered by `library-admin-unit.test.ts` (55 lines — sanitizer, filename parse, zod details, URL key) and `library.test.ts` (read-only tree). Nothing exercises publish semantics, reorder, the `city_admin` vs `super_admin` boundary, audio upload, panchang, or orphan cleanup. Items 4 and 6 would both have been caught by a single publish-after-reorder test.

---

## Medium

| # | File | Line | Issue | Category |
|---|---|---|---|---|
| 8 | `library-publish.ts` | 14–36 | SELECT-then-UPDATE outside a transaction; `content_version: row.content_version + 1` is a read-modify-write. Concurrent publishes collide on the version clients cache against. Use `sql\`content_version + 1\`` in one statement. | Correctness |
| 9 | `library-publish.ts` | 138–140 | `sect: String(draft["sect"])`, `Number(draft["vikramSamvat"])` read unvalidated JSONB into typed columns — `NaN` on malformed draft. CLAUDE.md requires JSONB validated against Zod before writing. | Correctness |
| 10 | `admin-library.ts` | 1121, 1158, 1218, 1237 | `Number(req.params.year)` with no `Number.isFinite` guard (only the GET at `:1049` has one). `/panchang/years/abc` → `NaN` into the query → 500. | Correctness |
| 11 | `admin-library.ts` | 1157–1212 | Day PATCH is a read-modify-write of the entire year JSONB with no locking. Two admins editing different days silently overwrite each other, and each edit rewrites all 365 days. | Correctness |
| 12 | `admin-library.ts` | 377, 732, 1112 | Unique violations detected by `msg.includes("unique")`. A concurrent-create collision on `draft_order_index` is reported to the admin as *"A section with that key already exists"*. Check `err.code === '23505'` and the constraint name. | Correctness |
| 13 | `admin-library.ts` | 955–1028 | `/audio/bulk`: 40 files × 96 MB, each fully buffered (`readFile` → `Buffer`) and transcoded serially in-request. No ffmpeg concurrency cap. The proxy will time out while transcodes continue. Belongs in a BullMQ job. | Performance |
| 14 | `library-audio.ts` | 62–112, 46–60 | `probeDurationSec` runs ffprobe **twice** (the comment at `:82` says so). `runCmd` has no timeout — a crafted MP3 can hang ffmpeg and the request indefinitely. | Performance |
| 15 | `library-audio.ts` | 136, 177–179 | `finally` unlinks `in.mp3`/`out.mp3` but never `rmdir`s the `mkdtemp` directory. One leaked temp dir per upload, unbounded. | Correctness |
| 16 | `library-media.ts` | 88–99, 108–109 | `sizeForKey` stats every file serially; `cleanupLibraryOrphans` calls `collectReferencedLibraryKeys()` directly *and* again inside `getLibraryMediaUsage()` — two full table scans and a duplicate stat sweep per cleanup. | Performance |
| 17 | `admin-library.ts` | 833–857 | `/items/reorder` parses `section_id`/`subsection_id` then destructures only `ids` (`:843`) — the scope is never applied, so any item id can be reordered into any list. Phase 2 (`:851–856`) also drops the `isNull(deleted_at)` guard that phase 1 has. | Correctness |
| 18 | `admin-library.ts` | 512, 649, 848; 61 | Magic offset `100_000 + i` collides if any live row already sits at ≥ 100 000. `reorderSchema` has `.min(1)` but no `.max()` — a large `ids` array becomes unbounded sequential UPDATEs in one transaction. | Correctness |
| 19 | `admin-library.ts` | 693, 771 | `subsection_id` is never checked to belong to the item's `section_id`. A cross-section value produces an item that disappears from the tree (grouped by `subsection_id`, filtered by `section_id` in `library-tree.ts:116–127`). | Correctness |
| 20 | `library-sanitize-html.ts` (both copies) | 86–102 | The close-tag loop scans for `stack[i].tag === tagName` but then calls `stack.pop()`, which removes the **top** frame, not `stack[i]`. "Pop until matching" is not what the code does; mismatched markup yields wrong nesting. Not an allowlist bypass. | Correctness |
| 21 | api-server / web / mobile | — | Three divergent copies of `sanitizeLibraryHtml` (161 / 204 lines / a third per the sync comment at web `:6`). A security control kept in sync by comment will drift. Move to a shared package. | Maintainability |
| 22 | `library-sanitize-html.ts` | 22–31 | `decodeBasicEntities` decodes `&amp;` before `&lt;`, so `&amp;lt;` becomes `<` and re-escapes to `&lt;` — the reader sees `<` where the author typed a literal `&lt;`. Safe, but lossy. | Correctness |
| 23 | `schema/library.ts` | 51, 132, 155 | `idx_library_sections_key`, `idx_library_items_item_code` and `uq_panchang_years_year` are **not** partial on `deleted_at IS NULL`, unlike every order index. A soft-deleted section permanently burns its `key`; a soft-deleted item burns its `item_code` (which bulk audio matches on). `uq_panchang_years_year` is unique on `year` alone despite the `sect` column, so two sects can never coexist for one year. | Correctness |
| 24 | `admin-library.ts` | 678–680 | No length cap on `text_content_*` (bare `z.string()`), and `sanitizeLibraryHtml` has no input size guard. | Performance |

---

## Low

- `library-media.ts:122` — `db.delete(upload_objects).where(and(inArray(upload_objects.key, [key])))` should be `eq(...)`; also one DELETE per key rather than a batch.
- `library-publish.ts:40–47` and peers — `unpublish*` does not bump `content_version`.
- `admin-library.ts:282–293` — the admin tree runs a `.filter()` over all items per section; quadratic, fine at current scale.
- `library-tree.ts:37` — `signUploadUrl` computes an HMAC per item on every tree request.
- `library-audio.ts:129–131` — `input[1]!` / `input[2]` assert non-null on a buffer that may be shorter than 3 bytes.

---

## What looks good

- **Authorization is layered correctly.** `admin.ts:123` puts the router behind `requireAuth, requireAdminPanel`; `admin-library.ts:58` applies `requireMinRole("city_admin")` to everything; every publish, unpublish, delete and the media cleanup additionally require `requireRole("super_admin")`. Editor and publisher are cleanly separated.
- **Guest/member redaction is server-side and single-sourced.** `buildLibraryTree` and `buildLibrarySection` both gate children on `requires_login`, gated sections ship as shells so the UI can prompt for login, and `library.test.ts:150–193` covers exactly that boundary — including asserting no stray gated item ids leak into the guest manifest.
- **Signed-URL model for `/uploads`** is the right primitive, uses `timingSafeEqual`, and hard-fails on a missing secret in production.
- **The sanitizer is a closed allowlist**, not a blocklist: text nodes are escaped, the only permitted attribute value is matched against a four-member set. The right architecture despite the nits above.
- **Soft delete throughout**, with partial unique indexes on the order columns.
- **`spawn` with array args, no shell** in the ffmpeg path — no command injection.
- **Bulk audio returns per-file results** instead of failing the whole batch.
- **Trilingual (en/hi/gu) modelling is consistent** across all three tables with shared fallback helpers.

---

## Suggested order of work

1. Strip all `#region agent log` blocks + delete `agent-debug-log.ts` and `POST /v1/public/debug-log` (items 1–2).
2. Add the YouTube/Vimeo refinement and apply it to `icon_url` / `deeplink_target` too (item 3).
3. Fix publish ordering (item 4) and add the publish-after-reorder regression test.
4. Add the missing audit entries (item 6).
5. Add a grace window to orphan cleanup (item 5).
6. Extract the sanitizer to a shared package (item 21), then fix the close-tag pop (item 20) once, not three times.
7. Backfill admin route integration tests (item 7).
