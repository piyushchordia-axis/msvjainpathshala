'use client';

import { Globe } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useTransition } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LOCALES, type Locale } from '@/i18n/locales';
import { usePathname, useRouter } from '@/i18n/navigation';

const LABELS: Record<Locale, string> = {
  en: 'English',
  hi: 'हिन्दी',
};

export function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const current = useLocale() as Locale;
  const [, startTransition] = useTransition();

  const switchTo = (locale: Locale) => {
    if (locale === current) return;
    startTransition(() => {
      router.replace(pathname, { locale });
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Change language"
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-accent"
      >
        <Globe className="h-4 w-4" />
        {LABELS[current]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        {LOCALES.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onSelect={() => switchTo(locale)}
            data-active={current === locale ? 'true' : undefined}
            className="data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
          >
            {LABELS[locale]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
