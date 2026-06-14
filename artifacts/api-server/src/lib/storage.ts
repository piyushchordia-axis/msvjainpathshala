/**
 * Pluggable file storage. LocalDiskProvider now; swap an S3/GCS provider later
 * by implementing the same StorageProvider interface — no call-site changes.
 *
 * Files are written under UPLOADS_DIR (default <cwd>/uploads) and served by
 * Express static at `${PUBLIC_API_URL}/uploads/<key>`.
 */
import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, writeFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface StoredObject {
  key: string;
  url: string;
  content_type: string;
  size: number;
}

export interface StorageProvider {
  /** Persist bytes and return its key + publicly-resolvable URL. */
  put(key: string, bytes: Buffer, contentType: string): Promise<StoredObject>;
  /** Absolute URL for a stored key. */
  url(key: string): string;
  /** Open a read stream for a stored key (used for streaming downloads). */
  getStream(key: string): ReadStream;
  /** Best-effort delete; never throws on a missing key. */
  remove(key: string): Promise<void>;
}

/** Build a safe, collision-free storage key: <folder>/<yyyy>/<mm>/<uuid><ext>. */
export function makeKey(folder: string, originalName?: string): string {
  const ext = originalName ? path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
  const safeFolder = folder.replace(/[^a-z0-9/_-]/gi, "").replace(/^\/+|\/+$/g, "") || "misc";
  return `${safeFolder}/${randomUUID()}${ext}`;
}

const PUBLIC_API_URL = (process.env["PUBLIC_API_URL"] ?? `http://localhost:${process.env["PORT"] ?? "8080"}`).replace(/\/+$/, "");

class LocalDiskProvider implements StorageProvider {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private resolve(key: string): string {
    // Prevent path traversal: resolved path must stay under baseDir.
    const target = path.resolve(this.baseDir, key);
    if (!target.startsWith(path.resolve(this.baseDir) + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return target;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    const target = this.resolve(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    const info = await stat(target);
    return { key, url: this.url(key), content_type: contentType, size: info.size };
  }

  url(key: string): string {
    return `${PUBLIC_API_URL}/uploads/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  getStream(key: string): ReadStream {
    return createReadStream(this.resolve(key));
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch {
      /* ignore missing */
    }
  }
}

/** Absolute path to the on-disk uploads directory (also served by Express static). */
export const UPLOADS_DIR = process.env["UPLOADS_DIR"]
  ? path.resolve(process.env["UPLOADS_DIR"])
  : path.resolve(process.cwd(), "uploads");

/** Singleton storage provider for the whole server. */
export const storage: StorageProvider = new LocalDiskProvider(UPLOADS_DIR);
