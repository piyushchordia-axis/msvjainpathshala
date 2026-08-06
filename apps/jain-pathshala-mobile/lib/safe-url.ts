/**
 * Returns the URL only if it uses an http(s) scheme, otherwise undefined — so a
 * stored `javascript:`/`data:` URL can never be handed to `Linking.openURL`.
 * Defense-in-depth: the API already rejects non-http(s) URLs on ingest and
 * guards delivery on POST /v1/library/:id/access, but this protects legacy /
 * public-feed rows at the open boundary too.
 *
 * Unlike the web helper, there is no page origin on native — the URL must be
 * absolute (relative paths fail the `URL` parse and are rejected).
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
