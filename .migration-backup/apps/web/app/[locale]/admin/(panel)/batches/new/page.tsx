/**
 * Admin → New batch. Server component: loads the actor's in-scope centres,
 * then renders the client create-batch form.
 */

import { listAdminCentres } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

import { CreateBatchForm } from './create-batch-form';

export default async function NewBatchPage() {
  let centres: { id: string; name: string }[] = [];
  let error: string | null = null;
  try {
    centres = (await listAdminCentres()).items.map((c) => ({ id: c.id, name: c.name }));
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load centres.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">New batch</h2>
        <p className="text-sm text-muted-foreground">Create a batch in one of your centres.</p>
      </header>
      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <CreateBatchForm centres={centres} />
      )}
    </div>
  );
}
