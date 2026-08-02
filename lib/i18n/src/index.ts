import en from "./locales/en.json";
import hi from "./locales/hi.json";

export type Locale = "en" | "hi";

const catalogs = { en, hi } as const;

export function tError(code: string, locale: Locale = "en"): string {
  const catalog = catalogs[locale]?.errors as Record<string, string> | undefined;
  return catalog?.[code] ?? catalogs.en.errors[code as keyof typeof catalogs.en.errors] ?? code;
}

export { en, hi };
