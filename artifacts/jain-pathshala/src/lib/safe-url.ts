/**
 * Returns the URL only if it uses an http(s) scheme, otherwise undefined — so a
 * stored `javascript:`/`data:` URL can never become an executable `href`.
 * Defense-in-depth: the API already rejects non-http(s) URLs on ingest, but this
 * guards any legacy/external data at the render boundary too.
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const protocol = new URL(url, window.location.origin).protocol;
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
