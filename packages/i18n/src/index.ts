/**
 * `@jp/i18n` — Jain Pathshala translation helpers.
 *
 *   import { t, tBilingual, SUPPORTED_LANGUAGES, type Language } from '@jp/i18n';
 *
 *   t('hi', 'punya.tiers.jigyasu')                 // → 'जिज्ञासु'
 *   t('en', 'auth.otp_subtitle', { phone: '+91…' }) // → 'We sent a 6-digit code to +91…'
 *   tBilingual({ en: 'Welcome', hi: 'स्वागत है' }) // → { en, hi }
 *
 * Keys are looked up by walking the locale JSON via dot-segments. Missing
 * keys fall back to the key string itself (and call `onMissingKey` if
 * configured) — never throw, so a missing translation never crashes a UI.
 *
 * Source-of-truth files: `src/locales/en.json` and `src/locales/hi.json`. Add
 * matching entries to BOTH on every change; a Step 7 lint job will assert
 * key parity.
 */

import en from './locales/en.json';
import hi from './locales/hi.json';

// ---------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Locale dictionaries
// ---------------------------------------------------------------------------

type Dict = { [k: string]: string | Dict };

const dicts: Record<Language, Dict> = {
  en: en as unknown as Dict,
  hi: hi as unknown as Dict,
};

/** Read-only access to the raw locale dictionaries (for debugging / tests). */
export function getLocale(lang: Language): Dict {
  return dicts[lang];
}

// ---------------------------------------------------------------------------
// Missing-key hook (configurable so apps can wire it into Sentry / Pino)
// ---------------------------------------------------------------------------

type MissingKeyHandler = (lang: Language, key: string) => void;

let onMissingKey: MissingKeyHandler = (lang, key) => {
  // Default: dev-time warning, never throw.
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    console.warn(`[@jp/i18n] missing key '${key}' for locale '${lang}'`);
  }
};

export function setMissingKeyHandler(handler: MissingKeyHandler): void {
  onMissingKey = handler;
}

// ---------------------------------------------------------------------------
// Walk + interpolate
// ---------------------------------------------------------------------------

function walk(dict: Dict, segments: readonly string[]): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const seg of segments) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Dict)[seg];
    if (node === undefined) return undefined;
  }
  return typeof node === 'string' ? node : undefined;
}

const INTERPOLATION_RE = /\{(\w+)\}/g;

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(INTERPOLATION_RE, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) {
      return String(params[name]);
    }
    return match;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Translate a dotted key for the given locale.
 *
 * @param locale  Target locale (`'en'` or `'hi'`).
 * @param key     Dot-path into the locale JSON, e.g. `'punya.tiers.jigyasu'`.
 * @param params  Optional `{ name: value }` map — substitutes `{name}` in the result.
 * @returns       The translated string, or the key itself if not found.
 */
export function t(locale: Language, key: string, params?: Record<string, string | number>): string {
  const segments = key.split('.');
  const value = walk(dicts[locale], segments);

  if (value === undefined) {
    // Try fallback locale before giving up.
    if (locale !== DEFAULT_LANGUAGE) {
      const fallback = walk(dicts[DEFAULT_LANGUAGE], segments);
      if (fallback !== undefined) {
        onMissingKey(locale, key);
        return params ? interpolate(fallback, params) : fallback;
      }
    }
    onMissingKey(locale, key);
    return key;
  }

  return params ? interpolate(value, params) : value;
}

/**
 * Pair-up an `{ en, hi }` record into both languages. Useful when an API
 * accepts bilingual fields and a client wants to render both at once.
 *
 * The helper is intentionally untyped beyond the input shape — it just
 * returns the record unchanged. The value is making the intent obvious in
 * call-sites: `tBilingual({ en, hi })`.
 */
export function tBilingual<T extends { en: string; hi: string }>(
  record: T,
): {
  en: T['en'];
  hi: T['hi'];
} {
  return { en: record.en, hi: record.hi };
}

/** Convenience: pick the right side of a bilingual record by current locale. */
export function tPick(locale: Language, record: { en: string; hi: string }): string {
  return record[locale];
}
