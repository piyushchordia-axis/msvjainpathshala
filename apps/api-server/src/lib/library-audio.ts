/**
 * Library audio: MP3 only, ≤96MB, ffmpeg → 128kbps mono, store via StorageProvider.
 * Cap raised for full stotra recordings (e.g. Bhaktamar).
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeKey, storage } from "./storage";

export const LIBRARY_AUDIO_MAX_BYTES = 96 * 1024 * 1024;

export type TranscodedAudio = {
  url: string;
  key: string;
  duration_sec: number;
  size_bytes: number;
};

export class LibraryAudioError extends Error {
  constructor(
    message: string,
    readonly code: "ERR_VALIDATION_FAILED" | "ERR_INTERNAL" = "ERR_VALIDATION_FAILED",
    readonly status = 422,
  ) {
    super(message);
    this.name = "LibraryAudioError";
  }
}

/** Parse item_code from an upload filename (stem before first extension). */
export function itemCodeFromFilename(filename: string): string | null {
  const base = path.basename(filename).replace(/\.[^.]+$/, "");
  const m = /^([A-Za-z0-9_-]+)/.exec(base);
  return m?.[1] ?? null;
}

function ffmpegBin(): string {
  return process.env["FFMPEG_PATH"]?.trim() || "ffmpeg";
}

function ffprobeBin(): string {
  return process.env["FFPROBE_PATH"]?.trim() || "ffprobe";
}

function runCmd(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ code: 127, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function probeDurationSec(filePath: string): Promise<number> {
  const { code, stderr } = await runCmd(ffprobeBin(), [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (code === 127) {
    throw new LibraryAudioError(
      "ffprobe is not available — install ffmpeg or set FFPROBE_PATH.",
      "ERR_INTERNAL",
      503,
    );
  }
  if (code !== 0) {
    throw new LibraryAudioError("Could not read audio duration.", "ERR_INTERNAL", 503);
  }
  // ffprobe prints duration on stdout; we only captured stderr — re-run collecting stdout
  const duration = await new Promise<number>((resolve, reject) => {
    const child = spawn(
      ffprobeBin(),
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true },
    );
    let out = "";
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
    });
    child.on("error", (err) => reject(err));
    child.on("close", (c) => {
      if (c !== 0) {
        reject(new Error(stderr || "ffprobe failed"));
        return;
      }
      const n = Number.parseFloat(out.trim());
      resolve(Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
    });
  });
  return duration;
}

/**
 * Validate MP3 buffer, transcode to 128kbps mono, upload to library folder.
 */
export async function processLibraryMp3(
  input: Buffer,
  originalName: string,
): Promise<TranscodedAudio> {
  if (input.byteLength > LIBRARY_AUDIO_MAX_BYTES) {
    throw new LibraryAudioError("Audio must be 96MB or smaller.");
  }
  const lower = originalName.toLowerCase();
  if (!lower.endsWith(".mp3")) {
    throw new LibraryAudioError("Only MP3 audio is accepted.");
  }
  // MPEG sync / ID3 magic
  const isMp3 =
    (input[0] === 0xff && (input[1]! & 0xe0) === 0xe0) ||
    (input[0] === 0x49 && input[1] === 0x44 && input[2] === 0x33);
  if (!isMp3) {
    throw new LibraryAudioError("File does not look like a valid MP3.");
  }

  const dir = await mkdtemp(path.join(tmpdir(), "jp-lib-audio-"));
  const inPath = path.join(dir, "in.mp3");
  const outPath = path.join(dir, "out.mp3");
  try {
    await writeFile(inPath, input);
    const { code, stderr } = await runCmd(ffmpegBin(), [
      "-y",
      "-i",
      inPath,
      "-ac",
      "1",
      "-b:a",
      "128k",
      "-codec:a",
      "libmp3lame",
      outPath,
    ]);
    if (code === 127) {
      throw new LibraryAudioError(
        "ffmpeg is not available — install ffmpeg or set FFMPEG_PATH.",
        "ERR_INTERNAL",
        503,
      );
    }
    if (code !== 0) {
      throw new LibraryAudioError(
        `Audio transcode failed: ${stderr.slice(0, 200)}`,
        "ERR_INTERNAL",
        503,
      );
    }
    const outBuf = await readFile(outPath);
    const duration_sec = await probeDurationSec(outPath);
    const key = makeKey("library", "audio.mp3");
    const stored = await storage.put(key, outBuf, "audio/mpeg");
    return {
      url: stored.url,
      key: stored.key,
      duration_sec,
      size_bytes: stored.size,
    };
  } finally {
    await Promise.allSettled([unlink(inPath), unlink(outPath)]);
  }
}
