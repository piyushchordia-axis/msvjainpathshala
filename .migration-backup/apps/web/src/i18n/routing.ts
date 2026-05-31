/**
 * next-intl routing config. Subpath routing per the prompt:
 *
 *   /en/...   →  English (default)
 *   /hi/...   →  Hindi (Devanagari)
 *
 * `localePrefix: 'always'` forces the locale segment on every URL so
 * crawlers and the language switcher have a stable surface.
 */

import { defineRouting } from 'next-intl/routing';

import { DEFAULT_LOCALE, LOCALES } from './locales';

export const routing = defineRouting({
  locales: [...LOCALES],
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'always',
});
