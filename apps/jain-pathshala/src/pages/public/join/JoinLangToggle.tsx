import { useEffect } from 'react';
import { useLocale, useSetLocale } from '@/lib/locale-context';
import { preferJoinHindi } from '@/lib/join';

/** On join routes: default to Hindi if the user has never chosen a locale. */
export function usePreferJoinHindi() {
  const setLocale = useSetLocale();
  useEffect(() => {
    preferJoinHindi(() => localStorage.getItem('jp_locale'), setLocale);
  }, [setLocale]);
}

export function JoinLangToggle() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-border bg-card text-xs font-medium">
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={`px-3 py-1.5 ${locale === 'en' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale('hi')}
        className={`px-3 py-1.5 ${locale === 'hi' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
      >
        हिं
      </button>
    </div>
  );
}
