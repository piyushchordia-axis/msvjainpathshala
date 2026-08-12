# Library Enhancement — section/subsection tree

> Design document. No code has been written against this yet.
> Status: **draft for review**. Open questions in §12 need answers before implementation.
> Convention: binding rules are numbered `LB1…LB24`, matching the house `AT*` (attendance) and `CU*` (curriculum) style. Where a rule contradicts `SPEC.md`, the rule wins, exactly as `CLAUDE.md` does.

---

## 1. What this changes

The library is today a **flat list of 13-column rows**. `lib/db/src/schema/library.ts` has no parent, no ordering column, no in-app content — every item is a link that leaves the app. It is the most isolated module in the platform: no curriculum link, no offline story, no i18n keys, and two parallel client code paths (guest vs member) that render the same component.

This document restructures it into a **two-level tree** that a member or a guest browses the same way:

```
Library
└── Section              e.g. "Stavan & Bhakti", "Tattvarth Sutra", "For new parents"
    └── Subsection       one piece of content, of a declared kind
        ├── text          → opens in-app (bilingual body, scrollable screen)
        ├── audio         → uploaded file or external stream
        ├── video_embed   → YouTube/Vimeo, redirects out
        ├── pdf           → signed download / external link
        ├── image         → signed download / external link
        └── course_link   → redirects into the existing course tree
```

The tree is the **same tree pre-login and post-login**. A guest sees every section and every subsection title; gated subsections render locked with a sign-in call to action instead of vanishing. That single change is what turns the library from a link dump into the platform's front door.

**Not in this document** (deliberate — see §11): search, tags, per-city scoping, Punya for reading, AI anything.

---

## 2. Binding rules

### LB1 — Exactly two levels, never three
`Section → Subsection`. Sections do not nest. There is no `parent_section_id`. This mirrors CU1's refusal to let the course tree grow a fourth level, for the same reason: every extra level doubles the navigation code on three clients and is never used by more than two sections.

A subsection is a **leaf**. It holds content; it never holds children.

### LB2 — Vocabulary mirrors courses
Tables are `library_sections` and `library_subsections`. `library_items` is **renamed** to `library_subsections` via `ALTER TABLE … RENAME TO`, following the `0051_curriculum_courses.sql` precedent (`curricula → courses`) — never drop-and-recreate, because `library_access_logs` holds a foreign key and real access history.

The rename is not cosmetic. A Guruji, a Sanchalak and a developer should carry **one** mental model of "section → subsection" across courses and library. Two vocabularies for one shape is a tax paid at every handover.

Consequence: `library_access_logs.library_item_id` is renamed `library_subsection_id`, and the two indexes that reference it — `idx_library_access_logs_item` and `idx_library_access_logs_item_user` — are renamed with `ALTER INDEX … RENAME TO`. `idx_library_access_logs_user` is on `user_id` alone and is untouched.

### LB3 — `order_index`, dense, and actually unique
The ordering column is `order_index` (integer, NOT NULL, DEFAULT 0) on both tables — the house name, used by `course_template_sections`, `course_template_subsections`, `course_sections`, `course_subsections`, `exam_questions`, `exam_question_options`, `quiz_event_questions` and `push_quiz_questions`. Never `sort_order` or `position`.

(`join_form_fields.display_order` at `lib/db/src/schema/join.ts:54` is the one exception in the schema. It predates the convention and is not a precedent to follow.)

**Divergence from courses, deliberate:** the course tree has *no* unique constraint on `(parent_id, order_index)` and creates children with a racy `coalesce(max(order_index), -1) + 1`. Two concurrent creates produce duplicates and reads become nondeterministic (`ORDER BY order_index ASC` has no tiebreaker). The library gets it right:

```sql
CREATE UNIQUE INDEX idx_library_subsections_order
  ON library_subsections (section_id, order_index)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_library_sections_order
  ON library_sections (order_index)
  WHERE deleted_at IS NULL;
```

A partial unique index cannot be `DEFERRABLE`, so the reorder endpoint must be **two-pass** inside its transaction:

1. `UPDATE … SET order_index = -(order_index + 1) WHERE section_id = $1 AND deleted_at IS NULL`
2. assign final `0 … n-1` from the submitted array

Creation still appends at `max + 1`, but now a race surfaces as a `23505` unique violation the handler retries once, rather than as silent corruption. This should be backported to `course_sections` / `course_subsections` later; it is out of scope here.

### LB4 — Reorder replaces the whole list, exactly
`POST …/reorder` takes the full array of live child IDs. The array must be *exactly* the set of non-deleted children — same size, no duplicates, no foreign IDs — else `422 ERR_VALIDATION_FAILED`. Copied verbatim from `courses.ts:644-680`, and it is what makes reorder structurally incapable of re-parenting or dropping a node.

### LB5 — `content_type` enum: rename `video`, add `text` and `course_link`
`library_content_type_enum` becomes:

```
pdf | video_embed | audio | image | text | course_link
```

`video` is renamed to `video_embed`, resolving the standing conflict between `CLAUDE.md` Q7 (which says `type='video_embed'`) and the schema (which said `video`) — flagged in code comments at `library.ts:233` and `:304`. **CLAUDE.md wins**, per its own precedence rule. Those two comments are deleted with the rename.

