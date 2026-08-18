/**
 * Pure scheduling rules for the shared library download queue (no react-native).
 *
 * Split out of download-queue.ts so the two rules that actually matter can be
 * unit-tested: the concurrency cap is OVERALL rather than per kind, and a
 * button's state is derived identically for audio and PDF.
 */

export type DownloadKind = "audio" | "pdf";

/** Local download status, shared by DownloadedAudio and DownloadedPdf. */
export type DownloadStatus = "queued" | "downloading" | "complete" | "failed";

export type QueueRow = {
  itemId: string;
  status: DownloadStatus;
  contentVersion: number;
};

export type DownloadRef = { kind: DownloadKind; itemId: string };

/** Progress and active-job keys are kind-prefixed: one item can have both. */
export function downloadKey(kind: DownloadKind, itemId: string): string {
  return `${kind}:${itemId}`;
}

/**
 * §17.4 — which jobs to start now, given what is already running.
 *
 * The cap is across both kinds. Three audio files plus three PDFs is six
 * simultaneous transfers on a centre's shared wifi, which is the saturation the
 * cap exists to prevent.
 *
 * Audio goes first when both are waiting: it is usually far smaller, so
 * clearing it releases slots sooner than letting a 60MB granth scan hold one
 * while three stavans wait behind it.
 */
export function pickNextDownloads(args: {
  audio: QueueRow[];
  pdf: QueueRow[];
  activeKeys: Iterable<string>;
  max: number;
}): DownloadRef[] {
  const active = new Set(args.activeKeys);
  const free = args.max - active.size;
  if (free <= 0) return [];

  const candidates: DownloadRef[] = [
    ...args.audio
      .filter((r) => r.status === "queued")
      .map((r) => ({ kind: "audio" as const, itemId: r.itemId })),
    ...args.pdf
      .filter((r) => r.status === "queued")
      .map((r) => ({ kind: "pdf" as const, itemId: r.itemId })),
  ];

  const out: DownloadRef[] = [];
  for (const ref of candidates) {
    if (out.length >= free) break;
    if (active.has(downloadKey(ref.kind, ref.itemId))) continue;
    out.push(ref);
  }
  return out;
}

export type DownloadButtonState = "idle" | "queued" | "downloading" | "ready" | "failed";

/**
 * §17.1.3 — the PDF button is the audio state machine exactly, so one resolver
 * serves both rather than a near-copy that drifts the first time either is
 * touched.
 *
 * A complete download of an OLDER content_version resolves to `idle`, not
 * `ready`: the reader has a file, but not the one the library now publishes,
 * and offering to open it would serve a corrected granth's superseded scan.
 */
export function resolveDownloadButtonState(
  row: { status: DownloadStatus; contentVersion: number } | undefined,
  contentVersion: number,
): DownloadButtonState {
  if (!row) return "idle";
  if (row.status === "queued") return "queued";
  if (row.status === "downloading") return "downloading";
  if (row.status === "failed") return "failed";
  if (row.status === "complete" && row.contentVersion === contentVersion) return "ready";
  return "idle";
}
