export function ImpersonationBanner({ subjectName, subjectRole }: { subjectName: string; subjectRole: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-start gap-2 border-b border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <span className="font-semibold">Impersonating {subjectName}</span>{' '}
        <span className="text-destructive/80">— acting as {subjectRole}.</span>
      </div>
      <form action="/v1/admin/impersonate/stop" method="POST">
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
