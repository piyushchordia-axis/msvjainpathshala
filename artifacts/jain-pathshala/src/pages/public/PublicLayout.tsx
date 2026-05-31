import type { ReactNode } from 'react';
import { TopNav } from '@/components/public/TopNav';
import { Footer } from '@/components/public/Footer';

export function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
