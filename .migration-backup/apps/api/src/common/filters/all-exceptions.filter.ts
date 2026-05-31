/**
 * Global exception filter — every error response flows through here and is
 * shaped into the canonical envelope:
 *
 *   { "error": { "code", "message", "details"?, "request_id" } }
 *
 * Source priority:
 *   1. `AppError` (from `@jp/shared/errors`) — code + status authoritative.
 *   2. `ZodError` — 422 with structured field details.
 *   3. NestJS `HttpException` — status preserved, code mapped from status.
 *   4. Anything else — 500, code = ERR_INTERNAL, full stack logged.
 *
 * The filter NEVER leaks an Error message that looks like an SQL string or
 * stack trace to the client — production responses are sanitised; dev keeps
 * the original `message` for ergonomics.
 */

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ZodError } from 'zod';

import { AppError, ERROR_CODES, type ErrorEnvelope } from '@jp/shared';

import { getRequestContext } from '../context/request-context';

import type { Response } from 'express';

const STATUS_TO_CODE: Record<number, string> = {
  400: ERROR_CODES.ERR_VALIDATION_FAILED,
  401: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
  403: ERROR_CODES.ERR_RBAC_FORBIDDEN,
  404: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
  409: ERROR_CODES.ERR_CONFLICT,
  422: ERROR_CODES.ERR_VALIDATION_FAILED,
  429: ERROR_CODES.ERR_RATE_LIMITED,
  503: ERROR_CODES.ERR_INTERNAL,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const requestId = getRequestContext()?.request_id;

    const built = this.buildEnvelope(exception, requestId);

    if (built.status >= 500) {
      this.logger.error(
        { err: this.serialiseError(exception), request_id: requestId },
        built.envelope.error.message,
      );
    } else if (built.status >= 400) {
      this.logger.warn({ request_id: requestId, code: built.envelope.error.code });
    }

    res.status(built.status).json(built.envelope);
  }

  private buildEnvelope(
    exception: unknown,
    requestId: string | undefined,
  ): { status: number; envelope: ErrorEnvelope } {
    // ---- AppError -----------------------------------------------------
    if (exception instanceof AppError) {
      return {
        status: exception.statusCode,
        envelope: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details ? { details: exception.details } : {}),
            ...(requestId ? { request_id: requestId } : {}),
          },
        },
      };
    }

    // ---- ZodError -----------------------------------------------------
    if (exception instanceof ZodError) {
      return {
        status: 422,
        envelope: {
          error: {
            code: ERROR_CODES.ERR_VALIDATION_FAILED,
            message: 'Validation failed',
            details: exception.issues.map((i) => ({
              path: i.path.join('.'),
              code: i.code,
              message: i.message,
            })),
            ...(requestId ? { request_id: requestId } : {}),
          },
        },
      };
    }

    // ---- NestJS HttpException ----------------------------------------
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = (STATUS_TO_CODE[status] ??
        ERROR_CODES.ERR_INTERNAL) as ErrorEnvelope['error']['code'];
      const response = exception.getResponse();
      const message =
        typeof response === 'object' && response !== null && 'message' in (response as object)
          ? String((response as { message: unknown }).message)
          : typeof response === 'string'
            ? response
            : exception.message;
      return {
        status,
        envelope: {
          error: {
            code,
            message,
            ...(requestId ? { request_id: requestId } : {}),
          },
        },
      };
    }

    // ---- Anything else -----------------------------------------------
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      envelope: {
        error: {
          code: ERROR_CODES.ERR_INTERNAL,
          message:
            process.env.NODE_ENV === 'production'
              ? 'Internal server error'
              : exception instanceof Error
                ? exception.message
                : String(exception),
          ...(requestId ? { request_id: requestId } : {}),
        },
      },
    };
  }

  private serialiseError(e: unknown): Record<string, unknown> {
    if (e instanceof Error) {
      return { name: e.name, message: e.message, stack: e.stack };
    }
    return { value: String(e) };
  }
}
