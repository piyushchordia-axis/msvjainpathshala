/**
 * Admin login. Two-phase OTP flow:
 *   1. Enter +91 phone → POST /api/auth/login { phase: 'send' }
 *   2. Enter 6-digit OTP → POST /api/auth/login { phase: 'verify' }
 *      → cookies set + redirect to /{locale}/admin
 *
 * Visual language matches the mobile login from Step 8 — saffron CTA,
 * Mukta body, cream background, maroon display headings.
 */

import { redirect } from '@/i18n/navigation';
import { readSessionUser } from '@/lib/auth-cookies';
import { canAccessAdminPanel } from '@/lib/role-access';

import { LoginForm } from './LoginForm';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}

export default async function AdminLoginPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { next } = await searchParams;

  // Already signed in with admin access? Skip the form.
  const session = await readSessionUser();
  if (session && canAccessAdminPanel(session.role)) {
    redirect({ href: (next as `/${string}`) ?? '/admin', locale });
  }

  return (
    <div className="grid min-h-screen bg-background md:grid-cols-2">
      <aside className="relative hidden bg-primary text-primary-foreground md:flex md:items-end md:p-12">
        <div className="absolute inset-0 opacity-25" aria-hidden>
          {/* Background decoration; intentionally a plain <img> rather than next/image
              because we don't want LCP optimization on a purely decorative SVG. */}
          <img src="/motif-mandala.svg" alt="" className="h-full w-full object-cover" />
        </div>
        <div className="relative max-w-md">
          <div className="font-display text-3xl leading-tight">Jain Pathshala admin</div>
          <p className="mt-3 text-primary-foreground/80">
            Sign in with the phone number registered with your centre. One-time codes are sent by
            SMS.
          </p>
        </div>
      </aside>

      <main className="flex items-center justify-center p-6 md:p-12">
        <LoginForm nextPath={next ?? '/admin'} />
      </main>
    </div>
  );
}
