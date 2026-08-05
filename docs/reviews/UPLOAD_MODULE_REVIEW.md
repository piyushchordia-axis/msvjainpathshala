# Code Review — Upload functionality (student & parent surfaces)

**Scope:** every upload entry point reachable by a parent or student, plus the shared server pipeline behind them. Type / format / size handling, iOS ↔ Android parity, security, correctness.
**Reviewed:** `apps/api-server/src/{routes/v1/uploads.ts, lib/upload.ts, lib/storage.ts, lib/image-normalise.ts, lib/file-tokens.ts, lib/owned-upload.ts, middlewares/multer-error.ts, app.ts, routes/v1/me.ts, services/homework-submit-sync.ts, services/sync-batch.ts}`, `apps/jain-pathshala-mobile/{lib/api.ts, lib/proof-media.ts, lib/upload-size-guard.ts, lib/offline/media-upload-queue.ts, components/NiyamProofPicker.tsx, components/HomeworkProofPicker.tsx, hooks/useStudentPhotoPicker.ts, app.json}`, `apps/jain-pathshala/src/pages/admin/{GalleryAdminPage,HomeworkPage,LibraryAdminPage}.tsx`.
**Date:** 2026-08-05 · **HEAD:** `55edebe`

---

## Summary

The shared pipeline is well built — a single MIME↔extension table, magic-byte sniffing, mandatory EXIF stripping, HMAC-signed serving URLs, disk-backed temps with `finally` unlink, and ownership resolution against `upload_objects`. The design is better than most codebases at this stage.

But **the parent/student homework photo submission is broken 100% of the time on both iOS and Android**, and the failure is invisible to the user — the app says "Submitted." while the server has rejected the work. There is also debug telemetry POSTing request data to `127.0.0.1:7744` left in five production files, and a cross-tenant file-deletion hole on the student photo route.

**Verdict: Request Changes.** Two P0s block release.

---

## Upload surface inventory

| # | Surface | Who | Client folder | Server enum? |
|---|---|---|---|---|
| 1 | Niyam proof (photo/video/audio) | parent, student | `niyam-proof` | ✅ |
| 2 | Homework proof photo | parent, student | **`homework-proof`** | ❌ **falls back to `misc`** |
| 3 | Student ID-card / profile photo | parent, student | `student-photos` | ✅ |
| 4 | Homework worksheet | shikshak | `homework` | ✅ |
| 5–7 | Gallery / Homework / Library (web admin) | admin | `gallery`, `homework`, `library` | ✅ |

Server enum: `niyam-proof, homework, gallery, library, id-cards, registration, student-photos, competitions, shivirs, misc`.

---

## Critical issues

| # | File | Line | Issue | Severity |
|---|---|---|---|---|
| 1 | `mobile/lib/offline/media-upload-queue.ts` | 102 | Folder `"homework-proof"` is not in the server enum → stored under `misc/` → homework submit rejects 422 | 🔴 P0 |
| 2 | `api-server/src/routes/v1/uploads.ts` | 85–86, 87–104, 174–190 | Silent folder fallback hides #1; debug `fetch()` to `127.0.0.1:7744` in the request path | 🔴 P0 |
| 3 | `api-server/src/routes/v1/me.ts` | 110–121, 158–160 | Photo route checks key *prefix* only, no `uploaded_by` — then `storage.remove()`s the previous key → cross-tenant file delete | 🔴 High |
| 4 | `mobile/components/HomeworkProofPicker.tsx` | 100–112 | Shows "Submitted." even when the server rejected the submission | 🔴 High |
| 5 | `api-server/src/routes/v1/uploads.ts` | 29, 72 | No rate limit on a 50 MB multipart + sharp re-encode endpoint | 🟠 Medium |

---

### 1. 🔴 P0 — Homework photo submission fails for every parent and student

The full chain:

```
HomeworkProofPicker.tsx:63-79   enqueueHomeworkProofUpload({...})   ← no `folder` passed
media-upload-queue.ts:102        folder: input.folder ?? "homework-proof"
api.ts:350                       form.append("folder", "homework-proof")
uploads.ts:38-49                 z.enum([...]) — "homework-proof" ABSENT
uploads.ts:85-86                 safeParse fails → folder = "misc"     ← silent
storage.ts:39-43                 key = "misc/<uuid>.jpg"
homework-submit-sync.ts:182-188  resolveOwnedUpload({ folderPrefix: "homework/" })
owned-upload.ts:57-63            !key.startsWith("homework/") → { ok: false }
homework-submit-sync.ts:216      throw HomeworkSubmitError(422, ERR_VALIDATION_FAILED)
```

