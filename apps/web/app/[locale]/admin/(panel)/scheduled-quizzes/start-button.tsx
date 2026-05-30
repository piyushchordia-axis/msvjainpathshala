'use client';

/**
 * Start action for a scheduled quiz event. Only meaningful while the event is
 * 'scheduled'; once started the backend flips it to 'live'.
 */

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { toast } from '@/components/ui/toast';

export function StartQuizButton({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (status !== 'scheduled') {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  function run() {
    if (!window.confirm('Start this quiz now? Participants will be able to join.')) return;
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/quiz-events/${id}/start`, { method: 'POST' });
        const j = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) throw new Error(j?.error?.message ?? `Could not start (${res.status})`);
        toast.success('Quiz started', 'Participants can join now.');
        router.refresh();
      } catch (err) {
        toast.error('Could not start quiz', err instanceof Error ? err.message : 'Unknown error');
      }
    });
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      className="text-xs font-semibold text-saffron hover:underline disabled:opacity-50"
    >
      {pending ? '…' : 'Start now'}
    </button>
  );
}
