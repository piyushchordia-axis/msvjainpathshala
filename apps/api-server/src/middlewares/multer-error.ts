import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { unlink } from "node:fs/promises";
import { ErrorCode, ERROR_MESSAGES } from "@workspace/api-zod";
import { fail } from "../lib/envelope";

function prefersHindi(req: Request): boolean {
  const raw = String(req.headers["accept-language"] ?? "");
  return /^hi\b/i.test(raw) || /(^|,)\s*hi\b/i.test(raw);
}

function unlinkReqTemps(req: Request): void {
  const paths: string[] = [];
  if (req.file?.path) paths.push(req.file.path);
  const files = req.files;
  if (Array.isArray(files)) {
    for (const f of files) {
      if (f.path) paths.push(f.path);
    }
  } else if (files && typeof files === "object") {
    for (const list of Object.values(files)) {
      for (const f of list) {
        if (f.path) paths.push(f.path);
      }
    }
  }
  for (const p of paths) {
    void unlink(p).catch(() => {});
  }
}

/**
 * Maps multer LIMIT_* errors to the shared envelope instead of a 500.
 * Must be registered before the terminal error handler.
 * Also unlinks any disk temp multer may have left behind (e.g. LIMIT_FILE_SIZE).
 */
export function handleMulterError(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!(err instanceof multer.MulterError)) {
    next(err);
    return;
  }

  unlinkReqTemps(req);

  if (err.code === "LIMIT_FILE_SIZE") {
    const msg = ERROR_MESSAGES.ERR_FILE_TOO_LARGE;
    fail(res, 413, ErrorCode.FILE_TOO_LARGE, prefersHindi(req) ? msg.hi : msg.en);
    return;
  }

  if (err.code === "LIMIT_FILE_COUNT") {
    fail(
      res,
      422,
      ErrorCode.VALIDATION_FAILED,
      prefersHindi(req)
        ? "बहुत अधिक फ़ाइलें। एक फ़ाइल चुनें और फिर कोशिश करें।"
        : "Too many files. Upload one file at a time and try again.",
    );
    return;
  }

  fail(
    res,
    422,
    ErrorCode.VALIDATION_FAILED,
    prefersHindi(req) ? "अपलोड अमान्य है। फिर कोशिश करें।" : "Upload is invalid. Please try again.",
  );
}
