/**
 * Pino logger configuration.
 *
 *   - Dev: pretty-printed via pino-pretty so traces are readable in the terminal.
 *   - Other envs: JSON to stdout, ready for CloudWatch / Loki ingestion.
 *
 * Required log fields (SPEC §18.12):
 *   timestamp, level, service, env, trace_id, span_id, request_id,
 *   user_id, role, centre_id, msg.
 *
 * - `service` + `env` are static bindings.
 * - `trace_id`, `span_id` are pulled from the active OpenTelemetry span via the
 *   mixin (zero-cost when there is no active span).
 * - `request_id`, `user_id`, `role`, `centre_id` come from the per-request
 *   AsyncLocalStorage context populated by the request-id middleware + auth guard.
 *
 * PII redaction (CLAUDE.md "Security rules") is applied via `formatters.log`
 * before any transport — see `observability/log-redactor.ts`.
 */

import { trace } from '@opentelemetry/api';

import { getRequestContext } from '../../common/context/request-context';
import { pinoRedactionFormatter } from '../../observability/log-redactor';

import type { AppConfigService } from '../config/app-config.service';
import type { Params } from 'nestjs-pino';
import type { LoggerOptions } from 'pino';

export function buildPinoOptions(config: AppConfigService): LoggerOptions {
  const base: LoggerOptions = {
    level: config.logLevel,
    base: {
      service: config.serviceName,
      env: config.nodeEnv,
    },
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    messageKey: 'msg',
    mixin: () => {
      const ctx = getRequestContext();
      const span = trace.getActiveSpan();
      const spanCtx = span?.spanContext();
      return {
        ...(ctx ?? {}),
        ...(spanCtx ? { trace_id: spanCtx.traceId, span_id: spanCtx.spanId } : {}),
      };
    },
    formatters: {
      // Redact PII keys deeply. SPEC §18.12 + CLAUDE.md "Security rules → PII".
      log: pinoRedactionFormatter,
      // Compact level field (numeric → string).
      level(label) {
        return { level: label };
      },
    },
  };

  if (config.isDevelopment) {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          singleLine: false,
          ignore: 'pid,hostname',
        },
      },
    };
  }

  return base;
}

/**
 * `nestjs-pino` configuration. Adds a pino-http request logger that the
 * RequestIdMiddleware feeds into via `request.id`.
 */
export function buildNestjsPinoParams(config: AppConfigService): Params {
  return {
    pinoHttp: {
      ...buildPinoOptions(config),
      // Use the request_id seeded by RequestIdMiddleware (req.id is a Node
      // convention; pino-http picks it up by default and re-emits it).
      genReqId: (req) =>
        (req as { id?: string }).id ?? `srv-${Math.random().toString(36).slice(2, 12)}`,
      // Trim the body / query off pino-http's default serialisers (we have
      // structured per-controller logging for those). Keep a small set of
      // signal fields that the redactor still scrubs.
      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      autoLogging: {
        ignore: (req) => {
          // /healthz hits every 5–10s from the ALB — no signal in logging it.
          const url = (req as { url?: string }).url ?? '';
          return url.startsWith('/healthz') || url.startsWith('/metrics');
        },
      },
      customLogLevel: (_req, res, err) => {
        if (err) return 'error';
        if (res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    },
  };
}