Hits both the online route (`routes/v1/homework.ts:1669`, `:1692`) and the offline drain (`services/sync-batch.ts:402-409`). The upload itself succeeds — the file is on disk under `misc/` — so it also leaves an orphan on every attempt.

The teacher path works, because `app/shikshak/homework.tsx:156-159` passes `"homework"` explicitly. Only the parent/student path is affected.

**The unit test locks the bug in.** `lib/__tests__/homework-proof-upload.test.ts:62-69` asserts `toHaveBeenCalledWith(..., "homework-proof")`, and its mock at `:40` returns a `homework/` URL the real server would never mint for that folder. Green test, broken production — and fixing the string will fail the test.

**Fix:**
```ts
// media-upload-queue.ts:102
folder: input.folder ?? "homework",
```
Update the test assertion at `:68` to `"homework"` and change the mock URL at `:40` to a `misc/`-free `homework/` key so the fixture matches reality.

**Then make the class of bug impossible** — `uploads.ts:85-86` should reject an unknown folder rather than silently downgrading it:
```ts
const folderParse = folderSchema.safeParse(req.body?.folder ?? "misc");
if (!folderParse.success) {
  fail(res, 422, "ERR_VALIDATION_FAILED", `Unknown upload folder "${req.body?.folder}".`);
  return;
}
```
A typo'd folder is always a client bug. Failing loudly turns a silent 3-hop data-loss path into an immediate, obvious 422.

---

### 2. 🔴 P0 — Debug telemetry left in production code

Fourteen `// #region agent log` blocks POST request/response internals to `http://127.0.0.1:7744/ingest/33975112-...`:

| File | Lines |
|---|---|
| `api-server/src/routes/v1/uploads.ts` | 87, 174 |
| `api-server/src/services/homework-submit-sync.ts` | 118, 161, 189, 241 |
| `api-server/src/services/sync-batch.ts` | 411, 439 |
| `mobile/components/HomeworkProofPicker.tsx` | 88 |
| `mobile/lib/offline/media-upload-queue.ts` | 166 |

This is the debugging session for issue #1 that was never cleaned up. Problems: unconditional outbound `fetch` on every upload and every homework sync op (not `__DEV__`-gated, not env-gated); an unawaited promise per request; **it bypasses the Pino PII redactor entirely** — `uploads.ts:174` ships the storage key and URL path, `homework-submit-sync.ts:189` ships submission URL fragments; and on mobile it fires on the device's own loopback, which in a store build is a stray request to nothing.

**Fix:** delete all fourteen blocks. `git grep -n "#region agent log"` finds them.

---

### 3. 🔴 High — Cross-tenant file deletion via the student photo route

`routes/v1/me.ts:110-121` validates only the key prefix:

```ts
const key = uploadKeyFromUrl(body.photo_url);
if (!key || !key.startsWith("student-photos/")) { /* 422 */ }
```

No `upload_objects` lookup, no `uploaded_by` check — unlike niyam (`niyam-submissions.ts:122`) and homework (`homework-submit-sync.ts:182`), which both go through `resolveOwnedUpload`. `ownedStudentId(req, id)` at `:97` gates the *student*, not the *upload*.

Then at `:158-160`:
```ts
if (previousKey && previousKey !== uploadKeyFromUrl(body.photo_url ?? "")) {
  await storage.remove(previousKey);
}
```

So: PUT #1 sets your child's `photo_url` to a victim's `student-photos/<uuid>` key (accepted), PUT #2 changes it to anything else → the handler deletes the victim's file. It also lets you display another child's photo on your child's ID card in the interim.

Exploitation needs a victim key, and keys are `randomUUID()` — so this is not trivially exploitable today. But keys leak through every signed URL the API hands out, and the fix is three lines:

```ts
const owned = await resolveOwnedUpload({
  userId: req.authUser!.id,
  url: body.photo_url,
  folderPrefix: "student-photos/",
  allowedKinds: ["image"],
  label: "profile photo",
});
if (!owned.ok) { fail(res, 422, "ERR_VALIDATION_FAILED", owned.message); return; }
```

This also closes a second gap: today a fabricated key like `student-photos/anything.jpg` passes validation and is written to `students.photo_url`, so ID-card render gets a 404 image.

---

### 4. 🔴 High — "Submitted." is shown when the submission was rejected

