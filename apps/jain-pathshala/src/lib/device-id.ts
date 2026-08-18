/**
 * A stable per-browser device id.
 *
 * Was copy-pasted into both login pages. It is now shared because a THIRD
 * caller needs it — the library content-request form — and that caller only
 * works if it sends the exact value the sign-in flow sends: the server re-keys
 * a guest's device-scoped requests to their account by matching this id at
 * login (SPEC §17.4 / §17.10.2). A second minting rule would silently mean the
 * re-key never matches and guest history is lost at sign-in.
 *
 * Never derived from a hardware or browser fingerprint — this is a session-slot
 * key, and the server caps sessions per device on it.
 */
import { ulid } from 'ulid';

const KEY = 'jp.web.device_id';

export function getDeviceId(): string {
  if (typeof window === 'undefined') return 'web-ssr';
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = `web-${ulid()}`;
    window.localStorage.setItem(KEY, id);
  }
  return id;
}
