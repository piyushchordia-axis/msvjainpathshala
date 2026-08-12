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

/** Join several strings, romanize, and collapse for the roman_title column. */
export function buildRomanTitle(parts: Array<string | null | undefined>, bodyCap = 2000): string {
  const chunks: string[] = [];
  for (const p of parts) {
    if (!p?.trim()) continue;
    chunks.push(romanize(p));
  }
  let joined = chunks.filter(Boolean).join(" ");
  if (joined.length > bodyCap) joined = joined.slice(0, bodyCap);
  return joined.replace(/\s+/g, " ").trim();
}
