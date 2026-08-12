import { Link } from 'wouter';
import { useLocale } from '@/lib/locale-context';

/** Panchang placeholder — never login-gated. */
export default function PanchangPage() {
  const locale = useLocale();
  const hi = locale === 'hi';

  return (
    <section className="container py-12 md:py-16">
      <Link href="/library" className="text-sm text-muted-foreground hover:text-primary">
        ← {hi ? 'पुस्तकालय' : 'Library'}
      </Link>
      <h1 className="mt-4 font-display text-4xl text-secondary">{hi ? 'पंचांग' : 'Panchang'}</h1>
      <p className="mt-6 max-w-xl text-muted-foreground">
        {hi ? 'पंचांग शीघ्र उपलब्ध होगा।' : 'Panchang will be available here soon.'}
      </p>
    </section>
  );
}
