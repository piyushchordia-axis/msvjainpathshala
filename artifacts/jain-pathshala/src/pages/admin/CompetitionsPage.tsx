import { useState } from 'react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminTable, AdminError, AdminEmptyRow } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Plus } from 'lucide-react';

// Mirrors GET /v1/competitions row shape exactly.
interface CompetitionRow {
  id: string;
  city_id: string;
  city_name: string;
  name_en: string;
  name_hi: string;
  category: string;
  eligible_age_groups: string[];
  msv_only: boolean;
  registration_window_start: string;
  registration_window_end: string;
  event_date: string;
  winner_points: number;
  participant_points: number;
  max_participants: number | null;
  status: 'draft' | 'open' | 'closed' | 'results_published';
  results_published_at: string | null;
  registration_count: number;
}

const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;

// Forward-only lifecycle target via POST /:id/status (publish has its own action).
const NEXT_STATUS: Record<CompetitionRow['status'], { value: 'open' | 'closed'; label: string } | null> = {
  draft: { value: 'open', label: 'Open registration' },
  open: { value: 'closed', label: 'Close' },
  closed: null,
  results_published: null,
};

const STATUS_TONE: Record<CompetitionRow['status'], 'secondary' | 'default' | 'outline'> = {
  draft: 'outline',
  open: 'default',
  closed: 'secondary',
  results_published: 'secondary',
};

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function AddCompetitionDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cityId, setCityId] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [category, setCategory] = useState('general');
  const [ages, setAges] = useState<string[]>([]);
  const [msvOnly, setMsvOnly] = useState(false);
  const [winStart, setWinStart] = useState('');
  const [winEnd, setWinEnd] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [winnerPoints, setWinnerPoints] = useState('50');
  const [participantPoints, setParticipantPoints] = useState('10');
  const [maxParticipants, setMaxParticipants] = useState('');

  function toggleAge(g: string) {
    setAges((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }

  function reset() {
    setCityId('');
    setNameEn('');
    setNameHi('');
    setCategory('general');
    setAges([]);
    setMsvOnly(false);
    setWinStart('');
    setWinEnd('');
    setEventDate('');
    setWinnerPoints('50');
    setParticipantPoints('10');
    setMaxParticipants('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!cityId.trim() || !nameEn.trim() || !nameHi.trim() || !winStart || !winEnd || !eventDate) return;
    setBusy(true);
    try {
      await apiPost('/v1/competitions', {
        city_id: cityId.trim(),
        name_en: nameEn.trim(),
        name_hi: nameHi.trim(),
        category: category.trim() || 'general',
        eligible_age_groups: ages,
        msv_only: msvOnly,
        registration_window_start: new Date(winStart).toISOString(),
        registration_window_end: new Date(winEnd).toISOString(),
        event_date: eventDate,
        winner_points: Number(winnerPoints) || 0,
        participant_points: Number(participantPoints) || 0,
        ...(maxParticipants.trim() ? { max_participants: Number(maxParticipants) } : {}),
      });
      toast.success('Competition created.');
      setOpen(false);
      reset();
      onAdded();
    } catch (err) {
      toast.error('Failed to create competition.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New competition
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create competition</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="City ID *">
            <Input value={cityId} onChange={(e) => setCityId(e.target.value)} placeholder="UUID of the city" required />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Name (English) *">
              <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
            </FormRow>
            <FormRow label="Name (Hindi) *">
              <Input value={nameHi} onChange={(e) => setNameHi(e.target.value)} required />
            </FormRow>
          </div>
          <FormRow label="Category">
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="general" />
          </FormRow>
          <FormRow label="Eligible age groups (none = all)">
            <div className="flex flex-wrap gap-3 pt-1">
              {AGE_GROUPS.map((g) => (
                <label key={g} className="flex items-center gap-1.5 text-sm capitalize">
                  <input type="checkbox" checked={ages.includes(g)} onChange={() => toggleAge(g)} />
                  {g}
                </label>
              ))}
            </div>
          </FormRow>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={msvOnly} onChange={(e) => setMsvOnly(e.target.checked)} />
            MSV members only
          </label>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Registration opens *">
              <Input type="datetime-local" value={winStart} onChange={(e) => setWinStart(e.target.value)} required />
            </FormRow>
            <FormRow label="Registration closes *">
              <Input type="datetime-local" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} required />
            </FormRow>
          </div>
          <FormRow label="Event date *">
            <Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />
          </FormRow>
          <div className="grid grid-cols-3 gap-3">
            <FormRow label="Winner points">
              <Input type="number" min={0} value={winnerPoints} onChange={(e) => setWinnerPoints(e.target.value)} />
            </FormRow>
            <FormRow label="Participant points">
              <Input type="number" min={0} value={participantPoints} onChange={(e) => setParticipantPoints(e.target.value)} />
            </FormRow>
            <FormRow label="Max participants">
              <Input type="number" min={1} value={maxParticipants} onChange={(e) => setMaxParticipants(e.target.value)} placeholder="∞" />
            </FormRow>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatusActions({ row, onChanged }: { row: CompetitionRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const next = NEXT_STATUS[row.status];

  async function advance() {
    if (!next || busy) return;
    setBusy(true);
    try {
      await apiPost(`/v1/competitions/${row.id}/status`, { status: next.value });
      toast.success(`Competition ${next.value === 'open' ? 'opened' : 'closed'}.`);
      onChanged();
    } catch (err) {
      toast.error('Could not update status.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await apiPost<{ awarded: number }>(`/v1/competitions/${row.id}/publish-results`, {});
      toast.success(`Results published. Awarded ${res?.awarded ?? 0} student(s).`);
      onChanged();
    } catch (err) {
      toast.error('Could not publish results.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1">
      {next ? (
        <Button size="sm" variant="secondary" onClick={advance} disabled={busy}>
          {busy ? '…' : next.label}
        </Button>
      ) : null}
      {row.status === 'closed' ? (
        <Button size="sm" onClick={publish} disabled={busy}>
          {busy ? '…' : 'Publish results'}
        </Button>
      ) : null}
      {!next && row.status !== 'closed' ? <span className="text-xs text-muted-foreground">—</span> : null}
    </div>
  );
}

export default function CompetitionsPage() {
  const { items, loading, error, reload } = useAdminList<CompetitionRow>('/v1/competitions?limit=200');
  return (
    <AdminPageShell
      title="Competitions"
      subtitle="City-scoped competitions, registrations and Punya rewards."
      actions={<AddCompetitionDialog onAdded={reload} />}
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Name', 'City', 'Category', 'Event date', 'Regs', 'Points', 'Status', 'Actions']}
        loading={loading}
        empty=""
        colSpan={8}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={8} message="No competitions yet." />
        ) : null}
        {items.map((c) => (
          <tr key={c.id} className="hover:bg-muted/30">
            <td className="px-4 py-3">
              <div className="font-medium">{c.name_en}</div>
              <div className="text-xs text-muted-foreground">
                {c.msv_only ? 'MSV only · ' : ''}
                {c.eligible_age_groups.length ? c.eligible_age_groups.join(', ') : 'all ages'}
              </div>
            </td>
            <td className="px-4 py-3 text-xs">{c.city_name}</td>
            <td className="px-4 py-3 text-xs capitalize">{c.category}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">
              {new Date(c.event_date).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3">
              {c.registration_count}
              {c.max_participants != null ? <span className="text-xs text-muted-foreground"> / {c.max_participants}</span> : null}
            </td>
            <td className="px-4 py-3 text-xs">
              <span className="text-muted-foreground">W</span> {c.winner_points} ·{' '}
              <span className="text-muted-foreground">P</span> {c.participant_points}
            </td>
            <td className="px-4 py-3">
              <Badge variant={STATUS_TONE[c.status]} className="capitalize">
                {c.status.replace('_', ' ')}
              </Badge>
            </td>
            <td className="px-4 py-3">
              <StatusActions row={c} onChanged={reload} />
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