`HomeworkProofPicker.tsx:100-112` derives success from `!result.remote_url`:

```ts
const offline = !result.remote_url;
setStatusText(offline ? "Saved offline — will upload…" : "Submitted.");
```

`remote_url` is set by the *file upload*. The homework attach happens afterwards inside `drainMediaUploads` → `deps.drainSync()` → `drainQueues()`, which never throws — a `failed`/`conflict` op result is recorded in the queue and swallowed. So the current 422 from issue #1 renders as **"Submitted."** to the parent.

Even after #1 is fixed this is wrong: any 4xx from the attach (assignment closed, already graded, MSV-gated) silently reads as success. This is the exact failure mode CLAUDE.md's offline-sync §8 forbids — *"a mark that will never sync must not look like success."*

**Fix:** return the terminal op state from the drain and map it to the documented `queued / syncing / synced / conflict / failed` UI states. `"Submitted."` should require an observed `success`.

---

### 5. 🟠 Medium — `/v1/uploads` is unthrottled

`routes/v1.ts:46` and `uploads.ts:29` apply `requireAuth` and nothing else. Every other expensive authenticated endpoint is rate-limited:

| Route | Limit |
|---|---|
| `auth.ts:70-76`, `:200` | OTP send/verify, per phone + IP |
| `exams.ts:872-876` | 10/hr per user, 5/15min per exam |
| `niyam-submissions.ts:485-489` | 20/hr, 5/min per user |

Niyam *submission* is throttled at 5/min but the niyam *proof upload* that precedes it is not — the unthrottled path is the expensive one: 50 MB multipart + full-buffer sharp re-encode + disk/S3 write, repeatable by any authenticated parent. On `LocalDiskProvider` (the default whenever `S3_BUCKET` is unset) that is a straightforward disk-fill; on S3 it is a billing event.

**Fix:** `rateLimit("upload:user:${uid}", 30, 3600)` + a per-minute burst key on the POST handler. Note `lib/ratelimit.ts:106-119` fails **open** on Redis error and no-ops under `NODE_ENV=test` — acceptable for OTP, worth a second look for a resource-consumption limit.

---

## Type / format / size handling

### What is enforced

| Layer | Mechanism | Location |
|---|---|---|
| Declared MIME | Allowlist of 14 canonical types + aliases | `upload.ts:34-51`, `fileFilter` `:126-134` |
| Actual content | `file-type` magic bytes, first 4 KB only | `uploads.ts:107-109` |
| Size | 50 MB, multer `limits.fileSize`, `files: 1` | `upload.ts:124`, `errors.ts:124` |
| Size (client) | Pre-flight guard before `apiUpload` | `upload-size-guard.ts:19-26` |
| Oversize error | 413 `ERR_FILE_TOO_LARGE`, EN/HI, temps unlinked | `multer-error.ts:47-52` |
| Extension | Derived from resolved MIME, never client filename | `storageExtForUpload` `upload.ts:96-108` |
| EXIF/GPS | sharp `.rotate()`, no `.withMetadata()`, fail-closed | `image-normalise.ts:36-83` |
| Serving | `MIME_BY_EXT` + `nosniff` + HMAC signature, 1 h TTL | `app.ts:103-132`, `file-tokens.ts` |
| Path traversal | `makeKey` sanitises; `resolve()` prefix assert | `storage.ts:39-43`, `:56-62` |
| Ownership | `upload_objects.uploaded_by` (niyam + homework) | `owned-upload.ts:65-79` |

The `audio/webm` vs `video/webm` and `audio/mp4` vs `video/mp4` container-collision handling (`uploads.ts:112-127`) is genuinely good — it is the correct call for Android `MediaRecorder` mpeg4/AAC, and it is commented with the reasoning.

### Gaps

**5a. Declared-MIME fallback when magic is unknown** — `uploads.ts:124-127`. When `file-type` returns `undefined`, the client's declared MIME is trusted. `file-type` cannot identify HTML, SVG, JS, or plain text, so arbitrary bytes declared `application/pdf` are stored as `.pdf` with `content_type: application/pdf`. Images are safe (`stripImageMetadata` throws at `:150-163`); PDF, video and audio are not. XSS is blocked by `nosniff` + a correct `Content-Type` on the serve path, so this is low severity — but the fallback should be narrowed to the formats that actually need it (WAV/CAF, per the comment) rather than the whole allowlist.

