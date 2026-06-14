import {
  Award,
  BarChart3,
  BookOpen,
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
  LayoutDashboard,
  LifeBuoy,
  Library,
  ListChecks,
  Megaphone,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import type { Role } from '@/lib/auth';
import { ROLE_PRECEDENCE } from '@/lib/auth';
import type { ComponentType } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
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
      { href: '/admin/msv-enrolments', label: 'MSV applications', icon: Sparkles, min: 'city_admin' },
      { href: '/admin/shikshaks', label: 'Shikshaks', icon: Sparkles, min: 'sanchalak' },
      { href: '/admin/id-cards', label: 'ID Cards', icon: CreditCard, min: 'city_admin' },
    ],
  },
  {
    heading: 'Programme',
    items: [
      { href: '/admin/batches', label: 'Batches', icon: CalendarDays, min: 'sanchalak' },
      { href: '/admin/curriculum', label: 'Curriculum', icon: ScrollText, min: 'city_admin' },
      { href: '/admin/exams', label: 'Exams', icon: ListChecks, min: 'city_admin' },
      { href: '/admin/exam-builder', label: 'Exam builder', icon: ClipboardList, min: 'city_admin' },
      { href: '/admin/niyams', label: 'Niyams', icon: Flame, min: 'shikshak' },
      { href: '/admin/niyam-review', label: 'Niyam Review', icon: ClipboardCheck, min: 'shikshak' },
      { href: '/admin/homework', label: 'Homework', icon: BookOpen, min: 'shikshak' },
      { href: '/admin/progress', label: 'Student Progress', icon: GraduationCap, min: 'shikshak' },
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
      { href: '/admin/holidays', label: 'Holiday calendar', icon: CalendarDays, min: 'sanchalak' },
      { href: '/admin/attendance', label: 'Attendance', icon: CalendarCheck, min: 'shikshak' },
      { href: '/admin/notices', label: 'Notices', icon: Megaphone, min: 'shikshak' },
      { href: '/admin/gallery', label: 'Gallery', icon: ImageIcon, min: 'sanchalak' },
      { href: '/admin/library', label: 'Library', icon: Library, min: 'city_admin' },
      { href: '/admin/donations', label: 'Donations', icon: BarChart3, min: 'city_admin' },
      { href: '/admin/service-requests', label: 'Service requests', icon: LifeBuoy, min: 'sanchalak' },
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
      { href: '/admin/geography', label: 'Geography', icon: Building2, min: 'state_admin' },
      { href: '/admin/settings', label: 'Settings', icon: Settings, min: 'state_admin' },
      { href: '/admin/queues', label: 'Queues', icon: ShieldCheck, min: 'super_admin' },
    ],
  },
];

export function roleSatisfies(actor: Role, min: Role): boolean {
  return (ROLE_PRECEDENCE[actor] ?? 0) >= (ROLE_PRECEDENCE[min] ?? 0);
}

export function filterNavForRole(role: Role): NavGroup[] {
  return ADMIN_NAV.map((group) => ({
    heading: group.heading,
    items: group.items.filter((i) => roleSatisfies(role, i.min)),
  })).filter((g) => g.items.length > 0);
}
