/**
 * Admin login. Two-phase OTP flow:
 *   1. Enter +91 phone → POST /api/auth/login { phase: 'send' }
 *   2. Enter 6-digit OTP → POST /api/auth/login { phase: 'verify' }
 *      → cookies set + redirect to /{locale}/admin
 *
 * Visual language matches the mobile login from Step 8 — saffron CTA,
 * Mukta body, cream background, maroon display headings.
 */

import { redirect } from 'next/navigation';

import { Toaster } from '@/components/ui/toast';
import { readAccessToken, readSessionUser } from '@/lib/auth-cookies';
import { canAccessAdminPanel } from '@/lib/role-access';

import { LoginForm } from './LoginForm';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function AdminLoginPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { next, error } = await searchParams;
  const initialError = error === 'not_admin' ? 'not_admin' : undefined;

  // Normalize: middleware passes the locale-stripped path, but a stale
  // bookmark could pass `/en/...`. Strip it so we don't double-prefix.
  const safeNext = (next ?? '/admin').replace(/^\/(en|hi)(?=\/|$)/, '') || '/admin';

  // Already signed in with admin access? Skip the form.
  // Require BOTH the access cookie (gates the middleware) and the user
  // snapshot — if only the snapshot survives an access-cookie expiry,
  // calling redirect here would land the browser back on /admin → middleware
  // bounces it back to login → loop. Falling through to the form fixes it.
  const accessToken = await readAccessToken();
  const session = await readSessionUser();
  if (accessToken && session && canAccessAdminPanel(session.role)) {
    // Build the full locale-prefixed path manually — next-intl's
    // server-side redirect helper has surprised us with double-prefixing
    // in some flows; Next.js's redirect with an explicit URL is reliable.
    redirect(`/${locale}${safeNext}`);
  }

  return (
    <div className="grid min-h-screen bg-background md:grid-cols-2">
      <Toaster />
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
        <LoginForm nextPath={safeNext} initialError={initialError} />
      </main>
    </div>
  );
}
