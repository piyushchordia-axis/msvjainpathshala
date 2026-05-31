/**
 * Admin shivir live dashboard — `/admin/shivirs/[id]/live` (Step 15).
 *
 * Renders the four stat cards (Registered / Currently In / Already Out /
 * Not Arrived) and a live activity feed subscribed to the
 * `/shivirs/:shivirId` Socket.IO namespace.
 *
 * Server-render: fetches the initial counters via the REST endpoint, so
 * the page is useful even before the WebSocket connects (and stays
 * accurate if the socket can't reach the gateway).
 */

import { getShivir, getShivirLive, type ShivirLiveResponse } from '@/api/shivirs';
import { Card } from '@/components/ui/card';

import { ShivirLiveBoard } from './ShivirLiveBoard';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ session_id?: string }>;
}

export default async function AdminShivirLivePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { session_id } = await searchParams;

  let initial: ShivirLiveResponse | null = null;
  let sessions: Array<{ id: string; day_number: number; session_date: string }> = [];
  let error: string | null = null;
  try {
    const [live, detail] = await Promise.all([
      getShivirLive(id, session_id ? { session_id } : {}),
      getShivir(id),
    ]);
    initial = live;
    sessions = detail.sessions.map((s) => ({
      id: s.id,
      day_number: s.day_number,
      session_date: s.session_date,
    }));
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load live data.';
  }

  if (error) {
    return (
      <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        {error}
      </Card>
    );
  }
  if (!initial) return null;

  return (
    <ShivirLiveBoard
      shivirId={id}
      initial={initial}
      sessions={sessions}
      activeSessionId={session_id ?? null}
    />
  );
}
