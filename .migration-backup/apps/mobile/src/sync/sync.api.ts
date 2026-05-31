/**
 * Sync API client — typed wrappers around `/v1/sync/{batch,bootstrap,delta}`.
 *
 * The wire types come from `@jp/shared/schemas/sync`; we narrow them to the
 * client-side shape we actually consume. `unwrap()` strips the
 * `{ data, meta }` envelope so call sites get the inner payload directly.
 */

import { api, unwrap } from '@/api/client';

import type { Role, SyncOperationDto, SyncResultDto } from '@jp/shared';

export interface SyncBatchResult {
  results: SyncResultDto[];
  server_timestamp: string;
}

export interface SyncBootstrapResponse {
  user_id: string;
  role: Role;
  view_context: 'parent' | 'student';
  generated_at: string;
  payload: Record<string, unknown>;
}

export const syncApi = {
  batch(ops: SyncOperationDto[]): Promise<SyncBatchResult> {
    return unwrap(api.post('/v1/sync/batch', { ops }));
  },
  bootstrap(): Promise<SyncBootstrapResponse> {
    return unwrap(api.get('/v1/sync/bootstrap'));
  },
  delta(since: string): Promise<SyncBootstrapResponse> {
    return unwrap(api.get('/v1/sync/delta', { params: { since } }));
  },
};
