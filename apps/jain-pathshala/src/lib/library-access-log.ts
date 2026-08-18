/**
 * v3 §17.9 — report a library access event.
 *
 * Fire-and-forget: analytics must never surface as an error in front of a
 * reader, and must never delay what they asked for. Every failure is swallowed.
 *
 * Sends the same device id the sign-in flow sends, so pre-login reach is
 * counted and folds into the account on first login rather than double-counting
 * one person.
 */
import type { LibraryAccessEvent } from '@workspace/api-zod';
import { apiPost } from '@/lib/api-client';
import { getDeviceId } from '@/lib/device-id';

/**
 * Exactly one target. Most events fire on a piece of content; `granth_view` is
 * a SECTION open (§17.11.1), and a section id sent down the item field matches
 * no library item and is silently dropped.
 */
export type LibraryAccessTarget = { itemId: string } | { sectionId: string };

export function reportLibraryAccess(
  target: LibraryAccessTarget,
  event: LibraryAccessEvent,
): void {
  const body =
    'itemId' in target
      ? target.itemId
        ? { item_id: target.itemId }
        : null
      : target.sectionId
        ? { section_id: target.sectionId }
        : null;
  if (!body) return;
  void apiPost('/v1/library/access', {
    ...body,
    event,
    device_id: getDeviceId(),
  }).catch(() => {
    /* best-effort */
  });
}
