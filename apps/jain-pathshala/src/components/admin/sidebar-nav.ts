import {
  Award,
  BarChart3,
  BookOpen,
  Brain,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  CreditCard,
  FileText,
  Flame,
  GraduationCap,
  History,
  Image as ImageIcon,
  Images,
  Inbox,
  LayoutDashboard,
  LifeBuoy,
  Library,
  ListChecks,
  Megaphone,
  ScanLine,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import type { Role } from '@/lib/auth';
import { ROLE_PRECEDENCE } from '@/lib/auth';
import { canFeatureMedia, canAdministerExams } from '@workspace/api-zod';
import type { ComponentType } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  min: Role;
  /** When set, visibility uses a narrower capability gate instead of min alone. */
  gate?: 'featureMedia' | 'administerExams';
  /**
   * Modelled for `findNavItemForPath` but never rendered in the sidebar — route
   * aliases that share a page with a visible entry. A path the nav does not
   * model resolves to null, which `AdminRouteGuard` treats as "no extra
   * restriction", so an unmodelled alias is an ALLOW: `/admin/curriculum`
   * rendered the full courses page for any shikshak who typed it.
   */
  hidden?: boolean;
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
      { href: '/admin/msv-enrolments', label: 'MSV applications', icon: Sparkles, min: 'city_admin' },
      { href: '/admin/shikshaks', label: 'Shikshaks', icon: Sparkles, min: 'sanchalak' },
      { href: '/admin/id-cards', label: 'ID Cards', icon: CreditCard, min: 'city_admin' },
    ],
  },
  {
    heading: 'Programme',
    items: [
      { href: '/admin/batches', label: 'Batches', icon: CalendarDays, min: 'sanchalak' },
      { href: '/admin/courses', label: 'Courses', icon: ScrollText, min: 'city_admin' },
      // Alias route for the same CoursesAdminPage — same requirement, no second row.
      { href: '/admin/curriculum', label: 'Courses', icon: ScrollText, min: 'city_admin', hidden: true },
      { href: '/admin/exams', label: 'Exams', icon: ListChecks, min: 'city_admin', gate: 'administerExams' },
      { href: '/admin/exam-builder', label: 'Exam builder', icon: ClipboardList, min: 'city_admin', gate: 'administerExams' },
      { href: '/admin/exam-grading', label: 'Exam grading', icon: ClipboardCheck, min: 'city_admin', gate: 'administerExams' },
      { href: '/admin/niyams', label: 'Niyams', icon: Flame, min: 'shikshak' },
      { href: '/admin/niyam-review', label: 'Niyam Review', icon: ClipboardCheck, min: 'shikshak' },
      { href: '/admin/homework', label: 'Homework', icon: BookOpen, min: 'shikshak' },
      { href: '/admin/progress', label: 'Student Progress', icon: GraduationCap, min: 'shikshak' },
      { href: '/admin/competitions', label: 'Competitions', icon: Trophy, min: 'city_admin' },
      { href: '/admin/quizzes', label: 'Quizzes', icon: Brain, min: 'city_admin' },
      { href: '/admin/shivirs', label: 'Shivirs', icon: CalendarDays, min: 'city_admin' },
      { href: '/admin/punya/manual-award', label: 'Award Punya', icon: Award, min: 'shikshak' },
      { href: '/admin/punya/configs', label: 'Punya configs', icon: Settings, min: 'city_admin' },
      { href: '/admin/punya/audit', label: 'Punya audit', icon: History, min: 'city_admin' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/admin/centres', label: 'Centres', icon: Building2, min: 'sanchalak' },
      { href: '/admin/holidays', label: 'Holiday calendar', icon: CalendarDays, min: 'sanchalak' },
      { href: '/admin/attendance', label: 'Attendance', icon: CalendarCheck, min: 'shikshak' },
      { href: '/admin/notices', label: 'Notices', icon: Megaphone, min: 'shikshak' },
      { href: '/admin/gallery', label: 'Gallery', icon: ImageIcon, min: 'sanchalak' },
      {
        href: '/admin/media-curation',
        label: 'Media curation',
        icon: Images,
        min: 'city_admin',
        gate: 'featureMedia',
      },
      { href: '/admin/library', label: 'Library', icon: Library, min: 'city_admin' },
      { href: '/admin/team', label: 'Team', icon: Users, min: 'city_admin' },
      { href: '/admin/donations', label: 'Donations', icon: BarChart3, min: 'city_admin' },
      { href: '/admin/service-requests', label: 'Service requests', icon: LifeBuoy, min: 'sanchalak' },
      { href: '/admin/shivir-dashboard', label: 'Shivir attendance', icon: ScanLine, min: 'city_admin' },
      { href: '/admin/enquiries', label: 'Enquiries', icon: Inbox, min: 'city_admin' },
    ],
  },
  {
    heading: 'Insights',
    items: [
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3, min: 'sanchalak' },
      { href: '/admin/reports', label: 'Reports', icon: BarChart3, min: 'sanchalak' },
      { href: '/admin/audit', label: 'Audit log', icon: ScrollText, min: 'state_admin' },
    ],
  },
  {
    heading: 'System',
    items: [
      { href: '/admin/registration-forms', label: 'Registration forms', icon: FileText, min: 'city_admin' },
      { href: '/admin/join', label: 'Join registrations', icon: Inbox, min: 'shikshak' },
      { href: '/admin/geography', label: 'Geography', icon: Building2, min: 'state_admin' },
      { href: '/admin/settings', label: 'Settings', icon: Settings, min: 'state_admin' },
      { href: '/admin/queues', label: 'Queues', icon: ShieldCheck, min: 'super_admin' },
    ],
  },
];

export function roleSatisfies(actor: Role, min: Role): boolean {
  return (ROLE_PRECEDENCE[actor] ?? 0) >= (ROLE_PRECEDENCE[min] ?? 0);
}

/** Single source for "may this role open this nav destination" (XC-API-01). */
export function navItemAllows(role: Role, item: NavItem): boolean {
  if (item.gate === 'featureMedia') return canFeatureMedia(role);
  if (item.gate === 'administerExams') return canAdministerExams(role);
  return roleSatisfies(role, item.min);
}

/**
 * Longest-prefix nav match for a location, so `/admin/centres/:id` inherits
 * the `/admin/centres` requirement. Null for paths the nav does not model —
 * callers must treat that as "no extra restriction", never as a denial.
 */
export function findNavItemForPath(path: string): NavItem | null {
  let best: NavItem | null = null;
  for (const group of ADMIN_NAV) {
    for (const item of group.items) {
      if (path === item.href || path.startsWith(`${item.href}/`)) {
        if (!best || item.href.length > best.href.length) best = item;
      }
    }
  }
  return best;
}

export function filterNavForRole(role: Role): NavGroup[] {
  return ADMIN_NAV.map((group) => ({
    heading: group.heading,
    items: group.items.filter((i) => !i.hidden && navItemAllows(role, i)),
  })).filter((g) => g.items.length > 0);
}
