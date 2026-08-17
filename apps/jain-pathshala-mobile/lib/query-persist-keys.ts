/** Allow-list for PersistQueryClient — attendance + shikshak roster only.
 *
 * Explicit denials (even if someone later widens the allow-list):
 * gallery admin must never land on disk — opted-out family photos live there.
 */
export function shouldPersistQueryKey(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  const segment = queryKey[1];

  // Safeguard: admin gallery (incl. opted-out thumbnails) stays in memory only.
  if (root === "admin" && segment === "gallery") return false;

  if (root === "shikshak") {
    return segment === "attendance-session" || segment === "today";
  }
  if (root === "me") {
    // "today" lives under the "me" root (qk.today), not "shikshak" — the mismatch
    // meant the session list was dropped on relaunch, so a Guruji reopening the
    // app offline at a centre saw "No sessions today" and could reach no roster
    // at all, even though every roster was still cached.
    return segment === "attendance" || segment === "today";
  }
  if (root === "library") {
    return true;
  }
  // Public browse surfaces (centres, shivirs, notices, holidays, settings) —
  // a guest reopening the app offline used to get blank screens because none
  // of these survived a relaunch (GST-ERR-03). Gallery stays memory-only:
  // consent (Q6) is resolved at query time, and a disk copy would keep a
  // family's photo visible after they opt out until the next fetch.
  if (root === "public") {
    return segment !== "gallery";
  }
  if (root === "team") {
    return true;
  }
  return false;
}
