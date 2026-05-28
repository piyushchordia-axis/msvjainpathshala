/**
 * Locale list. Mirrors `@jp/i18n` SUPPORTED_LANGUAGES — kept in sync by
 * hand for the small set. If the list grows beyond a handful we'll
 * derive it from the package export directly.
 */

export const LOCALES = ['en', 'hi'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}
