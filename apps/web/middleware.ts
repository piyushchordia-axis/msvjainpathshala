/**
 * Combined middleware:
 *   1. next-intl handles the `/en` ↔ `/hi` subpath routing.
 *   2. After that we layer admin auth: any `/{locale}/admin/*` route
 *      (except `/admin/login`) requires a session cookie + a role
 *      with admin-panel access. Missing cookie → redirect to login.
 *      Disallowed role → redirect to the locale's homepage.
 *
 * We do NOT verify the JWT signature in middleware:
 *   - The dev API issues an ephemeral keypair on boot, so no static
 *     public key is reliable.
 *   - Server Components / Route Handlers re-verify on every backend
 *     hop via the API's RolesGuard. A forged cookie buys nothing.
 *   - We decode the access token's payload only to read the role
 *     (the user snapshot cookie carries the same info but is set by
 *     us, so trusting either is equivalent for routing).
 *
 * If we later need cryptographic gate-keeping at the edge, the
 * `jose` dep is already installed — wire `jwtVerify` here and source
 * the public key from a `/v1/auth/jwks` API endpoint.
 */

import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';

import { routing } from './src/i18n/routing';
import { COOKIE_ACCESS, COOKIE_USER } from './src/lib/auth-cookies';
import { canAccessAdminPanel } from './src/lib/role-access';

import type { Role } from '@jp/shared';

const intlMiddleware = createIntlMiddleware(routing);

interface DecodedSessionUser {
  role?: Role;
}

function readUserCookie(req: NextRequest): DecodedSessionUser | null {
  const raw = req.cookies.get(COOKIE_USER)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DecodedSessionUser;
  } catch {
    return null;
  }
}

const ADMIN_PATH = /^\/(en|hi)\/admin(?:\/|$)/;
const ADMIN_LOGIN_PATH = /^\/(en|hi)\/admin\/login\/?$/;

export default function middleware(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  const intlResponse = intlMiddleware(req);

  // The intl middleware may redirect (e.g. `/` → `/en`); honour it first.
  if (intlResponse.status >= 300 && intlResponse.status < 400) {
    return intlResponse;
  }

  // Only gate admin routes.
  if (!ADMIN_PATH.test(pathname) || ADMIN_LOGIN_PATH.test(pathname)) {
    return intlResponse;
  }

  const localeMatch = pathname.match(/^\/(en|hi)/);
  const locale = localeMatch?.[1] ?? 'en';

  const hasAccess = req.cookies.has(COOKIE_ACCESS);
  if (!hasAccess) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = `/${locale}/admin/login`;
    loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(loginUrl);
  }

  const user = readUserCookie(req);
  if (!canAccessAdminPanel(user?.role)) {
    const home = req.nextUrl.clone();
    home.pathname = `/${locale}`;
    home.search = '';
    return NextResponse.redirect(home);
  }

  return intlResponse;
}

export const config = {
  // Skip Next.js internals + static files; everything else flows through.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
