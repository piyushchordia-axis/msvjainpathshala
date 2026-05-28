/**
 * Notifications endpoint wrappers.
 *
 * Shapes match the Step 12 backend controllers:
 *   GET    /v1/notifications?cursor=&limit=20
 *   POST   /v1/notifications/:id/read
 *   POST   /v1/notifications/read-all
 *   GET    /v1/notifications/unread-count
 *   POST   /v1/device-tokens
 *   DELETE /v1/device-tokens/:id
 *   PATCH  /v1/users/me/notification-preferences
 *
 * All routes are JWT-guarded; the axios client attaches the bearer token
 * automatically.
 */

import { api, unwrap } from '../client';

export interface NotificationFeedItem {
  id: string;
  kind: string;
  title_en: string;
  title_hi: string;
  body_en: string;
  body_hi: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  channel: 'push' | 'sms' | 'email' | 'in_app';
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  source_entity_kind: string | null;
  source_entity_id: string | null;
  created_at: string;
}

export interface NotificationFeedPage {
  items: NotificationFeedItem[];
  next_cursor: string | null;
}

export interface NotificationPreferences {
  push: boolean;
  sms: boolean;
  email: boolean;
  in_app: boolean;
}

export const notificationsApi = {
  async list(
    params: { cursor?: string; limit?: number; only_unread?: boolean } = {},
  ): Promise<NotificationFeedPage> {
    const search = new URLSearchParams();
    if (params.cursor) search.set('cursor', params.cursor);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.only_unread) search.set('only_unread', '1');
    const qs = search.toString();
    return unwrap<NotificationFeedPage>(api.get(`/v1/notifications${qs ? `?${qs}` : ''}`));
  },

  async markRead(id: string): Promise<NotificationFeedItem> {
    const res = await unwrap<{ notification: NotificationFeedItem }>(
      api.post(`/v1/notifications/${id}/read`, {}),
    );
    return res.notification;
  },

  async markAllRead(): Promise<number> {
    const res = await unwrap<{ marked_read: number }>(api.post('/v1/notifications/read-all', {}));
    return res.marked_read;
  },

  async unreadCount(): Promise<number> {
    const res = await unwrap<{ unread_count: number }>(api.get('/v1/notifications/unread-count'));
    return res.unread_count;
  },

  async updatePreferences(
    patch: Partial<NotificationPreferences>,
  ): Promise<NotificationPreferences> {
    const res = await unwrap<{ notification_preferences: NotificationPreferences }>(
      api.patch('/v1/users/me/notification-preferences', patch),
    );
    return res.notification_preferences;
  },

  async registerDeviceToken(input: {
    platform: 'ios' | 'android' | 'web';
    token: string;
    device_id?: string;
  }): Promise<{ id: string }> {
    const res = await unwrap<{
      device_token: { id: string; platform: string; last_seen_at: string | null };
    }>(api.post('/v1/device-tokens', input));
    return { id: res.device_token.id };
  },

  async deleteDeviceToken(id: string): Promise<void> {
    await api.delete(`/v1/device-tokens/${id}`);
  },
};
