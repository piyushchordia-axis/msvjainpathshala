/**
 * Course catalogue authoring (CU3–CU8, CU20, CU22, CU33).
 * Prefills for punya_points are UI-only (CU22); DB default stays 0.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, ChevronUp, ChevronDown, Archive, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AdminEmptyRow,
  AdminError,
  AdminPageShell,
  AdminTable,
} from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/lib/auth-context';
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

interface GeoCity { id: string; name: string; state_name?: string }

interface CourseRow {
  id: string;
  name_en: string;
  name_hi: string | null;
  kind: string;
  academic_year: string | null;
  status: 'draft' | 'active' | 'archived';
  punya_points: number;
  city_id: string | null;
  city_name: string | null;
  template_id: string | null;
  section_count: number;
}

interface TreeSubsection {
  id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  order_index: number;
}

interface TreeSection {
  id: string;
  title_en: string;
  title_hi: string;
  order_index: number;
  punya_points: number;
  subsections: TreeSubsection[];
}

interface CourseTree {
  course: {
    id: string;
    name_en: string;
    name_hi: string | null;
    kind: string;
    academic_year: string | null;
    status: string;
    punya_points: number;
    city_id: string | null;
    template_id: string | null;
  };
  sections: TreeSection[];
}

interface TemplateRow {
  id: string;
  name_en: string;
  name_hi: string | null;
  kind: string;
  age_group: string | null;
}

interface TemplateTree {
  template: {
    id: string;
    name_en: string;
    name_hi: string | null;
    kind: string;
    age_group: string | null;
  };
  sections: TreeSection[];
}

const NO_CITY = '__none__';

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

/** IST academic year label, e.g. 2025-26 (April start). */
export function currentAcademicYear(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return '';
  if (m >= 4) return `${y}-${String(y + 1).slice(-2)}`;
  return `${y - 1}-${String(y).slice(-2)}`;
}

function academicYearStart(year: string | null | undefined): number | null {
  if (!year) return null;
  const m = /^(\d{4})/.exec(year.trim());
  return m ? Number(m[1]) : null;
}

/** CU22 — UI prefill only; never written unless the admin saves. */
export function sectionPunyaPrefill(subsectionCount: number): number {
  return Math.min(1000, Math.max(0, 10 * subsectionCount));
}

/** CU22 — 20% of sum of section points, capped at 2000. */
export function coursePunyaPrefill(sectionPoints: number[]): number {
  const sum = sectionPoints.reduce((a, b) => a + b, 0);
  return Math.min(2000, Math.max(0, Math.round(sum * 0.2)));
}

function statusBadge(status: string) {
  const variant =
    status === 'active' ? 'default' : status === 'draft' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

function publishErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not publish this course — check your connection and try again.';
  if (err.code === 'ERR_COURSE_NOT_PUBLISHABLE') return err.message;
  return err.message || 'Could not publish this course — fix the listed issues and try again.';
}

/* ——— Create / edit course ——— */

