/**
 * Post-upload media derivation on QUEUE_NAMES.MEDIA_PROCESSING.
 * Dispatch on payload.kind — do not add per-feature media queues.
 */
import { QUEUE_NAMES } from "@jp/shared/constants";
import { db, library_items } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

import { countPdfPages, readStoredPdf } from "../lib/library-pdf";
import { uploadKeyFromUrl } from "../lib/file-tokens";
import { registerQueueHandler, enqueueJob } from "../lib/queues";
import { logger } from "../lib/logger";

export const LIBRARY_PDF_PAGE_COUNT_KIND = "library_pdf_page_count";

/**
 * v3 §17.11.2 — count the pages of a freshly uploaded PDF and write the number
 * back onto the item.
 *
 * The count lands on `draft_pdf_page_count`, because that is where the upload
 * put the file and publish is what moves both across together. The one
 * exception is an item already published against this same file: there the
 * page count is a derived property of something readers can already open, so
 * writing it live completes the row rather than sneaking an unpublished edit
 * past the gate. Without that exception an admin who publishes faster than the
 * queue drains gets a permanent NULL.
 */
export async function runLibraryPdfPageCount(itemId: string): Promise<void> {
  const [row] = await db
    .select()
    .from(library_items)
    .where(and(eq(library_items.id, itemId), isNull(library_items.deleted_at)))
    .limit(1);
  if (!row?.draft_pdf_url) return;

  const key = uploadKeyFromUrl(row.draft_pdf_url);
  if (!key) return;

  const bytes = await readStoredPdf(key);
  if (!bytes) {
    logger.warn({ itemId, key }, "media.processing: stored PDF unreadable");
    return;
  }

  const pages = await countPdfPages(bytes);
  if (pages == null) {
    logger.warn({ itemId }, "media.processing: could not count PDF pages");
    return;
  }

  const patch: Record<string, unknown> = {
    draft_pdf_page_count: pages,
    updated_at: new Date(),
  };
  if (row.is_published && row.pdf_url === row.draft_pdf_url) {
    patch["pdf_page_count"] = pages;
  }

  await db.update(library_items).set(patch).where(eq(library_items.id, itemId));
}

/** Enqueue the page-count job for one item. Never throws — upload already succeeded. */
export async function enqueueLibraryPdfPageCount(itemId: string): Promise<void> {
  try {
    await enqueueJob(
      QUEUE_NAMES.MEDIA_PROCESSING,
      { kind: LIBRARY_PDF_PAGE_COUNT_KIND, item_id: itemId },
      // One pending count per item: re-uploading before the first job runs
      // should replace it, not queue a second parse of a 100MB file.
      { jobId: `${LIBRARY_PDF_PAGE_COUNT_KIND}:${itemId}` },
    );
  } catch (err) {
    logger.warn({ err, itemId }, "Failed to enqueue library PDF page count");
  }
}

let registered = false;

export function registerMediaJobs(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler(QUEUE_NAMES.MEDIA_PROCESSING, async (data) => {
    const kind = String((data as { kind?: string }).kind ?? "");
    if (kind === LIBRARY_PDF_PAGE_COUNT_KIND) {
      const itemId = String((data as { item_id?: string }).item_id ?? "");
      if (!itemId) return;
      await runLibraryPdfPageCount(itemId);
      return;
    }
    logger.warn({ kind }, "media.processing: unknown kind — ignored");
  });
}
