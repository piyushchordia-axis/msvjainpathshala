import type { ReactNode } from 'react';
import { useLocation, Redirect } from 'wouter';
import { Sidebar } from '@/components/admin/Sidebar';
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';
import { useAuth } from '@/lib/auth-context';
import { canAccessAdminPanel } from '@/lib/auth';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [_pathname] = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" aria-label="Loading…" />
      </div>
    );
  }

  if (!user || !canAccessAdminPanel(user.role)) {
    return <Redirect to="/admin/login" />;
  }

  const impActive = readCookie('jp_imp_active') === 'true';

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
