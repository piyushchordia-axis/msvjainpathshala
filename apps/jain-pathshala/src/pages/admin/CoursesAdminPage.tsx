/**
 * Course catalogue authoring (CU3–CU8, CU20, CU22, CU33).
 * Prefills for punya_points are UI-only (CU22); DB default stays 0.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Pencil,
  ChevronUp,
  ChevronDown,
  Archive,
  Send,
  ChevronLeft,
  CheckCircle2,
  Circle,
  AlertTriangle,
  Star,
  Settings,
} from 'lucide-react';
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
import { useLocale } from '@/lib/locale-context';
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

/** H16 — per-student progress read from GET /v1/courses/:id/tree?student_id=. */
interface StudentSubsectionProgress {
  id: string;
  title_en: string;
  title_hi: string;
  order_index: number;
  status: 'not_started' | 'in_progress' | 'completed';
  certified_at: string | null;
  certified_by: string | null;
  certified_by_gender: string | null;
}

interface TreeSectionProgress {
  id: string;
  title_en: string;
  title_hi: string;
  order_index: number;
  punya_points: number;
  status: 'not_started' | 'in_progress' | 'completed';
  certified_at: string | null;
  certified_by: string | null;
  certified_by_gender: string | null;
  // CU16 — both are surfaced; divergence is information, not an error.
  derived_status: 'not_started' | 'in_progress' | 'completed' | null;
  derived_leaf_total: number;
  derived_leaf_reached: number;
  derived_coverage: number | null;
  status_diverges: boolean;
  subsections: StudentSubsectionProgress[];
}

interface StudentCourseTree {
  course: {
    id: string;
    name_en: string;
    name_hi: string | null;
    kind: string;
    academic_year: string | null;
    punya_points: number;
  };
  sections: TreeSectionProgress[];
}

