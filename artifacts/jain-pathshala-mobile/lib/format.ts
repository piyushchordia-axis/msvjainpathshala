/** Lightweight date helpers for display (mirrors web's inline formatting). */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmt(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return fmt(d);
}

export function formatDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "—";
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  return formatDate(start ?? end);
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
