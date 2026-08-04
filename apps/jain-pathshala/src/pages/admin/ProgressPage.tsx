import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, FileText } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminError } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';

interface StudentOption {
  id: string;
  full_name: string | null;
  student_code: string;
  status?: string;
}

interface ProgressItem {
  item_id: string;
  title_en: string;
  title_hi: string;
  section_title: string;
  level: ProgressLevel;
  note: string | null;
}

interface ReportRow {
  id: string;
  period_kind: string;
  period_label: string;
  pdf_url: string | null;
  released_to_parent: boolean;
  generated_at: string;
}

type ProgressLevel = 'not_started' | 'in_progress' | 'completed' | 'mastered';
const LEVELS: ProgressLevel[] = ['not_started', 'in_progress', 'completed', 'mastered'];

function levelLabel(level: ProgressLevel): string {
  return level.replace(/_/g, ' ');
}

function studentLabel(s: StudentOption): string {
  return `${s.full_name ?? '—'} · ${s.student_code}`;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
}

function StudentSearchSelect({
  students,
  value,
  onChange,
  disabled,
  loading,
}: {
  students: StudentOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => students.find((s) => s.id === value) ?? null, [students, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className="mt-1 h-9 w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {loading
              ? 'Loading…'
              : selected
                ? studentLabel(selected)
                : 'Search by name or student code…'}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="z-[100] w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Type a student name or code…" />
          <CommandList>
            <CommandEmpty>No matching student.</CommandEmpty>
            <CommandGroup>
              {students.map((s) => {
                const label = studentLabel(s);
                return (
                  <CommandItem
                    key={s.id}
                    value={label}
                    onSelect={() => {
                      onChange(s.id);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === s.id ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function GenerateReportDialog({ studentId, onGenerated }: { studentId: string; onGenerated: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [periodKind, setPeriodKind] = useState('monthly');
  const [periodLabel, setPeriodLabel] = useState('');
  const [comment, setComment] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!periodLabel.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/v1/progress/students/${studentId}/reports`, {
        period_kind: periodKind.trim() || 'monthly',
        period_label: periodLabel.trim(),
        shikshak_comment: comment.trim() || undefined,
      });
      toast.success('Report generated.');
      setOpen(false);
      setPeriodLabel(''); setComment('');
      onGenerated();
    } catch (err) {
      toast.error('Failed to generate report.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><FileText className="mr-1 h-4 w-4" />Generate report</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Generate progress report</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Period kind *">
            <Select value={periodKind} onValueChange={setPeriodKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="termly">Termly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Period label *">
            <Input
              value={periodLabel}
              onChange={(e) => setPeriodLabel(e.target.value)}
              placeholder="e.g. 2026-06 or Term 1"
              maxLength={60}
              required
            />
          </FormRow>
          <FormRow label="Shikshak comment">
            <textarea
              className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
              placeholder="Optional comment for the parent."
            />
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !periodLabel.trim()}>{busy ? 'Generating…' : 'Generate'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseButton({ reportId, onReleased }: { reportId: string; onReleased: () => void }) {
  const [busy, setBusy] = useState(false);
  async function release() {
    setBusy(true);
    try {
      await apiPost(`/v1/progress/reports/${reportId}/release`, {});
      toast.success('Report released to parent.');
      onReleased();
    } catch (err) {
      toast.error('Failed to release report.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="secondary" disabled={busy} onClick={release}>
      {busy ? 'Releasing…' : 'Release'}
    </Button>
  );
}

export default function ProgressPage() {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentId, setStudentId] = useState('');

  const [items, setItems] = useState<ProgressItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingItem, setSavingItem] = useState<string | null>(null);

  const [reports, setReports] = useState<ReportRow[]>([]);

  useEffect(() => {
    setStudentsLoading(true);
    apiGet<{ items: StudentOption[] }>('/v1/admin/students?limit=500')
      .then((r) => {
        const list = (r?.items ?? []).filter((s) => s.status !== 'inactive');
        setStudents(list);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load students.'))
      .finally(() => setStudentsLoading(false));
  }, []);

  async function loadProgress(id: string) {
    setItemsLoading(true);
    setError(null);
    try {
      const r = await apiGet<{ items: ProgressItem[] }>(`/v1/progress/students/${id}`);
      setItems(r?.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load progress.');
      setItems([]);
    } finally {
      setItemsLoading(false);
    }
  }

  async function loadReports(id: string) {
    try {
      const r = await apiGet<{ items: ReportRow[] }>(`/v1/progress/students/${id}/reports`);
      setReports(r?.items ?? []);
    } catch {
      setReports([]);
    }
  }

  function onSelectStudent(id: string) {
    setStudentId(id);
    setItems([]);
    setReports([]);
    if (id) {
      void loadProgress(id);
      void loadReports(id);
    }
  }

  async function setLevel(itemId: string, level: ProgressLevel) {
    setSavingItem(itemId);
    setItems((prev) => prev.map((it) => (it.item_id === itemId ? { ...it, level } : it)));
    try {
      await apiPost(`/v1/progress/students/${studentId}/items/${itemId}`, { level });
      toast.success('Progress saved.');
    } catch (err) {
      toast.error('Failed to save progress.', err instanceof ApiError ? err.message : undefined);
      void loadProgress(studentId); // re-sync on failure
    } finally {
      setSavingItem(null);
    }
  }

  return (
    <AdminPageShell
      title="Student Progress"
      subtitle="Track curriculum mastery per student and generate releasable progress reports."
      actions={studentId ? <GenerateReportDialog studentId={studentId} onGenerated={() => loadReports(studentId)} /> : undefined}
    >
      {error ? <AdminError message={error} /> : null}

      <div className="mb-6 max-w-md">
        <Label className="text-xs font-medium">Student</Label>
        <StudentSearchSelect
          students={students}
          value={studentId}
          onChange={onSelectStudent}
          loading={studentsLoading}
          disabled={studentsLoading}
        />
        {!studentsLoading && students.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No active students in your scope. Assign a batch, or check that children are enrolled in your batches.
          </p>
        ) : null}
      </div>

      {!studentId ? (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Search for a student by name to view and edit their curriculum progress.
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Curriculum progress</h2>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Item</th>
                    <th className="px-4 py-2">Section</th>
                    <th className="px-4 py-2">Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {itemsLoading ? (
                    <tr><td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">Loading…</td></tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-muted-foreground">
                        No curriculum items for this student&apos;s city.
                        Ask a city admin to publish a curriculum, then refresh.
                      </td>
                    </tr>
                  ) : items.map((it) => (
                    <tr key={it.item_id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{it.title_en}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{it.section_title}</td>
                      <td className="px-4 py-3">
                        <Select
                          value={it.level}
                          onValueChange={(v) => setLevel(it.item_id, v as ProgressLevel)}
                          disabled={savingItem === it.item_id}
                        >
                          <SelectTrigger className="h-8 w-40 capitalize"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {LEVELS.map((l) => (
                              <SelectItem key={l} value={l} className="capitalize">{levelLabel(l)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Progress reports</h2>
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Period</th>
                    <th className="px-4 py-2">Generated</th>
                    <th className="px-4 py-2">PDF</th>
                    <th className="px-4 py-2">Released</th>
                    <th className="px-4 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reports.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No reports yet.</td></tr>
                  ) : reports.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium capitalize">{r.period_kind}</div>
                        <div className="text-xs text-muted-foreground">{r.period_label}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(r.generated_at).toLocaleDateString('en-GB')}
                      </td>
                      <td className="px-4 py-3">
                        {r.pdf_url ? (
                          <a className="text-primary underline" href={r.pdf_url} target="_blank" rel="noreferrer">Open PDF</a>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {r.released_to_parent ? (
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700">Yes</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {r.released_to_parent ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <ReleaseButton reportId={r.id} onReleased={() => loadReports(studentId)} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </AdminPageShell>
  );
}
