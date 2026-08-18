/**
 * Library PDF ingest — v3 §17.11.2.
 *
 * PDF only, ≤100MB, stored as-is via the configured StorageProvider. No
 * transcoding: unlike audio (which is normalised to 128kbps mono) a PDF is
 * already its final artefact, and re-writing one risks losing embedded
 * Devanagari fonts that the reader needs.
 *
 * Page count is deliberately NOT extracted here. A 100MB scanned granth can
 * take seconds to parse, and the admin should not sit on an upload request
 * waiting for a number that only decorates the UI — §17.11.2 puts it on the
 * media.processing queue instead.
 */
import { MAX_LIBRARY_PDF_BYTES } from "@workspace/api-zod";
import { PDFDocument } from "pdf-lib";

import { makeKey, storage } from "./storage";

export const LIBRARY_PDF_MAX_BYTES = MAX_LIBRARY_PDF_BYTES;

export type StoredPdf = {
  url: string;
  key: string;
  size_bytes: number;
};

export class LibraryPdfError extends Error {
  constructor(
    message: string,
    readonly code: "ERR_VALIDATION_FAILED" | "ERR_LIBRARY_PDF_TOO_LARGE" | "ERR_INTERNAL" =
      "ERR_VALIDATION_FAILED",
    readonly status = 422,
  ) {
    super(message);
    this.name = "LibraryPdfError";
  }
}

/**
 * A PDF starts with `%PDF-` — checked on the bytes, not the declared MIME type
 * or the extension. Both of those are attacker-controlled on an upload, and
 * this file is later handed to a reader that will try to parse it.
 */
export function looksLikePdf(input: Buffer): boolean {
  return input.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Validate and store one PDF. Throws LibraryPdfError with the right status. */
export async function storeLibraryPdf(
  input: Buffer,
  originalName: string,
): Promise<StoredPdf> {
  if (input.byteLength > LIBRARY_PDF_MAX_BYTES) {
    throw new LibraryPdfError(
      "That PDF is larger than 100MB — compress it or split it into volumes, then upload again.",
      "ERR_LIBRARY_PDF_TOO_LARGE",
      413,
    );
  }
  if (!originalName.toLowerCase().endsWith(".pdf")) {
    throw new LibraryPdfError("Only PDF files are accepted — rename or convert the file first.");
  }
  if (!looksLikePdf(input)) {
    throw new LibraryPdfError(
      "That file is not a PDF — it has a .pdf name but different contents. Re-export it as a PDF.",
    );
  }

  const key = makeKey("library", "doc.pdf");
  const stored = await storage.put(key, input, "application/pdf");
  return { url: stored.url, key: stored.key, size_bytes: stored.size };
}

/**
 * Count pages without rendering. `ignoreEncryption` because plenty of scanned
 * granths carry an owner password that forbids editing but not reading — that
 * is not a reason to refuse a page count.
 */
export async function countPdfPages(input: Buffer): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true });
    const pages = doc.getPageCount();
    return Number.isFinite(pages) && pages > 0 ? pages : null;
  } catch {
    // A file we cannot parse still downloads and may still open in the reader;
    // a missing page count is a cosmetic loss, never a reason to fail the item.
    return null;
  }
}

/** Read a stored PDF back out of the StorageProvider (worker path). */
export async function readStoredPdf(key: string): Promise<Buffer | null> {
  try {
    const chunks: Buffer[] = [];
    const stream = storage.getStream(key);
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferView as never));
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