function AddCourseDialog({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [nameEn, setNameEn] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [kind, setKind] = useState('standard');
  const [year, setYear] = useState(currentAcademicYear());
  const [cityId, setCityId] = useState(NO_CITY);

  const canMsv = user?.role === 'super_admin';

  useEffect(() => {
    if (!open) return;
    void apiGet<{ cities: GeoCity[] }>('/v1/admin/geography').then((r) => setCities(r?.cities ?? []));
    if (user?.role === 'city_admin' && user.city_id) setCityId(user.city_id);
  }, [open, user?.role, user?.city_id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameEn.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/courses', {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        kind,
        academic_year: year.trim() || null,
        city_id: cityId === NO_CITY ? null : cityId,
      });
      toast.success('Course draft created.');
      setOpen(false);
      setNameEn('');
      setNameHi('');
      setKind('standard');
      setYear(currentAcademicYear());
      setCityId(NO_CITY);
      onAdded();
    } catch (err) {
      toast.error(
        'Could not create the course — check the fields and try again.',
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
          <Plus className="mr-1 h-4 w-4" />
          New course
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create course</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Name (English) *">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </FormRow>
          <FormRow label="Name (Hindi)">
            <Input
              value={nameHi}
              onChange={(e) => setNameHi(e.target.value)}
              placeholder="Required before publish"
            />
          </FormRow>
          <FormRow label="Kind">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                {canMsv ? <SelectItem value="msv">MSV</SelectItem> : null}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Academic year">
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2025-26"
            />
          </FormRow>
          <FormRow label="City">
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger>
                <SelectValue placeholder="City" />
              </SelectTrigger>
              <SelectContent>
                {canMsv ? <SelectItem value={NO_CITY}>National (no city)</SelectItem> : null}
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !nameEn.trim()}>
              {busy ? 'Creating…' : 'Create draft'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditCourseMetaDialog({
  tree,
  onSaved,
}: {
  tree: CourseTree;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameEn, setNameEn] = useState(tree.course.name_en);
  const [nameHi, setNameHi] = useState(tree.course.name_hi ?? '');
  const [year, setYear] = useState(tree.course.academic_year ?? '');
  const [punya, setPunya] = useState(String(tree.course.punya_points));
  const [punyaTouched, setPunyaTouched] = useState(false);

  const livePrefill = coursePunyaPrefill(tree.sections.map((s) => s.punya_points));

  useEffect(() => {
    if (!open) return;
    setNameEn(tree.course.name_en);
    setNameHi(tree.course.name_hi ?? '');
    setYear(tree.course.academic_year ?? '');
    setPunya(String(tree.course.punya_points));
    setPunyaTouched(tree.course.punya_points !== 0);
  }, [open, tree]);

  useEffect(() => {
    if (!open || punyaTouched) return;
    setPunya(String(livePrefill));
  }, [open, livePrefill, punyaTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const points = Number(punya);
      await apiPatch(`/v1/admin/courses/${tree.course.id}`, {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        academic_year: year.trim() || null,
        punya_points: Number.isFinite(points) ? Math.max(0, Math.min(2000, Math.round(points))) : 0,
      });
      toast.success('Course updated.');
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(
        'Could not update the course — check the fields and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil className="mr-1 h-4 w-4" />
          Edit details
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit course</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Name (English) *">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </FormRow>
          <FormRow label="Name (Hindi)">
            <Input value={nameHi} onChange={(e) => setNameHi(e.target.value)} />
          </FormRow>
          <FormRow label="Academic year">
            <Input value={year} onChange={(e) => setYear(e.target.value)} />
          </FormRow>
          <FormRow label="Course Punya points">
            <Input
              type="number"
              min={0}
              max={2000}
              value={punya}
              onChange={(e) => {
                setPunyaTouched(true);
                setPunya(e.target.value);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Suggested (20% of section points): {livePrefill}. Zero means certificate only — no
              course-completion bonus.
            </p>
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !nameEn.trim()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ——— Section / subsection authoring ——— */

function SectionDialog({
  courseId,
  section,
  subsectionCount,
  onSaved,
  trigger,
}: {
  courseId: string;
  section?: TreeSection;
  subsectionCount: number;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [en, setEn] = useState(section?.title_en ?? '');
  const [hi, setHi] = useState(section?.title_hi ?? '');
  const prefill = sectionPunyaPrefill(subsectionCount);
  const [punya, setPunya] = useState(String(section?.punya_points ?? prefill));
  const [punyaTouched, setPunyaTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEn(section?.title_en ?? '');
    setHi(section?.title_hi ?? '');
    const existing = section?.punya_points;
    setPunyaTouched(existing != null && existing !== 0);
    setPunya(String(existing != null && existing !== 0 ? existing : prefill));
  }, [open, section, prefill]);

  useEffect(() => {
    if (!open || punyaTouched || section) return;
    setPunya(String(prefill));
  }, [open, prefill, punyaTouched, section]);

  // Live recalculation while authoring when the admin has not overwritten (CU22).
  useEffect(() => {
    if (!open || punyaTouched) return;
    setPunya(String(prefill));
  }, [open, prefill, punyaTouched]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    const points = Number(punya);
    if (!Number.isFinite(points) || points < 0) {
      toast.error(
        'Punya points must be a number from 0 to 1000 — enter a valid value and try again.',
      );
      return;
    }
    setBusy(true);
    try {
      const body = {
        title_en: en.trim(),
        title_hi: hi.trim(),
        punya_points: Math.max(0, Math.min(1000, Math.round(points))),
      };
      if (section) {
        await apiPatch(`/v1/courses/sections/${section.id}`, body);
        toast.success('Section updated.');
      } else {
        await apiPost(`/v1/courses/${courseId}/sections`, body);
        toast.success('Section added.');
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(
        'Could not save the section — check the titles and Punya points, then try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{section ? 'Edit section' : 'Add section'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={en} onChange={(e) => setEn(e.target.value)} required />
          </FormRow>
          <FormRow label="Title (Hindi) *">
            <Input value={hi} onChange={(e) => setHi(e.target.value)} required />
          </FormRow>
          <FormRow label="Punya points *">
            <Input
              type="number"
              min={0}
              max={1000}
              value={punya}
              onChange={(e) => {
                setPunyaTouched(true);
                setPunya(e.target.value);
              }}
              required
            />
            <p className="text-xs text-muted-foreground">
              Suggested (10 × subsections): {prefill}. Publish requires every section to be greater
              than 0.
            </p>
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !en.trim() || !hi.trim()}>
              {busy ? 'Saving…' : section ? 'Save' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubsectionDialog({
  sectionId,
  item,
  onSaved,
  trigger,
}: {
  sectionId: string;
  item?: TreeSubsection;
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [en, setEn] = useState(item?.title_en ?? '');
  const [hi, setHi] = useState(item?.title_hi ?? '');
  const [descEn, setDescEn] = useState(item?.description_en ?? '');
  const [descHi, setDescHi] = useState(item?.description_hi ?? '');

  useEffect(() => {
    if (open) {
      setEn(item?.title_en ?? '');
      setHi(item?.title_hi ?? '');
      setDescEn(item?.description_en ?? '');
      setDescHi(item?.description_hi ?? '');
    }
  }, [open, item]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    setBusy(true);
    const payload = {
      title_en: en.trim(),
      title_hi: hi.trim(),
      description_en: descEn.trim(),
      description_hi: descHi.trim(),
    };
    try {
      if (item) {
        await apiPatch(`/v1/courses/subsections/${item.id}`, payload);
        toast.success('Subsection updated.');
      } else {
        await apiPost(`/v1/courses/sections/${sectionId}/subsections`, payload);
        toast.success('Subsection added.');
      }
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(
        'Could not save the subsection — check both titles and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit subsection' : 'Add subsection'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={en} onChange={(e) => setEn(e.target.value)} required />
          </FormRow>
          <FormRow label="Title (Hindi) *">
            <Input value={hi} onChange={(e) => setHi(e.target.value)} required />
          </FormRow>
          <FormRow label="Content (English)">
            <Textarea
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="Learner-facing content for this subsection"
            />
          </FormRow>
          <FormRow label="Content (Hindi)">
            <Textarea
              value={descHi}
              onChange={(e) => setDescHi(e.target.value)}
              rows={4}
              maxLength={4000}
              placeholder="इस उप-अनुभाग की सामग्री"
            />
          </FormRow>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={busy || !en.trim() || !hi.trim()}>
              {busy ? 'Saving…' : item ? 'Save' : 'Add'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CourseTreeEditor({
  tree,
  reloadTree,
  onPublish,
  onArchive,
}: {
  tree: CourseTree;
  reloadTree: () => void;
  onPublish: () => void;
  onArchive: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const isDraft = tree.course.status === 'draft';
  const isActive = tree.course.status === 'active';

  async function deleteSection(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/courses/sections/${id}`);
      toast.success('Section deleted.');
      reloadTree();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'ERR_COURSE_NODE_HAS_CERTIFICATIONS'
          ? 'That section has certifications — archive the course instead of deleting it.'
          : 'Could not delete the section — try again, or archive the course if it has certifications.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteSubsection(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/courses/subsections/${id}`);
      toast.success('Subsection deleted.');
      reloadTree();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'ERR_COURSE_NODE_HAS_CERTIFICATIONS'
          ? 'That subsection has certifications — archive the course instead of deleting it.'
          : 'Could not delete the subsection — try again, or archive the course if it has certifications.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function moveSection(index: number, dir: -1 | 1) {
    const ids = tree.sections.map((s) => s.id);
    const j = index + dir;
    if (busy || j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    setBusy(true);
    try {
      await apiPost(`/v1/courses/${tree.course.id}/sections/reorder`, { section_ids: ids });
      reloadTree();
    } catch (err) {
      toast.error(
        'Could not reorder sections — refresh and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function moveSubsection(section: TreeSection, index: number, dir: -1 | 1) {
    const ids = section.subsections.map((i) => i.id);
    const j = index + dir;
    if (busy || j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    setBusy(true);
    try {
      await apiPost(`/v1/courses/sections/${section.id}/subsections/reorder`, {
        subsection_ids: ids,
      });
      reloadTree();
    } catch (err) {
      toast.error(
        'Could not reorder subsections — refresh and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-secondary">
            {tree.course.name_en}{' '}
            <Badge variant="secondary" className="ml-2 uppercase">
              {tree.course.kind}
            </Badge>{' '}
            {statusBadge(tree.course.status)}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {tree.course.name_hi ?? 'Hindi name missing'} ·{' '}
            {tree.course.academic_year ?? 'No academic year'} · Course Punya:{' '}
            {tree.course.punya_points}
            {tree.course.template_id ? ' · Derived from template' : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EditCourseMetaDialog tree={tree} onSaved={reloadTree} />
          {isDraft ? (
            <>
              <SectionDialog
                courseId={tree.course.id}
                subsectionCount={0}
                onSaved={reloadTree}
                trigger={
                  <Button size="sm">
                    <Plus className="mr-1 h-4 w-4" />
                    Add section
                  </Button>
                }
              />
              <Button size="sm" onClick={onPublish}>
                <Send className="mr-1 h-4 w-4" />
                Publish
              </Button>
            </>
          ) : null}
          {isActive ? (
            <Button size="sm" variant="outline" onClick={onArchive}>
              <Archive className="mr-1 h-4 w-4" />
              Archive
            </Button>
          ) : null}
        </div>
      </div>

      {tree.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sections yet. Add the first section to start building this course.
        </p>
      ) : (
        tree.sections.map((s, si) => (
          <div key={s.id} className="rounded-md border border-border/60">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1">
                {isDraft ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={busy || si === 0}
                      onClick={() => moveSection(si, -1)}
                      aria-label="Move section up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={busy || si === tree.sections.length - 1}
                      onClick={() => moveSection(si, 1)}
                      aria-label="Move section down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
                <span className="text-sm font-semibold">{s.title_en}</span>
                <span className="text-xs text-muted-foreground">{s.title_hi}</span>
                <Badge variant="outline" className="ml-2 text-xs">
                  {s.punya_points} Punya
                </Badge>
              </div>
              {isDraft ? (
                <div className="flex items-center gap-1">
                  <SectionDialog
                    courseId={tree.course.id}
                    section={s}
                    subsectionCount={s.subsections.length}
                    onSaved={reloadTree}
                    trigger={
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit section">
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    disabled={busy}
                    onClick={() => deleteSection(s.id)}
                    aria-label="Delete section"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
            <ul className="divide-y divide-border/40">
              {s.subsections.length === 0 ? (
                <li className="px-3 py-2 text-xs italic text-muted-foreground">
                  No subsections in this section.
                </li>
              ) : (
                s.subsections.map((it, ii) => (
                  <li key={it.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="flex items-center gap-1">
                      {isDraft ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={busy || ii === 0}
                            onClick={() => moveSubsection(s, ii, -1)}
                            aria-label="Move subsection up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={busy || ii === s.subsections.length - 1}
                            onClick={() => moveSubsection(s, ii, 1)}
                            aria-label="Move subsection down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : null}
                      <span className="text-sm">{it.title_en}</span>
                      <span className="text-xs text-muted-foreground">{it.title_hi}</span>
                    </div>
                    {isDraft ? (
                      <div className="flex items-center gap-1">
                        <SubsectionDialog
                          sectionId={s.id}
                          item={it}
                          onSaved={reloadTree}
                          trigger={
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              aria-label="Edit subsection"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          }
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive"
                          disabled={busy}
                          onClick={() => deleteSubsection(it.id)}
                          aria-label="Delete subsection"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            {isDraft ? (
              <div className="border-t border-border/40 px-3 py-2">
                <SubsectionDialog
                  sectionId={s.id}
                  onSaved={reloadTree}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Plus className="mr-1 h-4 w-4" />
                      Add subsection
                    </Button>
                  }
                />
              </div>
            ) : null}
          </div>
        ))
      )}
    </Card>
  );
}

/* ——— Templates (super_admin) ——— */

function TemplateTreeEditor({
  tree,
  reloadTree,
}: {
  tree: TemplateTree;
  reloadTree: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [en, setEn] = useState('');
  const [hi, setHi] = useState('');
  const [punya, setPunya] = useState('10');

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/course-templates/${tree.template.id}/sections`, {
        title_en: en.trim(),
        title_hi: hi.trim(),
        punya_points: Math.max(0, Math.min(1000, Number(punya) || 0)),
      });
      setEn('');
      setHi('');
      toast.success('Template section added.');
      reloadTree();
    } catch (err) {
      toast.error(
        'Could not add the template section — check titles and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function addSubsection(sectionId: string) {
    const titleEn = window.prompt('Subsection title (English)');
    if (!titleEn?.trim()) return;
    const titleHi = window.prompt('Subsection title (Hindi)');
    if (!titleHi?.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/course-template-sections/${sectionId}/subsections`, {
        title_en: titleEn.trim(),
        title_hi: titleHi.trim(),
      });
      toast.success('Template subsection added.');
      reloadTree();
    } catch (err) {
      toast.error(
        'Could not add the subsection — try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteSection(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/admin/course-template-sections/${id}`);
      toast.success('Template section deleted.');
      reloadTree();
    } catch (err) {
      toast.error(
        'Could not delete the template section — try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <h4 className="font-display text-base text-secondary">
        Template: {tree.template.name_en}
      </h4>
      <form className="flex flex-wrap items-end gap-2" onSubmit={addSection}>
        <div className="space-y-1">
          <Label className="text-xs">Section (English)</Label>
          <Input value={en} onChange={(e) => setEn(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Section (Hindi)</Label>
          <Input value={hi} onChange={(e) => setHi(e.target.value)} className="h-9 w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Punya</Label>
          <Input
            type="number"
            value={punya}
            onChange={(e) => setPunya(e.target.value)}
            className="h-9 w-20"
          />
        </div>
        <Button type="submit" size="sm" disabled={busy || !en.trim() || !hi.trim()}>
          Add section
        </Button>
      </form>
      {tree.sections.map((s) => (
        <div key={s.id} className="rounded-md border border-border/60 p-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-semibold">{s.title_en}</span>
              <span className="ml-2 text-xs text-muted-foreground">{s.title_hi}</span>
              <Badge variant="outline" className="ml-2">
                {s.punya_points} Punya
              </Badge>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => addSubsection(s.id)}>
                Add subsection
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                disabled={busy}
                onClick={() => deleteSection(s.id)}
                aria-label="Delete template section"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {s.subsections.map((sub) => (
              <li key={sub.id}>
                {sub.title_en} · {sub.title_hi}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}

function TemplatesPanel({ onDerived }: { onDerived: () => void }) {
  const { items, loading, error, reload } = useAdminList<TemplateRow>(
    '/v1/admin/course-templates',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tree, setTree] = useState<TemplateTree | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [kind, setKind] = useState('standard');
  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriveTpl, setDeriveTpl] = useState<TemplateRow | null>(null);
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [cityId, setCityId] = useState(NO_CITY);
  const [year, setYear] = useState(currentAcademicYear());
  const [busy, setBusy] = useState(false);

  async function loadTree(id: string) {
    setSelectedId(id);
    try {
      const data = await apiGet<TemplateTree>(`/v1/admin/course-templates/${id}/tree`);
      setTree(data);
    } catch (err) {
      setTree(null);
      toast.error(
        'Could not load the template tree — refresh and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    }
  }

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!nameEn.trim()) return;
    setBusy(true);
    try {
      await apiPost('/v1/admin/course-templates', {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        kind,
      });
      setNameEn('');
      setNameHi('');
      toast.success('Template created.');
      reload();
    } catch (err) {
      toast.error(
        'Could not create the template — check the name and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function derive() {
    if (!deriveTpl) return;
    setBusy(true);
    try {
      await apiPost(`/v1/admin/course-templates/${deriveTpl.id}/derive`, {
        city_id: cityId === NO_CITY ? null : cityId,
        academic_year: year.trim() || null,
      });
      toast.success('Course derived from template as a draft.');
      setDeriveOpen(false);
      onDerived();
    } catch (err) {
      toast.error(
        'Could not derive the course — check city and year, then try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!deriveOpen) return;
    void apiGet<{ cities: GeoCity[] }>('/v1/admin/geography').then((r) =>
      setCities(r?.cities ?? []),
    );
  }, [deriveOpen]);

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h3 className="font-display text-lg text-secondary">Course templates</h3>
        <p className="text-xs text-muted-foreground">
          Super_admin masters. Derive creates a one-time snapshot — later template edits do not
          change derived courses.
        </p>
      </div>
      {error ? <AdminError message={error} /> : null}
      <form className="flex flex-wrap items-end gap-2" onSubmit={createTemplate}>
        <div className="space-y-1">
          <Label className="text-xs">Name (English)</Label>
          <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} className="h-9 w-48" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Name (Hindi)</Label>
          <Input value={nameHi} onChange={(e) => setNameHi(e.target.value)} className="h-9 w-48" />
        </div>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="msv">MSV</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !nameEn.trim()}>
          New template
        </Button>
      </form>
      <AdminTable columns={['Name', 'Kind', '']} loading={loading} empty="" colSpan={3}>
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={3} message="No templates yet." />
        ) : null}
        {items.map((t) => (
          <tr key={t.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">
              {t.name_en}
              {t.name_hi ? (
                <span className="ml-2 text-xs text-muted-foreground">{t.name_hi}</span>
              ) : null}
            </td>
            <td className="px-4 py-3 text-xs uppercase">{t.kind}</td>
            <td className="px-4 py-3">
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={selectedId === t.id ? 'default' : 'outline'}
                  onClick={() => loadTree(t.id)}
                >
                  {selectedId === t.id ? 'Editing' : 'Edit'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDeriveTpl(t);
                    setDeriveOpen(true);
                  }}
                >
                  Derive course
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
      {tree ? (
        <TemplateTreeEditor
          tree={tree}
          reloadTree={() => {
            if (selectedId) void loadTree(selectedId);
          }}
        />
      ) : null}

      <AlertDialog open={deriveOpen} onOpenChange={setDeriveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Derive course from template</AlertDialogTitle>
            <AlertDialogDescription>
              Creates a draft copy of &ldquo;{deriveTpl?.name_en}&rdquo;. Later edits to the
              template will not change this course.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <FormRow label="City">
              <Select value={cityId} onValueChange={setCityId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CITY}>National (no city)</SelectItem>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Academic year">
              <Input value={year} onChange={(e) => setYear(e.target.value)} />
            </FormRow>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void derive();
              }}
              disabled={busy}
            >
              {busy ? 'Deriving…' : 'Derive draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ——— CU33 nudges ——— */

function CatalogueNudges({
  items,
  onArchive,
}: {
  items: CourseRow[];
  onArchive: (course: CourseRow) => void;
}) {
  const current = currentAcademicYear();
  const currentStart = academicYearStart(current);

  const stale = useMemo(
    () =>
      items.filter((c) => {
        if (c.status !== 'active') return false;
        const start = academicYearStart(c.academic_year);
        return start != null && currentStart != null && start < currentStart;
      }),
    [items, currentStart],
  );

  const activeByCity = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of items) {
      if (c.status !== 'active') continue;
      const key = c.city_id ?? '__national__';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].filter(([, n]) => n > 15);
  }, [items]);

  if (stale.length === 0 && activeByCity.length === 0) return null;

  return (
    <div className="space-y-3">
      {stale.length > 0 ? (
        <div className="rounded-md border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm font-medium text-foreground">
            Older academic years still active
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Current year is {current}. Archive courses students no longer need so the catalogue
            stays scannable.
          </p>
          <ul className="mt-3 space-y-2">
            {stale.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {c.name_en}{' '}
                  <span className="text-muted-foreground">
                    ({c.academic_year}
                    {c.city_name ? ` · ${c.city_name}` : ''})
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onArchive(c)}>
                  Archive
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {activeByCity.map(([cityKey, count]) => {
        const label =
          cityKey === '__national__'
            ? 'National'
            : (items.find((c) => c.city_id === cityKey)?.city_name ?? 'This city');
        return (
          <div
            key={cityKey}
            className="rounded-md border border-border bg-accent/40 px-4 py-3 text-sm"
          >
            <p className="font-medium text-accent-foreground">
              {label} has {count} active courses
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Past 15 active courses, consider archiving ones that are no longer taught this year.
            </p>
          </div>
        );
      })}
    </div>
  );
}

/* ——— Page ——— */

export default function CoursesAdminPage() {
  const { user } = useAuth();
  const { items, loading, error, reload } = useAdminList<CourseRow>('/v1/admin/courses');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<CourseRow | CourseTree['course'] | null>(
    null,
  );
  const [archiveCount, setArchiveCount] = useState<number | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const isSuper = user?.role === 'super_admin';

  async function loadTree(id: string) {
    setSelectedId(id);
    setTreeLoading(true);
    setTreeError(null);
    try {
      const data = await apiGet<CourseTree>(`/v1/admin/courses/${id}/tree`);
      setTree(data);
    } catch (err) {
      setTree(null);
      setTreeError(
        err instanceof ApiError
          ? err.message
          : 'Could not load the course tree — refresh and try again.',
      );
    } finally {
      setTreeLoading(false);
    }
  }

  function reloadTree() {
    if (selectedId) void loadTree(selectedId);
    reload();
  }

  async function publishSelected() {
    if (!tree || tree.course.status !== 'draft') return;
    try {
      await apiPost(`/v1/admin/courses/${tree.course.id}/publish`, {});
      toast.success('Course published.');
      reloadTree();
    } catch (err) {
      toast.error(publishErrorMessage(err));
    }
  }

  async function openArchive(course: CourseRow | CourseTree['course']) {
    setArchiveTarget(course);
    setArchiveCount(null);
    try {
      const impact = await apiGet<{ in_progress_uncertified_students: number }>(
        `/v1/admin/courses/${course.id}/archive-impact`,
      );
      setArchiveCount(impact.in_progress_uncertified_students ?? 0);
    } catch {
      setArchiveCount(0);
    }
  }

  async function confirmArchive() {
    if (!archiveTarget) return;
    setArchiveBusy(true);
    try {
      await apiPatch(`/v1/admin/courses/${archiveTarget.id}`, { status: 'archived' });
      toast.success('Course archived.');
      setArchiveTarget(null);
      reloadTree();
    } catch (err) {
      toast.error(
        'Could not archive the course — publish it first if it is still a draft, then try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setArchiveBusy(false);
    }
  }

  async function softDeleteDraft(id: string) {
    try {
      await apiDelete(`/v1/admin/courses/${id}`);
      toast.success('Draft deleted.');
      if (selectedId === id) {
        setSelectedId(null);
        setTree(null);
      }
      reload();
    } catch (err) {
      toast.error(
        'Could not delete the course — try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    }
  }

  return (
    <AdminPageShell
      title="Courses"
      subtitle="Author courses and templates, publish with the CU4 gate, and archive stale years."
      actions={<AddCourseDialog onAdded={reload} />}
    >
      {error ? <AdminError message={error} /> : null}

      <CatalogueNudges items={items} onArchive={(c) => void openArchive(c)} />

      <AdminTable
        columns={['Name', 'Kind', 'Year', 'Status', 'City', 'Sections', '']}
        loading={loading}
        empty=""
        colSpan={7}
      >
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={7} message="No courses in scope." />
        ) : null}
        {items.map((c) => (
          <tr
            key={c.id}
            className={`hover:bg-muted/30 ${selectedId === c.id ? 'bg-muted/40' : ''}`}
          >
            <td className="px-4 py-3 font-medium">
              {c.name_en}
              {c.name_hi ? (
                <div className="text-xs text-muted-foreground">{c.name_hi}</div>
              ) : (
                <div className="text-xs text-muted-foreground">Hindi name missing</div>
              )}
            </td>
            <td className="px-4 py-3 text-xs uppercase">{c.kind}</td>
            <td className="px-4 py-3 text-xs">{c.academic_year ?? '—'}</td>
            <td className="px-4 py-3">{statusBadge(c.status)}</td>
            <td className="px-4 py-3 text-xs">{c.city_name ?? 'National'}</td>
            <td className="px-4 py-3">{c.section_count}</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant={selectedId === c.id ? 'default' : 'outline'}
                  onClick={() => loadTree(c.id)}
                >
                  {selectedId === c.id ? 'Editing' : 'Edit'}
                </Button>
                {c.status === 'active' ? (
                  <Button size="sm" variant="outline" onClick={() => void openArchive(c)}>
                    Archive
                  </Button>
                ) : null}
                {c.status === 'draft' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => softDeleteDraft(c.id)}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>

      {treeError ? <AdminError message={treeError} /> : null}
      {treeLoading && !tree ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading course…</Card>
      ) : tree ? (
        <CourseTreeEditor
          tree={tree}
          reloadTree={reloadTree}
          onPublish={() => void publishSelected()}
          onArchive={() => void openArchive(tree.course)}
        />
      ) : null}

      {isSuper ? <TemplatesPanel onDerived={reload} /> : null}

      <AlertDialog
        open={!!archiveTarget}
        onOpenChange={(o) => {
          if (!o) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this course?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveCount == null
                ? 'Checking how many students still have work in progress…'
                : archiveCount === 0
                  ? `No students currently have in-progress, uncertified work on "${
                      'name_en' in (archiveTarget ?? {})
                        ? (archiveTarget as CourseRow).name_en
                        : ''
                    }". Archiving removes it from every student's active catalogue. Progress and certificates already earned stay intact.`
                  : `${archiveCount} student${archiveCount === 1 ? '' : 's'} currently ${
                      archiveCount === 1 ? 'has' : 'have'
                    } in-progress, uncertified work on "${
                      (archiveTarget as CourseRow | null)?.name_en ?? ''
                    }". Archiving removes the course from their catalogue mid-course — progress and certificates already earned stay intact, but they will not see it for new work.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmArchive();
              }}
              disabled={archiveBusy || archiveCount == null}
            >
              {archiveBusy ? 'Archiving…' : 'Archive course'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPageShell>
  );
}
