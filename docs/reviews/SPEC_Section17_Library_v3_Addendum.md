# SPEC.md — Section 17 (v3 Addendum)
## Library & Resource Module — Content Requests, Tarj, Granth

**Status:** Extends `SPEC_Section17_Library_v2.md`. Does **not** replace it — v2 remains binding in full except where a section below is explicitly marked *amended*. v2 + this addendum together constitute Section 17.
**Date:** August 2026 (decisions resolved with product owner, 16 Aug 2026)
**Related:** `CLAUDE.md` → Q12–Q15 (unchanged, still binding); Q16–Q18 (new — paste-ready blocks in the prompts doc, Appendix A)
**Build prompts:** `JainPathshala_Library_ClaudeCode_Prompts_v3.md` (prompts 13–22, continuing from v2's 0–12)

> **Precondition.** This addendum assumes a v2-conformant implementation. `reviews/LIBRARY_MODULE_REVIEW_2026_08.md` found the current build diverges from v2 in ways v3 depends on directly: the restored `access_tier` model, the restored `library_access_logs` table (whose pre-login device identifier v3 reuses for guest requests), a real `/v1/library/manifest` endpoint (which v3 extends), and a working FTS tokenizer/romanizer (which v3 indexes Tarj and Granth into). Land the review's Critical and High remediations before running the v3 prompts.

---

# Part A — Scope & Resolved Decisions

Three additions: a user-facing content request flow, an optional Tarj field on items, and a Granth section with an online reading experience and a physical-library directory.

Decisions deliberated and resolved:

| # | Decision | Resolution |
|---|---|---|
| 1 | Who may submit content requests | Everyone, **including guests** — guests supply name + phone; logged-in users auto-fill from profile |
| 2 | Request attachments | **None in v1.** Title, details, and one optional reference URL. No file uploads (copyright, malware, and moderation burden) |
| 3 | Offline Granth data model | **Two entities** — physical libraries and granth entries, linked many-to-many; browsable both ways |
| 4 | Online granth PDFs | **In-app viewer with explicit offline download**, mirroring the audio download UX |
| 5 | Tarj | Optional bilingual field on library items, shown under the title and in the text drawer, **search-indexed** |

Convention checks (same discipline as v2 Part A):

| # | Potential conflict | Resolution |
|---|---|---|
| 1 | Request review could suggest a moderator role. `CLAUDE.md` locks 8 roles (Q12). | **No new roles.** Queue readable by `city_admin` and above; actioned by `state_admin` and above. Service-layer enforcement. |
| 2 | Guest submissions could suggest a login gate or a `requires_login` flag (Q13). | **Neither.** Submission is an action, not content — no tier applies. Guest identity uses the *existing* §17.4 pattern: device-scoped rows, re-keyed to the account on first login, never cleared. |
| 3 | Granth PDFs could ship as a new content system. | **Extend, don't replace** (same as v2 conflict 1). PDF becomes a fourth first-class modality on `library_items`. Legacy `type='pdf'` rows keep working untouched — no data migration. |
| 4 | `external_url` could be read as permitting self-hosted or arbitrary-host video. | **No.** `external_url` is for third-party *document* downloads only. Video remains `embed_url`, YouTube/Vimeo, regex-validated (Q7). |
| 5 | A "Granth" screen could hardcode section names. | **Never.** `library_sections.type` gains a `granth` value; all rendering switches on `type` (v2 §17.1.2 rule). |

---

# Part B — Amended & New Sections

## 17.1.2 Section types *(amended)*

Add one row to the section-type table:

| `type` | Rendering | Example |
|---|---|---|
| `granth` | Two-tab screen: **Online Granth** (this section's own subsections/items, rendered per `item_list` rules) + **Offline Granth** (physical library directory, §17.11.3) | Granth |

## 17.1.3 Item modalities *(amended)*

The modality table gains two rows:

| Modality | Fields | Client behaviour |
|---|---|---|
| **PDF** | `pdf_asset_id`, `pdf_size_bytes`, `pdf_page_count` | Explicitly downloaded to app-private storage (same state machine as audio); opens in the in-app PDF viewer. Web renders inline. |
| **External link** | `external_url` | Opens in the device browser (web: new tab). `http(s)` only, validated on save. Documents only — never video (Q7). |

**Constraint (replaces v2's):** `CHECK (audio_asset_id IS NOT NULL OR embed_url IS NOT NULL OR text_content_en IS NOT NULL OR pdf_asset_id IS NOT NULL OR external_url IS NOT NULL OR asset_id IS NOT NULL)`

**New optional metadata (not a modality):** `tarj_en` / `tarj_hi` — the melody a piece is sung to (a stavan set to the tune of a well-known song or another stavan). Rendered as a single caption line under the item title in list rows and at the top of the text drawer, labelled "Tarj", in the viewer's preferred language with fallback. Rendered nowhere when both are null. Plain single-line text — never rich text. Indexed in search (§17.5).

## 17.4 Offline behaviour *(amended)*

| Asset | Offline availability |
|---|---|
| PDF | Explicitly downloaded by the user to app-private storage, recorded in client-local `downloaded_pdfs` with `last_read_page` |
| Granth directory (libraries + entries + availability) | Cached locally with the section tree after first load |

PDF and audio share one download queue (max 3 concurrent overall), the same background/continuation behaviour, and the same signed-URL rule: fresh signed URL at download time (1h TTL), local file thereafter, never re-signed on open. The Downloads screen lists PDFs alongside audio with individual and total sizes, per-item delete, and delete-all.

**Pre-login PDF downloads** are device-scoped and re-keyed to the user account on first login — never cleared (same rule as audio).

Content **requests** are the one exception to offline-first: submission requires connectivity and is *not* added to the offline MMKV queue. With no network the request form is replaced by an explanatory state.

## 17.5 Search *(amended)*

Index additions per item: `tarj_en`, `tarj_hi`, and a romanized tarj (same transliteration path as `roman_title`). A query matching only the tarj must find the item, with the tarj line as the snippet.

New indexed entities: `granth_entries` (title, author, plus roman transliterations) and `granth_libraries` (names). A granth match opens the entry detail; a library match opens the library detail. Both filtered to published rows.

The empty search-results state gains a "Can't find it? Request it" CTA that opens the request form (§17.10) prefilled with the query as title.

## 17.7 Content versioning *(amended)*

`granth_libraries` and `granth_entries` carry `content_version`, incremented on publish. The manifest gains two maps:

`GET /v1/library/manifest` → `{ sections: {…}, items: {…}, granth_libraries: {id: version}, granth_entries: {id: version} }`

Sync rules are identical to sections/items: version increased → refetch that row; id absent → remove locally and de-index. Any manifest-detected change triggers a local search index rebuild. The whole cache is never invalidated wholesale.

## 17.9 Access logging *(amended)*

`library_access_logs.event` gains: `pdf_view` (viewer open), `pdf_download` (completed download), `granth_view` (granth section open), `external_link_open` (link tap).

## 17.10 Content Addition Requests *(new)*

Users ask for content the Library doesn't have yet; admins review, source, and publish it, and the requester finds out.

### 17.10.1 Entry points

Three, all opening the same form: a "Request content" action on Library home; the same action on every section detail screen, prefilled with that section; and the empty-search CTA (§17.5), prefilled with the query as title.

### 17.10.2 Who may submit

Everyone, including guests.

- **Logged-in users:** `requester_user_id` from the session; name and phone prefilled server-side from the profile.
- **Guests:** `requester_device_id` — the *same* device identifier `library_access_logs` uses pre-login (§17.9) — plus mandatory name and phone. The phone is **unverified in v1** (accepted risk; see Open Decision 1). No OTP, no login prompt.

Guest requests are device-scoped. On first login, the existing §17.4 re-key mechanism also sets `requester_user_id` on all rows carrying that device id — history and publish notifications become retroactive. Requests are never deleted; rejected and published are terminal states retained for history and duplicate-spotting.

### 17.10.3 Request contents

| Field | Rules |
|---|---|
| Target section | Picker of published sections (`section_id`), **or** "Other" with free-text `suggested_section`. Exactly one path required. |
| `title` | Required, ≤ 200 chars |
| `details` | Required, ≥ 20 and ≤ 2000 chars |
| `reference_url` | Optional, `http(s)` only, ≤ 500 chars — e.g. a YouTube link of the recording they want added |
| `requester_name`, `requester_phone` | Always stored; prefilled for logged-in users, mandatory input for guests |

No file uploads in v1. Admins source the actual asset themselves from the reference link or their own material.

### 17.10.4 Lifecycle

```
pending ──→ accepted ──→ published   (system-set)
   │             │
   └──→ rejected ←┘
```

- `pending` → `accepted` | `rejected` — admin action, optional `admin_note` (shown to the requester; recommended on rejection).
- `accepted` → `rejected` — allowed; plans change.
- `accepted` → `published` — **system-set only.** When a library item whose id appears in an accepted request's `linked_item_id` is published, the request flips to `published` and a notification is enqueued via the existing `notifications.fanout` queue to `requester_user_id` (skipped when null — see §17.10.7), deep-linking to the item.
- `rejected` and `published` are terminal. A requester may always submit a fresh request.

Requester-facing **My Requests** screen: the caller's requests newest-first with status chips (Pending / Accepted / Rejected / Published), `admin_note` when present, and a tap-through to the published item when linked. Guests see their device-scoped list; after login the same screen shows the re-keyed history.

### 17.10.5 Review authority

Existing roles only (Q12). Enforced at the service layer, never only in UI.

| Role | Queue | Accept / Reject / Create-item |
|---|---|---|
| `super_admin`, `state_admin` | Read | Yes |
| `city_admin` | Read | No — `403 ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN` |
| `sanchalak`, `shikshak` | No | No |

"Create item from request" spawns a draft `library_items` row prefilled with the request's title and section and stores `linked_item_id` — the normal draft/publish flow takes over from there. The admin detail view surfaces similar pending requests by title match, so five people asking for the same stavan is visible as one piece of work. Every admin action writes an audit log entry.

### 17.10.6 Abuse controls

Redis sliding window, same pattern as the OTP limiter:

| Control | Limit | Error |
|---|---|---|
| Submission velocity | 3/day per device-or-user; 10/day per IP | `429 ERR_LIBRARY_REQUEST_RATE_LIMITED` |
| Pending cap | Max 3 requests in `pending` per requester | `409 ERR_LIBRARY_REQUEST_PENDING_LIMIT` |
| Content floor | `details` ≥ 20 chars, Zod-validated | `400` standard validation error |

`requester_phone` flows through the existing PII log redaction. Error copy follows the house rule — state the problem and the fix.

### 17.10.7 Notifications

Publish notification goes to `requester_user_id` holders only (guests who later logged in included, via re-key). Pure guests who never log in get **no automated notification in v1** — their contact number permits manual outreach, nothing more. A deliberate scope cut, not an oversight.

## 17.11 Granth *(new)*

### 17.11.1 Structure

One `library_sections` row of type `granth`, seeded unpublished with `access_tier='public'` (admin may rename, re-tier, publish). The screen renders two tabs. Neither the section name nor the tab behaviour is ever keyed on a name string — only on `type`.

### 17.11.2 Online Granth

The section's own subsections and items, rendered **exactly** per existing `item_list` rules. Online granths are ordinary `library_items` that typically carry `pdf_asset_id`, text content, or `external_url` — which means tiers, draft/publish, versioning, manifest sync, search, downloads, and access logging all apply with zero new machinery.

**PDF pipeline:** admin upload accepts PDF only, rejects above **100MB** with `413 ERR_LIBRARY_PDF_TOO_LARGE` (cap confirmable — Open Decision 3). `pdf_size_bytes` recorded at upload; `pdf_page_count` extracted asynchronously via the existing `media.processing` queue and written back. No transcoding. Client behaviour per §17.1.3 and §17.4: size shown before download, in-app viewer with pinch-zoom and page navigation, `last_read_page` restored from local storage (local-only in v1 — Open Decision 6).

### 17.11.3 Offline Granth — the two-entity directory

Not content — a directory of physical libraries. Two server entities plus a join:

```
granth_libraries       physical libraries: name, address, city, contact,
                       has_whatsapp, timings, optional lat/lng, note
granth_entries         granths: title, author, language, description,
                       optional linked_item_id → library_items ("Read online")
granth_availability    M2M join, unique (granth_id, library_id),
                       optional note (e.g. "reference only, not for issue")
```

`city` uses the same representation centres use — no new cities table. Contact details live on the library **only**; entries never duplicate them.

### 17.11.4 Browsing both ways

Two toggleable modes inside the Offline Granth tab:

- **By library** — published libraries grouped by city, defaulting to the viewer's city where known, with a city filter. Library detail: name, address with a tap-through to the device maps app (lat/lng when present, else an address query), contact name, tap-to-call phone, WhatsApp deep link when `has_whatsapp`, timings, note, and the library's granth catalogue.
- **By granth** — alphabetical, searchable list of published entries. Entry detail: title, author, language, description, a **Read online** action when `linked_item_id` is set, and an **Available at** list of published libraries with city and availability note.

Cross-link runs both directions: an online granth item whose id appears as any published entry's `linked_item_id` shows an "Available at N libraries" row opening the directory filtered to those libraries.

The directory is cached with the section tree — fully browsable offline and pre-login. Call, WhatsApp, and maps actions hand off to device apps.

### 17.11.5 Admin & scoping

Service-layer enforcement, existing roles only:

| Role | `granth_libraries` | `granth_entries` + section | `granth_availability` |
|---|---|---|---|
| `super_admin`, `state_admin` | Full | Full | Full |
| `city_admin` | Own city only | No | Only where the library is in their city |
| `sanchalak`, `shikshak` | No | No | No |

Draft/publish per existing library rules: edits write to draft, publishing increments `content_version`, only published rows reach public APIs. Soft delete throughout. Every action audit-logged. Out-of-scope cities are hidden from `city_admin` in UI — supplementing, never replacing, service enforcement.

### 17.11.6 Punya

Unchanged from v2 §17.8: the Library — including everything in this addendum — awards no Punya and never calls `PunyaService`.

---

# Part C — Database Changes

## New tables

```
library_content_requests   id, section_id (nullable FK library_sections),
                           suggested_section (nullable), title, details,
                           reference_url (nullable),
                           requester_user_id (nullable FK users),
                           requester_device_id (nullable),
                           requester_name, requester_phone,
                           status (pending|accepted|rejected|published, default pending),
                           admin_note (nullable),
                           linked_item_id (nullable FK library_items),
                           actioned_by (nullable FK users), actioned_at (nullable),
                           created_at, updated_at
                           CHECK (requester_user_id IS NOT NULL
                                  OR requester_device_id IS NOT NULL)
                           CHECK (section_id IS NOT NULL
                                  OR suggested_section IS NOT NULL)
                           -- no deleted_at: requests are never deleted

granth_libraries           id, name_en, name_hi, address_en, address_hi, city,
                           contact_name, contact_phone, has_whatsapp,
                           timings_en, timings_hi, lat (nullable), lng (nullable),
                           note_en, note_hi, order, is_published,
                           content_version, created_at, updated_at, deleted_at

granth_entries             id, title_en, title_hi, author_en, author_hi,
                           language, description_en, description_hi,
                           linked_item_id (nullable FK library_items),
                           order, is_published, content_version,
                           created_at, updated_at, deleted_at

granth_availability        id, granth_id (FK granth_entries),
                           library_id (FK granth_libraries),
                           note (nullable), created_at
                           UNIQUE (granth_id, library_id)
```

## Altered table

```
library_items  ADD  tarj_en, tarj_hi, pdf_asset_id (FK media_assets),
                    pdf_size_bytes, pdf_page_count, external_url  — all nullable
               REPLACE CHECK →  at least one of audio_asset_id, embed_url,
                    text_content_en, pdf_asset_id, external_url, asset_id
                    non-null  (constraint swap only — no row rewrite)
```

## Altered enums

```
library_sections.type       ADD  'granth'
library_access_logs.event   ADD  'pdf_view', 'pdf_download',
                                 'granth_view', 'external_link_open'
```

## New error codes (`@jp/shared/errors`)

```
ERR_LIBRARY_REQUEST_RATE_LIMITED      429
ERR_LIBRARY_REQUEST_PENDING_LIMIT     409
ERR_LIBRARY_REQUEST_ACTION_FORBIDDEN  403
ERR_LIBRARY_PDF_TOO_LARGE             413
```

## Client-local only (SQLite — not server)

```
downloaded_pdfs            item_id, local_path, size_bytes, content_version,
                           downloaded_at, status (queued|downloading|complete|failed),
                           last_read_page
```

No new BullMQ queues, no new roles. PDF page-count extraction rides `media.processing`; publish notifications ride `notifications.fanout`.

---

# Part D — Open Decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Guest phone on requests is unverified in v1. Add OTP verification later if spam appears despite rate limits? | Ship unverified; revisit only on evidence of abuse |
| 2 | Any outreach channel for pure-guest requesters (no account, no push)? SMS/WhatsApp would cost per message. | Manual outreach via the stored number, only when an admin chooses to |
| 3 | 100MB PDF cap — confirm against real scanned granth file sizes before locking | Sample the first upload batch; raise to 150MB only if needed |
| 4 | Granth entry categories/subject taxonomy | Defer until the catalogue exceeds ~100 entries; alphabetical + search suffices |
| 5 | Which cities appear in the directory's city filter | Derive from published `granth_libraries` rows — never show an empty city |
| 6 | Reading position (`last_read_page`) sync across devices | Local-only v1; server sync would need a session and conflicts with pre-login reading |