`LIBRARY_CONTENT_TYPES` in `lib/db/src/schema/enums.ts:101` is the source; the hand-duplicated copy at `lib/api-zod/src/contracts.ts:146` must be derived from it, not re-typed.

### LB6 — One payload per kind, enforced by a CHECK
Today `embed_url` and `file_url` are free-text and nothing stops a row from having both, neither, or the wrong one — which is why the seed stores PDF and audio URLs in `embed_url`. The new table adds `body_en`, `body_hi`, `body_format` and `course_id`, and a constraint makes the payload match the kind:

```sql
ALTER TABLE library_subsections
  ADD CONSTRAINT library_subsections_payload_check CHECK (
    CASE content_type
      WHEN 'text' THEN
        body_en IS NOT NULL AND embed_url IS NULL AND file_url IS NULL AND course_id IS NULL
      WHEN 'course_link' THEN
        course_id IS NOT NULL AND embed_url IS NULL AND file_url IS NULL AND body_en IS NULL
      WHEN 'video_embed' THEN
        embed_url IS NOT NULL AND file_url IS NULL AND course_id IS NULL AND body_en IS NULL
      ELSE  -- pdf, audio, image
        ((file_url IS NOT NULL) <> (embed_url IS NOT NULL))
        AND course_id IS NULL AND body_en IS NULL
    END
  ) NOT VALID;
```

`pdf`, `audio` and `image` accept **either** an uploaded `file_url` **or** an external `embed_url`, exclusively — this preserves today's behaviour, including the existing test asserting an arbitrary `https` URL is valid on a `pdf` (`library.test.ts:455`).

Added `NOT VALID`, then `VALIDATE CONSTRAINT` **in a later migration file**, after the backfill has run. Note that `0051` adds and validates within one file, which forfeits most of the benefit — the `ACCESS EXCLUSIVE` lock is held across the validation scan anyway. Splitting across files is the correction, not the precedent.

### LB7 — `access_tier` lives on the subsection only
Sections are **pure organisation** and carry no tier. A single section may hold public, member and MSV subsections side by side — and it should, because that mixture is the entire conversion mechanic: a guest reads two free stavans in a section and sees the third is for members.

Putting a tier on the section would force curators to duplicate sections per tier and would make "3 of 7 available" impossible to express.

### LB8 — Locked, not hidden
**This is the central behavioural change.** Today `GET /v1/public/library` filters out every non-public row (`public.ts:174-180`) and `GET /v1/library` filters to the caller's tiers, so the tier badge rendered at `LibraryView.tsx:144-147` is dead code a guest never sees.

From now on, the tree returns **every published subsection to everyone**, with a `locked: boolean` computed per viewer. A locked subsection returns its `id`, `title_en/hi`, `description_en/hi`, `content_type`, `access_tier` and `order_index`, and returns **no delivery payload whatsoever** — no `file_url`, no `embed_url`, no `body_en`, no `course_id`, no signed URL.

Titles and descriptions are marketing copy; treating them as secrets costs a conversion funnel and protects nothing. Delivery URLs are the actual secret and remain gated at `POST …/open`.

### LB9 — Therefore 403, not 404
`library.ts:213-216` currently returns **404** for an out-of-tier item so the catalogue cannot be enumerated. Under LB8 the catalogue is deliberately public, so anti-enumeration no longer buys anything, and the 404 actively hurts: the client cannot tell "gone" from "locked" and cannot show the right call to action.

`POST /v1/library/subsections/:id/open` on a locked subsection returns **403 `ERR_LIBRARY_TIER_LOCKED`**, with `required_tier` in `details`. A genuinely missing or unpublished or soft-deleted subsection still returns 404.

This reverses the `SPEC.md` Step 22 exit-criteria divergence noted in the module review — the spec's 403 is now correct, and the review note should be closed rather than the spec amended.

### LB10 — One tree endpoint for both audiences
`GET /v1/library/tree` serves guests and members from the same handler behind a new **`optionalAuth`** middleware: parse and verify the bearer token if present, attach `req.user`, and do **not** 401 when it is absent. No such middleware exists today — every router either calls `requireAuth` or omits auth entirely (`public.ts` has no import of it at all). This is net-new and must be written carefully; a bug that silently swallows an *invalid* token would downgrade a member to guest without telling them.

Tier resolution reuses `tiersForUser()` (`library.ts:67-98`) extended to accept `null`, returning `['public']`.

This deletes `GET /v1/public/library`, the duplicate client fetch branches at `LibraryView.tsx:69-75` and `LibraryPage.tsx:133-137`, and the dead `GET /v1/admin/library` at `admin-resources.ts:256`.

### LB11 — Cache-Control must vary on authentication
`/v1/public` gets `Cache-Control: public, max-age=60, stale-while-revalidate=300` from a path-scoped middleware at `app.ts:180-184`. Moving the tree to `/v1/library` drops out of that path, which is **fortunate**, because blanket-caching an endpoint whose response now depends on the caller's tier is a cache-poisoning bug waiting for a CDN.

The handler sets headers explicitly:

- unauthenticated → `Cache-Control: public, max-age=60, stale-while-revalidate=300`
- authenticated → `Cache-Control: private, no-store`
- always → `Vary: Authorization`

