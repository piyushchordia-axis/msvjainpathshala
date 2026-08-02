import en from "./locales/en.json";
import hi from "./locales/hi.json";

export type Locale = "en" | "hi";

const catalogs = { en, hi } as const;

type Catalog = typeof en;

function lookup(catalog: Catalog, path: string): string | undefined {
  const parts = path.split(".");
  let cur: unknown = catalog;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "string" ? cur : undefined;
}

/** Dot-path lookup into locale catalogs, with `{{var}}` interpolation. */
export function t(
  path: string,
  locale: Locale = "en",
  vars?: Record<string, string | number>,
): string {
  const raw =
    lookup(catalogs[locale], path) ??
    lookup(catalogs.en, path) ??
    path;
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{{${k}}}`, String(v)),
    raw,
  );
}

export function tError(code: string, locale: Locale = "en"): string {
  const catalog = catalogs[locale]?.errors as Record<string, string> | undefined;
  return catalog?.[code] ?? catalogs.en.errors[code as keyof typeof catalogs.en.errors] ?? code;
}

export { en, hi };