interface StudentOption {
  id: string;
  full_name: string | null;
  student_code: string;
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

/** M29 — 4-digit year, or a YYYY-YY academic year label. Blank is allowed (optional field). */
const ACADEMIC_YEAR_RE = /^\d{4}(-\d{2})?$/;

export function isValidAcademicYearInput(raw: string): boolean {
  const t = raw.trim();
  if (!t) return true;
  return ACADEMIC_YEAR_RE.test(t);
}

function academicYearErrorMessage(uiHi: boolean): string {
  return uiHi
    ? 'शैक्षणिक वर्ष 4 अंकों का वर्ष या YYYY-YY प्रारूप में होना चाहिए (जैसे 2025 या 2025-26) — सही करके फिर कोशिश करें।'
    : 'Academic year must be a 4-digit year or YYYY-YY (for example 2025 or 2025-26) — fix it and try again.';
}

/** M32 — at least one Devanagari codepoint is present; transliteration never passes. */
const DEVANAGARI_RE = /[ऀ-ॿ]/;

export function hasDevanagari(raw: string): boolean {
  return DEVANAGARI_RE.test(raw);
}

function devanagariErrorMessage(uiHi: boolean, fieldLabel: string): string {
  return uiHi
    ? `${fieldLabel} में देवनागरी लिपि होनी चाहिए, रोमन लिप्यंतरण मान्य नहीं है — देवनागरी में टाइप करें और फिर कोशिश करें।`
    : `${fieldLabel} must use Devanagari script, not a transliteration — type it in Hindi (Devanagari), then try again.`;
}

/**
 * M31 — `Number('')` is `0` in JS, so a blank Punya field silently saved as a
 * deliberate zero. This distinguishes "left blank" (null) from an explicit,
 * valid number, so callers can require the admin to type something.
 */
export function parsePunyaField(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function punyaEmptyErrorMessage(uiHi: boolean): string {
  return uiHi
    ? 'पुण्य अंक खाली नहीं छोड़ सकते — यदि कोई बोनस नहीं देना है तो 0 लिखें, अन्यथा एक मान्य संख्या लिखें, फिर कोशिश करें।'
    : 'Punya points cannot be left blank — enter 0 if there should be no bonus, or a valid number, then try again.';
}

/** L17-admin — bilingual labels instead of raw enum copy. */
function kindLabel(kind: string, uiHi: boolean): string {
  if (kind === 'msv') return 'MSV';
  if (kind === 'standard') return uiHi ? 'मानक' : 'Standard';
  return kind;
}

function courseStatusLabel(status: string, uiHi: boolean): string {
  if (status === 'draft') return uiHi ? 'प्रारूप' : 'Draft';
  if (status === 'active') return uiHi ? 'सक्रिय' : 'Active';
  if (status === 'archived') return uiHi ? 'संग्रहित' : 'Archived';
  return status;
}

/** CU11 progress-status label (three values only — 'mastered' is dead, CU11). */
function progressStatusLabel(
  status: 'not_started' | 'in_progress' | 'completed' | null | undefined,
  uiHi: boolean,
): string {
  if (status == null) return '—';
  if (status === 'not_started') return uiHi ? 'शुरू करना बाकी' : 'To be started';
  if (status === 'in_progress') return uiHi ? 'चल रहा है' : 'In progress';
  return uiHi ? 'पूर्ण' : 'Completed';
}

/** CU17 — three-branch honorific; NULL/other must not default to Guruji. */
function certifiedByLabel(gender: string | null | undefined, uiHi: boolean): string {
  if (gender === 'male') return uiHi ? 'गुरुजी द्वारा प्रमाणित' : 'Certified by Guruji';
  if (gender === 'female') return uiHi ? 'दीदी द्वारा प्रमाणित' : 'Certified by Didi';
  return uiHi ? 'प्रमाणित' : 'Certified';
}

/**
 * CU16 — a section carries a declared status AND a derived roll-up over its
 * sub-sections; divergence between them is information, never an error, and
 * is never auto-corrected. Mirrors the mobile divergenceNote helper so both
 * surfaces read the same five fields the same way.
 */
function divergenceNote(section: TreeSectionProgress, uiHi: boolean): string | null {
  if (!section.status_diverges || section.derived_status == null) return null;
  const declared = progressStatusLabel(section.status, uiHi);
  const derived = progressStatusLabel(section.derived_status, uiHi);
  const count = `${section.derived_leaf_reached}/${section.derived_leaf_total}`;
  return uiHi
    ? `घोषित: ${declared} · उप-अनुभागों से: ${derived} (${count})`
    : `Declared: ${declared} · from sub-sections: ${derived} (${count})`;
}

interface PunyaConfigRow {
  feature_key: string;
  points: number;
  is_active: boolean;
  city_id: string | null;
}

interface PunyaFeatureRow {
  key: string;
  min_points: number;
  max_points: number;
  is_active: boolean;
}

/**
 * CU22 — mirrors resolveCourseAwardPoints (apps/api-server/src/lib/course-points.ts)
 * exactly, using the same punya_configs/punya_features rows the server reads,
 * so the CU18 confirm can show the real clamped value instead of the raw
 * authored punya_points. A missing/inactive config awards 0 (H3), never an
 * unclamped multiply.
 */
export function resolveClampedCoursePoints(
  authoredPoints: number,
  featureKey: 'course_section_certified' | 'course_completed',
  cityId: string | null,
  configs: PunyaConfigRow[],
  features: PunyaFeatureRow[],
): number {
  if (authoredPoints <= 0) return 0;
  const feature = features.find((f) => f.key === featureKey && f.is_active);
  if (!feature) return 0;
  const cityConfig = cityId
    ? configs.find((c) => c.feature_key === featureKey && c.city_id === cityId && c.is_active)
    : undefined;
  const globalConfig = configs.find(
    (c) => c.feature_key === featureKey && c.city_id == null && c.is_active,
  );
  const multiplier = cityConfig?.points ?? globalConfig?.points ?? null;
  if (multiplier == null || multiplier <= 0) return 0;
  let points = Math.round((authoredPoints * multiplier) / 100);
  if (feature.min_points > 0 && points < feature.min_points) points = feature.min_points;
  if (feature.max_points > 0 && points > feature.max_points) points = feature.max_points;
  return Math.max(0, points);
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

function statusBadge(status: string, uiHi: boolean) {
  const variant =
    status === 'active' ? 'default' : status === 'draft' ? 'secondary' : 'outline';
  return <Badge variant={variant}>{courseStatusLabel(status, uiHi)}</Badge>;
}

function publishErrorMessage(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Could not publish this course — check your connection and try again.';
  if (err.code === 'ERR_COURSE_NOT_PUBLISHABLE') return err.message;
  return err.message || 'Could not publish this course — fix the listed issues and try again.';
}

/* ——— Create / edit course ——— */

function AddCourseDialog({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const uiHi = useLocale() === 'hi';
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
    // M32 — the Hindi name must be Devanagari, never a transliteration.
    if (nameHi.trim() && !hasDevanagari(nameHi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी नाम' : 'The Hindi name'));
      return;
    }
    // M29 — constrain to a parseable format so CU33's staleness nudge stays computable.
    if (!isValidAcademicYearInput(year)) {
      toast.error(academicYearErrorMessage(uiHi));
      return;
    }
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
                <SelectItem value="standard">{kindLabel('standard', uiHi)}</SelectItem>
                {canMsv ? <SelectItem value="msv">{kindLabel('msv', uiHi)}</SelectItem> : null}
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Academic year">
            <Input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2025-26"
              aria-label="Academic year"
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
  const uiHi = useLocale() === 'hi';
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
    if (nameHi.trim() && !hasDevanagari(nameHi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी नाम' : 'The Hindi name'));
      return;
    }
    if (!isValidAcademicYearInput(year)) {
      toast.error(academicYearErrorMessage(uiHi));
      return;
    }
    // M31 — Number('') is 0 in JS; a blank field must not silently save as a
    // deliberate zero (CU22 makes 0 mean "certificate, no bonus").
    const points = parsePunyaField(punya);
    if (points == null) {
      toast.error(punyaEmptyErrorMessage(uiHi));
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/v1/admin/courses/${tree.course.id}`, {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        academic_year: year.trim() || null,
        punya_points: Math.max(0, Math.min(2000, Math.round(points))),
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
  const uiHi = useLocale() === 'hi';
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

  // H11 — this is the ONE live-recalculation effect (CU22): while authoring
  // a NEW section (no `section` prop) and the admin has not overwritten the
  // suggestion, follow the prefill as subsectionCount changes. The `|| section`
  // guard is required — without it, re-opening the editor on an EXISTING
  // section re-runs this on mount and overwrites the authored Punya value
  // with the prefill before the admin touches anything. A second, unguarded
  // copy of this same effect used to exist here and always won that race.
  useEffect(() => {
    if (!open || punyaTouched || section) return;
    setPunya(String(prefill));
  }, [open, prefill, punyaTouched, section]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    if (!hasDevanagari(hi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी शीर्षक' : 'The Hindi title'));
      return;
    }
    const points = parsePunyaField(punya);
    if (points == null) {
      toast.error(punyaEmptyErrorMessage(uiHi));
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
  const uiHi = useLocale() === 'hi';
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
    if (!hasDevanagari(hi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी शीर्षक' : 'The Hindi title'));
      return;
    }
    setBusy(true);
    // L22 — write null, not '', when the admin leaves a description blank.
    // Explicit null (not an omitted key) so editing an existing subsection
    // can actually clear a previously-set description.
    const payload = {
      title_en: en.trim(),
      title_hi: hi.trim(),
      description_en: descEn.trim() ? descEn.trim() : null,
      description_hi: descHi.trim() ? descHi.trim() : null,
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

/** H14 — the same 4 preconditions publishCourse() checks server-side (course-admin.ts). */
type PublishCheck = { id: string; label: string; fix: string; ok: boolean };

function publishChecklist(tree: CourseTree, uiHi: boolean): PublishCheck[] {
  const hasNameHi = !!tree.course.name_hi?.trim();
  const hasYear = !!tree.course.academic_year?.trim();
  const hasSection = tree.sections.length > 0;
  const sectionsHavePunya = tree.sections.length > 0 && tree.sections.every((s) => s.punya_points > 0);
  return [
    {
      id: 'name_hi',
      label: uiHi ? 'हिंदी नाम सेट है' : 'Hindi name is set',
      fix: uiHi
        ? 'देवनागरी में हिंदी नाम जोड़ें, फिर फिर कोशिश करें।'
        : 'Add a Hindi name in Devanagari, then try again.',
      ok: hasNameHi,
    },
    {
      id: 'academic_year',
      label: uiHi ? 'शैक्षणिक वर्ष सेट है' : 'Academic year is set',
      fix: uiHi
        ? 'शैक्षणिक वर्ष सेट करें (जैसे 2025-26), फिर फिर कोशिश करें।'
        : 'Set the academic year (for example 2025-26), then try again.',
      ok: hasYear,
    },
    {
      id: 'sections',
      label: uiHi ? 'कम से कम एक अनुभाग मौजूद है' : 'At least one section exists',
      fix: uiHi ? 'कम से कम एक अनुभाग जोड़ें, फिर फिर कोशिश करें।' : 'Add at least one section, then try again.',
      ok: hasSection,
    },
    {
      id: 'section_punya',
      label: uiHi ? 'हर अनुभाग में 0 से अधिक पुण्य अंक हैं' : 'Every section has Punya points greater than 0',
      fix: uiHi
        ? 'हर अनुभाग में 0 से अधिक पुण्य अंक सेट करें, फिर फिर कोशिश करें।'
        : 'Set Punya points greater than 0 on every section, then try again.',
      ok: sectionsHavePunya,
    },
  ];
}

function CourseTreeEditor({
  tree,
  reloadTree,
  onPublish,
  publishing,
  onArchive,
  onClose,
}: {
  tree: CourseTree;
  reloadTree: () => void;
  onPublish: () => void;
  publishing: boolean;
  onArchive: () => void;
  onClose: () => void;
}) {
  const uiHi = useLocale() === 'hi';
  const [busy, setBusy] = useState(false);
  const isDraft = tree.course.status === 'draft';
  const isActive = tree.course.status === 'active';
  // M28 — CU25 permits editing an active course; CU20's certification guard
  // (server-enforced) is the real limit, not draft status. Only an archived
  // course's structure is read-only in this editor.
  const canEdit = tree.course.status !== 'archived';

  // H12 — delete a section/sub-section only after a named confirm.
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'section'; id: string; title: string; subsectionCount: number }
    | { kind: 'subsection'; id: string; title: string }
    | null
  >(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const checklist = useMemo(() => publishChecklist(tree, uiHi), [tree, uiHi]);
  const canPublish = checklist.every((c) => c.ok);

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      if (deleteTarget.kind === 'section') {
        await apiDelete(`/v1/courses/sections/${deleteTarget.id}`);
        toast.success('Section deleted.');
      } else {
        await apiDelete(`/v1/courses/subsections/${deleteTarget.id}`);
        toast.success('Subsection deleted.');
      }
      setDeleteTarget(null);
      reloadTree();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.code === 'ERR_COURSE_NODE_HAS_CERTIFICATIONS'
          ? `That ${deleteTarget.kind} has certifications — archive the course instead of deleting it.`
          : `Could not delete the ${deleteTarget.kind} — try again, or archive the course if it has certifications.`,
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setDeleteBusy(false);
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
          <Button type="button" size="sm" variant="outline" onClick={onClose} className="mb-3">
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to courses
          </Button>
          <h3 className="font-display text-lg text-secondary">
            {tree.course.name_en}{' '}
            <Badge variant="secondary" className="ml-2">
              {kindLabel(tree.course.kind, uiHi)}
            </Badge>{' '}
            {statusBadge(tree.course.status, uiHi)}
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
          {canEdit ? (
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
          ) : null}
          {isDraft ? (
            <Button
              size="sm"
              onClick={onPublish}
              disabled={publishing || !canPublish}
              aria-disabled={publishing || !canPublish}
            >
              <Send className="mr-1 h-4 w-4" />
              {publishing ? (uiHi ? 'प्रकाशित हो रहा है…' : 'Publishing…') : uiHi ? 'प्रकाशित करें' : 'Publish'}
            </Button>
          ) : null}
          {isActive ? (
            <Button size="sm" variant="outline" onClick={onArchive}>
              <Archive className="mr-1 h-4 w-4" />
              {uiHi ? 'संग्रहित करें' : 'Archive'}
            </Button>
          ) : null}
        </div>
      </div>

      {/* H14 — the server's {reasons, fixes} publish-gate payload, rendered as
          a standing checklist computed locally from `tree` instead of a
          single concatenated toast discovered only by failing. */}
      {isDraft ? (
        <div
          className="rounded-md border border-border bg-muted/30 p-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-xs font-medium text-foreground">
            {uiHi ? 'प्रकाशन आवश्यकताएँ' : 'Publish requirements'}
          </p>
          <ul className="mt-2 space-y-1">
            {checklist.map((c) => (
              <li key={c.id} className="flex items-start gap-2 text-xs">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className={c.ok ? 'text-muted-foreground' : 'text-foreground'}>
                  {c.label}
                  {!c.ok ? <span className="text-muted-foreground"> — {c.fix}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {tree.sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sections yet. Add the first section to start building this course.
        </p>
      ) : (
        tree.sections.map((s, si) => (
          <div key={s.id} className="rounded-md border border-border/60">
            <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-1">
                {canEdit ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={busy || si === 0}
                      onClick={() => moveSection(si, -1)}
                      aria-label={`Move "${s.title_en}" section up`}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      disabled={busy || si === tree.sections.length - 1}
                      onClick={() => moveSection(si, 1)}
                      aria-label={`Move "${s.title_en}" section down`}
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
              {canEdit ? (
                <div className="flex items-center gap-1">
                  <SectionDialog
                    courseId={tree.course.id}
                    section={s}
                    subsectionCount={s.subsections.length}
                    onSaved={reloadTree}
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label={`Edit "${s.title_en}" section`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    }
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive"
                    disabled={busy}
                    onClick={() =>
                      setDeleteTarget({
                        kind: 'section',
                        id: s.id,
                        title: s.title_en,
                        subsectionCount: s.subsections.length,
                      })
                    }
                    aria-label={`Delete "${s.title_en}" section`}
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
                      {canEdit ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={busy || ii === 0}
                            onClick={() => moveSubsection(s, ii, -1)}
                            aria-label={`Move "${it.title_en}" subsection up`}
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            disabled={busy || ii === s.subsections.length - 1}
                            onClick={() => moveSubsection(s, ii, 1)}
                            aria-label={`Move "${it.title_en}" subsection down`}
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : null}
                      <span className="text-sm">{it.title_en}</span>
                      <span className="text-xs text-muted-foreground">{it.title_hi}</span>
                    </div>
                    {canEdit ? (
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
                              aria-label={`Edit "${it.title_en}" subsection`}
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
                          onClick={() =>
                            setDeleteTarget({ kind: 'subsection', id: it.id, title: it.title_en })
                          }
                          aria-label={`Delete "${it.title_en}" subsection`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            {canEdit ? (
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

      {/* H16 — certify a specific student's progress + the CU16 divergence
          indicator, on the same surface the section/sub-section authoring
          lives on. Certify write access requires a live course (H2), so this
          only makes sense once the course is active. */}
      {isActive ? <CertifyPanel course={tree.course} /> : null}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === 'section' ? 'Delete this section?' : 'Delete this subsection?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === 'section'
                ? `"${deleteTarget.title}" and its ${deleteTarget.subsectionCount} subsection${
                    deleteTarget.subsectionCount === 1 ? '' : 's'
                  } will be removed. Any student's in-progress, uncertified work on them goes with it. This cannot be undone from here.`
                : deleteTarget
                  ? `"${deleteTarget.title}" will be removed. Any student's in-progress, uncertified work on it goes with it. This cannot be undone from here.`
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleteBusy}
            >
              {deleteBusy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ——— H16 — certify a student on this course, with the CU16 divergence panel ——— */

type CertifyTarget = {
  nodeId: string;
  nodeKind: 'section' | 'subsection';
  title: string;
  punya: number;
};

function CertifyPanel({ course }: { course: CourseTree['course'] }) {
  const uiHi = useLocale() === 'hi';
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [selected, setSelected] = useState<StudentOption | null>(null);
  const [progressTree, setProgressTree] = useState<StudentCourseTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pointsConfig, setPointsConfig] = useState<
    { configs: PunyaConfigRow[]; features: PunyaFeatureRow[] } | null
  >(null);
  const [certifyTarget, setCertifyTarget] = useState<CertifyTarget | null>(null);
  const [certifyBusy, setCertifyBusy] = useState(false);

  // Server-side ?q= search, debounced — mirrors PunyaAwardPage's student
  // picker. Only runs while nothing is selected (the picker is hidden once a
  // student is chosen).
  useEffect(() => {
    if (selected) return;
    const q = query.trim();
    const t = window.setTimeout(() => {
      const url = q
        ? `/v1/admin/students?limit=20&q=${encodeURIComponent(q)}`
        : '/v1/admin/students?limit=20';
      void apiGet<{ items: StudentOption[] }>(url)
        .then((r) => setStudents(r?.items ?? []))
        .catch(() => setStudents([]));
    }, 300);
    return () => window.clearTimeout(t);
  }, [query, selected]);

  async function loadStudentTree(studentId: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<StudentCourseTree>(
        `/v1/courses/${course.id}/tree?student_id=${studentId}`,
      );
      setProgressTree(data);
    } catch (err) {
      setProgressTree(null);
      setLoadError(
        err instanceof ApiError
          ? err.message
          : uiHi
            ? 'इस विद्यार्थी की प्रगति लोड नहीं हो सकी — फिर कोशिश करें।'
            : 'Could not load this student’s progress — try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  function pickStudent(s: StudentOption) {
    setSelected(s);
    setQuery('');
    void loadStudentTree(s.id);
  }

  function clearStudent() {
    setSelected(null);
    setProgressTree(null);
    setLoadError(null);
  }

  async function ensurePointsConfig() {
    if (pointsConfig) return pointsConfig;
    const [configsRes, featuresRes] = await Promise.all([
      apiGet<{ items: PunyaConfigRow[] }>('/v1/admin/punya/configs').catch(() => ({ items: [] })),
      apiGet<{ items: PunyaFeatureRow[] }>('/v1/admin/punya/features').catch(() => ({ items: [] })),
    ]);
    const next = { configs: configsRes?.items ?? [], features: featuresRes?.items ?? [] };
    setPointsConfig(next);
    return next;
  }

  async function openCertify(
    nodeKind: 'section' | 'subsection',
    nodeId: string,
    title: string,
    authoredPoints: number,
  ) {
    // CU21 — sub-section certifications never carry Punya (recognition
    // without currency); only a section award needs the clamped lookup.
    let clamped = 0;
    if (nodeKind === 'section') {
      const cfg = await ensurePointsConfig();
      clamped = resolveClampedCoursePoints(
        authoredPoints,
        'course_section_certified',
        course.city_id,
        cfg.configs,
        cfg.features,
      );
    }
    setCertifyTarget({ nodeId, nodeKind, title, punya: clamped });
  }

  async function confirmCertify() {
    if (!certifyTarget || !selected) return;
    setCertifyBusy(true);
    try {
      await apiPost(`/v1/courses/nodes/${certifyTarget.nodeId}/certify`, {
        student_id: selected.id,
      });
      toast.success(uiHi ? 'प्रमाणित किया गया।' : 'Certified.');
      setCertifyTarget(null);
      await loadStudentTree(selected.id);
    } catch (err) {
      toast.error(
        uiHi ? 'प्रमाणित नहीं किया जा सका।' : 'Could not certify — try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setCertifyBusy(false);
    }
  }

  const divergentCount = (progressTree?.sections ?? []).filter((s) => s.status_diverges).length;

  return (
    <div className="space-y-3 border-t border-border/60 pt-5">
      <div>
        <h4 className="font-display text-base text-secondary">
          {uiHi ? 'विद्यार्थी की प्रगति प्रमाणित करें' : 'Certify a student’s progress'}
        </h4>
        <p className="text-xs text-muted-foreground">
          {uiHi
            ? 'एक विद्यार्थी चुनें ताकि उनकी अनुभाग-दर-अनुभाग प्रगति देख सकें और पूर्ण किए गए काम को प्रमाणित कर सकें।'
            : 'Pick a student to see their section-by-section progress and certify completed work.'}
        </p>
      </div>

      {selected ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>
            {selected.full_name ?? 'Unnamed'} — {selected.student_code}
          </span>
          <Button type="button" size="sm" variant="ghost" onClick={clearStudent}>
            {uiHi ? 'बदलें' : 'Change'}
          </Button>
        </div>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={uiHi ? 'नाम या विद्यार्थी कोड से खोजें' : 'Search by name or student code'}
            aria-label={uiHi ? 'विद्यार्थी खोजें' : 'Search for a student to certify'}
          />
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {students.map((s) => (
              <button
                key={s.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-left text-sm hover:border-primary/40"
                onClick={() => pickStudent(s)}
              >
                <span>
                  {s.full_name ?? 'Unnamed'} — {s.student_code}
                </span>
              </button>
            ))}
            {students.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {uiHi ? 'कोई विद्यार्थी नहीं मिला।' : 'No students match this search.'}
              </p>
            ) : null}
          </div>
        </>
      )}

      {selected && loading ? (
        <p className="text-sm text-muted-foreground">
          {uiHi ? 'प्रगति लोड हो रही है…' : 'Loading progress…'}
        </p>
      ) : null}

      {selected && loadError ? <AdminError message={loadError} /> : null}

      {selected && progressTree ? (
        <div className="space-y-3">
          {divergentCount > 0 ? (
            <div
              className="flex items-start gap-2 rounded-md border border-border bg-amber-50 px-3 py-2 text-xs dark:bg-amber-950/30"
              role="status"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              <span>
                {uiHi
                  ? `${divergentCount} अनुभाग — घोषित और उप-अनुभागों से निकली प्रगति में अंतर है (जानकारी है, त्रुटि नहीं)।`
                  : `${divergentCount} section${divergentCount === 1 ? '' : 's'} where declared status and the roll-up from sub-sections differ — this is information, not an error.`}
              </span>
            </div>
          ) : null}

          {progressTree.sections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {uiHi ? 'इस पाठ्यक्रम में अभी कोई अनुभाग नहीं।' : 'No sections in this course yet.'}
            </p>
          ) : (
            progressTree.sections.map((s) => {
              const canCertifySection = s.status === 'completed' && !s.certified_at;
              const note = divergenceNote(s, uiHi);
              return (
                <div key={s.id} className="rounded-md border border-border/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">
                          {uiHi ? s.title_hi || s.title_en : s.title_en}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {progressStatusLabel(s.status, uiHi)}
                        </Badge>
                        {s.certified_at ? (
                          <Badge className="text-xs">{certifiedByLabel(s.certified_by_gender, uiHi)}</Badge>
                        ) : null}
                      </div>
                      {note ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-amber-700 dark:text-amber-500">
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                          {note}
                        </p>
                      ) : null}
                    </div>
                    {canCertifySection ? (
                      <Button
                        size="sm"
                        onClick={() => void openCertify('section', s.id, s.title_en, s.punya_points)}
                        aria-label={`Certify "${s.title_en}"`}
                      >
                        <Star className="mr-1 h-3.5 w-3.5" />
                        {uiHi ? 'प्रमाणित करें' : 'Certify'}
                      </Button>
                    ) : null}
                  </div>
                  {s.subsections.length > 0 ? (
                    <ul className="mt-2 space-y-1 divide-y divide-border/40 border-t border-border/40 pt-2">
                      {s.subsections.map((sub) => {
                        const canCertifySub = sub.status === 'completed' && !sub.certified_at;
                        return (
                          <li
                            key={sub.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-xs">
                                {uiHi ? sub.title_hi || sub.title_en : sub.title_en}
                              </span>
                              <Badge variant="outline" className="text-[10px]">
                                {progressStatusLabel(sub.status, uiHi)}
                              </Badge>
                              {sub.certified_at ? (
                                <Badge className="text-[10px]">
                                  {certifiedByLabel(sub.certified_by_gender, uiHi)}
                                </Badge>
                              ) : null}
                            </div>
                            {canCertifySub ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void openCertify('subsection', sub.id, sub.title_en, 0)}
                                aria-label={`Certify "${sub.title_en}"`}
                              >
                                <Star className="mr-1 h-3.5 w-3.5" />
                                {uiHi ? 'प्रमाणित करें' : 'Certify'}
                              </Button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}

      {/* H16/CU18 — irreversible; states the student, the node and the real
          CLAMPED Punya value the server will award (0 for a subsection). */}
      <AlertDialog
        open={!!certifyTarget}
        onOpenChange={(o) => {
          if (!o && !certifyBusy) setCertifyTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{uiHi ? 'इस नोड को प्रमाणित करें?' : 'Certify this node?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {certifyTarget && selected
                ? certifyTarget.nodeKind === 'section'
                  ? uiHi
                    ? `आप ${selected.full_name ?? selected.student_code} को «${certifyTarget.title}» पर ${certifyTarget.punya} पुण्य के लिए प्रमाणित करने जा रहे हैं। प्रमाणन अपरिवर्तनीय है।`
                    : `You are about to certify ${selected.full_name ?? selected.student_code} on “${certifyTarget.title}” for ${certifyTarget.punya} Punya. Certification is irreversible.`
                  : uiHi
                    ? `आप ${selected.full_name ?? selected.student_code} को «${certifyTarget.title}» पर प्रमाणित करने जा रहे हैं (उप-अनुभाग — कोई पुण्य नहीं)। प्रमाणन अपरिवर्तनीय है।`
                    : `You are about to certify ${selected.full_name ?? selected.student_code} on “${certifyTarget.title}” (subsection — no Punya award). Certification is irreversible.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={certifyBusy}>{uiHi ? 'रद्द करें' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmCertify();
              }}
              disabled={certifyBusy}
            >
              {certifyBusy ? (uiHi ? 'प्रमाणित हो रहा है…' : 'Certifying…') : uiHi ? 'प्रमाणित करें' : 'Certify'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ——— Templates (super_admin) ——— */

/** M30 — SubsectionDialog-pattern UI for a template subsection, replacing window.prompt. */
function TemplateSubsectionDialog({
  sectionId,
  item,
  onSaved,
  trigger,
}: {
  sectionId: string;
  item?: { id: string; title_en: string; title_hi: string };
  onSaved: () => void;
  trigger: React.ReactNode;
}) {
  const uiHi = useLocale() === 'hi';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [en, setEn] = useState(item?.title_en ?? '');
  const [hi, setHi] = useState(item?.title_hi ?? '');

  useEffect(() => {
    if (!open) return;
    setEn(item?.title_en ?? '');
    setHi(item?.title_hi ?? '');
  }, [open, item]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    if (!hasDevanagari(hi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी शीर्षक' : 'The Hindi title'));
      return;
    }
    setBusy(true);
    try {
      if (item) {
        await apiPatch(`/v1/admin/course-template-subsections/${item.id}`, {
          title_en: en.trim(),
          title_hi: hi.trim(),
        });
        toast.success('Template subsection updated.');
      } else {
        await apiPost(`/v1/admin/course-template-sections/${sectionId}/subsections`, {
          title_en: en.trim(),
          title_hi: hi.trim(),
        });
        toast.success('Template subsection added.');
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit template subsection' : 'Add template subsection'}</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={en} onChange={(e) => setEn(e.target.value)} required />
          </FormRow>
          <FormRow label="Title (Hindi) *">
            <Input value={hi} onChange={(e) => setHi(e.target.value)} required />
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

function TemplateTreeEditor({
  tree,
  reloadTree,
}: {
  tree: TemplateTree;
  reloadTree: () => void;
}) {
  const uiHi = useLocale() === 'hi';
  const [busy, setBusy] = useState(false);
  const [en, setEn] = useState('');
  const [hi, setHi] = useState('');
  const [punya, setPunya] = useState('10');
  const [deleteSub, setDeleteSub] = useState<{ id: string; title: string } | null>(null);

  async function addSection(e: React.FormEvent) {
    e.preventDefault();
    if (!en.trim() || !hi.trim()) return;
    if (!hasDevanagari(hi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी शीर्षक' : 'The Hindi title'));
      return;
    }
    const points = parsePunyaField(punya);
    if (points == null) {
      toast.error(punyaEmptyErrorMessage(uiHi));
      return;
    }
    setBusy(true);
    try {
      await apiPost(`/v1/admin/course-templates/${tree.template.id}/sections`, {
        title_en: en.trim(),
        title_hi: hi.trim(),
        punya_points: Math.max(0, Math.min(1000, Math.round(points))),
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

  async function confirmDeleteSub() {
    if (!deleteSub) return;
    setBusy(true);
    try {
      await apiDelete(`/v1/admin/course-template-subsections/${deleteSub.id}`);
      toast.success('Template subsection deleted.');
      setDeleteSub(null);
      reloadTree();
    } catch (err) {
      toast.error(
        'Could not delete the subsection — try again.',
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
              <TemplateSubsectionDialog
                sectionId={s.id}
                onSaved={reloadTree}
                trigger={
                  <Button size="sm" variant="outline" disabled={busy}>
                    Add subsection
                  </Button>
                }
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-destructive"
                disabled={busy}
                onClick={() => deleteSection(s.id)}
                aria-label={`Delete "${s.title_en}" template section`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <ul className="mt-2 space-y-1">
            {s.subsections.map((sub) => (
              <li
                key={sub.id}
                className="flex items-center justify-between gap-2 text-sm text-muted-foreground"
              >
                <span>
                  {sub.title_en} · {sub.title_hi}
                </span>
                <span className="flex items-center gap-1">
                  <TemplateSubsectionDialog
                    sectionId={s.id}
                    item={sub}
                    onSaved={reloadTree}
                    trigger={
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        aria-label={`Edit "${sub.title_en}" template subsection`}
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
                    onClick={() => setDeleteSub({ id: sub.id, title: sub.title_en })}
                    aria-label={`Delete "${sub.title_en}" template subsection`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <AlertDialog
        open={!!deleteSub}
        onOpenChange={(o) => {
          if (!o) setDeleteSub(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this template subsection?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${deleteSub?.title ?? ''}" will be removed from this template. This cannot be undone from here, and it never affects courses already derived from this template.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteSub();
              }}
              disabled={busy}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;

/** Locked age-group names (CLAUDE.md "Age group colours"). */
function ageGroupLabel(group: string, uiHi: boolean): string {
  if (group === 'bal') return uiHi ? 'बाल' : 'Bal';
  if (group === 'kishor') return uiHi ? 'किशोर' : 'Kishor';
  if (group === 'tarun') return uiHi ? 'तरुण' : 'Tarun';
  if (group === 'yuva') return uiHi ? 'युवा' : 'Yuva';
  return group;
}

/** M30 — proper dialog UI for template rename/delete, replacing the unreachable state. */
function TemplateMetaDialog({
  template,
  onSaved,
  onDeleted,
  trigger,
}: {
  template: TemplateRow;
  onSaved: () => void;
  onDeleted: () => void;
  trigger: React.ReactNode;
}) {
  const uiHi = useLocale() === 'hi';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameEn, setNameEn] = useState(template.name_en);
  const [nameHi, setNameHi] = useState(template.name_hi ?? '');
  const [kind, setKind] = useState(template.kind);
  const [ageGroup, setAgeGroup] = useState(template.age_group ?? NO_CITY);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNameEn(template.name_en);
    setNameHi(template.name_hi ?? '');
    setKind(template.kind);
    setAgeGroup(template.age_group ?? NO_CITY);
  }, [open, template]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!nameEn.trim()) return;
    if (nameHi.trim() && !hasDevanagari(nameHi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी नाम' : 'The Hindi name'));
      return;
    }
    setBusy(true);
    try {
      await apiPatch(`/v1/admin/course-templates/${template.id}`, {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        kind,
        age_group: ageGroup === NO_CITY ? null : ageGroup,
      });
      toast.success('Template updated.');
      setOpen(false);
      onSaved();
    } catch (err) {
      toast.error(
        'Could not update the template — check the fields and try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    setBusy(true);
    try {
      await apiDelete(`/v1/admin/course-templates/${template.id}`);
      toast.success('Template deleted.');
      setDeleteOpen(false);
      setOpen(false);
      onDeleted();
    } catch (err) {
      toast.error(
        'Could not delete the template — try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit template</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Name (English) *">
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} required />
          </FormRow>
          <FormRow label="Name (Hindi)">
            <Input value={nameHi} onChange={(e) => setNameHi(e.target.value)} />
          </FormRow>
          <FormRow label="Kind">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{kindLabel('standard', uiHi)}</SelectItem>
                <SelectItem value="msv">{kindLabel('msv', uiHi)}</SelectItem>
              </SelectContent>
            </Select>
          </FormRow>
          <FormRow label="Age group">
            <Select value={ageGroup} onValueChange={setAgeGroup}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CITY}>{uiHi ? 'कोई नहीं' : 'None'}</SelectItem>
                {AGE_GROUPS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {ageGroupLabel(g, uiHi)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {uiHi
                ? 'केवल संदर्भ के लिए — यह किसी भी दृश्यता को फ़िल्टर नहीं करता (CU3)।'
                : 'Authoring metadata only — never filters visibility (CU3).'}
            </p>
          </FormRow>
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              Delete template
            </Button>
            <div className="flex gap-2">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={busy || !nameEn.trim()}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this template?</AlertDialogTitle>
          <AlertDialogDescription>
            {`"${template.name_en}" will be removed. This cannot be undone from here, and it never affects courses already derived from this template.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
            disabled={busy}
          >
            {busy ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function TemplatesPanel({ onDerived }: { onDerived: () => void }) {
  const uiHi = useLocale() === 'hi';
  const { items, loading, error, reload } = useAdminList<TemplateRow>(
    '/v1/admin/course-templates',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tree, setTree] = useState<TemplateTree | null>(null);
  const [nameEn, setNameEn] = useState('');
  const [nameHi, setNameHi] = useState('');
  const [kind, setKind] = useState('standard');
  const [ageGroup, setAgeGroup] = useState(NO_CITY);
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
    if (nameHi.trim() && !hasDevanagari(nameHi)) {
      toast.error(devanagariErrorMessage(uiHi, uiHi ? 'हिंदी नाम' : 'The Hindi name'));
      return;
    }
    setBusy(true);
    try {
      await apiPost('/v1/admin/course-templates', {
        name_en: nameEn.trim(),
        name_hi: nameHi.trim() || null,
        kind,
        age_group: ageGroup === NO_CITY ? null : ageGroup,
      });
      setNameEn('');
      setNameHi('');
      setAgeGroup(NO_CITY);
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
    if (!isValidAcademicYearInput(year)) {
      toast.error(academicYearErrorMessage(uiHi));
      return;
    }
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
          {uiHi
            ? 'केवल super_admin टेम्पलेट बना या बदल सकता है। Derive एक बार का स्नैपशॉट बनाता है — बाद में टेम्पलेट में किए गए बदलाव पहले से बने पाठ्यक्रमों को प्रभावित नहीं करते।'
            : 'Only a super_admin can create or edit templates. Derive creates a one-time snapshot — later template edits never change courses already derived from it.'}
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
            <SelectItem value="standard">{kindLabel('standard', uiHi)}</SelectItem>
            <SelectItem value="msv">{kindLabel('msv', uiHi)}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={ageGroup} onValueChange={setAgeGroup}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue placeholder={uiHi ? 'आयु वर्ग' : 'Age group'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CITY}>{uiHi ? 'कोई नहीं' : 'None'}</SelectItem>
            {AGE_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {ageGroupLabel(g, uiHi)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" size="sm" disabled={busy || !nameEn.trim()}>
          New template
        </Button>
      </form>
      <AdminTable columns={['Name', 'Kind', 'Age group', '']} loading={loading} empty="" colSpan={4}>
        {items.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={4} message="No templates yet." />
        ) : null}
        {items.map((t) => (
          <tr key={t.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">
              {t.name_en}
              {t.name_hi ? (
                <span className="ml-2 text-xs text-muted-foreground">{t.name_hi}</span>
              ) : null}
            </td>
            <td className="px-4 py-3 text-xs">{kindLabel(t.kind, uiHi)}</td>
            <td className="px-4 py-3 text-xs">{t.age_group ? ageGroupLabel(t.age_group, uiHi) : '—'}</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={selectedId === t.id ? 'default' : 'outline'}
                  aria-pressed={selectedId === t.id}
                  onClick={() => loadTree(t.id)}
                >
                  {selectedId === t.id ? 'Editing' : 'Edit'}
                </Button>
                <TemplateMetaDialog
                  template={t}
                  onSaved={reload}
                  onDeleted={() => {
                    if (selectedId === t.id) {
                      setSelectedId(null);
                      setTree(null);
                    }
                    reload();
                  }}
                  trigger={
                    <Button size="icon" variant="ghost" aria-label={`Rename or delete "${t.name_en}"`}>
                      <Settings className="h-4 w-4" />
                    </Button>
                  }
                />
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
              <Input
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="e.g. 2025-26"
                aria-label="Academic year"
              />
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

  // L24 — a national course (city_id null) is visible in EVERY city's own
  // catalogue (CU3), so it must count toward EVERY city's ">15 active"
  // total, not sit in a separate national-only bucket that never crosses the
  // threshold on its own. `items` is already scoped to the caller's own role
  // (a city_admin only ever sees their city + national), so for each city
  // actually present the relevant count is "that city's own + national".
  const activeByCity = useMemo(() => {
    const active = items.filter((c) => c.status === 'active');
    const nationalCount = active.filter((c) => c.city_id == null).length;
    const perCity = new Map<string, { count: number; name: string }>();
    for (const c of active) {
      if (c.city_id == null) continue;
      const existing = perCity.get(c.city_id);
      perCity.set(c.city_id, {
        count: (existing?.count ?? 0) + 1,
        name: existing?.name ?? c.city_name ?? 'This city',
      });
    }
    const rows: Array<{ key: string; label: string; count: number }> = [];
    if (perCity.size === 0) {
      if (nationalCount > 15) rows.push({ key: '__national__', label: 'National', count: nationalCount });
    } else {
      for (const [cityId, { count, name }] of perCity) {
        const total = count + nationalCount;
        if (total > 15) rows.push({ key: cityId, label: name, count: total });
      }
    }
    return rows;
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onArchive(c)}
                  aria-label={`Archive "${c.name_en}" (${c.academic_year ?? 'no academic year'})`}
                >
                  Archive
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {activeByCity.map((row) => (
        <div key={row.key} className="rounded-md border border-border bg-accent/40 px-4 py-3 text-sm">
          <p className="font-medium text-accent-foreground">
            {row.label} has {row.count} active courses
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Past 15 active courses, consider archiving ones that are no longer taught this year.
          </p>
        </div>
      ))}
    </div>
  );
}

/* ——— Page ——— */

const STATUS_FILTERS = ['all', 'draft', 'active', 'archived'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default function CoursesAdminPage() {
  const { user } = useAuth();
  const uiHi = useLocale() === 'hi';
  // L29 — a status filter (minimum viable pagination aid) on an admin course
  // list that has no server-side LIMIT — narrowing by status is the cheapest
  // way to keep a 300-row catalogue scannable without a bigger pagination pass.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const coursesPath =
    statusFilter === 'all' ? '/v1/admin/courses' : `/v1/admin/courses?status=${statusFilter}`;
  const { items, loading, error, reload } = useAdminList<CourseRow>(coursesPath, [statusFilter]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tree, setTree] = useState<CourseTree | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  // L23 — in-flight guard so a double-click on Publish can't show success
  // then an error from the second, now-invalid request.
  const [publishing, setPublishing] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<CourseRow | CourseTree['course'] | null>(
    null,
  );
  const [archiveCount, setArchiveCount] = useState<number | null>(null);
  // H13 — a failed archive-impact fetch must render as an error, never as a
  // factual-looking "0 students affected" (which is what the old bare catch
  // produced).
  const [archiveError, setArchiveError] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  // M40 — a draft course delete now needs a named confirm too (today only
  // section/sub-section deletes did).
  const [deleteCourseTarget, setDeleteCourseTarget] = useState<CourseRow | null>(null);
  const [deleteCourseBusy, setDeleteCourseBusy] = useState(false);

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
    if (!tree || tree.course.status !== 'draft' || publishing) return;
    setPublishing(true);
    try {
      await apiPost(`/v1/admin/courses/${tree.course.id}/publish`, {});
      toast.success('Course published.');
      reloadTree();
    } catch (err) {
      toast.error(publishErrorMessage(err));
    } finally {
      setPublishing(false);
    }
  }

  async function openArchive(course: CourseRow | CourseTree['course']) {
    setArchiveTarget(course);
    setArchiveCount(null);
    setArchiveError(false);
    try {
      const impact = await apiGet<{ in_progress_uncertified_students: number }>(
        `/v1/admin/courses/${course.id}/archive-impact`,
      );
      setArchiveCount(impact.in_progress_uncertified_students ?? 0);
    } catch {
      // H13 — an unknown count must never render as a factual zero; the
      // dialog below shows an error state and keeps the confirm disabled.
      setArchiveError(true);
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

  async function confirmDeleteCourse() {
    if (!deleteCourseTarget) return;
    setDeleteCourseBusy(true);
    try {
      // H10-UI — the DELETE response now carries an impact count (H10,
      // server-side); surface it instead of a bare "Draft deleted."
      const result = await apiDelete<{ impact?: { in_progress_uncertified_students: number } }>(
        `/v1/admin/courses/${deleteCourseTarget.id}`,
      );
      const affected = result?.impact?.in_progress_uncertified_students ?? 0;
      toast.success(
        affected > 0
          ? `Draft deleted. ${affected} student${affected === 1 ? '' : 's'} had in-progress work on it.`
          : 'Draft deleted.',
      );
      if (selectedId === deleteCourseTarget.id) {
        setSelectedId(null);
        setTree(null);
      }
      setDeleteCourseTarget(null);
      reload();
    } catch (err) {
      toast.error(
        'Could not delete the course — try again.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setDeleteCourseBusy(false);
    }
  }

  function closeEditor() {
    setSelectedId(null);
    setTree(null);
    setTreeError(null);
  }

  const editing = !!selectedId;

  return (
    <AdminPageShell
      title="Courses"
      subtitle={
        uiHi
          ? 'पाठ्यक्रम और टेम्पलेट लिखें, सभी आवश्यकताएँ पूरी होने पर प्रकाशित करें, और पुराने वर्षों को संग्रहित करें।'
          : 'Author courses and templates, publish once every requirement is met, and archive stale years.'
      }
      actions={editing ? undefined : <AddCourseDialog onAdded={reload} />}
    >
      {error ? <AdminError message={error} /> : null}

      {/* L25 — the CU33 staleness banner must stay reachable on narrow
          screens while editing; only the (long) course table collapses. */}
      <CatalogueNudges items={items} onArchive={(c) => void openArchive(c)} />

      <div className={editing ? 'hidden md:block' : undefined}>
        {/* L29 — a status filter, at minimum, on an admin list with no
            server-side LIMIT. */}
        <div className="mb-3 flex items-center gap-2">
          <Label className="text-xs font-medium">{uiHi ? 'स्थिति' : 'Status'}</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="h-9 w-40" aria-label={uiHi ? 'स्थिति के अनुसार छाँटें' : 'Filter by status'}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{uiHi ? 'सभी' : 'All'}</SelectItem>
              <SelectItem value="draft">{courseStatusLabel('draft', uiHi)}</SelectItem>
              <SelectItem value="active">{courseStatusLabel('active', uiHi)}</SelectItem>
              <SelectItem value="archived">{courseStatusLabel('archived', uiHi)}</SelectItem>
            </SelectContent>
          </Select>
        </div>

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
            <td className="px-4 py-3 text-xs">{kindLabel(c.kind, uiHi)}</td>
            <td className="px-4 py-3 text-xs">{c.academic_year ?? '—'}</td>
            <td className="px-4 py-3">{statusBadge(c.status, uiHi)}</td>
            <td className="px-4 py-3 text-xs">{c.city_name ?? 'National'}</td>
            <td className="px-4 py-3">{c.section_count}</td>
            <td className="px-4 py-3">
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant={selectedId === c.id ? 'default' : 'outline'}
                  aria-pressed={selectedId === c.id}
                  onClick={() => loadTree(c.id)}
                >
                  {selectedId === c.id ? 'Editing' : 'Edit'}
                </Button>
                {c.status === 'active' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void openArchive(c)}
                    aria-label={`Archive "${c.name_en}"`}
                  >
                    Archive
                  </Button>
                ) : null}
                {c.status === 'draft' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => setDeleteCourseTarget(c)}
                    aria-label={`Delete "${c.name_en}" draft`}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </AdminTable>
      </div>

      {treeError ? <AdminError message={treeError} /> : null}
      {treeLoading && !tree ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading course…</Card>
      ) : tree ? (
        <CourseTreeEditor
          tree={tree}
          reloadTree={reloadTree}
          onPublish={() => void publishSelected()}
          publishing={publishing}
          onArchive={() => void openArchive(tree.course)}
          onClose={closeEditor}
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
              <span role="status" aria-live="polite">
                {archiveError
                  ? // H13 — a failed impact fetch is an ERROR state, never a
                    // factual-looking "0 students affected"; the action stays
                    // disabled below until the count is actually known.
                    'Could not check how many students have work in progress on this course — try again before archiving.'
                  : archiveCount == null
                    ? 'Checking how many students still have work in progress…'
                    : archiveCount === 0
                      ? `No students currently have in-progress, uncertified work on "${
                          archiveTarget?.name_en ?? ''
                        }". Archiving removes it from every student's active catalogue. Progress and certificates already earned stay intact.`
                      : `${archiveCount} student${archiveCount === 1 ? '' : 's'} currently ${
                          archiveCount === 1 ? 'has' : 'have'
                        } in-progress, uncertified work on "${
                          archiveTarget?.name_en ?? ''
                        }". Archiving removes the course from their catalogue mid-course — progress and certificates already earned stay intact, but they will not see it for new work.`}
              </span>{' '}
              {/* M39 — states the action is one-way: there is no un-archive route. */}
              <span className="font-medium">
                Archiving cannot be undone from the admin panel — there is no way to move a
                course back from Archived.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmArchive();
              }}
              disabled={archiveBusy || archiveCount == null || archiveError}
            >
              {archiveBusy ? 'Archiving…' : 'Archive course'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* M40 — a draft course delete gets the same named confirm H12 gave
          section/sub-section deletes; a draft can be hours of authoring. */}
      <AlertDialog
        open={!!deleteCourseTarget}
        onOpenChange={(o) => {
          if (!o && !deleteCourseBusy) setDeleteCourseTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this draft course?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${deleteCourseTarget?.name_en ?? ''}" and every section and sub-section under it will be removed. It has never been published, so no student has seen it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCourseBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteCourse();
              }}
              disabled={deleteCourseBusy}
            >
              {deleteCourseBusy ? 'Deleting…' : 'Delete draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminPageShell>
  );
}
