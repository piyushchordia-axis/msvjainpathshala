/**
 * Error envelope shape (CLAUDE.md "API response envelope"):
 *
 *   { "error": { "code": "ERR_...", "message": "...", "details": [...],
 *                "request_id": "..." } }
 *
 * `message` is *always* a human-readable English string — clients render the
 * localised version themselves using the code as a key into `@jp/i18n`.
 */

import type { ErrorCode } from './codes.js';

export interface ErrorDetail {
  /** Dot-path of the offending field (Zod-style), e.g. `centres[0].name_hi`. */
  path?: string;
  /** Code or hint used by the client to render a specific message under the field. */
  code?: string;
  /** Optional human-readable detail. */
  message?: string;
  /** Arbitrary extra metadata (e.g. min/max bounds). */
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    request_id?: string;
  };
}
