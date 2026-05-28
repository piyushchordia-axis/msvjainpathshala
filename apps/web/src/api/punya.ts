/**
 * Punya admin API wrappers (web admin) — Step 16.
 *
 * Surface mirrors the API contract in apps/api/src/modules/punya/*.
 */

import { authenticatedServerClient } from './server-client';

export type Tier = 'jigyasu' | 'shravak' | 'sadhak' | 'shraman' | 'tirthankar';

export interface PunyaFeature {
  id: string;
  key: string;
  default_points: number;
  is_manual: boolean;
  requires_reason: boolean;
  scope: 'global' | 'city';
  min_points: number | null;
  max_points: number | null;
}

export interface PunyaConfig {
  id: string;
  city_id: string;
  feature_id: string;
  points_override: number;
  min_points: number | null;
  max_points: number | null;
}

export interface PunyaTransaction {
  id: string;
  student_id: string;
  feature_key: string;
  points: number;
  reason: string | null;
  awarded_by_user_id: string | null;
  awarded_at: string;
  source_entity_kind: string;
  source_entity_id: string;
  reversal_of: string | null;
  city_id: string;
  centre_id: string | null;
  batch_id: string | null;
}

export interface ReconcileRunReport {
  run_id: string;
  started_at: string;
  finished_at: string;
  drift_count: number;
  drift_students: string[];
  alerted: boolean;
  source: 'cron' | 'manual_admin';
  details: Array<{
    student_id: string;
    before_total: number;
    after_total: number;
    drift_total: number;
  }>;
}

export async function listFeatures(): Promise<{ items: PunyaFeature[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/punya/features');
  return res.data.data as { items: PunyaFeature[] };
}

export async function listConfigsForCity(cityId: string): Promise<{ items: PunyaConfig[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/admin/punya/configs/${cityId}`);
  return res.data.data as { items: PunyaConfig[] };
}

export async function upsertConfig(input: {
  city_id: string;
  feature_id: string;
  points_override: number;
  min_points?: number;
  max_points?: number;
}): Promise<PunyaConfig> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/punya/configs', input);
  return res.data.data as PunyaConfig;
}

export async function manualAward(input: {
  student_id: string;
  feature_key: string;
  points: number;
  reason: string;
  is_msv_track?: boolean;
}): Promise<{ transaction: PunyaTransaction; balance: unknown; duplicate: boolean }> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/punya/manual-award', input);
  return res.data.data;
}

export async function reverseTransaction(input: {
  source_id: string;
  reason: string;
}): Promise<{ reversal_id: string; source_id: string; tier_downgraded: boolean }> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/punya/reverse', input);
  return res.data.data;
}

export async function lastReconcileRun(): Promise<ReconcileRunReport | null> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/punya/reconcile/last-run');
  return res.data.data as ReconcileRunReport | null;
}

export async function runReconcile(): Promise<ReconcileRunReport> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/punya/reconcile', {});
  return res.data.data as ReconcileRunReport;
}
