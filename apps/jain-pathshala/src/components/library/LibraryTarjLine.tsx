import type { LibraryItemDto } from "@workspace/api-zod";

/**
 * §17.1.3 — the melody a piece is sung to, in the viewer's language with
 * fallback to the other. Returns "" when neither is set.
 */
export function tarjLine(item: LibraryItemDto, hi: boolean): string {
  const en = item.tarj_en?.trim() || "";
  const hiVal = item.tarj_hi?.trim() || "";
  return hi ? hiVal || en : en || hiVal;
}

/** The label — a Jain/Indic term, kept untranslated in both locales. */
export function tarjLabel(hi: boolean): string {
  return hi ? "तर्ज़" : "Tarj";
}

export type LibraryTarjLineProps = {
  item: LibraryItemDto;
  hi: boolean;
  className?: string;
};

/**
 * One caption line under an item title. Renders nothing when the item has no
 * Tarj — most do not, and a bare "Tarj" label with nothing after it would sit
 * under every title in the library.
 */
export function LibraryTarjLine({ item, hi, className }: LibraryTarjLineProps) {
  const value = tarjLine(item, hi);
  if (!value) return null;
  return (
    <p className={className ?? "mt-1 text-sm leading-6 text-muted-foreground"}>
      <span className="font-medium">{tarjLabel(hi)}</span>
      {"\u2003"}
      {value}
    </p>
  );
}
