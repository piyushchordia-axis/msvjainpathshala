/**
 * Public-site top navigation. Cream background, saffron accents, Mukta
 * body. Matches `jp-design-system/preview/admin-sidebar.html`'s tone
 * (the public layout is much lighter — no shadows, no maroon block).
 */

import Image from 'next/image';

import { Link } from '@/i18n/navigation';

import { LanguageSwitcher } from './LanguageSwitcher';

const NAV_ITEMS: Array<{ href: string; labelKey: string; fallback: string }> = [
  { href: '/centres', labelKey: 'nav.centres', fallback: 'Centres' },
  { href: '/shivirs', labelKey: 'nav.shivirs', fallback: 'Shivirs' },
  { href: '/notices', labelKey: 'nav.notices', fallback: 'Notices' },
  { href: '/library', labelKey: 'nav.library', fallback: 'Library' },
  { href: '/gallery', labelKey: 'nav.gallery', fallback: 'Gallery' },
  { href: '/about', labelKey: 'nav.about', fallback: 'About' },
];

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-3" aria-label="Jain Pathshala">
          <Image src="/logo-mark.svg" alt="" width={36} height={36} className="h-9 w-9" priority />
          <span className="font-display text-xl text-secondary leading-tight">Jain Pathshala</span>
        </Link>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {item.fallback}
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
