import { Link, useLocation } from 'wouter';
import { useLocale, useSetLocale } from '@/lib/locale-context';
import { useAuth } from '@/lib/auth-context';
import { Menu } from 'lucide-react';
import { useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '@/components/ui/sheet';

/** Guest discovery links — My exams only when signed in (P4). */
const GUEST_NAV_ITEMS = [
  { href: '/join', label: 'Join', label_hi: 'जुड़ें' },
  { href: '/centres', label: 'Centres', label_hi: 'केंद्र' },
  { href: '/team', label: 'Team', label_hi: 'टीम' },
  { href: '/shivirs', label: 'Shivirs', label_hi: 'शिविर' },
  { href: '/notices', label: 'Notices', label_hi: 'सूचनाएँ' },
  { href: '/library', label: 'Library', label_hi: 'पुस्तकालय' },
  { href: '/courses', label: 'Courses', label_hi: 'पाठ्यक्रम' },
  { href: '/gallery', label: 'Gallery', label_hi: 'गैलरी' },
] as const;

const MEMBER_NAV_EXTRA = [
  { href: '/exams', label: 'My exams', label_hi: 'मेरी परीक्षाएँ' },
] as const;

/** Compact EN | हिं segment — works on narrow screens. */
function LanguageToggle() {
  const locale = useLocale();
  const setLocale = useSetLocale();
  return (
    <div
      className="inline-flex overflow-hidden rounded-full border border-border bg-card"
      role="group"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={`min-h-9 px-3 text-xs font-semibold ${
          locale === 'en'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLocale('hi')}
        className={`min-h-9 px-3 text-xs font-semibold ${
          locale === 'hi'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent'
        }`}
      >
        हिं
      </button>
    </div>
  );
}

export function TopNav() {
  const hi = useLocale() === 'hi';
  const { user } = useAuth();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const navItems = user
    ? [...GUEST_NAV_ITEMS, ...MEMBER_NAV_EXTRA]
    : [...GUEST_NAV_ITEMS];

  const signInHref =
    location && location !== '/'
      ? `/login?return=${encodeURIComponent(location)}`
      : '/login';

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div className="container flex h-16 items-center justify-between gap-3">
        <Link href="/" className="flex min-w-0 items-center gap-2.5 sm:gap-3" aria-label="Jain Pathshala">
          <img
            src={`${import.meta.env.BASE_URL}logo-mark.svg`}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 shrink-0"
          />
          <span className="font-display text-lg text-secondary leading-tight sm:text-xl truncate">
            Jain Pathshala
          </span>
        </Link>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {hi ? item.label_hi : item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <LanguageToggle />
          {!user ? (
            <Link
              href={signInHref}
              className="inline-flex min-h-9 items-center rounded-md border border-secondary px-3 py-2 text-sm text-secondary hover:bg-maroon-50"
            >
              {hi ? 'लॉगिन' : 'Sign in'}
            </Link>
          ) : null}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-accent md:hidden"
                aria-label={hi ? 'मेनू खोलें' : 'Open menu'}
              >
                <Menu className="h-5 w-5" />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[min(100%,20rem)]">
              <SheetHeader>
                <SheetTitle className="font-display text-left text-secondary">
                  {hi ? 'मेनू' : 'Menu'}
                </SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="mt-6 flex flex-col gap-1">
                {navItems.map((item) => (
                  <SheetClose asChild key={item.href}>
                    <Link
                      href={item.href}
                      className="rounded-md px-3 py-3 text-base text-foreground hover:bg-accent"
                    >
                      {hi ? item.label_hi : item.label}
                    </Link>
                  </SheetClose>
                ))}
                {!user ? (
                  <SheetClose asChild>
                    <Link
                      href={signInHref}
                      className="mt-2 rounded-md border border-secondary px-3 py-3 text-base text-secondary hover:bg-maroon-50"
                    >
                      {hi ? 'लॉगिन' : 'Sign in'}
                    </Link>
                  </SheetClose>
                ) : null}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
