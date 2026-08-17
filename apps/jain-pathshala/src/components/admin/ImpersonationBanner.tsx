import { useState } from 'react';
import { apiPost } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export function ImpersonationBanner({ subjectName, subjectRole }: { subjectName: string; subjectRole: string }) {
  const [busy, setBusy] = useState(false);

  async function stop() {
    setBusy(true);
    try {
      // apiPost prefixes API_BASE — the old native <form action="/v1/…">
      // posted to the WEB origin, so on a split-origin deploy the session
      // never ended (SUP-API-04).
      await apiPost('/v1/admin/impersonate/stop', {});
      window.location.assign('/admin/login');
    } catch {
      setBusy(false);
      toast.error(
        'Could not stop impersonating.',
        'Try again — if it keeps failing, clear your cookies to end the session.',
      );
    }
  }

  return (
    <div
      role="status"
      className="flex flex-col items-start gap-2 border-b border-destructive bg-destructive/10 px-4 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <span className="font-semibold">Impersonating {subjectName}</span>{' '}
        <span className="text-destructive/80">— acting as {subjectRole}.</span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void stop()}
        className="rounded-md border border-destructive bg-card px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground disabled:opacity-60"
      >
        {busy ? 'Stopping…' : 'Stop impersonating'}
      </button>
      {/* No-JS fallback still reaches the API host, not the web origin. */}
      <noscript>
        <form action={`${API_BASE}/v1/admin/impersonate/stop`} method="POST">
          <button
            type="submit"
            className="rounded-md border border-destructive bg-card px-3 py-1 text-xs font-medium text-destructive"
          >
            Stop impersonating
          </button>
        </form>
      </noscript>
    </div>
  );
}
