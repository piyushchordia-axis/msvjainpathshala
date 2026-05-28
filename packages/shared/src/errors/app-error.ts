/**
 * `AppError` — the canonical error class thrown by the API.
 *
 * The NestJS exception filter (SPEC §4.2 `common/filters/http-exception.filter.ts`)
 * catches AppError, serialises it into the `ErrorEnvelope` shape, and sets
 * the matching HTTP status from `statusCode` (defaulting to 500 if unset).
 *
 * Construct via the static helpers (`AppError.notFound(...)`, etc.) so the
 * code + status pair is correct by construction.
 */

import { ERROR_CODES, type ErrorCode } from './codes.js';

import type { ErrorDetail } from './envelope.js';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details: ErrorDetail[] | undefined;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    statusCode: number;
    details?: ErrorDetail[];
    cause?: unknown;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.details = opts.details;
  }

  static notFound(message = 'Resource not found', details?: ErrorDetail[]): AppError {
    return new AppError({
      code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
      message,
      statusCode: 404,
      ...(details !== undefined && { details }),
    });
  }

  static validation(message = 'Validation failed', details?: ErrorDetail[]): AppError {
    return new AppError({
      code: ERROR_CODES.ERR_VALIDATION_FAILED,
      message,
      statusCode: 422,
      ...(details !== undefined && { details }),
    });
  }

  static forbidden(
    message = 'Forbidden',
    code: ErrorCode = ERROR_CODES.ERR_RBAC_FORBIDDEN,
  ): AppError {
    return new AppError({ code, message, statusCode: 403 });
  }

  static conflict(message: string, code: ErrorCode = ERROR_CODES.ERR_CONFLICT): AppError {
    return new AppError({ code, message, statusCode: 409 });
  }

  static rateLimited(message = 'Too many requests'): AppError {
    return new AppError({
      code: ERROR_CODES.ERR_RATE_LIMITED,
      message,
      statusCode: 429,
    });
  }

  static internal(message = 'Internal server error', cause?: unknown): AppError {
    return new AppError({
      code: ERROR_CODES.ERR_INTERNAL,
      message,
      statusCode: 500,
      ...(cause !== undefined && { cause }),
    });
  }
}
