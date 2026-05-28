/**
 * next-intl request config. Loads the right locale dict from `@jp/i18n`
 * (which owns en.json / hi.json) so the web app shares strings with the
 * mobile app — no parallel translations to keep in sync.
 *
 * Path passed to `createNextIntlPlugin('./src/i18n/request.ts')` in
 * `next.config.ts`.
 */

import { getRequestConfig } from 'next-intl/server';

import { getLocale } from '@jp/i18n';

import { DEFAULT_LOCALE, isLocale } from './locales';

import type { AbstractIntlMessages } from 'next-intl';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = isLocale(requested) ? requested : DEFAULT_LOCALE;
  // @jp/i18n locales nest strings under namespace keys (`auth.otp.title`
  // style) — that shape is what next-intl's AbstractIntlMessages expects,
  // so the cast below is structural rather than lossy.
  return {
    locale,
    messages: getLocale(locale) as unknown as AbstractIntlMessages,
  };
});
