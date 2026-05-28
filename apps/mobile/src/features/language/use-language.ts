/**
 * useLanguage — returns the active i18n language as a typed union.
 *
 * Stays in sync with i18next at runtime; switching the locale via
 * `i18n.changeLanguage('hi')` re-renders any component subscribed via
 * this hook.
 */

import { useTranslation } from 'react-i18next';

export type AppLanguage = 'en' | 'hi';

export function useLanguage(): AppLanguage {
  const { i18n } = useTranslation();
  const raw = (i18n.language ?? 'en').toLowerCase();
  if (raw.startsWith('hi')) return 'hi';
  return 'en';
}
