/**
 * Admin → Assign Guruji / Didi to a batch. Server component: loads in-scope
 * batches + shikshaks, then renders the client assignment form.
 */

import { listAdminBatches, listAdminShikshaks } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

import { AssignShikshakForm } from './assign-shikshak-form';

export default async function AssignShikshakPage() {
  let batches: { id: string; name: string; centre_name: string }[] = [];
  let shikshaks: { id: string; full_name: string; phone: string }[] = [];
  let error: string | null = null;
  try {
    const [b, s] = await Promise.all([listAdminBatches(), listAdminShikshaks()]);
    batches = b.items.map((x) => ({ id: x.id, name: x.name, centre_name: x.centre_name }));
    shikshaks = s.items.map((x) => ({ id: x.id, full_name: x.full_name, phone: x.phone }));
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load batches or Guruji / Didi.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Assign Guruji / Didi</h2>
        <p className="text-sm text-muted-foreground">
          Put a teacher in charge of a batch in your scope.
        </p>
      </header>
      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <AssignShikshakForm batches={batches} shikshaks={shikshaks} />
      )}
    </div>
  );
}
