/**
 * Lossy Indic → ASCII romanization for library FTS (search-oriented, not linguistic).
 * Matras must be quoted string keys (not valid bare identifiers).
 */

const MAP: Record<string, string> = {
  // Devanagari independent vowels
  "अ": "a",
  "आ": "aa",
  "इ": "i",
  "ई": "ee",
  "उ": "u",
  "ऊ": "oo",
  "ऋ": "ri",
  "ए": "e",
  "ऐ": "ai",
  "ओ": "o",
  "औ": "au",
  // Devanagari consonants
  "क": "k",
  "ख": "kh",
  "ग": "g",
  "घ": "gh",
  "ङ": "ng",
  "च": "ch",
  "छ": "chh",
  "ज": "j",
  "झ": "jh",
  "ञ": "ny",
  "ट": "t",
  "ठ": "th",
  "ड": "d",
  "ढ": "dh",
  "ण": "n",
  "त": "t",
  "थ": "th",
  "द": "d",
  "ध": "dh",
  "न": "n",
  "प": "p",
  "फ": "ph",
  "ब": "b",
  "भ": "bh",
  "म": "m",
  "य": "y",
  "र": "r",
  "ल": "l",
  "व": "v",
  "श": "sh",
  "ष": "sh",
  "स": "s",
  "ह": "h",
  "ळ": "l",
  "क्ष": "ksh",
  "ज्ञ": "gy",
  // Devanagari matras / signs
  "ा": "aa",
  "ि": "i",
  "ी": "ee",
  "ु": "u",
  "ू": "oo",
  "ृ": "ri",
  "े": "e",
  "ै": "ai",
  "ो": "o",
  "ौ": "au",
  "ं": "n",
  "ः": "h",
  "ँ": "n",
  "्": "",
  // Gujarati independent vowels
  "અ": "a",
  "આ": "aa",
  "ઇ": "i",
  "ઈ": "ee",
  "ઉ": "u",
  "ઊ": "oo",
  "ઋ": "ri",
  "એ": "e",
  "ઐ": "ai",
  "ઓ": "o",
  "ઔ": "au",
  // Gujarati consonants
  "ક": "k",
  "ખ": "kh",
  "ગ": "g",
  "ઘ": "gh",
  "ઙ": "ng",
  "ચ": "ch",
  "છ": "chh",
  "જ": "j",
  "ઝ": "jh",
  "ઞ": "ny",
  "ટ": "t",
  "ઠ": "th",
  "ડ": "d",
  "ઢ": "dh",
  "ણ": "n",
  "ત": "t",
  "થ": "th",
  "દ": "d",
  "ધ": "dh",
  "ન": "n",
  "પ": "p",
  "ફ": "ph",
  "બ": "b",
  "ભ": "bh",
  "મ": "m",
  "ય": "y",
  "ર": "r",
  "લ": "l",
  "વ": "v",
  "શ": "sh",
  "ષ": "sh",
  "સ": "s",
  "હ": "h",
  "ળ": "l",
  "ક્ષ": "ksh",
  "જ્ઞ": "gy",
  // Gujarati matras / signs
  "ા": "aa",
  "િ": "i",
  "ી": "ee",
  "ુ": "u",
  "ૂ": "oo",
  "ૃ": "ri",
  "ે": "e",
  "ૈ": "ai",
  "ો": "o",
  "ૌ": "au",
  "ં": "n",
  "ઃ": "h",
  "ઁ": "n",
  "્": "",
};

const LIGATURES = ["क्ष", "ज्ञ", "ક્ષ", "જ્ઞ"] as const;

