/**
 * Footer for the public site. Slim — just credits, a short brand line,
 * and links to legal stubs.
 *
 * Copy follows DESIGN_GUIDE.md tone: warm, plain English (or Hindi),
 * no emoji.
 */

import { Link } from '@/i18n/navigation';

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-muted/30">
      <div className="container flex flex-col gap-6 py-12 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <div className="font-display text-lg text-secondary">Jain Pathshala</div>
          <p className="mt-2 text-sm text-muted-foreground">
            A Megh Sanskar Vatika initiative for Jain religious education across India. Built with
            care by Enaa Creations.
          </p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
          <Link className="text-muted-foreground hover:text-foreground" href="/about">
            About
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/contact">
            Contact
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/donate">
            Donate
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/msv">
            MSV
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/enquire">
            Enquire
          </Link>
          <Link className="text-muted-foreground hover:text-foreground" href="/admin/login">
            Admin
          </Link>
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
