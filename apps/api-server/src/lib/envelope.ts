import type { Response } from "express";
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
