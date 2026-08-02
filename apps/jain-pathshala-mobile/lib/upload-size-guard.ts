/**
 * Client-side upload size guard. Library picks ignore videoMaxDuration, so a
 * parent can select a multi-minute 4K clip that would burn mobile data and then
 * fail at the server. Reject before apiUpload when size is known.
 */
import { ERROR_MESSAGES, MAX_UPLOAD_BYTES } from "@workspace/api-zod";

export { MAX_UPLOAD_BYTES };

export function fileTooLargeMessage(hi: boolean): string {
  const msg = ERROR_MESSAGES.ERR_FILE_TOO_LARGE;
  return hi ? msg.hi : msg.en;
}

/**
 * Returns a localized rejection message when `sizeBytes` exceeds the shared
 * upload cap, or `null` when the file is within limit / size is unknown.
 */
export function rejectIfOverUploadLimit(
  sizeBytes: number | null | undefined,
  hi = false,
): string | null {
  if (sizeBytes == null || !Number.isFinite(sizeBytes)) return null;
  if (sizeBytes <= MAX_UPLOAD_BYTES) return null;
  return fileTooLargeMessage(hi);
}
