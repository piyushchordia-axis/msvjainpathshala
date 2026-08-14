/**
 * City public-route slug: lowercase, Devanagari→Roman, non-alphanumerics→hyphens.
 * Must stay in sync with migration `0063_cities_slug` (jp_city_slug).
 */

/** Devanagari → Roman (IAST-ish). Keys are Unicode code points / digraphs. */
const DEVANAGARI: Record<string, string> = {
  "\u0915\u094D\u0937": "ksh", // क्ष
  "\u0924\u094D\u0930": "tr", // त्र
  "\u091C\u094D\u091E": "gy", // ज्ञ
  "\u0905": "a", // अ
  "\u0906": "aa", // आ
  "\u0907": "i", // इ
  "\u0908": "ee", // ई
  "\u0909": "u", // उ
  "\u090A": "oo", // ऊ
  "\u090B": "ri", // ऋ
  "\u090F": "e", // ए
  "\u0910": "ai", // ऐ
  "\u0913": "o", // ओ
  "\u0914": "au", // औ
  "\u0915": "k", // क
  "\u0916": "kh", // ख
  "\u0917": "g", // ग
  "\u0918": "gh", // घ
  "\u0919": "ng", // ङ
  "\u091A": "ch", // च
  "\u091B": "chh", // छ
  "\u091C": "j", // ज
  "\u091D": "jh", // झ
  "\u091E": "ny", // ञ
  "\u091F": "t", // ट
  "\u0920": "th", // ठ
  "\u0921": "d", // ड
  "\u0922": "dh", // ढ
  "\u0923": "n", // ण
  "\u0924": "t", // त
  "\u0925": "th", // थ
  "\u0926": "d", // द
  "\u0927": "dh", // ध
  "\u0928": "n", // न
  "\u092A": "p", // प
  "\u092B": "ph", // फ
  "\u092C": "b", // ब
  "\u092D": "bh", // भ
  "\u092E": "m", // म
  "\u092F": "y", // य
  "\u0930": "r", // र
  "\u0932": "l", // ल
  "\u0935": "v", // व
  "\u0936": "sh", // श
  "\u0937": "sh", // ष
  "\u0938": "s", // स
  "\u0939": "h", // ह
  "\u093E": "a", // ा
  "\u093F": "i", // ि
  "\u0940": "ee", // ी
  "\u0941": "u", // ु
  "\u0942": "oo", // ू
  "\u0943": "ri", // ृ
  "\u0947": "e", // े
  "\u0948": "ai", // ै
  "\u094B": "o", // ो
  "\u094C": "au", // ौ
  "\u0902": "n", // ं
  "\u0901": "n", // ँ
  "\u0903": "h", // ः
  "\u094D": "", // ्
  "\u093C": "", // ़
  "\u0950": "om", // ॐ
};

function transliterateDevanagari(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; ) {
    // Prefer digraphs (क्ष / त्र / ज्ञ) before single code points.
    const three = input.slice(i, i + 3);
    if (DEVANAGARI[three] !== undefined) {
      out += DEVANAGARI[three];
      i += 3;
      continue;
    }
    const one = input[i]!;
    if (DEVANAGARI[one] !== undefined) {
      out += DEVANAGARI[one];
      i += 1;
      continue;
    }
    out += one;
    i += 1;
  }
  return out;
}

/** Derive a URL slug from a city display name. Empty string if nothing remains. */
export function slugifyCityName(name: string): string {
  return transliterateDevanagari(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validate an admin-supplied slug (already lowercased / hyphenated). */
export function isValidCitySlug(slug: string): boolean {
  return slug.length >= 1 && slug.length <= 120 && SLUG_RE.test(slug);
}
