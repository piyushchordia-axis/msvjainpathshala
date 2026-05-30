'use client';

/**
 * Row actions for the students roster: generate a progress-report PDF (with a
 * period picker) and regenerate the digital ID card. Both call the synchronous
 * pdfkit backend, then open the returned signed URL in a new tab.
 */

import { useState, useTransition } from 'react';

import { toast } from '@/components/ui/toast';

function currentMonthLabel(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function StudentDocuments({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  const [periodKind, setPeriodKind] = useState<'monthly' | 'termly'>('monthly');
  const [periodLabel, setPeriodLabel] = useState(currentMonthLabel());

  function openUrl(data: unknown): void {
    const url = (data as { url?: string } | null)?.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  function generateReport() {
    const label = periodLabel.trim();
    if (!label) {
      toast.error('Period required', 'Enter a period label, e.g. 2026-05.');
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/students/${id}/report`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ period_kind: periodKind, period_label: label }),
        });
        const j = (await res.json().catch(() => null)) as {
          data?: { url?: string };
          error?: { message?: string };
        } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not generate (${res.status})`);
        toast.success('Progress report ready', 'Opening the PDF in a new tab.');
        openUrl(j?.data);
      } catch (err) {
        toast.error(
          'Could not generate report',
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    });
  }

  function regenerateIdCard() {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/students/${id}/id-card`, { method: 'POST' });
        const j = (await res.json().catch(() => null)) as {
          data?: { url?: string };
          error?: { message?: string };
        } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not generate (${res.status})`);
        toast.success('ID card ready', 'Opening the PDF in a new tab.');
        openUrl(j?.data);
      } catch (err) {
        toast.error(
          'Could not generate ID card',
          err instanceof Error ? err.message : 'Unknown error',
        );
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Report period kind"
        value={periodKind}
        onChange={(e) => setPeriodKind(e.target.value as 'monthly' | 'termly')}
        disabled={pending}
        className="rounded border border-cream-dark bg-cream px-1.5 py-0.5 text-xs text-ink disabled:opacity-50"
      >
        <option value="monthly">Monthly</option>
        <option value="termly">Termly</option>
      </select>
      <input
        aria-label="Report period label"
        value={periodLabel}
        onChange={(e) => setPeriodLabel(e.target.value)}
        disabled={pending}
        placeholder="2026-05"
        className="w-20 rounded border border-cream-dark bg-cream px-1.5 py-0.5 text-xs text-ink disabled:opacity-50"
      />
      <button
        type="button"
        onClick={generateReport}
        disabled={pending}
        className="text-xs font-medium text-saffron hover:underline disabled:opacity-50"
      >
        {pending ? '…' : 'Report PDF'}
      </button>
      <button
        type="button"
        onClick={regenerateIdCard}
        disabled={pending}
        className="text-xs font-medium text-saffron hover:underline disabled:opacity-50"
      >
        {pending ? '…' : 'ID card'}
      </button>
    </div>
  );
}
