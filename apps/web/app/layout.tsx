/**
 * Root layout. Just renders <html><body> with no providers — the
 * locale-aware `app/[locale]/layout.tsx` mounts the NextIntlClientProvider
 * because every route in this app sits inside a `[locale]` segment.
 *
 * Why split: the root `layout.tsx` must not be a Client Component or
 * provider boundary; doing that here would prevent the underlying
 * `<html lang>` attribute from changing per request.
 */

import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Jain Pathshala',
    template: '%s — Jain Pathshala',
  },
  description: 'Multi-tenant Jain religious education platform — Megh Sanskar Vatika network.',
  icons: {
    icon: '/icon-punya.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
