/**
 * v3 §17.11.4 — open the device's own apps: maps, dialler, WhatsApp.
 *
 * The URL rules are shared with web in `@workspace/api-zod`; only the map
 * scheme is decided here, because `geo:` and Apple Maps exist on a handset and
 * not in a browser.
 *
 * Every opener reports failure rather than throwing: "no app can do this" is an
 * ordinary state on a spare handset with no dialler or no WhatsApp, and the
 * caller has to say so in copy that names the fix.
 */
import { Linking, Platform } from "react-native";
import type { GranthLibraryDto } from "@workspace/api-zod";
import { mapsTarget, mapsWebUrl, telUrl, whatsappUrl } from "@workspace/api-zod";

export { normalisePhone, telUrl, whatsappUrl, mapsTarget } from "@workspace/api-zod";

export type HandoffResult = "opened" | "failed";

/**
 * Native map schemes first so the hand-off lands in the reader's own map app
 * rather than a browser tab; the shared https URL is the fallback.
 */
export function mapsUrl(lib: {
  lat: number | null;
  lng: number | null;
  name: string;
  address: string;
}): string | null {
  const target = mapsTarget(lib);
  if (!target) return null;
  if (target.kind === "coords") {
    const coords = `${target.lat},${target.lng}`;
    const label = encodeURIComponent(target.label);
    return Platform.OS === "ios"
      ? `https://maps.apple.com/?q=${label}&ll=${coords}`
      : `geo:${coords}?q=${coords}(${label})`;
  }
  return mapsWebUrl(target);
}

async function open(url: string | null): Promise<HandoffResult> {
  if (!url) return "failed";
  try {
    await Linking.openURL(url);
    return "opened";
  } catch {
    return "failed";
  }
}

export function openMaps(
  lib: GranthLibraryDto,
  name: string,
  address: string,
): Promise<HandoffResult> {
  return open(mapsUrl({ lat: lib.lat, lng: lib.lng, name, address }));
}

export function openPhone(phone: string | null | undefined): Promise<HandoffResult> {
  return open(telUrl(phone));
}

export function openWhatsapp(phone: string | null | undefined): Promise<HandoffResult> {
  return open(whatsappUrl(phone));
}
