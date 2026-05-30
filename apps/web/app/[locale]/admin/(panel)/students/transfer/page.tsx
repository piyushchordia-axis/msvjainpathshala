/**
 * Admin → Transfer a student. Server component: loads active students + the
 * in-scope batches, then renders the client transfer form.
 */

import { listAdminBatches, listAdminStudents } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

import { TransferForm } from './transfer-form';

export default async function TransferStudentPage() {
  let students: { id: string; label: string }[] = [];
  let batches: { id: string; label: string }[] = [];
  let error: string | null = null;
  try {
    const [s, b] = await Promise.all([
      listAdminStudents({ status: 'active', limit: 200 }),
      listAdminBatches(),
    ]);
    students = s.items.map((x) => ({ id: x.id, label: `${x.full_name} · ${x.student_code}` }));
    batches = b.items.map((x) => ({ id: x.id, label: `${x.name} · ${x.centre_name}` }));
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load students or batches.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Transfer student</h2>
        <p className="text-sm text-muted-foreground">
          Move a student to a different batch or centre within your scope.
        </p>
      </header>
      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : (
        <TransferForm students={students} batches={batches} />
      )}
    </div>
  );
}
