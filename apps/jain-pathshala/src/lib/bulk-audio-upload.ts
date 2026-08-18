/**
 * Per-file bulk audio upload.
 *
 * The panel used to POST every file in ONE multipart request and, when that
 * request rejected, mark every row `failed` — including files the server had
 * already stored and matched. Re-uploading them is the obvious next move and is
 * wrong. Worse, results were matched back by filename, so two files called
 * `ST-01.mp3` shared a single verdict.
 *
 * Uploading one file per request fixes both by construction: a row's outcome
 * comes from its own response, and an aborted run cannot un-finish a row that
 * already succeeded. Nothing is matched by name.
 *
 * `unknown` is the third outcome and it is the point. A transport failure means
 * we do not know whether the server stored the file — saying "failed" claims
 * knowledge we do not have, and the admin acts on it.
 */

export type BulkAudioStatus =
  | "queued"
  | "uploading"
  | "done"
  | "failed"
  | "unknown";

export type BulkAudioRow = {
  /** Position in the queue. Unique even when two files share a name. */
  index: number;
  filename: string;
  status: BulkAudioStatus;
  /** 0..1 while uploading; null when not measurable. */
  progress: number | null;
  itemCode: string | null;
  itemId: string | null;
  error: string | null;
};

/** What one upload attempt produced. */
export type BulkAudioOutcome =
  | { kind: "stored"; itemCode: string | null; itemId: string | null }
  | { kind: "rejected"; itemCode: string | null; error: string }
  | { kind: "unreachable"; error: string };

export function makeRows(files: Array<{ name: string }>): BulkAudioRow[] {
  return files.map((file, index) => ({
    index,
    filename: file.name,
    status: "queued",
    progress: null,
    itemCode: null,
    itemId: null,
    error: null,
  }));
}

/**
 * Fold one outcome into one row. Pure, and addressed by index — never by
 * filename, which is not unique and was the source of the shared-verdict bug.
 */
export function settleRow(row: BulkAudioRow, outcome: BulkAudioOutcome): BulkAudioRow {
  if (outcome.kind === "stored") {
    return {
      ...row,
      status: "done",
      progress: 1,
      itemCode: outcome.itemCode,
      itemId: outcome.itemId,
      error: null,
    };
  }
  if (outcome.kind === "rejected") {
    // The server looked at this file and said no. That is a real verdict.
    return {
      ...row,
      status: "failed",
      progress: null,
      itemCode: outcome.itemCode,
      error: outcome.error,
    };
  }
  // We never got a verdict. Say so, rather than inventing one.
  return { ...row, status: "unknown", progress: null, error: outcome.error };
}

export function applyOutcome(
  rows: BulkAudioRow[],
  index: number,
  outcome: BulkAudioOutcome,
): BulkAudioRow[] {
  return rows.map((r) => (r.index === index ? settleRow(r, outcome) : r));
}

export function setRowProgress(
  rows: BulkAudioRow[],
  index: number,
  progress: number | null,
): BulkAudioRow[] {
  return rows.map((r) =>
    r.index === index ? { ...r, status: "uploading", progress } : r,
  );
}

/**
 * Run `work` over every index with at most `limit` in flight.
 *
 * Bounded because a Sanchalak dropping forty stavans on the page should not
 * open forty concurrent uploads on a centre's connection — that is slower than
 * three, and it is how a run ends up half-finished.
 */
export async function runBounded(
  count: number,
  limit: number,
  work: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, count)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      await work(index);
    }
  });
  await Promise.all(lanes);
}
