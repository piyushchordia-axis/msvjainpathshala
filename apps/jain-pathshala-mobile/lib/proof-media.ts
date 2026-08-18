/**
 * Shared proof-media helpers used by NiyamProofPicker and HomeworkProofPicker.
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

export type MediaKind = "photo" | "video" | "audio";

export type ProofMediaItem = {
  localId: string;
  kind: MediaKind;
  url: string;
  mime?: string;
  size_bytes?: number;
  previewUri?: string;
  /**
   * `queued` — the file is in the durable media-upload queue and will be sent
   * when the device reconnects. It does NOT block submission: the niyam op
   * carries the local URI and `planDrain` releases it once the URL lands.
   * `failed` stays terminal (the server rejected this file), so it still blocks.
   */
  status: "uploading" | "queued" | "ready" | "failed";
  error?: string;
  /** Set for `queued` items — links to the PendingMediaUpload row. */
  mediaUploadId?: string;
};

/** Camera/library max video length (seconds). Library picks may still ignore this. */
export const VIDEO_MAX_DURATION_SEC = 30;

/**
 * Re-exported from its new home. It moved to `lib/image-pick.ts` when five
 * other call sites turned out to be missing it — the constant was never the
 * problem, remembering to pass it was.
 */
export { PREFERRED_ASSET_REPRESENTATION_MODE } from "@/lib/image-pick";

export async function resolveLocalByteSize(
  uri: string,
  blob?: Blob,
): Promise<number | null> {
  if (blob && typeof blob.size === "number") return blob.size;
  if (Platform.OS === "web") return null;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory) return null;
    return typeof info.size === "number" ? info.size : null;
  } catch {
    return null;
  }
}

export function newProofLocalId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function guessMime(kind: MediaKind, declared?: string | null): string {
  const d = (declared ?? "").split(";")[0]!.trim().toLowerCase();
  if (d === "image/jpg") return "image/jpeg";
  if (d === "audio/m4a" || d === "audio/x-m4a" || d === "audio/aac") return "audio/mp4";
  if (d) return d;
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/mp4";
  return "image/jpeg";
}

/** RN FormData on Android needs an explicit file:// scheme. */
export function ensureFileUri(uri: string): string {
  if (!uri) return uri;
  if (uri.startsWith("file://") || uri.startsWith("content://") || uri.startsWith("blob:")) {
    return uri;
  }
  if (uri.startsWith("/")) return `file://${uri}`;
  return uri;
}

/**
 * True when the form may be submitted. `uploading` is transient in-flight work
 * worth waiting a moment for; `failed` is a server rejection the parent must
 * remove. `queued` passes — an offline parent submits and the queue follows.
 */
export function mediaReady(items: ProofMediaItem[]): boolean {
  return !items.some((m) => m.status === "uploading" || m.status === "failed");
}

export function toSubmitMedia(items: ProofMediaItem[]) {
  return items
    .filter((m) => (m.status === "ready" && m.url) || m.status === "queued")
    .map((m) =>
      m.status === "queued"
        ? {
            url: "",
            kind: m.kind,
            mime: m.mime,
            size_bytes: m.size_bytes,
            local_uri: m.previewUri,
            media_upload_id: m.mediaUploadId,
            pending_upload: true as const,
          }
        : {
            url: m.url,
            kind: m.kind,
            mime: m.mime,
            size_bytes: m.size_bytes,
          },
    );
}
