'use client';

/**
 * Transfer a student to a different batch (city_admin+). Posts to
 * /api/admin/students/transfer → POST /v1/enrolments/students/:id/transfer.
 */

import { useState, useTransition } from 'react';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';

interface Opt {
  id: string;
  label: string;
}

export function TransferForm({ students, batches }: { students: Opt[]; batches: Opt[] }) {
  const [studentId, setStudentId] = useState(students[0]?.id ?? '');
  const [batchId, setBatchId] = useState(batches[0]?.id ?? '');
  const [pending, startTransition] = useTransition();

  const valid = !!studentId && !!batchId;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      toast.error('Check the form', 'Pick a student and a target batch.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/students/transfer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ student_id: studentId, target_batch_id: batchId }),
        });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not transfer (${res.status})`);
        toast.success('Student transferred', 'They now belong to the selected batch.');
      } catch (err) {
        toast.error('Could not transfer', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  if (students.length === 0 || batches.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {students.length === 0 ? 'No active students in scope.' : 'No batches in scope.'}
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">Student</Label>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="mb-1 block text-xs font-semibold text-muted-foreground">
            Target batch
          </Label>
          <select
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
          >
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 flex items-center justify-end">
          <button
            type="submit"
            disabled={pending || !valid}
            className="rounded-md bg-saffron px-4 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
          >
            {pending ? 'Transferring…' : 'Transfer student'}
          </button>
        </div>
      </form>
    </Card>
  );
}
