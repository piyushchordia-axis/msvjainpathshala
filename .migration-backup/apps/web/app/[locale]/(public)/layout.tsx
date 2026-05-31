/**
 * Public-site shared shell: top nav + footer wrapping every page in the
 * `(public)` route group.
 */

import { Footer } from '@/components/public/Footer';
import { TopNav } from '@/components/public/TopNav';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopNav />
      <main className="min-h-[60vh]">{children}</main>
      <Footer />
    </>
  );
}
