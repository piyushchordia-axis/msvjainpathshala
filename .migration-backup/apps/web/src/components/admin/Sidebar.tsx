'use client';

/**
 * Admin sidebar. Matches `jp-design-system/preview/admin-sidebar.html`:
 *
 *   - 220px column
 *   - maroon background, cream-tinted text, saffron active marker
 *   - grouped nav with uppercase section headings in ink-dim
 *   - bottom user card with avatar + role
 *
 * Active-state highlighting uses next-intl's `usePathname` (strips the
 * locale segment) so /en/admin/students and /hi/admin/students both
 * resolve to the same item.
 */

import { LogOut } from 'lucide-react';

import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

import { filterNavForRole, type NavGroup } from './sidebar-nav';

import type { SessionUser } from '@/lib/auth-cookies';

interface SidebarProps {
  user: SessionUser;
}

function initials(name: string, phone: string): string {
  const trimmed = name.trim();
  if (trimmed) {
    return trimmed
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('');
  }
  return phone.slice(-2);
}

function NavBlock({ groups, pathname }: { groups: NavGroup[]; pathname: string }) {
  return (
    <nav aria-label="Admin" className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {groups.map((group) => (
        <div key={group.heading}>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cream-deeper/70">
            {group.heading}
          </div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href as `/${string}`}
                    className={cn(
                      'group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground shadow-1'
                        : 'text-cream-deeper/85 hover:bg-maroon-700 hover:text-cream',
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const groups = filterNavForRole(user.role);

  return (
    <aside className="hidden h-screen w-[220px] shrink-0 flex-col border-r border-maroon-700/40 bg-secondary text-cream md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-maroon-700/40 px-4">
        {/* Static SVG logo; plain <img> avoids next/image's optimization for a 36px asset. */}
        <img src="/logo-mark.svg" alt="" className="h-8 w-8" />
        <div className="leading-tight">
          <div className="font-display text-base text-cream">Jain Pathshala</div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-cream-deeper/70">Admin</div>
        </div>
      </div>

      <NavBlock groups={groups} pathname={pathname} />

      <div className="border-t border-maroon-700/40 p-3">
        <div className="flex items-center gap-3 rounded-md bg-maroon-700/40 px-3 py-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-pill bg-primary text-primary-foreground">
            <span className="font-semibold text-sm">{initials(user.full_name, user.phone)}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-cream">
              {user.full_name || user.phone}
            </div>
            <div className="truncate text-[11px] uppercase tracking-wide text-cream-deeper/70">
              {user.role}
            </div>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-cream-deeper/80 hover:bg-maroon-700 hover:text-cream"
            >
              <LogOut className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
