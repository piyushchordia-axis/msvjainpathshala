/**
 * i18next setup. Translations come from `@jp/i18n` (en.json / hi.json).
 *
 * The active language is persisted in `profile.store` (MMKV `jp.profile`)
 * and rehydrated synchronously on import so the very first render uses
 * the right language — no English-flash on first paint after a Hindi user
 * cold-starts the app.
 *
 * To change the language at runtime, call:
 *   `i18n.changeLanguage('hi')`
 * which fires `i18next` listeners and triggers a re-render of every
 * `useTranslation()`-consuming component.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// `getLocale` from @jp/i18n returns the parsed JSON dict for a language.
// We use it instead of importing the JSON paths directly so the build
// honours the package boundary (Metro resolves through `@jp/i18n`).
import { getLocale } from '@jp/i18n';

import { profileStore } from '@/storage/stores/profile.store';

const startLang = profileStore.get().preferred_language;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: getLocale('en') as Record<string, unknown> },
    hi: { translation: getLocale('hi') as Record<string, unknown> },
  },
  lng: startLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // Keys missing in a locale fall back to English silently (matches the
  // @jp/i18n contract). We don't want a missing translation to crash a UI.
  returnEmptyString: false,
  returnNull: false,
});

export { i18n };
export default i18n;
