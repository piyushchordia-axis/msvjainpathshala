import { Search } from 'lucide-react';
import { Globe } from 'lucide-react';
import { useLocale, useSetLocale } from '@/lib/locale-context';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export function TopBar({ title, subtitle }: TopBarProps) {
  const locale = useLocale();
  const setLocale = useSetLocale();

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-card px-6">
      <div className="min-w-0">
        <h1 className="truncate font-display text-lg text-secondary">{title}</h1>
        {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search…"
            className="h-9 w-64 rounded-md border border-input bg-card pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <button
          onClick={() => setLocale(locale === 'en' ? 'hi' : 'en')}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-accent"
        >
          <Globe className="h-4 w-4" />
          {locale === 'hi' ? 'हिन्दी' : 'English'}
        </button>
      </div>
    </header>
  );
}
