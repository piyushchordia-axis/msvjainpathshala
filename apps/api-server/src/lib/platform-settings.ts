/**
 * Platform-level settings (Q3 — 80G) stored in the `settings` table.
 *
 * `eighty_g_enabled` defaults to FALSE; enabling it requires BOTH
 * `eighty_g_registration_number` AND `organization_pan` to be set (the PATCH
 * route enforces the pair). Existing receipts are never deleted when the
 * toggle goes off — eligibility is stamped per donation at capture time and
 * receipt files stay in storage untouched.
 */
import { db, settings } from "@workspace/db";
import { inArray } from "drizzle-orm";

export const PLATFORM_SETTINGS_ALLOWLIST = [
  "eighty_g_enabled",
  "eighty_g_registration_number",
  "organization_pan",
] as const;

export type PlatformSettingKey = (typeof PLATFORM_SETTINGS_ALLOWLIST)[number];

export function isPlatformSettingKey(key: string): key is PlatformSettingKey {
  return (PLATFORM_SETTINGS_ALLOWLIST as readonly string[]).includes(key);
}

export interface EightyGConfig {
  enabled: boolean;
  registrationNumber: string | null;
  organizationPan: string | null;
}

type SettingsReader = Pick<typeof db, "select">;

/** Read the 80G configuration; usable inside a transaction via `reader`. */
export async function getEightyGConfig(reader: SettingsReader = db): Promise<EightyGConfig> {
  const rows = await reader
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...PLATFORM_SETTINGS_ALLOWLIST]));
  const map = new Map(rows.map((r) => [r.key, r.value ?? ""]));
  return {
    enabled: (map.get("eighty_g_enabled") ?? "false").toLowerCase() === "true",
    registrationNumber: map.get("eighty_g_registration_number")?.trim() || null,
    organizationPan: map.get("organization_pan")?.trim() || null,
  };
}