No response-cache helper exists in the codebase (`lib/auth-user-cache.ts` is domain-specific and hard-wired to `AuthUserRow`). Server-side caching of the guest tree is a follow-up, not v1.

### LB12 — Rate limit the unauthenticated tree by IP
`/v1/public/*` is currently unauthenticated **and** unthrottled. The tree endpoint is heavier than the flat list, so it gets `rateLimit("library:tree:ip:" + req.ip, 60, 60)` when `req.user` is absent, using the existing helper (`lib/ratelimit.ts`) — called inline in the handler, since that helper is not middleware.

Two properties to carry knowingly: it **fails open** on any Redis error (`ratelimit.ts:115-119`), and it is a no-op under `NODE_ENV=test` unless `JP_TEST_RATE_LIMIT=1`.

### LB13 — Text bodies are not in the tree
`GET /v1/library/tree` returns metadata plus `has_body: boolean`. The body comes from `GET /v1/library/subsections/:id`. A library of 200 articles must not ship every article on every home-screen load, and the tree must stay small enough to cache and to persist offline.

### LB14 — `body_format` exists from day one, defaulting to `plain`
`body_en` / `body_hi` are `text`; `body_format` is `text NOT NULL DEFAULT 'plain'` with `CHECK (body_format IN ('plain','markdown'))`.

v1 renders `plain` only, as raw `<Text>` — matching how course subsection descriptions render today (`app/course/[id]/section/[sectionId].tsx:199-220`), and no markdown or HTML library is installed on any client.

The column exists now because plain text is **not** safely reinterpretable as markdown later — underscores and asterisks in existing Hindi transliteration would silently become emphasis. One column now avoids a data-repair migration then.

Length cap: `z.string().max(20000)` at the API. Courses cap descriptions at 4000 (`courses.ts:684-687`); library text is long-form and needs more.

### LB15 — Text opens as a screen, not a modal
Course subsections open in a bottom-sheet `<Modal>`. Library text opens as a **full route** — `app/library/subsection/[id].tsx` on mobile, `/library/s/:sectionId/:subsectionId` on web.

Deliberate divergence: library text is long-form (a stavan with meaning, an article for new parents), needs scroll position, a language toggle, adjustable font size and a share affordance. A sheet gives none of those, and a route is shareable and deep-linkable where a sheet is not.

### LB16 — `course_link` is resolved server-side, never client-side
A `course_link` subsection stores `course_id uuid REFERENCES courses(id) ON DELETE RESTRICT`.

