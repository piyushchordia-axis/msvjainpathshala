/**
 * Cached batch roster snapshots. Key = batch_id; value = roster + meta.
 * Full payload shape lands in Step 13 (Attendance) — Step 8 only declares.
 */

import { CacheStore } from './_cache-base';

export interface BatchSnapshot {
  id: string;
  name: string;
  centre_id: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  student_ids: string[];
}

export const batchesCache = new CacheStore<BatchSnapshot>('jp.cache.batches');
