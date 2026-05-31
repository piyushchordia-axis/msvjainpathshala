import type { ReactNode } from 'react';
import { useLocation, Redirect } from 'wouter';
import { Sidebar } from '@/components/admin/Sidebar';
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';
import { useAuth } from '@/lib/auth-context';
import { canAccessAdminPanel } from '@/lib/auth';

function readCookie(name: string): string | null {
  const m = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [pathname] = useLocation();

  if (!user || !canAccessAdminPanel(user.role)) {
    return <Redirect to="/admin/login" />;
  }

  const impActive = readCookie('jp_imp_active') === 'true';
  const impOriginName = readCookie('jp_imp_origin_name') ?? 'Administrator';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar user={user} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {impActive ? (
          <ImpersonationBanner
            subjectName={user.full_name || user.phone}
            subjectRole={user.role}
          />
        ) : null}

        <main className="flex-1 overflow-y-auto px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
