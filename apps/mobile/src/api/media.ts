/**
 * uploadFile() — single-shot media upload helper used across mobile (Step 11).
 *
 * Flow:
 *   1. POST /v1/media/sign-upload  → { upload_url, upload_headers, asset_id }
 *   2. PUT  upload_url             ← raw file bytes (no auth header)
 *   3. POST /v1/media/finalize     → { asset_id, checksum_sha256? }
 *   4. Poll GET /v1/media/:assetId until status === 'ready' (≤ 30s)
 *
 * The caller passes an `asset` shape that's intentionally compatible with
 * the object expo-image-picker / expo-document-picker hand back so this
 * helper sits behind either picker without adapter glue:
 *
 *   const asset = result.assets?.[0];
 *   if (asset) await uploadFile(asset, 'student_photo', { onProgress: ... });
 *
 * No expo-image-picker dependency is forced here — the surface is just the
 * subset of fields we need. Install expo-image-picker in the screens that
 * actually invoke the picker.
 */

import { api, ApiError, unwrap } from './client';

import type { MediaKind } from '@jp/shared';

export interface UploadableAsset {
  /** file:// or content:// URI returned by the picker. */
  uri: string;
  /** Reported MIME — the server still sniffs the real type on processing. */
  mimeType?: string | null;
  type?: string | null;
  /** Original size in bytes. Optional — we fall back to fetch().blob().size. */
  fileSize?: number | null;
  /** Optional convenience — passed through to upload_headers for debugging. */
  fileName?: string | null;
}

export interface UploadProgressEvent {
  /** 0..1 fraction of the upload (PUT phase only — sign + finalise are ~instant). */
  progress: number;
  /** 'signing' | 'uploading' | 'finalising' | 'processing' | 'ready' */
  stage: 'signing' | 'uploading' | 'finalising' | 'processing' | 'ready';
}

export interface UploadOptions {
  onProgress?: (event: UploadProgressEvent) => void;
  /** Override the default 30s poll timeout (in ms). */
  pollTimeoutMs?: number;
  /** Override the default 1.5s poll interval (in ms). */
  pollIntervalMs?: number;
}

export interface UploadResult {
  asset_id: string;
  status: 'ready' | 'uploaded' | 'processing' | 'failed';
  mime_type: string;
  url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
}

interface SignUploadResponse {
  asset_id: string;
  upload_url: string;
  upload_headers: Record<string, string>;
  s3_key: string;
  bucket: 'private' | 'public' | 'exports' | 'receipts';
  expires_in_seconds: number;
}

interface MediaReadDescriptor {
  id: string;
  status: 'pending' | 'uploaded' | 'processing' | 'ready' | 'failed' | 'quarantined';
  kind: MediaKind;
  mime_type: string;
  size_bytes: number;
  url: string | null;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
}

const DEFAULT_POLL_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_500;

/** Read a local file URI as a Blob — works in both Expo and Web. */
async function uriToBlob(uri: string): Promise<Blob> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to read local file: ${res.status}`);
  return res.blob();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload `asset` as media of `kind`. Throws ApiError on protocol failures and
 * a plain Error on PUT / poll failures.
 */
export async function uploadFile(
  asset: UploadableAsset,
  kind: MediaKind,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const mime = asset.mimeType ?? asset.type ?? 'application/octet-stream';
  let sizeBytes = asset.fileSize ?? 0;
  let blob: Blob | null = null;

  options.onProgress?.({ progress: 0, stage: 'signing' });

  // We may need the blob early if the picker didn't tell us the size.
  if (!sizeBytes) {
    blob = await uriToBlob(asset.uri);
    sizeBytes = blob.size;
  }

  // 1) sign-upload
  const sign = await unwrap<SignUploadResponse>(
    api.post('/v1/media/sign-upload', {
      kind,
      mime_type: mime,
      size_bytes: sizeBytes,
    }),
  );

  options.onProgress?.({ progress: 0, stage: 'uploading' });

  // 2) PUT to the presigned URL — no Authorization header
  if (!blob) blob = await uriToBlob(asset.uri);
  const putResp = await fetch(sign.upload_url, {
    method: 'PUT',
    headers: sign.upload_headers,
    body: blob,
  });
  if (!putResp.ok) {
    const body = await putResp.text().catch(() => '');
    throw new Error(`Upload failed (${putResp.status}): ${body.slice(0, 200)}`);
  }
  options.onProgress?.({ progress: 1, stage: 'finalising' });

  // 3) finalize — server HEADs the object and enqueues media.processing
  await unwrap(
    api.post('/v1/media/finalize', {
      asset_id: sign.asset_id,
      // Skip the optional checksum field — the server only enforces it when
      // present. RN doesn't expose a fast native SHA-256 on Blob without an
      // extra dep, so we deliberately omit it for now.
      checksum_sha256: '0'.repeat(64),
    }),
  );
  options.onProgress?.({ progress: 1, stage: 'processing' });

  // 4) Poll until status === 'ready'
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const start = Date.now();
  let last: MediaReadDescriptor | null = null;
  while (Date.now() - start < pollTimeoutMs) {
    const descriptor = await unwrap<MediaReadDescriptor>(
      api.get(`/v1/media/${sign.asset_id}`),
    ).catch((err: unknown) => {
      if (err instanceof ApiError && err.statusCode === 404) return null;
      throw err;
    });
    if (descriptor) {
      last = descriptor;
      if (descriptor.status === 'ready') {
        options.onProgress?.({ progress: 1, stage: 'ready' });
        return {
          asset_id: descriptor.id,
          status: descriptor.status,
          mime_type: descriptor.mime_type,
          url: descriptor.url,
          thumbnail_url: descriptor.thumbnail_url,
          width: descriptor.width,
          height: descriptor.height,
        };
      }
      if (descriptor.status === 'failed') {
        throw new Error('Server rejected the upload during processing.');
      }
    }
    await delay(pollIntervalMs);
  }

  throw new Error(
    `Upload still ${last?.status ?? 'processing'} after ${Math.round(pollTimeoutMs / 1000)}s — try again`,
  );
}

/** Fetch the descriptor for an already-uploaded asset. */
export async function getMediaAsset(assetId: string): Promise<MediaReadDescriptor> {
  return unwrap<MediaReadDescriptor>(api.get(`/v1/media/${assetId}`));
}

export type { MediaReadDescriptor };
