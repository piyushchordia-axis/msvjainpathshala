/**
 * Locale-aware root layout. Owns the `<html lang>` + `<body>` because the
 * root `app/layout.tsx` is a no-op passthrough.
 *
 * Mounts `NextIntlClientProvider` so client components downstream can
 * use `useTranslations(...)` without doing their own lookup.
 */

import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';

import { Toaster } from '@/components/ui/toast';
import { LOCALES, isLocale, type Locale } from '@/i18n/locales';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  setRequestLocale(locale as Locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
