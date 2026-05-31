/**
 * Client-side results entry form. Position dropdown per registered student
 * (none / 1 / 2 / 3 / 4+).
 */

'use client';

import { useRouter } from 'next/navigation';
import React, { useCallback, useState } from 'react';

import type { CompetitionStatus, RegistrationWithStudent } from '@/api/competitions';

interface RowState {
  studentId: string;
  fullName: string;
  studentCode: string;
  ageGroup: string;
  rank: number | null;
  note: string;
}

export default function ResultsForm({
  competitionId,
  status,
  rows,
}: {
  competitionId: string;
  status: CompetitionStatus;
  rows: RegistrationWithStudent[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<RowState[]>(() =>
    rows.map((r) => ({
      studentId: r.registration.student_id,
      fullName: r.student_full_name,
      studentCode: r.student_code,
      ageGroup: r.age_group,
      rank: r.registration.result_rank,
      note: r.registration.result_note ?? '',
    })),
  );
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const setRank = useCallback((studentId: string, rank: number | null) => {
    setItems((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, rank } : r)));
  }, []);

  const setNote = useCallback((studentId: string, note: string) => {
    setItems((prev) => prev.map((r) => (r.studentId === studentId ? { ...r, note } : r)));
  }, []);

  const saveRanks = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = items
        .filter((r) => r.rank != null)
        .map((r) => ({
          student_id: r.studentId,
          rank: r.rank,
          note: r.note || undefined,
        }));
      if (payload.length === 0) {
        setError('Assign at least one rank before saving.');
        setSaving(false);
        return;
      }
      const res = await fetch('/api/admin/competitions/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: competitionId, results: payload }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(payload.error?.message ?? `Save failed (${res.status})`);
      }
      const out = (await res.json()) as { data: { recorded: number } };
      setSuccess(`${out.data.recorded} ranks saved`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save ranks');
    } finally {
      setSaving(false);
    }
  }, [items, competitionId, router]);

  const publish = useCallback(async () => {
    setPublishing(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/admin/competitions/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: competitionId }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(payload.error?.message ?? `Publish failed (${res.status})`);
      }
      const out = (await res.json()) as {
        data: { punya_awards: number; winners_notified: number };
      };
      setSuccess(
        `Results published — ${out.data.punya_awards} Punya awarded, ${out.data.winners_notified} parents notified`,
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish');
    } finally {
      setPublishing(false);
    }
  }, [competitionId, router]);

  const published = status === 'results_published';

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-success/40 bg-success-bg p-3 text-sm text-success">
          {success}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Age group</th>
              <th className="px-4 py-3">Position</th>
              <th className="px-4 py-3">Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.studentId} className="border-t border-border/60">
                <td className="px-4 py-3 text-sm text-ink">{row.fullName}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{row.studentCode}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{row.ageGroup}</td>
                <td className="px-4 py-3">
                  <select
                    disabled={published}
                    value={row.rank ?? ''}
                    onChange={(e) =>
                      setRank(row.studentId, e.target.value ? Number(e.target.value) : null)
                    }
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                  >
                    <option value="">—</option>
                    <option value="1">1st</option>
                    <option value="2">2nd</option>
                    <option value="3">3rd</option>
                    <option value="4">Participant</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <input
                    type="text"
                    disabled={published}
                    value={row.note}
                    onChange={(e) => setNote(row.studentId, e.target.value)}
                    placeholder="(optional)"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={saveRanks}
          disabled={saving || published}
          className="rounded-md border border-input px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save ranks'}
        </button>
        <button
          type="button"
          onClick={publish}
          disabled={publishing || published}
          className="rounded-md bg-saffron px-5 py-2 text-sm font-semibold text-white hover:bg-saffron-700 disabled:opacity-60"
        >
          {published ? 'Already published' : publishing ? 'Publishing…' : 'Publish results'}
        </button>
      </div>
    </div>
  );
}
