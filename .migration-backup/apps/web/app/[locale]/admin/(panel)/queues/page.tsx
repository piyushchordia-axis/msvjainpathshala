/**
 * Admin → Queues (`/admin/queues`).
 *
 * super_admin-only BullMQ dashboard. Shows per-queue counters and DLQ
 * sizes; replays/deletes happen via dedicated DLQ inspectors (separate).
 */

import { getQueueStats, type QueueStat } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

export default async function AdminQueuesPage() {
  let queues: QueueStat[] = [];
  let error: string | null = null;
  try {
    const res = await getQueueStats();
    queues = res.queues;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load queue stats.';
  }

  const dlqAlert = queues.some((q) => q.dlq_size > 0);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Queues</h2>
        <p className="text-sm text-muted-foreground">
          BullMQ counters across all 30 queues. Watch the DLQ column for stuck jobs.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      {dlqAlert ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
          <strong className="text-destructive">DLQ items present.</strong>{' '}
          <span className="text-muted-foreground">
            Inspect failed jobs and replay or discard via the API.
          </span>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Queue</th>
                <th className="px-4 py-3 text-right">Waiting</th>
                <th className="px-4 py-3 text-right">Active</th>
                <th className="px-4 py-3 text-right">Delayed</th>
                <th className="px-4 py-3 text-right">Completed</th>
                <th className="px-4 py-3 text-right">Failed</th>
                <th className="px-4 py-3 text-right">DLQ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {queues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No queues reporting.
                  </td>
                </tr>
              ) : (
                queues.map((q) => (
                  <tr key={q.queue} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs">{q.queue}</td>
                    <td className="px-4 py-3 text-right">{q.waiting}</td>
                    <td className="px-4 py-3 text-right">{q.active}</td>
                    <td className="px-4 py-3 text-right">{q.delayed}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{q.completed}</td>
                    <td
                      className={
                        q.failed > 0
                          ? 'px-4 py-3 text-right font-semibold text-destructive'
                          : 'px-4 py-3 text-right text-muted-foreground'
                      }
                    >
                      {q.failed}
                    </td>
                    <td
                      className={
                        q.dlq_size > 0
                          ? 'px-4 py-3 text-right font-semibold text-destructive'
                          : 'px-4 py-3 text-right text-muted-foreground'
                      }
                    >
                      {q.dlq_size}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
