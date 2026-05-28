/**
 * Notices admin API wrappers (web admin) — Step 18.
 *
 * Mirrors apps/api/src/modules/notices/*.
 */

import { authenticatedServerClient } from './server-client';

export type NoticeScope = 'batch' | 'centre' | 'city' | 'state' | 'national' | 'msv';

export interface NoticeRow {
  id: string;
  scope: NoticeScope;
  city_id: string;
  centre_id: string | null;
  batch_id: string | null;
  msv_only: boolean;
  content_en: string;
  content_hi: string;
  pinned: boolean;
  scheduled_for: string | null;
  published_at: string | null;
  is_public: boolean;
  is_critical: boolean;
  send_sms: boolean;
  created_by_user_id: string;
}

export interface NoticeCreateInput {
  scope: NoticeScope;
  centre_id?: string;
  batch_id?: string;
  msv_only?: boolean;
  content_en: string;
  content_hi: string;
  pinned?: boolean;
  scheduled_for?: string;
  is_public?: boolean;
  is_critical?: boolean;
  send_sms?: boolean;
}

export interface SmsCostEstimate {
  recipients: number;
  segments_en: number;
  segments_hi: number;
  cost_paise: number;
  worst_segments_per_recipient: number;
}

export async function listAdminNotices(opts: { scope?: NoticeScope } = {}): Promise<{
  items: NoticeRow[];
}> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/notices', { params: opts });
  return res.data.data as { items: NoticeRow[] };
}

export async function createNotice(input: NoticeCreateInput): Promise<{
  notice: NoticeRow;
  estimated_recipients: number;
  estimated_sms_cost_paise: number | null;
}> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/notices', input);
  return res.data.data;
}

export async function estimateSmsCost(input: NoticeCreateInput): Promise<SmsCostEstimate> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/notices/estimate-sms', input);
  return res.data.data as SmsCostEstimate;
}

export async function pinNotice(id: string, pinned: boolean): Promise<NoticeRow> {
  const client = await authenticatedServerClient();
  const res = await client.patch(`/v1/admin/notices/${id}/pin`, { pinned });
  return res.data.data as NoticeRow;
}
