/**
 * Authenticated admin layout. Wraps everything under
 * `/{locale}/admin/...` EXCEPT `/admin/login` (which sits outside this
 * route group). Middleware already redirected unauthenticated users to
 * the login page, but the layout re-checks the session cookie defensively
 * (zero-cost server read; redirects if the cookie was stripped between
 * middleware and render).
 */

import { Sidebar } from '@/components/admin/Sidebar';
import { TopBar } from '@/components/admin/TopBar';
import { redirect } from '@/i18n/navigation';
import { readSessionUser } from '@/lib/auth-cookies';
import { canAccessAdminPanel } from '@/lib/role-access';

interface PanelLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function AdminPanelLayout({ children, params }: PanelLayoutProps) {
  const { locale } = await params;
  const user = await readSessionUser();
  if (!user || !canAccessAdminPanel(user.role)) {
    // `redirect` throws under the hood, but next-intl's wrapper is typed
    // to return `void` rather than `never` — the `return null` below makes
    // TS narrow `user` to non-null in the JSX.
    redirect({ href: '/admin/login', locale });
    return null;
  }

  return (
    <div className="flex min-h-screen bg-muted/40">
      <Sidebar user={user} />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopBar title="Admin" subtitle={`${user.role} · ${user.full_name || user.phone}`} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
