/**
 * Request-scoped context propagated via Node's AsyncLocalStorage.
 *
 * Stores the per-request `request_id` (ULID) and resolved actor info so log
 * lines and downstream services can include them without threading the
 * request through every function call.
 *
 * SPEC §18.12 calls for `request_id`, `user_id`, `role`, `centre_id` on every
 * log line — the request-id middleware seeds the ULID, the auth guard (Step 5)
 * fills in user/role/centre when present.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  request_id: string;
  user_id?: string;
  role?: string;
  centre_id?: string;
  impersonator_id?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Mutate the current context — used by guards / interceptors to enrich it
 * with `user_id`, `role`, etc. after auth resolves. Safe because each request
 * has its own context object (created by the middleware).
 */
export function setContextFields(fields: Partial<RequestContext>): void {
  const ctx = storage.getStore();
  if (ctx) Object.assign(ctx, fields);
}
