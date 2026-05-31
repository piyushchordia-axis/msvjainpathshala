/**
 * Profile store — device-scoped user preferences. Currently:
 *   - preferred_language (drives i18n, also synced server-side via
 *     PATCH /v1/auth/me when the toggle changes).
 *   - last_login_phone (pre-fills the phone input on /login).
 *
 * Lives in MMKV `jp.profile` so it survives logout (DESIGN_GUIDE intent:
 * a user's language choice persists across re-logins on the same device).
 */

import { getMmkv } from '../mmkv';

import type { ProfileSnapshot } from '../types';

const KEY = 'snapshot';
const DEFAULT: ProfileSnapshot = { preferred_language: 'en' };

export const profileStore = {
  get(): ProfileSnapshot {
    const raw = getMmkv('jp.profile').getString(KEY);
    if (!raw) return DEFAULT;
    try {
      return { ...DEFAULT, ...(JSON.parse(raw) as Partial<ProfileSnapshot>) };
    } catch {
      return DEFAULT;
    }
  },
  set(patch: Partial<ProfileSnapshot>): void {
    const current = this.get();
    const next = { ...current, ...patch };
    getMmkv('jp.profile').set(KEY, JSON.stringify(next));
  },
  clear(): void {
    getMmkv('jp.profile').delete(KEY);
  },
};
