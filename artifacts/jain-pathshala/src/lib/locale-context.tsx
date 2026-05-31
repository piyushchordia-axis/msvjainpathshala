import { createContext, useContext, useState, type ReactNode } from 'react';
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

  function handleSet(l: Locale) {
    setLocale(l);
    localStorage.setItem('jp_locale', l);
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale: handleSet }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useSetLocale() {
  return useContext(LocaleContext).setLocale;
}
