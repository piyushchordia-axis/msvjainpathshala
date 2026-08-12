/**
 * One-shot: build bhaktamar-stotra-hi.ts from extracted JSON.
 * Run: node scripts/gen-bhaktamar-content.mjs (from repo tooling as needed)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const jsonPath = path.join(root, "lib/db/src/content/bhaktamar-stotra-hi.json");
const outPath = path.join(root, "lib/db/src/content/bhaktamar-stotra-hi.ts");
const verses = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
if (!Array.isArray(verses) || verses.length !== 48) {
  throw new Error(`Expected 48 verses, got ${verses?.length}`);
}
const body = verses.map((v) => JSON.stringify(v)).join(",\n  ");
const ts = `/**
 * Bhaktamar Stotra (Hindi) — 48 verses.
 * Source: https://www.vidyasagar.net/bhaktamar-stotra-hindi/ (verses only).
 */
export const BHAKTAMAR_VERSES_HI: readonly string[] = [
  ${body},
];

export const BHAKTAMAR_MAHAMANTRA_HI =
  "ॐ ह्रीं क्लीं अर्हं वृषभनाथ तीर्थंकराय् नमः";

/** Closed-set HTML for library text_content_hi. */
export function bhaktamarStotraHiHtml(): string {
  const paras = BHAKTAMAR_VERSES_HI.map((v) => \`<p>\${v}</p>\`);
  paras.push(\`<p><strong>महामंत्र-</strong> \${BHAKTAMAR_MAHAMANTRA_HI}</p>\`);
  return paras.join("");
}
`;
fs.writeFileSync(outPath, ts, "utf8");
console.log("wrote", outPath, verses.length);
