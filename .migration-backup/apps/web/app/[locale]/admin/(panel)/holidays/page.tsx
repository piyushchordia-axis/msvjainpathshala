/**
 * Holidays admin (SPEC §5.10). Server component: fetches the centre roster
 * server-side, then hands it to the client island that manages per-centre
 * attendance-calendar holidays (add / remove). Holidays suppress
 * auto-generated attendance sessions for those dates.
 */

import { listAdminCentres } from '@/api/admin-misc';

import { HolidaysManager } from './holidays-manager';

export default async function HolidaysPage() {
  let centres: { id: string; name: string; locality: string | null }[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminCentres();
    centres = res.items.map((c) => ({ id: c.id, name: c.name, locality: c.locality }));
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load centres';
  }

  return (
    <div className="space-y-2">
      <h2 className="font-display text-2xl text-secondary">Holiday calendar</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Mark dates when a centre is closed. Attendance sessions are not generated for holiday dates.
      </p>
      {error ? (
        <p className="mt-4 text-sm text-destructive">{error}</p>
      ) : (
        <HolidaysManager centres={centres} />
      )}
    </div>
  );
}
