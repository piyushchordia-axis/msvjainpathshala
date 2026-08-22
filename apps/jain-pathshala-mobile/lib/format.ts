/** Lightweight date helpers for display (mirrors web's inline formatting). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// P-17 (review 2026-08) — formatDate had no locale branch at all (not just a
// missed argument at call sites); every other locale-sensitive value in this
// app threads `hi` explicitly.
const MONTHS_HI = [
  "जन", "फ़र", "मार्च", "अप्रैल", "मई", "जून",
  "जुल", "अग", "सित", "अक्तू", "नव", "दिस",
];

function fmt(d: Date, hi: boolean): string {
  const months = hi ? MONTHS_HI : MONTHS;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDate(value: string | null | undefined, hi = false): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return fmt(d, hi);
}

export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  hi = false,
): string {
  if (!start && !end) return "—";
  if (start && end) return `${formatDate(start, hi)} – ${formatDate(end, hi)}`;
  return formatDate(start ?? end, hi);
}

export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = (start ?? "").slice(0, 5);
  const e = (end ?? "").slice(0, 5);
  if (s && e) return `${s} – ${e}`;
  return s || e || "—";
}

export function formatPaise(paise: number | null | undefined): string {
  if (!paise) return "₹0";
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
