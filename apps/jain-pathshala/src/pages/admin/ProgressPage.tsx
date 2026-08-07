import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronsUpDown, FileText, Star } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminError } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

interface ReportRow {
  id: string;
  period_kind: string;
  period_label: string;
  pdf_url: string | null;
  released_to_parent: boolean;
  generated_at: string;
}

interface CourseOption {
  id: string;
  name_en: string;
  name_hi: string | null;
  kind: string;
  academic_year: string | null;
  punya_points: number;
}

type ProgressStatus = 'not_started' | 'in_progress' | 'completed';

interface TreeSubsection {
  id: string;
  title_en: string;
  title_hi: string;
  status: ProgressStatus;
  certified_at: string | null;
  certified_by: string | null;
  certified_by_gender: string | null;
}

interface TreeSection {
  id: string;
  title_en: string;
  title_hi: string;
  punya_points: number;
  status: ProgressStatus;
  certified_at: string | null;
  certified_by: string | null;
  certified_by_gender: string | null;
  derived_status: ProgressStatus | null;
  derived_leaf_total: number;
  derived_leaf_reached: number;
  derived_coverage: number | null;
  status_diverges: boolean;
  subsections: TreeSubsection[];
}

interface StudentCourseTree {
  course: {
    id: string;
    name_en: string;
    name_hi: string | null;
    punya_points: number;
  };
  progress: {
    coverage: number | null;
    mastery: number | null;
  };
  sections: TreeSection[];
}

const STATUSES: ProgressStatus[] = ['not_started', 'in_progress', 'completed'];

function statusLabel(s: ProgressStatus | null): string {
  if (s == null) return '—';
  return s.replace(/_/g, ' ');
}

/** CU17 — three-branch honorific; never hardcode Guruji for null/other. */
function certifiedLabel(gender: string | null | undefined): string {
  if (gender === 'male') return 'Certified by Guruji';
  if (gender === 'female') return 'Certified by Didi';
  return 'Certified';
}

