import { Link } from 'wouter';
import { useLocale } from '@/lib/locale-context';

export function Footer() {
  const hi = useLocale() === 'hi';
  return (
    <footer className="mt-24 border-t border-border bg-muted/30">
      <div className="container flex flex-col gap-6 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <div className="font-display text-lg text-secondary">Jain Pathshala</div>
          <p className="mt-2 text-sm text-muted-foreground">
            {hi
              ? 'भारत भर में जैन धार्मिक शिक्षा के लिए एक मेघ संस्कार वाटिका पहल। ईना क्रिएशन्स द्वारा सावधानीपूर्वक निर्मित।'
              : 'A Megh Sanskar Vatika initiative for Jain religious education across India. Built with care by Enaa Creations.'}
          </p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          {/* /about and /msv are stubs without real content yet — links hidden until those pages are ready. */}
          <Link className="text-muted-foreground hover:text-foreground" href="/contact">{hi ? 'संपर्क' : 'Contact'}</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/donate">{hi ? 'दान करें' : 'Donate'}</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/enquire">{hi ? 'पूछताछ' : 'Enquire'}</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/my-requests">{hi ? 'मेरे अनुरोध' : 'My requests'}</Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/admin/login">{hi ? 'एडमिन' : 'Admin'}</Link>
        </nav>
      </div>
      <div className="border-t border-border">
        <div className="container flex items-center justify-between py-4 text-xs text-muted-foreground">
          <span>© 2026 Enaa Creations · Megh Sanskar Vatika</span>
          <span className="font-mono">v0.1.0</span>
        </div>
      </div>
    </footer>
  );
}