The client must **not** decide whether the course is reachable. CU3 visibility (`status='active'` AND (`city_id IS NULL` OR matches the student's centre city) AND if `kind='msv'` then `students.msv_status='approved'`) is server logic, and `GET /v1/courses/:id/tree` hard-requires a `student_id` and 422s without one (`courses.ts:352`).

So `POST …/open` on a `course_link` returns one of three states:

| Viewer | Result |
|---|---|
| Guest | `403 ERR_LIBRARY_TIER_LOCKED` — client shows the sign-in wall |
| Member, course visible to the active student | `200 { kind: 'course', course_id, route: '/course/<id>' }` |
| Member, course not visible (wrong city, MSV not approved, archived) | `200 { kind: 'course_unavailable', reason_code }` |

`course_unavailable` is a 200, not a 403 — the subsection is legitimately visible to this member, the *course behind it* is not applicable to their child. Conflating the two would show a "sign in" prompt to someone already signed in. `reason_code` is one of `CITY_MISMATCH`, `MSV_NOT_APPROVED`, `NOT_ACTIVE`, and the client renders a plain sentence, never the code.

**Which child?** Resolution uses `useSessionView()`'s `activeStudentId` on mobile, sent as `student_id`. If a parent has multiple children, the answer depends on the active student — which is correct and already how `/course/:id` behaves. See open question §12.3 for the multi-child edge.

### LB17 — One open endpoint for every kind
`POST /v1/library/subsections/:id/open` is the single delivery + logging path, replacing `POST /v1/library/:id/access`. It always logs, and returns a discriminated result:

```ts
| { kind: 'file';    url: string }   // pdf, image, audio (uploaded)  — signed
| { kind: 'external'; url: string }  // video_embed, and pdf/image/audio with embed_url
| { kind: 'text';    /* no url */ }  // body already fetched via the detail route
| { kind: 'course';  course_id: string; route: string }
| { kind: 'course_unavailable'; reason_code: string }
```

The server re-validates the **stored** URL on every open — scheme must be `http(s)`, and `video_embed` must pass `isVideoEmbedUrl` — returning `409 ERR_NO_CONTENT_URL` otherwise. This guard already exists (`library.ts:226-243`) and protects legacy rows; keep it.

Signed-URL TTL is unchanged: `GATED_LIBRARY_TTL_SECONDS = 3600` for gated tiers, provider default for public. Note that both currently resolve to 3600 unless env overrides, so the distinction is presently a no-op — worth either making real or deleting, but not in this change.

### LB18 — Guest engagement is a counter, not a log row
`library_access_logs` has a partial unique on `(subsection_id, user_id) WHERE user_id IS NOT NULL`, so guest opens have nothing to deduplicate against and would accumulate one row per tap, forever.

Guests instead increment `library_subsections.guest_open_count` (`integer NOT NULL DEFAULT 0`) with a single atomic `UPDATE … SET guest_open_count = guest_open_count + 1`. No row, no PII, no unbounded growth, and the admin list gains a genuinely useful "public reach" number it does not have today.

Member logging is unchanged: the existing `onConflictDoUpdate` upsert bumping `last_accessed_at` and `access_count`.

### LB19 — Publishing is an AND across both levels
`is_published boolean NOT NULL DEFAULT true` on both tables. Effective visibility is `section.is_published AND subsection.is_published AND both deleted_at IS NULL`. No new status enum — the existing boolean is sufficient and a three-state would need a state machine nobody asked for.

Publish gate, enforced in the service layer: a subsection cannot be set `is_published = true` without `title_hi` and a payload valid for its `content_type`. This is the CU4/CU5 publish-gate idea at subsection granularity, and it is what stops an English-only or empty row reaching a member.

### LB20 — Soft delete cascades down; FKs RESTRICT
Soft-deleting a section sets `deleted_at` on the section **and all its subsections in the same transaction**, mirroring `softDeleteCourseNode()` (`services/course-admin.ts:131-253`). All foreign keys are `ON DELETE RESTRICT` per CU29 — the FK is the safety net, not the guard.

There is no library equivalent of CU20's certification block, so nothing prevents deletion; but the admin delete confirmation must stop saying *"This cannot be undone"* (`LibraryAdminPage.tsx:374`), because it is a soft delete and that copy is simply false.

### LB21 — Writes stay super_admin-only, and this is a known limitation
`library_sections` and `library_subsections` have **no `city_id`**, so there is no scope to check and no safe way to let a city_admin write. Writes therefore remain `super_admin` only, exactly as today (`library.ts:282-284`), where that restriction is a *consequence* of the missing column rather than a policy.

This is called out as a limitation, not a design goal. Adding `city_id` to `library_sections` and wiring `lib/quiz-scope.ts` (which is already parameterised by a `ScopeCols` map and needs no modification) is the single change that would unlock delegated authoring, per-city curation and targeted "new item published" notifications. It is out of scope here on purpose — see §11.

### LB22 — The Q7 host whitelist is unchanged
`video_embed` continues to accept only the hosts in `lib/validation.ts:35-43` (YouTube, `youtu.be`, Vimeo, `player.vimeo.com`). The router should now use the existing `videoEmbedUrl()` Zod helper at `validation.ts:60` instead of re-inlining `httpUrl(2000)` + `superRefine`; the helper is defined and currently unused.

Audio embeds are **not** whitelisted in v1 — `audio` with an `embed_url` accepts any `https` host, matching how `pdf` behaves today. See open question §12.2.

### LB23 — Every string comes from i18n
The library has **zero** i18n keys today; all copy is inline ternaries like `hi ? "पुस्तकालय" : "Digital library"` scattered across `LibraryView.tsx`, `LibraryPage.tsx`, three `_layout.tsx` files and `guest/home.tsx:62`, and the admin page is English-only.

Every new string lands in `lib/i18n/src/locales/en.json` and `hi.json` under a `library.*` namespace, and the existing inline ternaries are migrated in the same change. Hindi is Devanagari — no transliteration. Layouts tolerate +35% string length.

### LB24 — The tree is persisted offline; files are cached, not URLs
`lib/query-persist-keys.ts` is a three-entry allowlist and `["library", …]` is not in it, so the library is empty offline today. Add the tree query key — a one-line change that makes the whole catalogue readable on a bad connection, and text subsections fully readable, since their bodies persist with the query cache.

Binary download (pdf, audio) follows the working precedent at `app/admin/reports.tsx:90-91` — `expo-file-system` `downloadAsync` into `cacheDirectory`. **Cache the file, never the URL**: signed URLs expire in an hour, so a persisted `url` is a guaranteed failure on the next open.

### LB25 — Fix `tiersForUser` before shipping LB8
`tiersForUser` short-circuits to **all four tiers** for anyone passing `canAccessAdminPanel(role)` (`library.ts:67-98`) — which is every admin role *and* shikshak. So a sanchalak or a city_admin silently receives `shikshak`-tier content, and this was raised as finding M5 in the module review and never closed.

Today the blast radius is small because gated rows are filtered out and nobody sees a tier they lack. Under LB8 the tier drives a visible `locked` flag on every row, so a wrong tier becomes a wrong *screen* for four roles at once. Resolve tiers by explicit role mapping — `shikshak` tier for `shikshak` and above, `student`/`msv` derived from owned students as today — rather than by "can this role open the admin panel", which answers a different question.

This is a prerequisite for LB8, not a follow-up.

---

## 3. Schema

### `library_sections` (new)

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | uuid PK | no | `gen_random_uuid()` | |
| `title_en` | text | no | — | |
| `title_hi` | text | no | — | required; sections are few and curated |
| `description_en` | text | yes | — | short blurb under the section heading |
| `description_hi` | text | yes | — | |
| `icon` | text | yes | — | Ionicon name, validated against an allowlist |
| `cover_url` | text | yes | — | optional card image, signed like any upload |
| `order_index` | integer | no | `0` | LB3 |
| `is_published` | boolean | no | `true` | LB19 |
| `created_by` | uuid FK → `users.id` SET NULL | yes | — | closes review finding L1 |
| `deleted_at` | timestamptz | yes | — | |
| `created_at` / `updated_at` | timestamptz | no | `now()` | |

Index: `idx_library_sections_order` — partial unique on `(order_index) WHERE deleted_at IS NULL`. It doubles as the ordered-read index, so no separate "alive" index is needed.

### `library_subsections` (renamed from `library_items`)

Existing columns retained: `id`, `content_type`, `title_en`, `title_hi`, `description_en`, `description_hi`, `embed_url`, `file_url`, `access_tier`, `is_published`, `deleted_at`, `created_at`, `updated_at`.

Added:

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `section_id` | uuid FK → `library_sections.id` RESTRICT | **no** (after backfill) | — | |
| `order_index` | integer | no | `0` | LB3 |
| `body_en` | text | yes | — | `text` kind only |
| `body_hi` | text | yes | — | |
| `body_format` | text | no | `'plain'` | `CHECK IN ('plain','markdown')` — LB14 |
| `course_id` | uuid FK → `courses.id` RESTRICT | yes | — | `course_link` kind only |
| `guest_open_count` | integer | no | `0` | LB18 |
| `created_by` | uuid FK → `users.id` SET NULL | yes | — | |

Constraints: `library_subsections_payload_check` (LB6).

Indexes: the partial unique from LB3, plus `idx_library_subsections_section` on `(section_id) WHERE deleted_at IS NULL`, and — closing a long-standing gap — `idx_library_subsections_tier` on `(access_tier)` and `idx_library_subsections_type` on `(content_type)`. Both columns are filtered on by the API today and neither is indexed.

### `library_access_logs`
Unchanged in shape. `library_item_id` renamed to `library_subsection_id`; the three indexes renamed to match.

---

## 4. Migration sequence

Six files. The split is not stylistic — `ALTER TYPE … ADD VALUE` cannot be *used* in the same transaction that adds it, and Drizzle wraps each migration file in a transaction. Enum changes and enum usage must therefore live in different files.

| # | File | Contents |
|---|---|---|
| 1 | `00NN_library_enum_values.sql` | `ALTER TYPE library_content_type_enum RENAME VALUE 'video' TO 'video_embed'` (transactional, PG10+); `ADD VALUE 'text'`; `ADD VALUE 'course_link'`. **Nothing else.** |
| 2 | `00NN_library_sections.sql` | `CREATE TABLE library_sections`; `ALTER TABLE library_items RENAME TO library_subsections`; `ALTER INDEX` renames; `ALTER TABLE library_access_logs RENAME COLUMN library_item_id TO library_subsection_id`; add nullable `section_id`, `order_index`, `body_*`, `course_id`, `guest_open_count`, `created_by`; new FKs added `NOT VALID`. |
| 3 | `00NN_library_backfill.sql` | Insert a `"General"` / `"सामान्य"` section; assign every existing subsection to it with `order_index` by `created_at`; **repair the seed rows** that put PDF and audio URLs in `embed_url` (see §5); `SET section_id NOT NULL`. |
| 4 | `00NN_library_constraints.sql` | `VALIDATE CONSTRAINT` on the FKs; add `library_subsections_payload_check` `NOT VALID` then `VALIDATE`; create the partial unique and filter indexes. |
| 5 | `00NN_library_notification_kind.sql` | *(optional, only if §12.6 is answered yes)* `ALTER TYPE notification_kind_enum ADD VALUE 'library_published'`, per the `0045` precedent. |
| 6 | `00NN_library_seed.sql` | Replace the 3-item seed with a realistic tree — at least 4 sections covering every content kind and every access tier, so the locked-state UI has something to render in dev. `SPEC.md` §13.12 asks for 60 items; that is the target. |

Rollback for file 1 is the awkward one: Postgres has no `ALTER TYPE … DROP VALUE`. Rolling back past migration 1 requires recreating the type. Note this in the deploy runbook and treat migration 1 as forward-only.

---

## 5. Data repair

Two repairs, one required and one conditional.

**Required — `section_id` backfill.** Every existing row needs a section. Migration 3 inserts a `"General"` / `"सामान्य"` section and assigns all rows to it, `order_index` ordered by `created_at`, then sets `section_id NOT NULL`. Straightforward, and the only reason `section_id` is added nullable in migration 2.

**Conditional — `embed_url` rows that should be `file_url`.** The three seed rows at `lib/db/src/seed.ts:986-1016` put the audio and PDF URLs in `embed_url`, but their values are external (`https://example.org/audio/stavan-1.mp3`, `https://example.org/pdf/values-guide.pdf`). Under LB6's CHECK that is **legal** — `pdf`, `audio` and `image` accept either column — so nothing is broken and no repair is needed for seed data.

The rows that *would* need repair are production rows where an admin uploaded a file through the dialog and the URL landed in `embed_url`. The predicate for those is exact:

```sql
UPDATE library_subsections
   SET file_url = embed_url, embed_url = NULL
 WHERE content_type IN ('pdf','audio','image')
   AND embed_url LIKE '%/uploads/%';
```

Run it as a **reversible check-then-apply**, not blind: count the matches on production first. If the count is zero, drop the statement from the migration entirely rather than shipping dead SQL.

---

## 6. API surface

### Read — `optionalAuth`

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/library/tree` | Full tree, `locked` per LB8. Rate limited by IP when unauthed (LB12). Cache headers per LB11. |
| GET | `/v1/library/sections/:id` | One section + its subsections |
| GET | `/v1/library/subsections/:id` | Detail; includes `body_en`/`body_hi` only when unlocked |
| POST | `/v1/library/subsections/:id/open` | Log + resolve delivery (LB17) |

### Write — `requireAuth` + `requireAdminPanel` + super_admin (LB21)

| Method | Path |
|---|---|
| GET | `/v1/library/admin/tree` — structure-only, all rows incl. drafts, `access_count` + `guest_open_count` |
| POST | `/v1/library/sections` |
| PATCH | `/v1/library/sections/:id` |
| DELETE | `/v1/library/sections/:id` *(soft, cascades — LB20)* |
| POST | `/v1/library/sections/reorder` |
| POST | `/v1/library/sections/:id/subsections` |
| PATCH | `/v1/library/subsections/:id` |
| DELETE | `/v1/library/subsections/:id` *(soft)* |
| POST | `/v1/library/sections/:id/subsections/reorder` |

`GET /v1/library/admin/tree` is read-only for **all** admin-panel roles (unchanged from today's `/v1/library/admin`); only the writes are super_admin.

### Removed

| Route | Disposition |
|---|---|
| `GET /v1/public/library` | Deleted. Superseded by `/v1/library/tree` unauthed. Keep as a 200 alias for one release if any external caller exists. |
| `GET /v1/library` (flat) | Deleted. |
| `POST /v1/library/:id/access` | Deleted → `/v1/library/subsections/:id/open`. |
| `GET /v1/admin/library` (`admin-resources.ts:256`) | Deleted — dead duplicate with no caller. |
| `POST/PATCH/DELETE /v1/library[/:id]` | Become the subsection routes above. |

### Tree response shape

```jsonc
{
  "data": {
    "viewer": { "authed": true, "tiers": ["public", "student"] },
    "sections": [
      {
        "id": "…", "title_en": "…", "title_hi": "…",
        "description_en": "…", "description_hi": "…",
        "icon": "musical-notes-outline", "cover_url": null, "order_index": 0,
        "subsection_count": 7, "locked_count": 3,
        "subsections": [
          {
            "id": "…", "title_en": "…", "title_hi": "…",
            "description_en": "…", "description_hi": "…",
            "content_type": "text", "access_tier": "public",
            "order_index": 0, "locked": false, "has_body": true
          },
          {
            "id": "…", "title_en": "…", "title_hi": "…",
            "description_en": null, "description_hi": null,
            "content_type": "video_embed", "access_tier": "msv",
            "order_index": 1, "locked": true, "has_body": false
          }
        ]
      }
    ]
  },
  "meta": { "request_id": "…", "timestamp": "…", "count": 4 }
}
```

`locked_count` lets a section header read *"3 of 7 need a sign-in"* without the client walking the array.

Note there is no `url` field anywhere in the tree — delivery is always a separate `POST …/open`, for locked and unlocked alike. One code path, no client-side URL resolution, and the double-resolution bug at `LibraryView.tsx:47` / `LibraryPage.tsx:48` disappears.

### Errors
Add to `apps/jp-shared/src/errors.ts`, per CU32's precedent:

- `ERR_LIBRARY_TIER_LOCKED` (403) — LB9
- `ERR_LIBRARY_SECTION_NOT_EMPTY` (409) — reserved if hard delete is ever added
- `ERR_LIBRARY_PAYLOAD_INVALID` (422) — payload does not match `content_type`
- `ERR_LIBRARY_NOT_PUBLISHABLE` (422) — LB19 gate, with `{ reasons, fixes }` like `ERR_COURSE_NOT_PUBLISHABLE`

---

## 7. Mobile

### Routes
```
app/library/index.tsx                  section list (replaces the flat LibraryView)
app/library/section/[id].tsx           subsection list
app/library/subsection/[id].tsx        text reader (LB15)
```

The existing `app/guest/library.tsx`, `app/parent/library.tsx`, `app/student/library.tsx` stay as five-line wrappers so the tab bars are untouched, but all three now render the section list.

**Add the library tab to `app/shikshak/_layout.tsx`.** A `shikshak` access tier exists in the enum and is resolvable by `tiersForUser`, yet there is no shikshak-facing surface anywhere — content targeted at Gurujis is currently unreachable by Gurujis.

### Per-kind behaviour

| Kind | Tap behaviour |
|---|---|
| `text` | push `app/library/subsection/[id]` — in-app reader, scrollable, language toggle, works offline |
| `audio` | **In-app player.** `expo-audio ~1.1.1` is already a dependency and already used in `components/NiyamProofPicker.tsx:12` — no new package needed |
| `video_embed` | `POST …/open` → `Linking.openURL`, guarded by `safeHref`. In-app WebView is a follow-up |
| `pdf` / `image` | `POST …/open` → `Linking.openURL`; "Save for offline" via `downloadAsync` (LB24) |
| `course_link` | `POST …/open` → `router.push('/course/<id>')`, or the `course_unavailable` sentence |
| locked (any kind) | no network call; open the login wall |

Q7 says video embeds should render as embedded WebViews. v1 keeps the external redirect for **video only** — the brief describes video as *"a video link which gets redirected"*, and `react-native-webview` plus an in-app PDF viewer is a meaningful dependency and review cost. Flagged as the top follow-up in §11.

Audio is the exception and should ship in-app: `expo-audio` is already installed, so an inline player is a screen, not a dependency decision. An audio subsection that bounces a parent out to the browser mid-stavan is a worse experience than the current flat list, not a better one.

### Login wall — new shared component
No reusable gating component exists; the pattern is copy-pasted at `app/shivir-scan/[id].tsx:227-230`, `app/guest/more.tsx:72-84` and `pages/public/ExamsPage.tsx:812-827`, and web's library upsell (`LibraryPage.tsx:179`) is text with no call to action at all.

Build one `<LockedContent>` — lock icon, the tier's reason line, and a primary button routing to `/auth/phone` (mobile) or `/admin/login` (web). Use it for library first; the three existing one-offs can migrate later.

### Offline
Add the tree key to `lib/query-persist-keys.ts` (LB24). Text bodies persist with the detail query, so a downloaded-nothing user still has the whole reading library on a train.

---

## 8. Web — public

`pages/public/LibraryPage.tsx` becomes a section grid; new `/library/s/:sectionId` and `/library/s/:sectionId/:subsectionId`, registered in `PublicRoutes.tsx`. Same `<LockedContent>`, same per-kind behaviour, except `text` renders inline rather than pushing a route on mobile.

The raw `fetch` at `LibraryPage.tsx:130-136` that bypasses the api-client and swallows non-200 into `[]` goes away — one client, one endpoint, real error states.

---

## 9. Web — admin

`pages/admin/LibraryAdminPage.tsx` becomes a **master-detail tree editor**, closely modelled on `CourseTreeEditor` at `CoursesAdminPage.tsx:629+`: section list on the left, subsections on the right, up/down reorder buttons calling the reorder endpoints, inline create/edit dialogs.

The subsection dialog becomes **kind-driven** — picking `content_type` swaps the payload field, so a `text` row shows two textareas and a `course_link` row shows a course picker. Today the dialog shows every field for every kind, which is exactly how the seed ended up with PDF URLs in `embed_url`.

Also fixed here:

- Pagination. `useAdminList` drives "Load more" off `meta.next_cursor`, which the endpoint never sends (`useAdminList.ts:56-59`), so the list is silently hard-capped at 200 rows. A tree endpoint returns the whole structure and the dead control is removed.
- The delete confirmation copy (LB20).
- `PATCH` never sets `updated_at` (`library.ts:499`) — carry it over to the new handlers correctly.
- Missing filter controls: `content_type` and `access_tier` filters exist on the API and have never had UI.

---

## 10. Tests

`apps/api-server/test/library.test.ts` has 22 cases and is the only library test in the repo. Extend, do not replace — every existing assertion about tier gating, the Q7 whitelist, signed URLs and soft delete still holds, except the two the design deliberately changes.

New coverage:

1. **Tree shape** — sections ordered, subsections ordered within, drafts excluded, soft-deleted excluded at both levels.
2. **LB8 locked, not hidden** — a guest tree contains MSV subsection *titles*; the same rows carry `locked: true` and no `body_en`, no `file_url`, no `embed_url`, no `course_id`. Assert the absence explicitly, by key.
3. **LB9** — `POST …/open` on a locked subsection returns 403 `ERR_LIBRARY_TIER_LOCKED`; on a soft-deleted one, 404. *(Updates the existing 404 assertion.)*
4. **LB6** — every invalid `content_type`/payload combination is rejected at the API and by the CHECK.
5. **LB3** — concurrent creates do not duplicate `order_index`; reorder is dense and atomic; a partial reorder array is 422.
6. **LB16** — all three `course_link` outcomes, including `course_unavailable` for a city mismatch and for an MSV course with an unapproved student.
7. **LB11** — `Vary: Authorization` present; `private, no-store` when authed; `public, max-age` when not. This is a security assertion, not a nicety.
8. **LB18** — a guest open bumps `guest_open_count` and writes **no** `library_access_logs` row.
9. **LB20** — deleting a section soft-deletes its subsections and they vanish from both trees.
10. **LB19** — publishing a subsection without `title_hi` is 422.
11. **LB25** — a sanchalak and a city_admin do **not** receive `shikshak`-tier content; a shikshak does. Assert per role, since this is the regression the current `canAccessAdminPanel` short-circuit already ships.

Also add the currently-untested paths: limit clamping, the `tier` filter, and a parent whose child's `msv_status` changes mid-session.

---

## 11. Explicitly out of scope

Each of these is a real gap; none is in this change.

| Deferred | Why, and what it costs |
|---|---|
| **Per-city scoping** (`city_id` + `quiz-scope.ts`) | The single highest-leverage follow-up. Until it lands, authoring stays super_admin-only (LB21) and a "new item published" notification has no honest audience — the only fanout possible is a full `users` scan. |
| **In-app viewers** (WebView video, `react-pdf` / `react-native-pdf`) | Q7 asks for embedded rendering; v1 redirects out per the brief. Adds real dependency and review weight. |
| **Search and tags** | A browsable tree makes search less urgent than it was for a 200-row flat list. When it lands: trigram GIN, `simple` config not `english` (the stemmer is wrong for Devanagari), and the `escapeIlike` + keyset pattern at `admin.ts:367-434`. |
| **Punya for reading** | Plumbing is easy; the blocker is identity. `library_access_logs.user_id` is a *user*, `awardPunya` needs a `student_id`, and a parent maps to N children. There is also no anti-farming cap for automated features — `punya_award_limits` is manual-award only. Needs a product decision first. |
| **"New item published" push** | `NOTIFICATION_KINDS` has no `library` value and it backs a pgEnum, so it needs an `ALTER TYPE` migration (precedent `0045`). Blocked on scoping regardless. |
| **Universal / app links** | `app.json` still carries the Replit placeholder origin, no `associatedDomains`, no `intentFilters`. Sharing a library link that opens the app is impossible until that is fixed. |
| **Engagement analytics** | `library_access_logs`' unique-per-(item,user) upsert collapses the timeline to first + last + count. Any trend metric needs a separate events table. `mv_centre_engagement` is the view to extend (precedent `0026`), never a new view name. |
| **`media.cleanup_unfinalized`** | Still a one-line log stub. `file_url` is free text with no FK to `upload_objects`, so replaced library files leak forever. Platform-wide, not library-specific. |

---

## 12. Open questions

These need answers before implementation starts.

**12.1 — Is the `library_items → library_subsections` rename worth it?**
LB2 argues yes: one vocabulary across courses and library. The cost is a rename touching the schema, four migrations, the route file, Zod contracts, three client surfaces and the test file. Declining it means keeping `library_items` as the leaf under `library_sections`, which reads oddly but is materially less churn. *Recommendation: rename.*

**12.2 — Should `audio` accept external embeds, and from which hosts?**
LB22 allows any `https` host for audio (matching `pdf` today). If Gurujis will paste Spotify or SoundCloud links, an allowlist like Q7's is safer. If audio is always an uploaded MP3, drop `embed_url` for `audio` from the CHECK entirely and make it file-only.

**12.3 — `course_link` when a parent has several children.**
The design resolves against `activeStudentId`. If a course is visible to one child and not another, the same subsection shows differently depending on the session view. Acceptable, or should the tile list every child's status?

**12.4 — Plain text or markdown for `text` bodies?**
LB14 ships `plain` with a `body_format` column so markdown can follow. Markdown in v1 means adding `react-native-markdown-display` and `react-markdown` and sanitising input. Long stavan text with meaning and commentary probably *wants* headings and emphasis eventually.

**12.5 — Should the shikshak tab land in this change?**
LB-adjacent: the `shikshak` access tier exists with no surface. Adding the tab is small but touches a persona outside the brief.

**12.6 — Notify members when a section is published?**
Requires the `notification_kind_enum` migration and, honestly, the scoping work first (§11). Recommend no for v1.

**12.7 — Does web need a members-only library view?**
Web's library is currently public-only, and web has no learner course view at all. Under LB10 a signed-in member on web would see their gated content — which is new behaviour for that app. Intended, or keep web public-tier only?

---

## 13. Suggested sequencing

Each phase is independently shippable and leaves the app working.

| Phase | Contents | Rough size |
|---|---|---|
| 1 | Migrations 1–4, schema, backfill, repair. No behaviour change. | 1 PR |
| 2 | Read API — `optionalAuth`, `/tree`, `/sections/:id`, `/subsections/:id`, `/open`, cache + rate-limit headers, LB8/LB9 gating. Old routes aliased. | 1 PR |
| 3 | Write API — section/subsection CRUD + reorder, publish gate, cascade delete. | 1 PR |
| 4 | Admin tree editor, kind-driven dialog, filters, copy fixes. | 1 PR |
| 5 | Mobile — section list, subsection list, text reader, `<LockedContent>`, per-kind open, shikshak tab. | 1–2 PRs |
| 6 | Public web tree + locked states. | 1 PR |
| 7 | i18n migration (LB23), offline persistence (LB24), delete the aliased legacy routes, seed expansion. | 1 PR |

Tests land with the phase that introduces the behaviour, not at the end.

---

*Drafted August 2026.*

*Depends on: `CLAUDE.md` (Q7, CLAUDE.md-over-SPEC precedence); `docs/CURRICULUM_ENHANCEMENT.md` (CU1, CU3, CU4, CU5, CU20, CU29, CU32); `SPEC.md` §5.16, §6.20, §13.12, Step 22.*

*Against `docs/reviews/LIBRARY_MODULE_REVIEW.md` this closes **M1, M5, L1, L3, L4** and **partially closes M4** (sections and ordering land; search and tags are deferred in §11). It does **not** close **M2** — per-city scoping and age-group targeting are explicitly out of scope, and LB21 records that as a known limitation.*