**5b. `application/pdf` is allowlisted but unreachable from mobile.** `owned-upload` accepts `["image","pdf"]` for homework, and the web admin accepts PDFs — but the app has no `expo-document-picker` (not in `package.json`). A parent photographing a multi-page worksheet has no way to submit a PDF on either platform. Server capability without a client, or an intentional restriction that should be documented.

**5c. `upload_objects` has no `size` column and no cleanup.** Schema is `key, uploaded_by, content_type, created_at` (`lib/db/src/schema/punya.ts:48-62`). The `media.cleanup_unfinalized` cron required by CLAUDE.md exists but is a stub — `jobs/derived-data-jobs.ts:156-162` only calls `logger.info(...)`. So every abandoned pick, every failed submit, and (today) every homework proof under issue #1 is a permanent orphan. There is no per-user storage quota either.

**5d. Prefixes outside the enum.** `lib/idcard-render.ts:433` writes `id-cards/` and `routes/v1/progress.ts:426` writes `reports/` — the latter is not in `folderSchema` at all. Harmless today (server-generated, never client-supplied), but the enum is not a complete inventory of live storage prefixes, which matters if `resolveOwnedUpload` or the `/uploads` route is ever tightened on the assumption that it is.

**5e. Video EXIF is a known, tracked gap.** `TODO(ffmpeg-video-exif)` — QuickTime `com.apple.quicktime.location.ISO6709` is not stripped. Correctly mitigated: `maybeInsertGalleryFromSubmission` (`niyam-submissions.ts:157+`) publishes images only. Worth a regression test asserting a video proof never produces a `gallery_items` row.

**5f. `parts` / `fields` limits.** `upload.ts:124` sets `fileSize` and `files` but not `fields`, `parts`, or `fieldSize`. A client can send thousands of text fields. Minor, one line.

---

## iOS ↔ Android parity

**6a. 🟠 `useStudentPhotoPicker` omits `preferredAssetRepresentationMode`.** `hooks/useStudentPhotoPicker.ts:57-70` passes only `mediaTypes`, `quality`, `allowsEditing`, `aspect`. Every other picker sets it — `NiyamProofPicker.tsx:274, 308`, `HomeworkProofPicker.tsx:148, 170`, `app/shikshak/homework.tsx:136, 141` — and `lib/proof-media.ts:31-35` carries a `__DEV__` throw explicitly warning *"iOS would upload raw HEIC."*

The student ID-card photo is therefore the one path that can ship raw HEIC from iOS. The server handles HEIC at `image-normalise.ts:53-62` by converting to JPEG via sharp — **but sharp's prebuilt binaries have historically shipped without HEIF decode** (libheif/x265 licensing). If this deployment's sharp lacks it, every iOS student photo from the library fails with *"Could not process this HEIC/HEIF photo… use Compatible photo mode"* while the same user's niyam proof uploads fine. Two actions: (a) add `preferredAssetRepresentationMode: PREFERRED_ASSET_REPRESENTATION_MODE` to both calls; (b) verify HEIC decode on the deployed sharp build (`node -e "console.log(require('sharp').format.heif)"`) — I could not verify it here, native deps aren't installed in this sandbox.

**6b. 🟠 Video size is unbounded in practice.** `videoMaxDuration: 30` caps camera duration but not bitrate, and no `videoQuality` is passed — so iOS records at native camera quality. A 30 s 4K/60 clip is well over 50 MB, and `pickFromLibrary` ignores `videoMaxDuration` entirely (documented in `upload-size-guard.ts:2-4`). The user records the proof, then gets "File too large" with no path forward. Add `videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium` (iOS) and consider client-side transcode, or raise the cap for video specifically.

**6c. 🟠 120 s timeout is too short for the target network.** `api.ts:391-392` allows 120 s for video/audio. 50 MB over a rural-India mobile link will not finish; the user gets `ERR_NETWORK` after two minutes with the bytes discarded. Consider chunked/resumable upload for video, or at minimum scale the timeout by file size.

**6d. 🟡 No upload progress.** `apiUpload` uses `fetch`, which has no upload progress events. A 50 MB upload shows an indeterminate "Uploading…" for minutes. `XMLHttpRequest` (available in RN) would give `onprogress`.

**6e. 🟡 Niyam proofs have no offline queue.** `NiyamProofPicker.enqueueUpload` calls `apiUpload` directly. Offline → the item goes `failed` with a manual Retry, and the local URI is held only in component state — navigating away loses it. Homework proofs get `jp.queue.media_uploads`; niyam proofs get nothing, despite `jp.queue.niyam_submissions` being the canonical queue in CLAUDE.md's offline model. Route niyam proofs through the same media queue.

