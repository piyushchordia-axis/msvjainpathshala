/**
 * Platform settings endpoint wrapper — super_admin only (CLAUDE.md Q3).
 *
 *   GET /v1/admin/platform-settings
 *
 * The 80G toggle is read-only here; the mobile super-admin "settings" tab
 * surfaces the singleton row so admins can see the current 80G config.
 */

import { api, unwrap } from '../client';

export interface PlatformSettingsDto {
  id: string;
  eighty_g_enabled: boolean;
  eighty_g_registration_number: string | null;
  eighty_g_trust_name: string | null;
  eighty_g_trust_address: string | null;
  eighty_g_section: string;
  last_updated_by: string | null;
  last_updated_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export const platformSettingsApi = {
  async get(): Promise<PlatformSettingsDto> {
    return unwrap<PlatformSettingsDto>(api.get('/v1/admin/platform-settings'));
  },
};
