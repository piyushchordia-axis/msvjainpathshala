/**
 * Wraps every successful controller response into the canonical envelope:
 *
 *   { "data": <payload>, "meta": { "request_id", "timestamp" } }
 *
 * Per CLAUDE.md "API response envelope" and SPEC §6.27. Controllers that
 * need pagination meta should return either:
 *   - `Paginated<T>` from `@jp/shared` (items + page/page_size/total), or
 *   - a plain `{ items, ... }` object that already carries the pagination
 *     fields — the interceptor lifts them into `meta` automatically.
 *
 * Endpoints that produce non-JSON output (e.g. `/metrics`, `/healthz`) are
 * exempted by checking for the `BYPASS_ENVELOPE` symbol on the response.
 */

import { Injectable } from '@nestjs/common';
import { map, type Observable } from 'rxjs';

import { getRequestContext } from '../context/request-context';

import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';

export const BYPASS_ENVELOPE = Symbol.for('jp.bypassEnvelope');

const PAGINATION_KEYS = new Set(['page', 'page_size', 'total', 'next_cursor', 'prev_cursor']);
/**
 * Non-pagination keys we lift from the controller's payload into `meta`.
 * Step 10 adds `warning` + `duplicate_of_student_id` for enrolment
 * duplicate detection (SPEC §8.1 — same name+dob+parent surfaces a
 * non-blocking warning).
 */
const META_LIFT_KEYS = new Set(['warning', 'duplicate_of_student_id']);

@Injectable()
export class TransformInterceptor<T = unknown> implements NestInterceptor<T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    return next.handle().pipe(
      map((payload) => {
        const httpCtx = context.switchToHttp();
        const res = httpCtx.getResponse<{ [BYPASS_ENVELOPE]?: boolean }>();
        if (res[BYPASS_ENVELOPE]) return payload;

        const requestId = getRequestContext()?.request_id;

        // Lift pagination + meta fields off the payload into meta when present.
        let data: unknown = payload;
        const meta: Record<string, unknown> = {
          request_id: requestId,
          timestamp: new Date().toISOString(),
        };
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const obj = payload as Record<string, unknown>;
          const isList = 'items' in obj;
          const lifted: Record<string, unknown> = {};
          for (const key of META_LIFT_KEYS) {
            if (key in obj) lifted[key] = obj[key];
          }
          if (isList) {
            for (const key of PAGINATION_KEYS) {
              if (key in obj) lifted[key] = obj[key];
            }
          }
          if (Object.keys(lifted).length > 0) {
            // Don't mutate the controller's object — clone with lifted keys stripped.
            const remaining: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(obj)) {
              if (!PAGINATION_KEYS.has(k) && !META_LIFT_KEYS.has(k)) remaining[k] = v;
            }
            data = remaining;
            Object.assign(meta, lifted);
          }
        }

        return { data, meta };
      }),
    );
  }
}
