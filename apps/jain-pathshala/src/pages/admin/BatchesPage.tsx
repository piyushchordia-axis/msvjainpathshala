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
import { AGE_GROUPS, formatAgeGroup, formatAgeGroups } from '@workspace/api-zod';

interface AdminBatchRow {
  id: string;
  name: string | null;
  centre_id?: string;
  centre_name: string;
  age_groups: string[];
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

function BatchRowActions({
  batch,
  onChanged,
}: {
  batch: AdminBatchRow;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [staff, setStaff] = useState<{ user_id: string; full_name: string | null; gender: string | null; is_primary: boolean }[]>([]);
  const [tagged, setTagged] = useState<{ user_id: string; full_name: string | null; gender: string | null }[]>([]);
  const [pick, setPick] = useState('');

  async function toggle() {
    if (busy) return;
    const action = batch.status === 'active' ? 'deactivate' : 'activate';
    setBusy(true);
    try {
      await apiPost(`/v1/admin/batches/${batch.id}/${action}`, {});
      toast.success(`Batch ${action}d.`);
      onChanged();
    } catch (err) {
      toast.error(`Could not ${action} batch.`, err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function loadStaff() {
    try {
      const [list, centreShik] = await Promise.all([
        apiGet<{ items: typeof staff }>(`/v1/admin/batches/${batch.id}/shikshaks`),
        batch.centre_id
          ? apiGet<{ items: { user_id: string; full_name: string | null; gender: string | null }[] }>(
              `/v1/admin/centres/${batch.centre_id}/shikshaks`,
            )
          : Promise.resolve({ items: [] }),
      ]);
      setStaff(list?.items ?? []);
      setTagged(centreShik?.items ?? []);
    } catch (err) {
      toast.error('Could not load batch staff.', err instanceof ApiError ? err.message : undefined);
    }
  }

  function label(g: string | null | undefined) {
    if (g === 'female') return 'Didi';
    if (g === 'male') return 'Guruji';
    return 'Shikshak';
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Dialog
        open={staffOpen}
        onOpenChange={(o) => {
          setStaffOpen(o);
          if (o) void loadStaff();
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">Staff</Button>
        </DialogTrigger>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Staff — {batch.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            {tagged.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No shikshaks tagged to this centre yet.{' '}
                {batch.centre_id ? (
                  <a className="underline" href={`/admin/centres/${batch.centre_id}`}>
                    Open centre staffing
                  </a>
                ) : null}
              </p>
            ) : (
              <div className="flex gap-2">
                <Select value={pick} onValueChange={setPick}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Add from centre tags" />
                  </SelectTrigger>
                  <SelectContent>
                    {tagged
                      .filter((t) => !staff.some((s) => s.user_id === t.user_id))
                      .map((t) => (
                        <SelectItem key={t.user_id} value={t.user_id}>
                          {t.full_name ?? t.user_id} ({label(t.gender)})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!pick}
                  onClick={async () => {
                    try {
                      await apiPost(`/v1/admin/batches/${batch.id}/shikshaks`, {
                        user_id: pick,
                        is_primary: staff.length === 0,
                      });
                      setPick('');
                      await loadStaff();
                      onChanged();
                      toast.success('Assigned.');
                    } catch (err) {
                      toast.error('Assign failed.', err instanceof ApiError ? err.message : undefined);
                    }
                  }}
                >
                  Add
                </Button>
              </div>
            )}
            <ul className="divide-y divide-border text-sm">
              {staff.map((s) => (
                <li key={s.user_id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <p className="font-medium">
                      {s.full_name ?? '—'}{' '}
                      <span className="text-xs text-muted-foreground">({label(s.gender)})</span>
                      {s.is_primary ? (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Primary</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {!s.is_primary ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          try {
                            await apiPost(`/v1/admin/batches/${batch.id}/primary`, { user_id: s.user_id });
                            await loadStaff();
                            onChanged();
                          } catch (err) {
                            toast.error('Could not set primary.', err instanceof ApiError ? err.message : undefined);
                          }
                        }}
                      >
                        Make primary
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await apiPost(`/v1/admin/batches/${batch.id}/shikshaks/${s.user_id}/remove`, {});
                          await loadStaff();
                          onChanged();
                        } catch (err) {
                          toast.error('Could not remove.', err instanceof ApiError ? err.message : undefined);
                        }
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <DialogClose asChild>
              <Button variant="secondary" className="w-full">Done</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
      <Button size="sm" variant={batch.status === 'active' ? 'secondary' : 'ghost'} disabled={busy} onClick={toggle}>
        {batch.status === 'active' ? 'Deactivate' : 'Activate'}
      </Button>
    </div>
  );
}

interface CentreOption { id: string; name: string; }

const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function AddBatchDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [centres, setCentres] = useState<CentreOption[]>([]);
  const [name, setName] = useState('');
  const [centreId, setCentreId] = useState('');
  const [ageGroups, setAgeGroups] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [capacity, setCapacity] = useState('30');
  const [primaryId, setPrimaryId] = useState('');
  const [tagged, setTagged] = useState<{ user_id: string; full_name: string | null; gender: string | null }[]>([]);

  useEffect(() => {
    if (!open) return;
    void apiGet<{ items: CentreOption[] }>('/v1/admin/centres').then((r) => setCentres(r?.items ?? []));
  }, [open]);

  useEffect(() => {
    if (!open || !centreId) {
      setTagged([]);
      setPrimaryId('');
      return;
    }
    void apiGet<{ items: typeof tagged }>(`/v1/admin/centres/${centreId}/shikshaks`).then((r) => {
      setTagged(r?.items ?? []);
      setPrimaryId('');
    });
  }, [open, centreId]);

  function toggleDay(d: number) {
    setSelectedDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);
  }

  function toggleAge(g: string) {
    setAgeGroups((prev) => prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]);
  }

  function selectAllAges() {
    setAgeGroups([...AGE_GROUPS]);
  }

  function clearAges() {
    setAgeGroups([]);
  }

  function reset() {
    setName('');
    setCentreId('');
    setAgeGroups([]);
    setStartTime('');
    setEndTime('');
    setSelectedDays([]);
    setCapacity('30');
    setPrimaryId('');
    setTagged([]);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !centreId || ageGroups.length === 0 || !startTime || !endTime) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/batches', {
        centre_id: centreId,
        name: name.trim(),
        age_groups: ageGroups,
        start_time: startTime,
        end_time: endTime,
        day_of_week: selectedDays,
        capacity: Number(capacity) || 30,
        ...(primaryId ? { primary_shikshak_id: primaryId } : {}),
      });
      toast.success('Batch created.');
      setOpen(false);
      reset();
      onAdded();
    } catch (err) {
      toast.error('Failed to create batch.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add batch</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs font-medium">Age groups * ({ageGroups.length} selected)</Label>
              <div className="flex gap-2">
                <button type="button" className="text-xs text-primary underline" onClick={selectAllAges}>Select all</button>
                <button type="button" className="text-xs text-muted-foreground underline" onClick={clearAges}>Clear</button>
              </div>
            </div>
            <div className="space-y-1 rounded-md border border-border p-2">
              {AGE_GROUPS.map((g) => {
                const active = ageGroups.includes(g);
                return (
                  <label key={g} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40">
                    <input type="checkbox" checked={active} onChange={() => toggleAge(g)} />
                    <span>{formatAgeGroup(g)}</span>
                  </label>
                );
              })}
            </div>
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
          <div className="space-y-1">
            <Label className="text-xs font-medium">Primary Guruji / Didi (optional)</Label>
            {tagged.length === 0 && centreId ? (
              <p className="text-xs text-muted-foreground">
                Tag shikshaks on the{' '}
                <a className="underline" href={`/admin/centres/${centreId}`}>centre staffing</a> page first.
              </p>
            ) : (
              <Select value={primaryId || '__none'} onValueChange={(v) => setPrimaryId(v === '__none' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="None yet" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">None yet</SelectItem>
                  {tagged.map((t) => (
                    <SelectItem key={t.user_id} value={t.user_id}>
                      {t.full_name ?? t.user_id}
                      {t.gender === 'female' ? ' (Didi)' : t.gender === 'male' ? ' (Guruji)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !name.trim() || !centreId || ageGroups.length === 0 || !startTime || !endTime}>
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
                <th className="px-4 py-3">Age groups</th>
                <th className="px-4 py-3">Primary Guruji / Didi</th>
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
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatAgeGroups(b.age_groups)}</td>
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
                      <BatchRowActions batch={b} onChanged={load} />
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
