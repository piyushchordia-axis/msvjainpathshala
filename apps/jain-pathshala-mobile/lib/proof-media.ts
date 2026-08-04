/**
 * Shared proof-media helpers used by NiyamProofPicker and HomeworkProofPicker.
 */
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";

export type MediaKind = "photo" | "video" | "audio";

export type ProofMediaItem = {
  localId: string;
  kind: MediaKind;
  url: string;
  mime?: string;
  size_bytes?: number;
  previewUri?: string;
  status: "uploading" | "ready" | "failed";
  error?: string;
};

/** Camera/library max video length (seconds). Library picks may still ignore this. */
export const VIDEO_MAX_DURATION_SEC = 30;

/**
 * Force a JPEG/H.264-compatible representation on iOS. If this enum is missing
 * after an SDK bump, optional chaining would silently pass `undefined` and iOS
 * would fall back to Current (raw HEIC) — which our upload pipeline rejects.
 */
export const PREFERRED_ASSET_REPRESENTATION_MODE =
  ImagePicker.UIImagePickerPreferredAssetRepresentationMode?.Compatible;

if (__DEV__ && PREFERRED_ASSET_REPRESENTATION_MODE === undefined) {
  throw new Error(
    "[proof-media] UIImagePickerPreferredAssetRepresentationMode.Compatible is undefined. " +
      "iOS would upload raw HEIC. Check the expo-image-picker version.",
  );
}

export async function resolveLocalByteSize(
  uri: string,
  blob?: Blob,
): Promise<number | null> {
  if (blob && typeof blob.size === "number") return blob.size;
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

export function mediaReady(items: ProofMediaItem[]): boolean {
  return items.every((m) => m.status === "ready") && !items.some((m) => m.status === "uploading");
}

export function toSubmitMedia(items: ProofMediaItem[]) {
  return items
    .filter((m) => m.status === "ready" && m.url)
    .map((m) => ({
      url: m.url,
      kind: m.kind,
      mime: m.mime,
      size_bytes: m.size_bytes,
    }));
}
