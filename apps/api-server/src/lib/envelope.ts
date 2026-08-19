import type { Response } from "express";
import { z } from "zod";
import type { ErrorCode } from "@workspace/api-zod";

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200): void {
  res.status(status).json(meta ? { data, meta } : { data });
}

export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): void {
  res.status(status).json({ error: details === undefined ? { code, message } : { code, message, details } });
}

/**
 * Flatten Zod issues into envelope `details` entries.
 *
 * Takes `unknown` so it can be handed the binding from a bare `catch` around
 * `schema.parse()`, not just a `safeParse` error — returns undefined for
 * anything that is not a ZodError, which `fail` then omits from the envelope.
 */
export function zodDetails(err: unknown): Array<{ path: string; message: string }> | undefined {
  if (!(err instanceof z.ZodError)) return undefined;
  return err.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
  }));
}
