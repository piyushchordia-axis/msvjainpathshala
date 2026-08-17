/**
 * Resolve a client-supplied media URL against upload_objects ownership.
 * Shared by niyam proofs and homework submissions/attachments (F2).
 */
import { db, upload_objects } from "@workspace/db";
import { eq } from "drizzle-orm";
import { uploadKeyFromUrl } from "./file-tokens";
import { MIME_BY_EXT } from "./upload";

export type OwnedUploadMediaKind = "image" | "pdf" | "video" | "audio";

export type ResolveOwnedUploadOk = {
  ok: true;
  key: string;
  contentType: string | null;
  kind: OwnedUploadMediaKind;
};

export type ResolveOwnedUploadFail = {
  ok: false;
  message: string;
};

function kindFromContentType(
  contentType: string | null | undefined,
  key: string,
): OwnedUploadMediaKind | null {
  let mime = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!mime) {
    const dot = key.lastIndexOf(".");
    if (dot >= 0) {
      mime = (MIME_BY_EXT[key.slice(dot + 1).toLowerCase()] ?? "").toLowerCase();
    }
  }
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/**
 * Verify `url` is an /uploads/... object under `folderPrefix` owned by `userId`.
 * External https links fail — callers that want an admin escape hatch must
 * short-circuit before calling this.
 */
export async function resolveOwnedUpload(opts: {
  userId: string;
  url: string;
  /** Storage key prefix including trailing slash, e.g. "homework/" */
  folderPrefix: string;
  allowedKinds: readonly OwnedUploadMediaKind[];
  /** Human label for error copy ("homework" / "niyam proof"). */
  label?: string;
}): Promise<ResolveOwnedUploadOk | ResolveOwnedUploadFail> {
  const label = opts.label ?? "upload";
  const folder = opts.folderPrefix.replace(/\/$/, "");
  const key = uploadKeyFromUrl(opts.url);
  if (!key || !key.startsWith(opts.folderPrefix)) {
    return {
      ok: false,
      message: `That ${label} link is not a file you uploaded here (${folder} uploads only) — upload the file first, then submit.`,
    };
  }

  const [row] = await db
    .select({
      uploaded_by: upload_objects.uploaded_by,
      content_type: upload_objects.content_type,
    })
    .from(upload_objects)
    .where(eq(upload_objects.key, key))
    .limit(1);

  if (!row || row.uploaded_by !== opts.userId) {
    return {
      ok: false,
      message: `That ${label} file is not an upload owned by you. Re-upload it and try again.`,
    };
  }

  const kind = kindFromContentType(row.content_type, key);
  if (!kind || !opts.allowedKinds.includes(kind)) {
    const allowed = opts.allowedKinds.join(" or ");
    // Name the offending type ("a video") so the parent knows WHICH file to
    // swap, not just that something was wrong.
    const what = kind ? `A ${kind} file` : "That file type";
    return {
      ok: false,
      message: `${what} cannot be used for ${label} — upload an ${allowed} instead.`,
    };
  }

  return {
    ok: true,
    key,
    contentType: row.content_type,
    kind,
  };
}