**6f. 🔴 `usesCleartextTraffic: true` on Android.** `app.json:36`. This ships in release builds — a downgraded or misconfigured `EXPO_PUBLIC_API_URL` sends children's photos and bearer tokens over plaintext HTTP. iOS is correctly configured (`NSAllowsArbitraryLoads: false`). Move this behind a dev-only config plugin or a `networkSecurityConfig` that allows cleartext for the LAN dev host only.

**6g. 🟡 Android 13+ media permissions.** `app.json:38-44` lists `CAMERA`, `RECORD_AUDIO`, and location, but no `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO`. The `expo-image-picker` config plugin normally injects these, but the explicit `android.permissions` array has historically acted as an allowlist. Verify the generated `AndroidManifest.xml` after prebuild, and test library picking on an Android 13+ device.

---

## Minor

| # | File | Line | Note |
|---|---|---|---|
| i | `middlewares/multer-error.ts` | 73 | Hindi fallback ends with `。` (CJK ideographic full stop) — should be `।` or `.` |
| ii | `routes/v1/uploads.ts` | 106 | The `ADMIN_FOLDERS` 403 fires *after* 50 MB is on disk. Correct (temps are unlinked in `finally`), but the write is wasted — folder is a text field and is parsed before the handler runs |
| iii | `lib/storage.ts` | 40 | `makeKey`'s doc comment promises `<folder>/<yyyy>/<mm>/<uuid><ext>`; the implementation has no date segments. Fix the comment or add them — dated prefixes make retention much easier later |
| iv | `lib/upload.ts` | 137 | `uploadMemory` deprecated alias — grep shows no importers; delete |
| v | `lib/image-normalise.ts` | 44-48 | GIF passes through unstripped. Correct call (animation), but GIF *can* carry XMP; worth a comment narrowing the claim |

---

## What looks good

- **One MIME table, three consumers.** `UPLOAD_MIME_TABLE` drives the allowlist, the storage extension, and the serve `Content-Type` — they cannot drift, and `test/uploads.test.ts:34-42` asserts the round-trip.
- **Disk-backed temps, not memory.** 50 MB never lands in heap; `safeUnlink` in `finally` on every exit path; `multer-error.ts:16-33` also cleans up on `LIMIT_FILE_SIZE`. `uploads.test.ts` asserts no temps remain.
- **Magic-byte validation reads only 4 KB.** Correct trade-off, and the container-collision exceptions are precisely scoped and well-commented.
- **EXIF stripping fails closed.** Any `image/*` that sharp cannot process is rejected rather than stored raw — the right default when the payload is children's photos that may reach a public gallery.
- **Signed serving URLs.** HMAC + TTL + `timingSafeEqual`, with a clear rationale for why cookies and bearer tokens don't work for `<img>`. `Cache-Control: private, max-age=3600` correctly matches the TTL.
- **Ownership resolution.** `resolveOwnedUpload` deriving media kind from the *stored* `content_type` rather than the client's claimed `kind` is exactly right.
- **Error copy** states the problem and the fix, in EN and HI, per the CLAUDE.md voice rule.

---

## Recommended order

1. Delete the 14 `#region agent log` blocks — `git grep -n "#region agent log"`
2. `media-upload-queue.ts:102` → `"homework"`; update the test at `:40, :68`
3. `uploads.ts:85-86` → 422 on unknown folder instead of silent `misc` fallback
4. `me.ts:110-121` → `resolveOwnedUpload` with `folderPrefix: "student-photos/"`
5. `HomeworkProofPicker` → surface the real terminal op state; `"Submitted."` only on observed success
6. `app.json:36` → remove `usesCleartextTraffic` from release
7. Rate-limit `POST /v1/uploads`
8. `useStudentPhotoPicker` → add `preferredAssetRepresentationMode`; verify sharp HEIF support on the deploy target
9. Implement `media.cleanup_unfinalized` (orphans in `upload_objects` older than 24 h with no referencing row)
10. Video: `videoQuality`, size-scaled timeout, and a plan for >50 MB clips

### Regression tests worth adding

- Upload with `folder=homework` → key starts `homework/` → homework submit succeeds (the exact chain in issue #1, end to end).
- Unknown folder string → 422, not a `misc` fallback.
- `PUT /v1/me/students/:id/photo` with another user's `student-photos/` key → 422, and the victim's file still exists afterwards.
- A video niyam proof never produces a `gallery_items` row (guards 5e).
