/**
 * Holidays admin (SPEC §5.10). Server component: fetches the centre roster
 * server-side, then hands it to the client island that manages per-centre
 * attendance-calendar holidays (add / remove). Holidays suppress
 * auto-generated attendance sessions for that date.
 */

import { serverApiGet } from '@/lib/server-api';

import { HolidaysManager } from './holidays-manager';

interface CentreRow {
  id: string;
  name: string;
  locality?: string | null;
}

export default async function HolidaysPage() {
  let centres: CentreRow[] = [];
  let error: string | null = null;
  try {
    const data = await serverApiGet<{ items: CentreRow[] }>('/v1/admin/centres');
    centres = data.items ?? [];
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load centres';
  }

  return (
    <div className="container py-8">
      <h1 className="font-display text-3xl text-secondary">Holiday calendar</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Mark dates when a centre is closed. Attendance sessions are not generated for holiday dates.
      </p>
      {error ? (
        <p className="mt-4 text-destructive">{error}</p>
      ) : (
        <HolidaysManager centres={centres} />
      )}
    </div>
  );
}
