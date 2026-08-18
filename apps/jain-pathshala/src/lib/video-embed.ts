/**
 * Turn a stored video link into an embeddable player URL.
 *
 * Q7 says video items carry a YouTube or Vimeo URL and that "the mobile and web
 * apps render these as embedded iframes/WebViews". Web was calling
 * `window.open` instead, so a popup blocker turned a stavan recording into an
 * error toast telling a desktop reader to install YouTube.
 *
 * The host allowlist mirrors `isVideoEmbedUrl` in the API
 * (apps/api-server/src/lib/validation.ts) and is deliberately an EXACT hostname
 * match, never endsWith — `youtube.com.evil.tld` must not become an iframe on a
 * page that also renders sanitised HTML.
 */

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
]);

const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

/** Bare ids only — anything else is not an id we are willing to interpolate. */
function cleanId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const id = raw.split("/")[0] ?? "";
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/**
 * The player URL for `url`, or null when it is not a recognised embed.
 *
 * Null is a real answer, not a failure: the caller keeps the plain link for
 * anything it cannot embed rather than rendering an iframe pointed at an
 * arbitrary host.
 */
export function videoEmbedSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/^\/+/, "");

  if (YOUTUBE_HOSTS.has(host)) {
    // youtu.be/ID
    if (host === "youtu.be") {
      const id = cleanId(path);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    // /watch?v=ID
    const v = cleanId(parsed.searchParams.get("v"));
    if (v) return `https://www.youtube.com/embed/${v}`;
    // /embed/ID, /shorts/ID, /live/ID all carry the id in the second segment
    const [first, second] = path.split("/");
    if (first === "embed" || first === "shorts" || first === "live") {
      const id = cleanId(second);
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    return null;
  }

  if (VIMEO_HOSTS.has(host)) {
    if (host === "player.vimeo.com") {
      const [first, second] = path.split("/");
      if (first !== "video") return null;
      const id = cleanId(second);
      return id ? `https://player.vimeo.com/video/${id}` : null;
    }
    const id = cleanId(path);
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }

  return null;
}
