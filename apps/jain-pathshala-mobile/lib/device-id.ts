/**
 * A stable per-install device id for `POST /api/auth/login` (verify phase).
 *
 * The server caps sessions at 5 per user and has a same-`device_id` replace
 * path so re-signing in on one handset is free. The old sign-in screen minted
 * `mobile-${Date.now()}-${Math.random()}` on EVERY verify, so mobile never took
 * that path: each sign-in burned a fresh slot, and six sign-ins from one phone
 * evicted five genuine other devices. The symptom — being silently signed out
 * on your other devices — reads as a token-refresh bug and would be chased
 * nowhere near here.
 *
 * Mirrors web's `jp.web.device_id`. Persisted through secureStorage, which is
 * the Keychain on iOS (survives reinstall, so the slot stays stable) and
 * AsyncStorage on Expo-web.
 */
import { secureStorage } from "@/lib/secure-storage";
import { ulid } from "@/lib/offline/ulid";

const KEY = "jp.mobile.device_id";

let cached: string | null = null;
let inflight: Promise<string> | null = null;

function mint(): string {
  // 33 chars, inside the server's 1..128 bound. Never derived from a hardware
  // identifier — this is a session slot key, not a fingerprint.
  return `mobile-${ulid()}`;
}

/**
 * Resolve this install's device id, minting and persisting one on first use.
 *
 * Never throws and never rejects: a locked or reset keystore degrades to an id
 * that is stable for the process, which is far better than failing sign-in.
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  // Concurrent callers share one resolution, so two of them cannot mint two ids
  // and race each other into the store.
  if (inflight) return inflight;

  inflight = (async () => {
    let id: string | null = null;
    try {
      id = await secureStorage.getItem(KEY);
    } catch {
      // Keystore unavailable — fall through and mint.
    }
    if (!id) {
      id = mint();
      try {
        await secureStorage.setItem(KEY, id);
      } catch {
        // Same: keep it in memory for this process rather than blocking login.
      }
    }
    cached = id;
    return id;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
