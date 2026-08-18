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

/**
 * Collapse the spelling distinctions people do not make when typing.
 *
 * The schwa variant above was not enough on its own: it writes "namokaara",
 * "mahaaveera", "gurujee" — faithful, and nothing anyone types. A reader types
 * "namokar", "mahavir", "guruji". The long/short vowel distinction Devanagari
 * marks is simply absent from how Indian users spell in Latin, so the index and
 * the query have to meet in the middle.
 *
 * Applied to BOTH sides. Folding only the index would leave the query spelling
 * "mahaveer" unable to reach a folded "mahavir"; folding only the query would
 * do the reverse. The rule is one function so the two cannot drift.
 *
 * The word-final "a" goes too: the schwa variant writes "kalpasutra" where the
 * literal writes "klpsootr", and a reader may type either. Dropping it from both
 * sides and matching by prefix covers both, because "kalpasutr" is a prefix of
 * whatever they typed. Guarded at length 2 so single syllables ("ka") survive.
 */
export function searchFold(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((word) => {
      const folded = word
        .replace(/aa/g, "a")
        .replace(/ee|ii/g, "i")
        .replace(/oo|uu/g, "u")
        // Hindi speakers type व as either; "shwetambar" and "shvetambar" are
        // the same word to everyone who searches for it.
        .replace(/w/g, "v");
      return folded.length > 2 && folded.endsWith("a")
        ? folded.slice(0, -1)
        : folded;
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

/**
 * The consonant skeleton — every vowel dropped.
 *
 * Last resort for the one thing folding cannot reach: a reader who drops a
 * MEDIAL vowel. नवकार is indexed "navakar" and typed "navkar"; कल्पसूत्र is
 * "kalpasutr" and typed "kalpsutra". Enumerating which internal schwas a
 * particular speaker keeps is guesswork, so the skeleton ignores all of them.
 *
 * "m" folds to "n" because the anusvara is romanised one way and typed the
 * other before a labial — संवत्सरी is "sanvatsari" here and "samvatsari" to
 * everyone who types it.
 *
 * Far too loose to rank against, so it is queried ONLY when the real query
 * found nothing, and only from four characters up — see searchLibrary.
 */
export function romanSkeleton(input: string): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[aeiou]/g, "").replace(/m/g, "n"))
    .filter((word) => word.length >= 3)
    .join(" ")
    .trim();
}

/** Both romanisations of one string, folded and de-duplicated. */
function foldedVariants(input: string): string[] {
  const literal = searchFold(romanize(input));
  const schwa = searchFold(romanizeWithSchwa(input));
  return [...new Set([literal, schwa])].filter(Boolean);
}

/**
 * Join several strings, romanize, and collapse for the roman_title column.
 *
 * Emits the FOLDED spellings only. Every query token that can reach this column
 * is folded too (see buildFtsPrefixQuery), so an unfolded copy could never
 * match — it would be index weight that no query can address.
 */
export function buildRomanTitle(parts: Array<string | null | undefined>, bodyCap = 2000): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p?.trim()) continue;
    chunks.push(...foldedVariants(p));
  }
  let joined = chunks.filter(Boolean).join(" ");
  if (joined.length > bodyCap) joined = joined.slice(0, bodyCap);
  return joined.replace(/\s+/g, " ").trim();
}

/**
 * The skeleton column's contents. Titles and tarj only — never the body, which
 * would turn a four-letter skeleton prefix into a match against half the shelf.
 */
export function buildRomanSkeleton(parts: Array<string | null | undefined>): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p?.trim()) continue;
    for (const variant of foldedVariants(p)) {
      const skel = romanSkeleton(variant);
      if (skel) chunks.push(skel);
    }
  }
  return [...new Set(chunks.join(" ").split(" "))].filter(Boolean).join(" ");
}