/** Transliterate Devanagari/Gujarati (and Latin) to lowercase ASCII for FTS. */
export function romanize(input: string): string {
  if (!input) return "";
  let out = "";
  let i = 0;
  while (i < input.length) {
    let matched = false;
    for (const lig of LIGATURES) {
      if (input.startsWith(lig, i)) {
        out += MAP[lig] ?? "";
        i += lig.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const ch = input[i]!;
    i += 1;
    if (MAP[ch] !== undefined) {
      out += MAP[ch];
      continue;
    }
    const latin = ch.normalize("NFD").replace(/\p{M}/gu, "");
    if (/[A-Za-z0-9]/.test(latin)) {
      out += latin.toLowerCase();
      continue;
    }
    if (/\s/.test(ch)) out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Consonants, so the schwa variant knows where an implicit "a" belongs.
 * Derived from MAP rather than listed again — a consonant added there must
 * not need remembering here.
 */
const CONSONANTS = new Set(
  Object.keys(MAP).filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    const devanagariConsonant = cp >= 0x0915 && cp <= 0x0939;
    const gujaratiConsonant = cp >= 0x0a95 && cp <= 0x0ab9;
    return devanagariConsonant || gujaratiConsonant || ch.length > 1;
  }),
);

/**
 * True for a dependent VOWEL sign or a virama — the two things that replace or
 * cancel a consonant's inherent vowel.
 *
 * Deliberately narrower than "any combining mark": anusvara, visarga and
 * candrabindu are marks too, but they are nasals and breath, not vowels.
 * Counting them would make संघवी "snghavee" instead of "sanghavee", and
 * "sangh" is exactly what someone types.
 *
 * A following CONSONANT does not mute anything either: कल्प is "kalpa".
 */
function mutesInherentVowel(ch: string | undefined): boolean {
  const cp = ch?.codePointAt(0);
  if (cp === undefined) return false;
  // Devanagari matras U+093E–U+094C and virama U+094D.
  if (cp >= 0x093e && cp <= 0x094d) return true;
  // Gujarati matras U+0ABE–U+0ACC and virama U+0ACD.
  if (cp >= 0x0abe && cp <= 0x0acd) return true;
  return false;
}

/**
 * The same transliteration with the INHERENT VOWEL written out.
 *
 * romanize() is deliberately literal: कल्पसूत्र becomes "klpsootr", because
 * every Devanagari consonant carries an unwritten "a" that the glyphs do not
 * show. Nobody types "klpsootr". They type "kalpasutra", and a prefix search
 * for "kalp" against "klpsootr" matches nothing — so a Devanagari-only title
 * was unreachable from a Roman keyboard, which is the one thing §17.5's
 * romanisation exists to prevent.
 *
 * Emitted ALONGSIDE the literal form rather than replacing it: both spellings
 * are indexed, so nothing that matched before stops matching.
 */
export function romanizeWithSchwa(input: string): string {
  if (!input) return "";
  let out = "";
  let i = 0;
  while (i < input.length) {
    let token: string | null = null;
    for (const lig of LIGATURES) {
      if (input.startsWith(lig, i)) {
        token = lig;
        break;
      }
    }
    if (!token) token = input[i]!;
    i += token.length;

    const mapped = MAP[token];
    if (mapped !== undefined) {
      out += mapped;
      if (CONSONANTS.has(token)) {
        // The inherent vowel sounds unless a matra or a virama follows.
        if (!mutesInherentVowel(input[i])) out += "a";
      }
      continue;
    }

    const latin = token.normalize("NFD").replace(/\p{M}/gu, "");
    if (/[A-Za-z0-9]/.test(latin)) {
      out += latin.toLowerCase();
      continue;
    }
    if (/\s/.test(token)) out += " ";
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Join several strings, romanize, and collapse for the roman_title column. */
export function buildRomanTitle(parts: Array<string | null | undefined>, bodyCap = 2000): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p?.trim()) continue;
    const literal = romanize(p);
    chunks.push(literal);
    // Both spellings, so "kalp" and "klp" both reach कल्पसूत्र.
    const schwa = romanizeWithSchwa(p);
    if (schwa && schwa !== literal) chunks.push(schwa);
  }
  let joined = chunks.filter(Boolean).join(" ");
  if (joined.length > bodyCap) joined = joined.slice(0, bodyCap);
  return joined.replace(/\s+/g, " ").trim();
}