function studentLabel(s: StudentOption): string {
  return `${s.full_name ?? '—'} · ${s.student_code}`;
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
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
      setPeriodLabel('');
      setComment('');
      onGenerated();
    } catch (err) {
      toast.error(
        'Could not generate the report — check the period label and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <FileText className="mr-1 h-4 w-4" />
          Generate report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate progress report</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Period kind *">
            <Select value={periodKind} onValueChange={setPeriodKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !periodLabel.trim()}>
              {busy ? 'Generating…' : 'Generate'}
            </Button>
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
      toast.error(
        'Could not release the report — try again.',
        err instanceof ApiError ? err.message : undefined,
      );
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

type CertifyTarget = {
  nodeId: string;
  nodeTitle: string;
  punyaPoints: number;
  kind: 'section' | 'subsection';
};

export default function ProgressPage() {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentId, setStudentId] = useState('');

  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseId, setCourseId] = useState('');
  const [tree, setTree] = useState<StudentCourseTree | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingNode, setSavingNode] = useState<string | null>(null);

  const [reports, setReports] = useState<ReportRow[]>([]);
  const [certifyTarget, setCertifyTarget] = useState<CertifyTarget | null>(null);
  const [certifyBusy, setCertifyBusy] = useState(false);

  const selectedStudent = useMemo(
    () => students.find((s) => s.id === studentId) ?? null,
    [students, studentId],
  );

  useEffect(() => {
    setStudentsLoading(true);
    apiGet<{ items: StudentOption[] }>('/v1/admin/students?limit=500')
      .then((r) => {
        const list = (r?.items ?? []).filter((s) => s.status !== 'inactive');
        setStudents(list);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load students.'),
      )
      .finally(() => setStudentsLoading(false));
  }, []);

  async function loadCourses() {
    try {
      const r = await apiGet<{ items: CourseOption[] }>('/v1/courses');
      setCourses(r?.items ?? []);
    } catch {
      setCourses([]);
    }
  }

  async function loadTree(sid: string, cid: string) {
    if (!sid || !cid) {
      setTree(null);
      return;
    }
    setTreeLoading(true);
    setError(null);
    try {
      const data = await apiGet<StudentCourseTree>(
        `/v1/courses/${cid}/tree?student_id=${encodeURIComponent(sid)}`,
      );
      setTree(data);
    } catch (err) {
      setTree(null);
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not load course progress — pick another course or refresh.',
      );
    } finally {
      setTreeLoading(false);
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
    setTree(null);
    setCourseId('');
    setReports([]);
    if (id) {
      void loadCourses();
      void loadReports(id);
    }
  }

  function onSelectCourse(id: string) {
    setCourseId(id);
    if (studentId && id) void loadTree(studentId, id);
  }

  async function setNodeStatus(nodeId: string, status: ProgressStatus) {
    setSavingNode(nodeId);
    try {
      await apiPost(`/v1/courses/nodes/${nodeId}/progress`, {
        student_id: studentId,
        status,
      });
      toast.success('Progress saved.');
      void loadTree(studentId, courseId);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'ERR_COURSE_NODE_CERTIFIED'
          ? 'That node is already certified — certification cannot be changed here.'
          : 'Could not save progress — refresh and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
      void loadTree(studentId, courseId);
    } finally {
      setSavingNode(null);
    }
  }

  async function confirmCertify() {
    if (!certifyTarget || !studentId) return;
    setCertifyBusy(true);
    try {
      await apiPost(`/v1/courses/nodes/${certifyTarget.nodeId}/certify`, {
        student_id: studentId,
      });
      toast.success('Node certified.');
      setCertifyTarget(null);
      void loadTree(studentId, courseId);
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'ERR_COURSE_NODE_NOT_COMPLETE'
          ? 'Mark the node completed before certifying — set status to completed, then certify again.'
          : 'Could not certify — check scope and status, then try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setCertifyBusy(false);
    }
  }

  return (
    <AdminPageShell
      title="Student progress"
      subtitle="Track course progress per student, surface declared vs derived section status, and certify with confirm."
      actions={
        studentId ? (
          <GenerateReportDialog studentId={studentId} onGenerated={() => loadReports(studentId)} />
        ) : undefined
      }
    >
      {error ? <AdminError message={error} /> : null}

      <div className="mb-6 grid max-w-2xl gap-4 sm:grid-cols-2">
        <div>
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
              No active students in your scope. Assign a batch, or check that children are enrolled
              in your batches.
            </p>
          ) : null}
        </div>
        <div>
          <Label className="text-xs font-medium">Course</Label>
          <Select
            value={courseId || undefined}
            onValueChange={onSelectCourse}
            disabled={!studentId || courses.length === 0}
          >
            <SelectTrigger className="mt-1">
              <SelectValue placeholder={studentId ? 'Select a course…' : 'Pick a student first'} />
            </SelectTrigger>
            <SelectContent>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name_en}
                  {c.academic_year ? ` · ${c.academic_year}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!studentId ? (
        <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Search for a student by name to view and edit their course progress.
        </div>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Course progress</h2>
            {!courseId ? (
              <div className="rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                {courses.length === 0
                  ? 'No active courses in this student\'s city. Ask a city admin to publish a course, then refresh.'
                  : 'Select a course to view section progress.'}
              </div>
            ) : treeLoading && !tree ? (
              <p className="text-sm text-muted-foreground">Loading course…</p>
            ) : tree ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-baseline gap-3 text-sm">
                  <span className="font-display text-lg text-secondary">{tree.course.name_en}</span>
                  <span className="text-xs text-muted-foreground">
                    Coverage:{' '}
                    {tree.progress.coverage == null
                      ? '—'
                      : `${Math.round(tree.progress.coverage * 100)}%`}
                    {' · '}
                    Mastery:{' '}
                    {tree.progress.mastery == null
                      ? '—'
                      : `${Math.round(tree.progress.mastery * 100)}%`}
                  </span>
                </div>
                {tree.sections.map((s) => (
                  <div key={s.id} className="rounded-md border border-border/60">
                    <div className="space-y-2 border-b border-border/60 bg-muted/30 px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="text-sm font-semibold">{s.title_en}</span>
                          <span className="ml-2 text-xs text-muted-foreground">{s.title_hi}</span>
                          <Badge variant="outline" className="ml-2">
                            {s.punya_points} Punya
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Select
                            value={s.status}
                            onValueChange={(v) => setNodeStatus(s.id, v as ProgressStatus)}
                            disabled={!!s.certified_at || savingNode === s.id}
                          >
                            <SelectTrigger className="h-8 w-36 capitalize">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUSES.map((st) => (
                                <SelectItem key={st} value={st} className="capitalize">
                                  {statusLabel(st)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {s.certified_at ? (
                            <span className="inline-flex items-center gap-1 text-xs text-secondary">
                              <Star className="h-3.5 w-3.5" />
                              {certifiedLabel(s.certified_by_gender)}
                            </span>
                          ) : s.status === 'completed' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setCertifyTarget({
                                  nodeId: s.id,
                                  nodeTitle: s.title_en,
                                  punyaPoints: s.punya_points,
                                  kind: 'section',
                                })
                              }
                            >
                              Certify
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Declared: {statusLabel(s.status)}
                        {' · '}
                        Derived roll-up:{' '}
                        {s.derived_status == null
                          ? 'none (no subsections)'
                          : `${statusLabel(s.derived_status)} (${s.derived_leaf_reached}/${s.derived_leaf_total} leaves)`}
                      </p>
                      {s.status_diverges ? (
                        <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs text-foreground">
                          Declared status and derived roll-up differ — this is information for the
                          Sanchalak, not an error. Neither side is auto-corrected.
                        </p>
                      ) : null}
                    </div>
                    <ul className="divide-y divide-border/40">
                      {s.subsections.length === 0 ? (
                        <li className="px-3 py-2 text-xs italic text-muted-foreground">
                          No subsections.
                        </li>
                      ) : (
                        s.subsections.map((sub) => (
                          <li
                            key={sub.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                          >
                            <div>
                              <span className="text-sm">{sub.title_en}</span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {sub.title_hi}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Select
                                value={sub.status}
                                onValueChange={(v) => setNodeStatus(sub.id, v as ProgressStatus)}
                                disabled={!!sub.certified_at || savingNode === sub.id}
                              >
                                <SelectTrigger className="h-8 w-36 capitalize">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {STATUSES.map((st) => (
                                    <SelectItem key={st} value={st} className="capitalize">
                                      {statusLabel(st)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {sub.certified_at ? (
                                <span className="inline-flex items-center gap-1 text-xs text-secondary">
                                  <Star className="h-3.5 w-3.5" />
                                  {certifiedLabel(sub.certified_by_gender)}
                                </span>
                              ) : sub.status === 'completed' ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    setCertifyTarget({
                                      nodeId: sub.id,
                                      nodeTitle: sub.title_en,
                                      punyaPoints: 0,
                                      kind: 'subsection',
                                    })
                                  }
                                >
                                  Certify
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        ))
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
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
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        No reports yet.
                      </td>
                    </tr>
                  ) : (
                    reports.map((r) => (
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
                            <a
                              className="text-primary underline"
                              href={r.pdf_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open PDF
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.released_to_parent ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                              Yes
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.released_to_parent ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <ReleaseButton
                              reportId={r.id}
                              onReleased={() => loadReports(studentId)}
                            />
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      <AlertDialog
        open={!!certifyTarget}
        onOpenChange={(o) => {
          if (!o) setCertifyTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Certify this node?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  You are about to certify{' '}
                  <span className="font-medium text-foreground">
                    {selectedStudent?.full_name ?? 'this student'}
                  </span>{' '}
                  on{' '}
                  <span className="font-medium text-foreground">{certifyTarget?.nodeTitle}</span>
                  {certifyTarget?.kind === 'section' ? (
                    <>
                      {' '}
                      for{' '}
                      <span className="font-medium text-foreground">
                        {certifyTarget.punyaPoints} Punya
                      </span>
                      .
                    </>
                  ) : (
                    <> (subsection — no Punya award).</>
                  )}
                </p>
                <p>Certification is irreversible. Only continue if you mean to award this star.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={certifyBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmCertify();
              }}
              disabled={certifyBusy}
            >
              {certifyBusy ? 'Certifying…' : 'Certify'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPageShell>
  );
}
