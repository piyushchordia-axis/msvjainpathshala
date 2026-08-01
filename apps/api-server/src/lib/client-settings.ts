/**
 * Keys that anonymous / non-admin clients may read (and that super_admin may
 * PATCH via /v1/admin/settings). Never put secrets here — settings also holds
 * default_otp_code which must stay off this list.
 */
export const CLIENT_SETTINGS_ALLOWLIST = ["gallery_carousel_interval_ms"] as const;

export type ClientSettingKey = (typeof CLIENT_SETTINGS_ALLOWLIST)[number];

export function isClientSettingKey(key: string): key is ClientSettingKey {
  return (CLIENT_SETTINGS_ALLOWLIST as readonly string[]).includes(key);
}
