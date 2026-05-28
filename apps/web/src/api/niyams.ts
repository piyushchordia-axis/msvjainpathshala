/**
 * Niyam + Gallery admin API wrappers (web admin) — Step 17.
 *
 * Mirrors apps/api/src/modules/niyams/* and gallery/*.
 */

import { authenticatedServerClient } from './server-client';

export type NiyamType = 'daily' | 'weekly' | 'monthly';
export type ProofType = 'photo' | 'video' | 'either';

export interface NiyamRow {
  id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  type: NiyamType;
  start_date: string;
  end_date: string | null;
  audience_kind: string;
  audience_filters: Record<string, unknown> | null;
  proof_type: ProofType;
  points_value: number;
  msv_only: boolean;
  city_id: string;
}

export interface NiyamSubmissionRow {
  id: string;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type: NiyamType;
  points_value: number;
  status: 'auto_approved' | 'rejected';
  submitted_at: string;
  submission_date: string;
  proof_asset_id: string;
  rejected_at: string | null;
  rejection_reason: string | null;
}

export async function listAdminNiyams(opts: { type?: NiyamType } = {}): Promise<{
  items: NiyamRow[];
}> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/niyams', { params: opts });
  return res.data.data as { items: NiyamRow[] };
}

export async function listAdminSubmissions(opts: {
  niyam_id?: string;
  only_approved?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ items: NiyamSubmissionRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/niyam-submissions', { params: opts });
  return res.data.data as { items: NiyamSubmissionRow[] };
}

export async function rejectSubmission(
  id: string,
  reason: string,
): Promise<{
  submission_id: string;
  reversal_transaction_id: string;
  points_reversed: number;
  gallery_hidden: boolean;
}> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/niyam-submissions/${id}/reject`, { reason });
  return res.data.data;
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------

export interface AdminGalleryItem {
  id: string;
  asset_id: string;
  is_featured: boolean;
  created_at: string;
  first_name: string;
  age_group: string;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type: string;
  removed: boolean;
  removed_by: string | null;
  student_id: string;
  centre_id: string;
  city_id: string;
}

export async function listAdminGallery(opts: {
  status?: 'visible' | 'removed' | 'featured';
  limit?: number;
  offset?: number;
}): Promise<{ items: AdminGalleryItem[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/gallery', { params: opts });
  return res.data.data as { items: AdminGalleryItem[] };
}

export async function featureGalleryItem(id: string): Promise<AdminGalleryItem> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/gallery/${id}/feature`, {});
  return res.data.data as AdminGalleryItem;
}

export async function unfeatureGalleryItem(id: string): Promise<AdminGalleryItem> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/gallery/${id}/unfeature`, {});
  return res.data.data as AdminGalleryItem;
}

export async function removeGalleryItem(id: string, reason: string): Promise<AdminGalleryItem> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/gallery/${id}/remove`, { reason });
  return res.data.data as AdminGalleryItem;
}
