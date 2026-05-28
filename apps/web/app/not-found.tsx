/**
 * Top-level 404. Lives at the app root rather than under `[locale]/`
 * so the `notFound()` call in the locale layout (unknown locale
 * segment) flows through here.
 */

export default function NotFound() {
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center bg-background p-8 text-center font-body">
        <div className="max-w-md space-y-3">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">404</p>
          <h1 className="font-display text-3xl text-secondary">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            The page you were looking for doesn&apos;t exist or has moved. Try the homepage or sign
            in to the admin panel.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <a
              className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
              href="/en"
            >
              Go home
            </a>
            <a
              className="rounded-md border border-secondary px-4 py-2 text-sm text-secondary"
              href="/en/admin/login"
            >
              Admin sign in
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
