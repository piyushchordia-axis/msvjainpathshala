/**
 * Library endpoint wrappers — Step 22.
 *
 * Lists items visible to the caller (tier-filtered server-side) and reads
 * one by id. Q7: video items carry an embed_url (YouTube/Vimeo) and no
 * asset_id; pdf/audio/image items carry an asset_id which the mobile
 * client resolves via /v1/media/:id when it needs a signed URL.
 */

import { api, unwrap } from '../client';

export type LibraryContentType = 'pdf' | 'video' | 'audio' | 'image';
export type LibraryAccessTier = 'public' | 'student' | 'msv' | 'shikshak';

export interface LibraryItemDto {
  id: string;
  content_type: LibraryContentType;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  asset_id: string | null;
  embed_url: string | null;
  tags: string[];
  age_groups: string[];
  languages: string[];
  access_tier: LibraryAccessTier;
  msv_only: boolean;
  city_id: string | null;
  created_at: string;
}

export const libraryApi = {
  async list(opts: { content_type?: LibraryContentType; limit?: number; offset?: number } = {}) {
    return unwrap<{ items: LibraryItemDto[] }>(api.get('/v1/library', { params: opts }));
  },
  async getById(id: string) {
    return unwrap<LibraryItemDto>(api.get(`/v1/library/${id}`));
  },
  async logAccess(id: string, action: 'view' | 'download' = 'view') {
    return unwrap<{ ok: boolean }>(api.post(`/v1/library/${id}/access-log`, { action }));
  },
};
