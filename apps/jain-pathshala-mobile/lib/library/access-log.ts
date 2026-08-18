/**
 * v3 §17.9 — report a library access event.
 *
 * Fire-and-forget: analytics must never surface as an error in front of a
 * reader, and must never block the thing they actually asked for. Every caller
 * awaits nothing and every failure is swallowed.
 *
 * Guests report under the same device id the session flow uses, so pre-login
 * reach is counted and folds into the account on first sign-in.
 */
import type { LibraryAccessEvent } from "@workspace/api-zod";
import { apiPost } from "@/lib/api";
import { getDeviceId } from "@/lib/device-id";

/**
 * Exactly one target. Most events fire on a piece of content; `granth_view` is
 * a SECTION open (§17.11.1), and a section id sent down the item field matches
 * no library item and is silently dropped.
 */
export type LibraryAccessTarget = { itemId: string } | { sectionId: string };

export async function logLibraryAccess(
  target: LibraryAccessTarget,
  event: LibraryAccessEvent,
): Promise<void> {
  const body =
    "itemId" in target
      ? target.itemId
        ? { item_id: target.itemId }
        : null
      : target.sectionId
        ? { section_id: target.sectionId }
        : null;
  if (!body) return;
  try {
    const device_id = await getDeviceId();
    await apiPost("/v1/library/access", { ...body, event, device_id });
  } catch {
    /* analytics are best-effort — never let this reach the reader */
  }
}

/** Detached form: use where the caller must not await at all. */
export function reportLibraryAccess(
  target: LibraryAccessTarget,
  event: LibraryAccessEvent,
): void {
  void logLibraryAccess(target, event);
}
