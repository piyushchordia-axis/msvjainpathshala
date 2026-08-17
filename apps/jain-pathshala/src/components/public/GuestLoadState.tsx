/**
 * Shared loading / error presentation for guest pages.
 *
 * Before this, seven guest pages hardcoded English "Loading…" under Devanagari
 * headings (GST-DSN-04), several rendered raw technical strings like
 * "Library request failed (502)" (GST-DSN-03), and every error card was static —
 * recovery required a full browser reload (GST-ERR-04).
 */
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function GuestLoading({ hi }: { hi: boolean }) {
  return (
    <div className="mt-10 text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</div>
  );
}

export function GuestError({
  hi,
  what,
  whatHi,
  onRetry,
}: {
  hi: boolean;
  /** The thing that failed to load, e.g. "centres" — completes the sentence. */
  what: string;
  whatHi: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="mt-10 border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
      <p>
        {hi
          ? `${whatHi} लोड नहीं हो सके — अपना कनेक्शन जाँचें और पुनः प्रयास करें।`
          : `Couldn't load ${what} — check your connection and try again.`}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          {hi ? 'पुनः प्रयास करें' : 'Try again'}
        </Button>
      ) : null}
    </Card>
  );
}
