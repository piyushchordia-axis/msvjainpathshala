const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Stable DD Mon YYYY (UTC) for receipts and certificates. */
export function formatPdfDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0');
  const m = MONTHS[date.getUTCMonth()] ?? '';
  return `${d} ${m} ${date.getUTCFullYear()}`;
}

export function formatInrFromPaise(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
