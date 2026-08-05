import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '@/i18n/locales';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', setLocale: () => {} });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const stored = localStorage.getItem('jp_locale') as Locale | null;
    return stored === 'hi' ? 'hi' : 'en';
  });

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const handleSet = useCallback((l: Locale) => {
    setLocale(l);
    localStorage.setItem('jp_locale', l);
  }, []);

  const value = useMemo(
    () => ({ locale, setLocale: handleSet }),
    [locale, handleSet],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocale() {
  return useContext(LocaleContext).setLocale;
}
