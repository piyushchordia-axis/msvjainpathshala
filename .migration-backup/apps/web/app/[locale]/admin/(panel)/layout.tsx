/**
 * Authenticated admin layout. Wraps everything under
 * `/{locale}/admin/...` EXCEPT `/admin/login` (which sits outside this
 * route group). Middleware already redirected unauthenticated users to
 * the login page, but the layout re-checks the session cookie defensively
 * (zero-cost server read; redirects if the cookie was stripped between
 * middleware and render).
 */

import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';
import { Sidebar } from '@/components/admin/Sidebar';
import { TopBar } from '@/components/admin/TopBar';
import { redirect } from '@/i18n/navigation';
import { readImpersonationSubject, readSessionUser } from '@/lib/auth-cookies';
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

  const impersonation = await readImpersonationSubject();

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      {impersonation ? (
        <ImpersonationBanner subjectName={impersonation.name} subjectRole={impersonation.role} />
      ) : null}
      <div className="flex min-h-0 flex-1">
        <Sidebar user={user} />
        <div className="flex min-h-screen flex-1 flex-col">
          <TopBar title="Admin" subtitle={`${user.role} · ${user.full_name || user.phone}`} />
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
