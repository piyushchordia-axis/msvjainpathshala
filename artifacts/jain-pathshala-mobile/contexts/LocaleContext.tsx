import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const STORAGE_KEY = "jp_locale";

interface LocaleContextValue {
  locale: Locale;
  hi: boolean;
  setLocale: (l: Locale) => void;
  toggleLocale: () => void;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  hi: false,
  setLocale: () => {},
  toggleLocale: () => {},
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === "hi" || stored === "en") setLocaleState(stored);
    });
  }, []);

  function setLocale(l: Locale) {
    setLocaleState(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
  }

  function toggleLocale() {
    setLocale(locale === "hi" ? "en" : "hi");
  }

  return (
    <LocaleContext.Provider
      value={{ locale, hi: locale === "hi", setLocale, toggleLocale }}
    >
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Pick between an English and Hindi string based on the active locale. */
export function useT() {
  const { hi } = useLocale();
  return (en: string, hin: string) => (hi ? hin : en);
}
