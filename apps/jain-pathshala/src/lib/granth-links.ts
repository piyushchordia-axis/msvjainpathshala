/**
 * v3 §17.11.4 — hand-off targets from the browser.
 *
 * The rules live in `@workspace/api-zod` so the phone and the laptop cannot
 * disagree about a stored number. Web has no native map scheme, so the maps
 * target always renders as the shared https URL.
 */
import { mapsTarget, mapsWebUrl, telUrl, whatsappUrl } from '@workspace/api-zod';

export { normalisePhone } from '@workspace/api-zod';

export const telHref = telUrl;
export const whatsappHref = whatsappUrl;

export function mapsHref(lib: {
  lat: number | null;
  lng: number | null;
  name: string;
  address: string;
}): string | null {
  return mapsWebUrl(mapsTarget(lib));
}
