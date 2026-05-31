/**
 * AiHmacGuard — verifies a request was signed by the FastAPI AI service.
 *
 * Used to protect `POST /v1/questions/ai-batch`. The contract mirrors
 * what NestJS sends OUTBOUND (see ai-quiz-generate.processor.ts):
 *
 *     X-Signature: hex(HMAC-SHA256(secret, body))
 *     X-Timestamp: unix epoch seconds (anti-replay; ±300s window)
 *
 * We need access to the raw body to verify the signature. The
 * `main.ts` bootstrap installs `express.raw()` for the AI batch path so
 * `req.rawBody` is populated by the time this guard runs.
 *
 * In production a misconfigured deploy (missing secret) is caught by the
 * env schema at boot. In dev / test the guard short-circuits to allow if
 * the secret is empty so unit tests don't need to mint signatures.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import { CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';

import { AppError } from '@jp/shared';

import { AppConfigService } from '../../core/config/app-config.service';

interface RawBodyRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  body?: unknown;
}

@Injectable()
export class AiHmacGuard implements CanActivate {
  private readonly logger = new Logger(AiHmacGuard.name);
  private static readonly MAX_SKEW_SECONDS = 300;

  constructor(private readonly cfg: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RawBodyRequest>();
    const secret = this.cfg.aiService.hmacSecret;

    // Dev / test convenience: when the secret isn't configured, allow.
    // production startup refuses to boot without the secret.
    if (!secret) {
      this.logger.warn(
        'AI_SERVICE_HMAC_SECRET not configured — allowing /v1/questions/ai-batch unsigned (DEV ONLY)',
      );
      return true;
    }

    const headerOf = (name: string): string => {
      const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
      if (Array.isArray(raw)) return raw[0] ?? '';
      return typeof raw === 'string' ? raw : '';
    };

    const signature = headerOf('x-signature');
    const timestamp = headerOf('x-timestamp');
    if (!signature || !timestamp) {
      throw new AppError({
        code: 'ERR_AI_HMAC_MISSING' as never,
        message: 'Both X-Signature and X-Timestamp are required',
        statusCode: 401,
      });
    }

    const ts = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(ts)) {
      throw new AppError({
        code: 'ERR_AI_HMAC_TIMESTAMP' as never,
        message: 'X-Timestamp must be an integer',
        statusCode: 401,
      });
    }
    const skew = Math.abs(Math.floor(Date.now() / 1000) - ts);
    if (skew > AiHmacGuard.MAX_SKEW_SECONDS) {
      throw new AppError({
        code: 'ERR_AI_HMAC_REPLAY' as never,
        message: `X-Timestamp skew ${skew}s exceeds ${AiHmacGuard.MAX_SKEW_SECONDS}s`,
        statusCode: 401,
      });
    }

    const body =
      req.rawBody ??
      (typeof req.body === 'string'
        ? Buffer.from(req.body, 'utf8')
        : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8'));

    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError({
        code: 'ERR_AI_HMAC_INVALID' as never,
        message: 'X-Signature does not match the request body',
        statusCode: 401,
      });
    }

    return true;
  }
}
