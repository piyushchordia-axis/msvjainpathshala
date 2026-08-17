import { Link } from 'wouter';
import { useLocale } from '@/lib/locale-context';

/**
 * Panchang — never login-gated.
 *
 * The full tithi calendar lives in the mobile app (`lib/panchang` is a
 * mobile-package module); porting it needs a lib move, so until then this page
 * says where the calendar actually is instead of an indefinite "soon"
 * (GST-API-04).
 */
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
        {hi
          ? 'तिथि और पर्व-दिनों वाला पूरा पंचांग अभी जैन पाठशाला मोबाइल ऐप में उपलब्ध है — वेब संस्करण पर काम चल रहा है।'
          : 'The full Panchang — tithis and parva days — is currently available in the Jain Pathshala mobile app. The web version is on its way.'}
      </p>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        {hi
          ? 'तब तक, अपने केंद्र की छुट्टियाँ केंद्र पृष्ठ पर देखें।'
          : "Until then, you can see your centre's holidays on its centre page."}
      </p>
      <Link
        href="/centres"
        className="mt-6 inline-block rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-secondary hover:border-primary/40"
      >
        {hi ? 'केंद्र देखें' : 'Browse centres'}
      </Link>
    </section>
  );
}
