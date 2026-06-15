import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface AdminBatchRow {
  id: string;
  name: string | null;
  centre_name: string;
  age_group: string;
  shikshak_name: string | null;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  status: 'active' | 'inactive';
}

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatDays(days: number[]): string {
  if (!days?.length) return '—';
  return days.map((d) => DAY_NAMES[d] ?? String(d)).join(', ');
}

function formatTime(start: string, end: string): string {
  const trim = (t: string) => (t ? t.slice(0, 5) : '');
  const s = trim(start);
  const e = trim(end);
  if (!s && !e) return '—';
  return `${s}–${e}`;
}

function BatchRowActions({ id, status, onChanged }: { id: string; status: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const action = status === 'active' ? 'deactivate' : 'activate';
    setBusy(true);
    try {
      await apiPost(`/v1/admin/batches/${id}/${action}`, {});
      toast.success(`Batch ${action}d.`);
      onChanged();
    } catch (err) {
      toast.error(`Could not ${action} batch.`, err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={status === 'active' ? 'secondary' : 'ghost'} disabled={busy} onClick={toggle}>
      {status === 'active' ? 'Deactivate' : 'Activate'}
    </Button>
  );
}

interface CentreOption { id: string; name: string; }

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;

function AddBatchDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [name, setName] = useState('');
  const [centreId, setCentreId] = useState('');
  const [ageGroup, setAgeGroup] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [capacity, setCapacity] = useState('30');

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: CentreOption[] }>('/v1/admin/centres').then((r) => setCentres(r?.items ?? []));
  }, [open]);

  function toggleDay(d: number) {
    setSelectedDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !centreId || !ageGroup || !startTime || !endTime) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/batches', {
        centre_id: centreId,
        name: name.trim(),
        age_group: ageGroup,
        start_time: startTime,
        end_time: endTime,
        day_of_week: selectedDays,
        capacity: Number(capacity) || 30,
      });
      toast.success('Batch created.');
      setOpen(false);
      setName(''); setCentreId(''); setAgeGroup(''); setStartTime(''); setEndTime(''); setSelectedDays([]); setCapacity('30');
      onAdded();
    } catch (err) {
      toast.error('Failed to create batch.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add batch</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add batch</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Batch name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Morning Bal Batch" required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Centre *</Label>
            <Select value={centreId} onValueChange={setCentreId}>
              <SelectTrigger><SelectValue placeholder="Select centre" /></SelectTrigger>
              <SelectContent>
                {centres.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Age group *</Label>
            <Select value={ageGroup} onValueChange={setAgeGroup}>
              <SelectTrigger><SelectValue placeholder="Select age group" /></SelectTrigger>
              <SelectContent>
                {AGE_GROUPS.map((g) => <SelectItem key={g} value={g} className="capitalize">{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Start time *</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">End time *</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Days of week</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {DAYS.slice(1).map((d, i) => {
                const day = i + 1;
                const active = selectedDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${active ? 'bg-primary text-primary-foreground border-primary' : 'border-input bg-background hover:bg-muted'}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-medium">Capacity</Label>
            <Input type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !name.trim() || !centreId || !ageGroup || !startTime || !endTime}>
              {busy ? 'Saving…' : 'Create batch'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BatchesPage() {
  const [items, setItems] = useState<AdminBatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: AdminBatchRow[] }>('/v1/admin/batches');
      setItems(res?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load batches.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-secondary">Batches</h2>
          <p className="text-sm text-muted-foreground">Batches across your centres, with their schedule and assigned Guruji.</p>
        </div>
        <AddBatchDialog onAdded={load} />
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Centre</th>
                <th className="px-4 py-3">Age group</th>
                <th className="px-4 py-3">Shikshak</th>
                <th className="px-4 py-3">Day / time</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No batches in scope yet.</td></tr>
              ) : (
                items.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{b.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{b.centre_name}</td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">{b.age_group}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{b.shikshak_name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDays(b.day_of_week)} · {formatTime(b.start_time, b.end_time)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={b.status === 'active'
                        ? 'rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700'
                        : 'rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground'}
                      >{b.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <BatchRowActions id={b.id} status={b.status} onChanged={load} />
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
