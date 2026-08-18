/**
 * Fetching published Panchang years from the API.
 *
 * Split from ./version, which must stay pure: version.ts holds the
 * cache-vs-remote decision and is unit-tested, and importing the API client
 * there drags react-native into the test bundler.
 *
 * This used to be a stub returning null, with a comment saying no public
 * endpoint existed. That was true, and it meant a verified Panchang could be
 * uploaded, reviewed and published and still never reach a single device — the
 * app stayed on its bundled file forever.
 */
import { apiGet } from "@/lib/api";
import { panchangYearSchema, type PanchangYear } from "@/lib/panchang/schema";

type PanchangYearResponse = {
  year: number;
  content_version: number;
  payload: unknown;
};

/**
 * Fetch one published year.
 *
 * Returns null rather than throwing on any failure — offline, 404 for a year
 * nobody has published, or a payload that does not satisfy the schema. The
 * caller is offline-first and simply keeps whatever it already had.
 *
 * The schema parse is the last gate before the cache: a payload without
 * provenance is discarded here, so an unverified year cannot be persisted onto
 * the device even if something upstream let one through.
 */
export async function fetchRemotePanchangYear(
  year: number,
): Promise<PanchangYear | null> {
  try {
    const res = await apiGet<PanchangYearResponse>(`/v1/panchang/years/${year}`);
    const parsed = panchangYearSchema.safeParse(res?.payload);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
