/**
 * Human-readable entity codes.
 *
 * | Entity        | Format                  | Example           |
 * | Pathshala     | {CITY}-{LOC}            | MUM-GHK           |
 * | Student       | {CITY}-STU-{#####}      | MUM-STU-00042     | city-scoped, permanent
 * | Parent        | {CITY}-PAR-{#####}      | MUM-PAR-00012     |
 * | Shikshak      | {PATHSHALA}-SHK-{#####} | MUM-GHK-SHK-00003 |
 * | Sanchalak     | {PATHSHALA}-SAN-{#####} | MUM-GHK-SAN-00003 |
 * | City admin    | {CITY}-CAD-{#####}      | MUM-CAD-00001     |
 * | State admin   | {STATE}-SAD-{#####}     | MH-SAD-00001      |
 * | MSV member    | MSV{#####}              | MSV00001          |
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

export type CodeSeries = "STU" | "PAR" | "SHK" | "SAN" | "CAD" | "SAD" | "MSV";

const PAD: Record<CodeSeries, number> = {
  STU: 5,
  PAR: 5,
  SHK: 5,
  SAN: 5,
  CAD: 5,
  SAD: 5,
  MSV: 5,
};

/** Uppercase A–Z / 0–9 / hyphen only; trim junk. */
export function normalizeCodePart(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Derive a 2–4 letter locality token from a place name (Ghatkopar → GHK). */
export function localityToken(localityOrName: string): string {
  const cleaned = localityOrName
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\b(JAIN|PATHSHALA|CENTRE|CENTER|EAST|WEST|NORTH|SOUTH|NEW|ROAD)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length === 0) return "CTR";
  if (words.length === 1) {
    const w = words[0]!;
    if (w.length <= 4) return w;
    // Prefer consonants for a compact token.
    const cons = w.replace(/[AEIOU]/g, "");
    if (cons.length >= 3) return cons.slice(0, 3);
    return w.slice(0, 3);
  }
  return words
    .slice(0, 3)
    .map((w) => w[0]!)
    .join("");
}

export function composePathshalaCode(cityCode: string, localityPart: string): string {
  const city = normalizeCodePart(cityCode);
  const loc = normalizeCodePart(localityPart).replace(/-/g, "");
  if (!city || !loc) {
    throw new Error("Pathshala code needs a city code and a locality token.");
  }
  return `${city}-${loc}`;
}

export function formatPersonaCode(
  series: Exclude<CodeSeries, "MSV">,
  scopeKey: string,
  n: number,
): string {
  const pad = PAD[series];
  const num = String(n).padStart(pad, "0");
  const scope = normalizeCodePart(scopeKey);
  if (series === "STU" || series === "PAR" || series === "CAD") {
    return `${scope}-${series}-${num}`;
  }
  if (series === "SAD") {
    return `${scope}-SAD-${num}`;
  }
  // SHK / SAN — scope is full Pathshala code (MUM-GHK)
  return `${scope}-${series}-${num}`;
}

export function formatMsvCode(n: number): string {
  return `MSV${String(n).padStart(PAD.MSV, "0")}`;
}

/** Atomically bump the counter and return the next integer for (series, scope). */
export async function nextCodeNumber(
  dbOrTx: DbOrTx,
  series: CodeSeries,
  scopeKey: string,
): Promise<number> {
  const scope = series === "MSV" ? "GLOBAL" : normalizeCodePart(scopeKey);
  if (!scope) throw new Error(`Missing scope for ${series} code allocation`);

  const result = await dbOrTx.execute(sql`
    INSERT INTO entity_code_counters (series, scope_key, last_no)
    VALUES (${series}, ${scope}, 1)
    ON CONFLICT (series, scope_key) DO UPDATE
      SET last_no = entity_code_counters.last_no + 1,
          updated_at = now()
    RETURNING last_no
  `);
  const rows =
    (result as unknown as { rows?: Array<{ last_no: number }> }).rows ?? [];
  const n = Number(rows[0]?.last_no);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error(`Failed to allocate ${series} code for ${scope}`);
  }
  return n;
}

export async function allocateStudentCode(dbOrTx: DbOrTx, cityCode: string): Promise<string> {
  const n = await nextCodeNumber(dbOrTx, "STU", cityCode);
  return formatPersonaCode("STU", cityCode, n);
}

export async function allocateParentCode(dbOrTx: DbOrTx, cityCode: string): Promise<string> {
  const n = await nextCodeNumber(dbOrTx, "PAR", cityCode);
  return formatPersonaCode("PAR", cityCode, n);
}

export async function allocateShikshakCode(
  dbOrTx: DbOrTx,
  pathshalaCode: string,
): Promise<string> {
  const n = await nextCodeNumber(dbOrTx, "SHK", pathshalaCode);
  return formatPersonaCode("SHK", pathshalaCode, n);
}

export async function allocateSanchalakCode(
  dbOrTx: DbOrTx,
  pathshalaCode: string,
): Promise<string> {
  const n = await nextCodeNumber(dbOrTx, "SAN", pathshalaCode);
  return formatPersonaCode("SAN", pathshalaCode, n);
}

export async function allocateCityAdminCode(dbOrTx: DbOrTx, cityCode: string): Promise<string> {
  const n = await nextCodeNumber(dbOrTx, "CAD", cityCode);
  return formatPersonaCode("CAD", cityCode, n);
}

export async function allocateStateAdminCode(dbOrTx: DbOrTx, stateCode: string): Promise<string> {
  const n = await nextCodeNumber(dbOrTx, "SAD", stateCode);
  return formatPersonaCode("SAD", stateCode, n);
}

export async function allocateMsvCode(dbOrTx: DbOrTx): Promise<string> {
  const n = await nextCodeNumber(dbOrTx, "MSV", "GLOBAL");
  return formatMsvCode(n);
}

/** Sync a counter up so later allocations do not collide with backfilled codes. */
export async function bumpCounterAtLeast(
  dbOrTx: DbOrTx,
  series: CodeSeries,
  scopeKey: string,
  atLeast: number,
): Promise<void> {
  const scope = series === "MSV" ? "GLOBAL" : normalizeCodePart(scopeKey);
  if (!scope || atLeast < 1) return;
  await dbOrTx.execute(sql`
    INSERT INTO entity_code_counters (series, scope_key, last_no)
    VALUES (${series}, ${scope}, ${atLeast})
    ON CONFLICT (series, scope_key) DO UPDATE
      SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no),
          updated_at = now()
  `);
}
