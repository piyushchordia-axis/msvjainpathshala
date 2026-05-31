import { Link } from 'wouter';
import { useLocale, useSetLocale } from '@/lib/locale-context';
import { Globe } from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/centres', label: 'Centres' },
  { href: '/shivirs', label: 'Shivirs' },
  { href: '/notices', label: 'Notices' },
  { href: '/library', label: 'Library' },
  { href: '/gallery', label: 'Gallery' },
  { href: '/about', label: 'About' },
];

function LanguageSwitcher() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        aria-label="Change language"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-accent"
      >
        <Globe className="h-4 w-4" />
        {locale === 'hi' ? 'हिन्दी' : 'English'}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[8rem] overflow-hidden rounded-md border border-border bg-card p-1 shadow-2">
          {(['en', 'hi'] as const).map((l) => (
            <button
              key={l}
              onClick={() => { setLocale(l); setOpen(false); }}
              className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground ${locale === l ? 'bg-accent text-accent-foreground' : ''}`}
            >
              {l === 'hi' ? 'हिन्दी' : 'English'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3" aria-label="Jain Pathshala">
          <img src="/logo-mark.svg" alt="" width={36} height={36} className="h-9 w-9" />
          <span className="font-display text-xl text-secondary leading-tight">Jain Pathshala</span>
        </Link>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link
            href="/admin/login"
            className="hidden sm:inline-flex items-center rounded-md border border-secondary px-3 py-2 text-sm text-secondary hover:bg-maroon-50"
          >
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
