/**
 * Notices endpoint wrappers used by the parent / shikshak / sanchalak notice
 * feed screen (Step 18).
 */

import { api, unwrap } from '../client';

export type NoticeScope = 'batch' | 'centre' | 'city' | 'state' | 'national' | 'msv';

export interface NoticeDto {
  id: string;
  scope: NoticeScope;
  city_id: string;
  centre_id: string | null;
  batch_id: string | null;
  msv_only: boolean;
  content_en: string;
  content_hi: string;
  attachments: Record<string, unknown> | null;
  pinned: boolean;
  scheduled_for: string | null;
  published_at: string | null;
  is_public: boolean;
  is_critical: boolean;
  send_sms: boolean;
  is_read?: boolean;
}

export const noticesApi = {
  async listForCaller(opts: { limit?: number; offset?: number } = {}): Promise<{
    items: NoticeDto[];
  }> {
    return unwrap<{ items: NoticeDto[] }>(api.get('/v1/notices', { params: opts }));
  },

  async listPublic(opts: { limit?: number; offset?: number } = {}): Promise<{
    items: NoticeDto[];
  }> {
    return unwrap<{ items: NoticeDto[] }>(api.get('/v1/notices/public', { params: opts }));
  },

  async markRead(noticeId: string): Promise<{ read_at: string }> {
    return unwrap<{ read_at: string }>(api.post(`/v1/notices/${noticeId}/read`, {}));
  },
};
