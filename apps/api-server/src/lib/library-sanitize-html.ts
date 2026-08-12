/**
 * Closed-set HTML sanitizer for library textContent.
 * Allow: p, br, b, i, strong, em, #text.
 * On p only: style limited to text-align: left|center|right|justify.
 */

const ALLOWED_TAGS = new Set(["p", "br", "b", "i", "strong", "em"]);
const VOID_TAGS = new Set(["br"]);
const ALIGN = new Set(["left", "center", "right", "justify"]);

const TOKEN_RE =
  /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)/g;

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

/** Extract text-align from a raw style attribute, if allowed. */
function allowedTextAlign(attrs: string): string | null {
  const styleMatch = attrs.match(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!styleMatch) return null;
  const style = styleMatch[1] ?? styleMatch[2] ?? styleMatch[3] ?? "";
  const alignMatch = style.match(/(?:^|;)\s*text-align\s*:\s*([a-z]+)\s*(?:;|$)/i);
  if (!alignMatch) return null;
  const align = alignMatch[1]!.toLowerCase();
  return ALIGN.has(align) ? align : null;
}

/**
 * Sanitize library HTML to the allowlist. Unknown tags are unwrapped (children kept).
 * Void/disallowed empty tags are dropped. Scripts and comments removed.
 */
export function sanitizeLibraryHtml(input: string): string {
  if (!input) return "";
  const html = input.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");

  type Frame = { tag: string; align: string | null; out: string[] };
  const root: Frame = { tag: "#root", align: null, out: [] };
  const stack: Frame[] = [root];

  let cursor = 0;
  while (cursor < html.length) {
    TOKEN_RE.lastIndex = cursor;
    const m = TOKEN_RE.exec(html);
    // Bare `<` that is not a tag/comment — emit as text so `a < b` stays safe.
    if (!m || m.index !== cursor) {
      const ch = html[cursor]!;
      stack[stack.length - 1]!.out.push(ch === "<" ? "&lt;" : escapeText(ch));
      cursor += 1;
      continue;
    }
    cursor = TOKEN_RE.lastIndex;

    const full = m[0];
    if (full.startsWith("<!--")) continue;

    if (m[3] !== undefined) {
      // Text node
      const text = escapeText(decodeBasicEntities(m[3]));
      if (text) stack[stack.length - 1]!.out.push(text);
      continue;
    }

    const tagName = m[1]!.toLowerCase();
    const attrs = m[2] ?? "";
    const isClose = full.startsWith("</");
    const isSelfClosing = /\/\s*>$/.test(full) || VOID_TAGS.has(tagName);

    if (isClose) {
      // Pop until matching allowed tag; unwrap others already handled
      for (let i = stack.length - 1; i >= 1; i--) {
        if (stack[i]!.tag === tagName) {
          const frame = stack.pop()!;
          const parent = stack[stack.length - 1]!;
          if (ALLOWED_TAGS.has(frame.tag) && !VOID_TAGS.has(frame.tag)) {
            const style =
              frame.tag === "p" && frame.align
                ? ` style="text-align: ${frame.align}"`
                : "";
            parent.out.push(`<${frame.tag}${style}>${frame.out.join("")}</${frame.tag}>`);
          } else {
            // Disallowed close — just splice children up
            parent.out.push(...frame.out);
          }
          break;
        }
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      // Unwrap: ignore open tag (children flow to current frame); ignore void
      continue;
    }

    if (VOID_TAGS.has(tagName) || isSelfClosing) {
      stack[stack.length - 1]!.out.push(`<${tagName} />`);
      continue;
    }

    const align = tagName === "p" ? allowedTextAlign(attrs) : null;
    stack.push({ tag: tagName, align, out: [] });
  }

  // Close any unclosed allowed frames
  while (stack.length > 1) {
    const frame = stack.pop()!;
    const parent = stack[stack.length - 1]!;
    if (ALLOWED_TAGS.has(frame.tag) && !VOID_TAGS.has(frame.tag)) {
      const style =
        frame.tag === "p" && frame.align ? ` style="text-align: ${frame.align}"` : "";
      parent.out.push(`<${frame.tag}${style}>${frame.out.join("")}</${frame.tag}>`);
    } else {
      parent.out.push(...frame.out);
    }
  }

  return root.out.join("").trim();
}

export type LibraryTextLang = "en" | "hi" | "gu";

export function availableTextLangs(item: {
  text_content_en?: string | null;
  text_content_hi?: string | null;
  text_content_gu?: string | null;
}): LibraryTextLang[] {
  const out: LibraryTextLang[] = [];
  if (item.text_content_en?.trim()) out.push("en");
  if (item.text_content_hi?.trim()) out.push("hi");
  if (item.text_content_gu?.trim()) out.push("gu");
  return out;
}

export function textContentForLang(
  item: {
    text_content_en?: string | null;
    text_content_hi?: string | null;
    text_content_gu?: string | null;
  },
  lang: LibraryTextLang,
): string {
  if (lang === "hi") return item.text_content_hi?.trim() || item.text_content_en || item.text_content_gu || "";
  if (lang === "gu") return item.text_content_gu?.trim() || item.text_content_en || item.text_content_hi || "";
  return item.text_content_en?.trim() || item.text_content_hi || item.text_content_gu || "";
}
