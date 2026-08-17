/**
 * Niyam proof-media resolution — shared by the online submit route and the
 * offline /v1/sync/batch handler.
 *
 * This lives here rather than in the route because CLAUDE.md "Offline sync §4"
 * requires each sync op_type handler to call the SAME service method as its
 * direct online endpoint. The sync path previously accepted a single unvalidated
 * `proof_asset_id` while the online route validated ownership, media kind,
 * `max_uploads` and `proof_required` — a parallel, weaker implementation, which
 * meant an offline submission could land without the proof the niyam required.
 */

export type ProofMediaKind = "photo" | "video" | "audio";

export type ClientMediaItem = {
  url: string;
  /** Ignored — kept on the wire for clients; kind is derived server-side. */
  kind: ProofMediaKind;
  mime?: string;
  size_bytes?: number;
};

export type ResolvedMediaItem = {
  url: string;
  kind: ProofMediaKind;
  mime: string | null;
  size_bytes: number | null;
};

/**
 * Resolve each media URL against upload_objects owned by this user.
 * Client-supplied `kind` is ignored — kind comes from stored content_type.
 */
export async function resolveSubmissionMedia(
  userId: string,
  items: ClientMediaItem[],
  allowed: ProofMediaKind[],
): Promise<{ ok: true; items: ResolvedMediaItem[] } | { ok: false; message: string }> {
  const { resolveOwnedUpload } = await import("./owned-upload");
  const allowedKinds = allowed.map((k) => (k === "photo" ? ("image" as const) : k));
  const resolved: ResolvedMediaItem[] = [];
  for (const item of items) {
    const r = await resolveOwnedUpload({
      userId,
      url: item.url,
      folderPrefix: "niyam-proof/",
      allowedKinds,
      label: "niyam proof",
    });
    if (!r.ok) {
      return { ok: false, message: r.message };
    }
    const kind: ProofMediaKind = r.kind === "image" ? "photo" : (r.kind as ProofMediaKind);
    resolved.push({
      url: item.url,
      kind,
      mime: r.contentType ?? item.mime ?? null,
      size_bytes: item.size_bytes ?? null,
    });
  }
  return { ok: true, items: resolved };
}

/**
 * Gate media against the niyam's own rules. Shared so the offline path cannot
 * accept a submission the online path would have rejected.
 */
export function checkMediaAgainstNiyam(
  niyam: { max_uploads: number; proof_required: boolean },
  mediaCount: number,
): { ok: true } | { ok: false; message: string } {
  if (niyam.max_uploads === 0 && mediaCount > 0) {
    return { ok: false, message: "This niyam does not accept media." };
  }
  if (mediaCount > niyam.max_uploads) {
    return { ok: false, message: `This niyam accepts at most ${niyam.max_uploads} file(s).` };
  }
  if (niyam.proof_required && mediaCount === 0) {
    return { ok: false, message: "This niyam requires proof." };
  }
  return { ok: true };
}
