/**
 * Role-filtered sidebar nav. Each item declares which roles see it; the
 * sidebar component intersects with the current actor's role hierarchy
 * (super_admin sees everything; sanchalak sees only its scope).
 *
 * Hierarchy from SPEC §7: super_admin > state_admin > city_admin >
 * sanchalak > shikshak. The `min` field is the LOWEST role allowed —
 * anyone with higher precedence also sees the item.
 *
 * Hrefs are root-relative (no locale prefix); the Sidebar component
 * uses next-intl's <Link> so the locale is added automatically.
 */

import {
  Award,
  BarChart3,
  Building2,
  CalendarDays,
  Flame,
  History,
  Image as ImageIcon,
  LayoutDashboard,
  Library,
  ListChecks,
  Megaphone,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';

import { ROLE_PRECEDENCE, type Role } from '@jp/shared';

import type { ComponentType } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Lowest role that may see this item. */
  min: Role;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavGroup[] = [
  {
    heading: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard', icon: LayoutDashboard, min: 'shikshak' }],
  },
  {
    heading: 'People',
    items: [
      { href: '/admin/students', label: 'Students', icon: Users, min: 'shikshak' },
      { href: '/admin/enrolments', label: 'Enrolments', icon: ListChecks, min: 'sanchalak' },
      {
        href: '/admin/msv-enrolments',
        label: 'MSV applications',
        icon: Sparkles,
        min: 'city_admin',
      },
      { href: '/admin/shikshaks', label: 'Shikshaks', icon: Sparkles, min: 'sanchalak' },
    ],
  },
  {
    heading: 'Programme',
    items: [
      { href: '/admin/batches', label: 'Batches', icon: CalendarDays, min: 'sanchalak' },
      { href: '/admin/curriculum', label: 'Curriculum', icon: ScrollText, min: 'city_admin' },
      { href: '/admin/niyams', label: 'Niyams', icon: Flame, min: 'shikshak' },
      { href: '/admin/shivirs', label: 'Shivirs', icon: CalendarDays, min: 'city_admin' },
      { href: '/admin/punya/manual-award', label: 'Award Punya', icon: Award, min: 'shikshak' },
      { href: '/admin/punya/configs', label: 'Punya configs', icon: Settings, min: 'city_admin' },
      { href: '/admin/punya/audit', label: 'Punya audit', icon: History, min: 'city_admin' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/admin/centres', label: 'Centres', icon: Building2, min: 'city_admin' },
      { href: '/admin/notices', label: 'Notices', icon: Megaphone, min: 'shikshak' },
      { href: '/admin/gallery', label: 'Gallery', icon: ImageIcon, min: 'sanchalak' },
      { href: '/admin/library', label: 'Library', icon: Library, min: 'city_admin' },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { href: '/admin/reports', label: 'Reports', icon: BarChart3, min: 'sanchalak' },
      { href: '/admin/audit', label: 'Audit log', icon: History, min: 'city_admin' },
    ],
  },
  {
    heading: 'System',
    items: [
      { href: '/admin/queues', label: 'Queues', icon: ShieldCheck, min: 'super_admin' },
      { href: '/admin/settings', label: 'Settings', icon: Settings, min: 'state_admin' },
    ],
  },
];

/** True if `actor` has at least the precedence of `min`. */
export function roleSatisfies(actor: Role, min: Role): boolean {
  return (ROLE_PRECEDENCE[actor] ?? 0) >= (ROLE_PRECEDENCE[min] ?? 0);
}

/** Filter the nav tree by role. Empty groups are dropped. */
export function filterNavForRole(role: Role): NavGroup[] {
  return ADMIN_NAV.map((group) => ({
    heading: group.heading,
    items: group.items.filter((i) => roleSatisfies(role, i.min)),
  })).filter((g) => g.items.length > 0);
}
