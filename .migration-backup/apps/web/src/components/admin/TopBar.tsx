'use client';

/**
 * Admin top bar. Holds the page title (set per route via params), a
 * lightweight search affordance, and the language switcher.
 *
 * Title is consumed via children so each admin page can pass its own
 * heading text + breadcrumb.
 */

import { Search } from 'lucide-react';

import { LanguageSwitcher } from '@/components/public/LanguageSwitcher';

interface TopBarProps {
  title: string;
  subtitle?: string;
}

export function TopBar({ title, subtitle }: TopBarProps) {
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
            className="h-9 w-64 rounded-md border border-input bg-card pl-8 pr-3 text-sm placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
