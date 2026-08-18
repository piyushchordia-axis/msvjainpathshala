/**
 * v3 §17.11.4 — hand-off targets for maps, dialler and WhatsApp.
 *
 * Shared and dependency-free. The same stored number has to produce the same
 * WhatsApp link on the phone and on the laptop, or a reader who saw a chat
 * button on one and not the other would reasonably think something is broken.
 *
 * Only the platform-specific URL *scheme* is left to each client: `geo:` and
 * Apple Maps exist on a handset and not in a browser.
 */

/** Digits only, with a leading + preserved — wa.me rejects spaces and dashes. */
export function normalisePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 6) return null;
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}

export function telUrl(phone: string | null | undefined): string | null {
  const n = normalisePhone(phone);
  return n ? `tel:${n}` : null;
}

/**
 * wa.me wants the number WITHOUT a plus. A number stored with no country code
 * would deep-link to whatever country the reader's own account is in, so those
 * are refused rather than guessed — sending someone to a stranger is worse than
 * showing no button at all.
 */
export function whatsappUrl(phone: string | null | undefined): string | null {
  const n = normalisePhone(phone);
  if (!n || !n.startsWith("+")) return null;
  return `https://wa.me/${n.slice(1)}`;
}

export type MapsTarget =
  | { kind: "coords"; lat: number; lng: number; label: string }
  | { kind: "query"; query: string };

/**
 * §17.11.4 — coordinates when present, else an address query.
 *
 * A coordinate is exact; an address query is the map app's best guess. Never
 * synthesise one from the other, and never treat (0, 0) as a location: it is a
 * real point in the Gulf of Guinea, the same trap AT32 calls out for attendance
 * GPS. A library with neither usable coordinates nor an address returns null,
 * and the caller renders no button.
 */
export function mapsTarget(lib: {
  lat: number | null;
  lng: number | null;
  name: string;
  address: string;
}): MapsTarget | null {
  const usableCoords =
    typeof lib.lat === "number" &&
    typeof lib.lng === "number" &&
    Number.isFinite(lib.lat) &&
    Number.isFinite(lib.lng) &&
    !(lib.lat === 0 && lib.lng === 0);

  if (usableCoords) {
    return {
      kind: "coords",
      lat: lib.lat as number,
      lng: lib.lng as number,
      label: lib.name || "Library",
    };
  }

  const query = [lib.name, lib.address].filter(Boolean).join(", ").trim();
  return query ? { kind: "query", query } : null;
}

/** Browser-safe maps URL — used directly on web, and as the mobile fallback. */
export function mapsWebUrl(target: MapsTarget | null): string | null {
  if (!target) return null;
  return target.kind === "coords"
    ? `https://maps.google.com/?q=${target.lat},${target.lng}`
    : `https://maps.google.com/?q=${encodeURIComponent(target.query)}`;
}
