/**
 * Impersonation banner — only renders when the access token claims an
 * impersonation context. For Step 9 we surface this from a server prop
 * (the layout reads the session user and a flag).
 *
 * Visual: red strip across the top of the admin viewport, two lines of
 * sentence-case copy, and a "Stop impersonating" form post.
 */

export interface ImpersonationBannerProps {
  subjectName: string;
  subjectRole: string;
}

export function ImpersonationBanner({ subjectName, subjectRole }: ImpersonationBannerProps) {
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-2 border-b border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <span className="font-semibold">Impersonating {subjectName}</span>{' '}
        <span className="text-destructive/80">— acting as {subjectRole}.</span>
      </div>
      <form action="/api/admin/impersonate/stop" method="POST">
        <button
          type="submit"
          className="rounded-md border border-destructive bg-card px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground"
        >
          Stop impersonating
        </button>
      </form>
    </div>
  );
}
