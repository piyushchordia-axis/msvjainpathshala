/**
 * Seeds a ULID request id, propagates it via AsyncLocalStorage, exposes it
 * on the response header `X-Request-Id`, and feeds it into pino-http's
 * `req.id`.
 *
 * If the inbound request already carries `X-Request-Id`, that value is
 * preferred — the upstream caller (mobile / web BFF / load balancer) keeps
 * authority for the id so traces stitch across hops.
 */

import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ulid } from 'ulid';

import { runWithContext, type RequestContext } from '../context/request-context';

import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction): void {
    const inbound = req.header(HEADER);
    const id = inbound && inbound.length <= 64 ? inbound : ulid();
    req.id = id;
    res.setHeader('X-Request-Id', id);

    const ctx: RequestContext = { request_id: id };
    runWithContext(ctx, () => next());
  }
}
