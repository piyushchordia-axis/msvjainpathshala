import { useEffect, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AdminEmptyRow,
  AdminError,
  AdminPageShell,
  AdminTable,
} from '@/components/admin/AdminPageShell';
import { useAdminList } from '@/hooks/useAdminList';
import { useScopedGeography } from '@/hooks/useScopedGeography';
import { apiGet, apiPost, apiPatch, ApiError } from '@/lib/api-client';
import { describeApiError } from '@/lib/admin-error';
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function formatInr(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}

/* Curriculum authoring moved to CoursesAdminPage (Step 6). */

/* ——— Exams ——— */
interface ExamRow {
  id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  city_id: string;
  city_name: string;
  window_start: string;
  window_end: string;
  /** Plaintext codes are never listable (CTY-DSN-05) — only this flag is. */
  requires_otp?: boolean;
  results_released: boolean;
  attempt_count: number;
  max_attempts: number;
  total_marks: number;
  pass_mark: number;
  /** SUM(question marks) so a paper/total mismatch is visible (CTY-API-07b). */
  question_marks_total: number;
}

/**
 * Persistent access-code panel (CTY-API-07): the code used to appear in a
 * 4-second toast and was unrecoverable afterwards — it is hashed at rest and
 * can never be shown again.
 */
function AccessCodePanel({ code, context }: { code: string; context: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-primary/40 bg-primary/5 p-4">
      <p className="text-sm font-medium">{context}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded bg-card px-3 py-1.5 font-mono text-lg tracking-widest">{code}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Save it now — the code is stored hashed and cannot be shown again. You can regenerate a
        new one from Edit exam if it is lost.
      </p>
    </div>
  );
}

/** ISO → value for `<input type="datetime-local">` in local time. */
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AddExamDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Scope-filtered + cached — the raw national list let a city_admin fill the
  // whole form before a 403 (CTY-API-05).
  const geo = useScopedGeography(open);
  const cities = geo.cities;
  const [title, setTitle] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionHi, setDescriptionHi] = useState('');
  const [cityId, setCityId] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [totalMarks, setTotalMarks] = useState('100');
  const [passMark, setPassMark] = useState('40');
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [otp, setOtp] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFieldError(null);
    setCreatedCode(null);
  }, [open]);

  function validateClient(): string | null {
    const startMs = new Date(windowStart).getTime();
    const endMs = new Date(windowEnd).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      return 'The exam must end after it starts — check the window dates.';
    }
    const total = Number(totalMarks);
    const pass = Number(passMark);
    if (!Number.isFinite(total) || !Number.isFinite(pass) || pass > total) {
      return 'Pass mark cannot be higher than total marks.';
    }
    const attempts = Number(maxAttempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
      return 'Attempts allowed must be between 1 and 10.';
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !titleHi.trim() || !cityId || !windowStart || !windowEnd) return;
    const localError = validateClient();
    if (localError) {
      setFieldError(localError);
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      const res = await apiPost<{ exam_otp: string | null }>('/v1/admin/exams', {
        title_en: title.trim(),
        title_hi: titleHi.trim(),
        description_en: descriptionEn.trim() || undefined,
        description_hi: descriptionHi.trim() || undefined,
        city_id: cityId,
        window_start: new Date(windowStart).toISOString(),
        window_end: new Date(windowEnd).toISOString(),
        total_marks: Number(totalMarks),
        pass_mark: Number(passMark),
        max_attempts: Number(maxAttempts),
        exam_otp: otp.trim() || undefined,
      });
      setTitle('');
      setTitleHi('');
      setDescriptionEn('');
      setDescriptionHi('');
      setCityId('');
      setWindowStart('');
      setWindowEnd('');
      setTotalMarks('100');
      setPassMark('40');
      setMaxAttempts('1');
      setOtp('');
      setFieldError(null);
      onAdded();
      if (res.exam_otp) {
        // Keep the dialog open on a persistent code panel (CTY-API-07) — a
        // 4-second toast was the only sight of an unrecoverable code.
        setCreatedCode(res.exam_otp);
      } else {
        toast.success('Exam created.');
        setOpen(false);
      }
    } catch (err) {
      const d = describeApiError(err, 'Could not create the exam');
      toast.error(d.title, d.detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          New exam
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{createdCode ? 'Exam created' : 'Create exam'}</DialogTitle>
        </DialogHeader>
        {createdCode ? (
          <div className="space-y-4 pt-2">
            <AccessCodePanel code={createdCode} context="Access code for this exam" />
            <div className="flex justify-end">
              <Button type="button" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </FormRow>
          <FormRow label="Title (Hindi) *">
            <Input
              value={titleHi}
              onChange={(e) => setTitleHi(e.target.value)}
              required
              placeholder="शीर्षक"
            />
          </FormRow>
          <FormRow label="Description (English)">
            <Textarea value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} rows={2} />
          </FormRow>
          <FormRow label="Description (Hindi)">
            <Textarea
              value={descriptionHi}
              onChange={(e) => setDescriptionHi(e.target.value)}
              rows={2}
              placeholder="विवरण"
            />
          </FormRow>
          <FormRow label="City *">
            {geo.error ? (
              <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <span>Couldn't load cities — this is a load failure, not an empty scope.</span>
                <Button type="button" size="sm" variant="outline" onClick={geo.retry}>
                  Retry
                </Button>
              </div>
            ) : (
              <Select value={cityId} onValueChange={setCityId}>
                <SelectTrigger>
                  <SelectValue placeholder={geo.loading ? 'Loading cities…' : 'Select city'} />
                </SelectTrigger>
                <SelectContent>
                  {cities.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.state_name ? ` (${c.state_name})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Window start *">
              <Input
                type="datetime-local"
                value={windowStart}
                onChange={(e) => {
                  setWindowStart(e.target.value);
                  setFieldError(null);
                }}
                required
              />
            </FormRow>
            <FormRow label="Window end *">
              <Input
                type="datetime-local"
                value={windowEnd}
                onChange={(e) => {
                  setWindowEnd(e.target.value);
                  setFieldError(null);
                }}
                required
              />
            </FormRow>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormRow label="Total marks">
              <Input
                type="number"
                min={1}
                value={totalMarks}
                onChange={(e) => {
                  setTotalMarks(e.target.value);
                  setFieldError(null);
                }}
              />
            </FormRow>
            <FormRow label="Pass mark">
              <Input
                type="number"
                min={0}
                value={passMark}
                onChange={(e) => {
                  setPassMark(e.target.value);
                  setFieldError(null);
                }}
              />
            </FormRow>
            <FormRow label="Attempts allowed">
              <Input
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => {
                  setMaxAttempts(e.target.value);
                  setFieldError(null);
                }}
              />
            </FormRow>
          </div>
          <FormRow label="Access code (auto-generated if blank)">
            <Input
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="e.g. ABC123"
              className="font-mono"
            />
          </FormRow>
          {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={busy || !title.trim() || !titleHi.trim() || !cityId || !windowStart || !windowEnd}
            >
              {busy ? 'Saving…' : 'Create'}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditExamDialog({ exam, onSaved }: { exam: ExamRow; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // `?? ''` everywhere: a missing field must degrade to an empty input, never
  // a render-time crash — undefined.trim() white-screened the whole panel
  // before the list route returned these columns (CTY-ERR-01).
  const [title, setTitle] = useState(exam.title_en ?? '');
  const [titleHi, setTitleHi] = useState(exam.title_hi ?? '');
  const [descriptionEn, setDescriptionEn] = useState(exam.description_en ?? '');
  const [descriptionHi, setDescriptionHi] = useState(exam.description_hi ?? '');
  const [windowStart, setWindowStart] = useState(toDatetimeLocalValue(exam.window_start));
  const [windowEnd, setWindowEnd] = useState(toDatetimeLocalValue(exam.window_end));
  const [totalMarks, setTotalMarks] = useState(String(exam.total_marks ?? 100));
  const [passMark, setPassMark] = useState(String(exam.pass_mark ?? 0));
  const [maxAttempts, setMaxAttempts] = useState(String(exam.max_attempts ?? 1));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenCode, setRegenCode] = useState<string | null>(null);
  const marksLocked = exam.results_released;

  useEffect(() => {
    if (!open) return;
    setTitle(exam.title_en ?? '');
    setTitleHi(exam.title_hi ?? '');
    setDescriptionEn(exam.description_en ?? '');
    setDescriptionHi(exam.description_hi ?? '');
    setWindowStart(toDatetimeLocalValue(exam.window_start));
    setWindowEnd(toDatetimeLocalValue(exam.window_end));
    setTotalMarks(String(exam.total_marks ?? 100));
    setPassMark(String(exam.pass_mark ?? 0));
    setMaxAttempts(String(exam.max_attempts ?? 1));
    setFieldError(null);
    setRegenCode(null);
  }, [open, exam]);

  async function regenerateCode() {
    if (!window.confirm('Generate a new access code? The old code stops working immediately.')) {
      return;
    }
    setRegenBusy(true);
    try {
      const res = await apiPost<{ exam_otp: string }>(`/v1/admin/exams/${exam.id}/access-code`, {});
      setRegenCode(res.exam_otp);
      onSaved();
    } catch (err) {
      const d = describeApiError(err, 'Could not regenerate the code');
      toast.error(d.title, d.detail);
    } finally {
      setRegenBusy(false);
    }
  }

  function validateClient(): string | null {
    const startMs = new Date(windowStart).getTime();
    const endMs = new Date(windowEnd).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
      return 'The exam must end after it starts — check the window dates.';
    }
    const total = Number(totalMarks);
    const pass = Number(passMark);
    if (!Number.isFinite(total) || !Number.isFinite(pass) || pass > total) {
      return 'Pass mark cannot be higher than total marks.';
    }
    const attempts = Number(maxAttempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
      return 'Attempts allowed must be between 1 and 10.';
    }
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !titleHi.trim() || !windowStart || !windowEnd) return;
    const localError = validateClient();
    if (localError) {
      setFieldError(localError);
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        title_en: title.trim(),
        title_hi: titleHi.trim(),
        description_en: descriptionEn.trim() || null,
        description_hi: descriptionHi.trim() || null,
        window_start: new Date(windowStart).toISOString(),
        window_end: new Date(windowEnd).toISOString(),
        max_attempts: Number(maxAttempts),
      };
      if (!marksLocked) {
        body.total_marks = Number(totalMarks);
        body.pass_mark = Number(passMark);
      }
      await apiPatch(`/v1/admin/exams/${exam.id}`, body);
      toast.success('Exam updated.');
      setOpen(false);
      onSaved();
    } catch (err) {
      const d = describeApiError(err, 'Could not update the exam');
      toast.error(d.title, d.detail);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit exam">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit exam</DialogTitle>
        </DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </FormRow>
          <FormRow label="Title (Hindi) *">
            <Input
              value={titleHi}
              onChange={(e) => setTitleHi(e.target.value)}
              required
              placeholder="शीर्षक"
            />
          </FormRow>
          <FormRow label="Description (English)">
            <Textarea value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} rows={2} />
          </FormRow>
          <FormRow label="Description (Hindi)">
            <Textarea
              value={descriptionHi}
              onChange={(e) => setDescriptionHi(e.target.value)}
              rows={2}
              placeholder="विवरण"
            />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Window start *">
              <Input
                type="datetime-local"
                value={windowStart}
                onChange={(e) => {
                  setWindowStart(e.target.value);
                  setFieldError(null);
                }}
                required
              />
            </FormRow>
            <FormRow label="Window end *">
              <Input
                type="datetime-local"
                value={windowEnd}
                onChange={(e) => {
                  setWindowEnd(e.target.value);
                  setFieldError(null);
                }}
                required
              />
            </FormRow>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormRow label="Total marks">
              <Input
                type="number"
                min={1}
                value={totalMarks}
                disabled={marksLocked}
                onChange={(e) => {
                  setTotalMarks(e.target.value);
                  setFieldError(null);
                }}
              />
            </FormRow>
            <FormRow label="Pass mark">
              <Input
                type="number"
                min={0}
                value={passMark}
                disabled={marksLocked}
                onChange={(e) => {
                  setPassMark(e.target.value);
                  setFieldError(null);
                }}
              />
            </FormRow>
            <FormRow label="Attempts allowed">
              <Input
                type="number"
                min={1}
                max={10}
                value={maxAttempts}
                onChange={(e) => {
                  setMaxAttempts(e.target.value);
                  setFieldError(null);
                }}
              />
            </FormRow>
          </div>
          {marksLocked ? (
            <p className="text-xs text-muted-foreground">
              Total marks and pass mark are locked after results are released.
            </p>
          ) : null}
          {regenCode ? (
            <AccessCodePanel code={regenCode} context="New access code" />
          ) : (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Access code: {exam.requires_otp ? 'required' : 'not required'} — codes are hashed
                and can only be replaced, never read back.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={regenBusy}
                onClick={() => void regenerateCode()}
              >
                {regenBusy ? 'Generating…' : 'Regenerate'}
              </Button>
            </div>
          )}
          {fieldError ? <p className="text-sm text-destructive">{fieldError}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={busy || !title.trim() || !titleHi.trim() || !windowStart || !windowEnd}
            >
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ExamsPage() {
  const { items, loading, error, reload } = useAdminList<ExamRow>('/v1/admin/exams?limit=50');
  const [busy, setBusy] = useState<string | null>(null);

  async function releaseResults(id: string) {
    setBusy(id);
    try {
      await apiPost(`/v1/admin/exams/${id}/release-results`, {});
      toast.success('Results released.');
      reload();
    } catch (err) {
      const d = describeApiError(err, 'Could not release results');
      toast.error(d.title, d.detail);
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminPageShell
      title="Exams"
      subtitle="Online exams, access codes, and result release."
      actions={<AddExamDialog onAdded={reload} />}
    >
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Exam', 'City', 'Window', 'Marks', 'Access code', 'Attempts', 'Allowed', 'Results', 'Actions']}
        loading={loading}
        empty=""
        colSpan={9}
      >
        {items.length === 0 && !loading ? <AdminEmptyRow colSpan={9} message="No exams." /> : null}
        {items.map((e) => {
          const marksMismatch = e.question_marks_total !== e.total_marks;
          return (
          <tr key={e.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{e.title_en}</td>
            <td className="px-4 py-3 text-xs">{e.city_name}</td>
            <td className="px-4 py-3 text-xs whitespace-nowrap">
              {new Date(e.window_start).toLocaleDateString('en-GB')} –{' '}
              {new Date(e.window_end).toLocaleDateString('en-GB')}
            </td>
            <td className="px-4 py-3 text-xs whitespace-nowrap">
              {/* SUM(question marks) vs declared total (CTY-API-07b): a paper
                  worth 20 declared out of 100 fails the whole cohort. */}
              <span className={marksMismatch && !e.results_released ? 'font-medium text-destructive' : ''}>
                {e.question_marks_total}/{e.total_marks}
              </span>
              {marksMismatch && !e.results_released ? (
                <span className="ml-1 text-muted-foreground">(questions ≠ total)</span>
              ) : null}
            </td>
            <td className="px-4 py-3 text-xs">
              {/* Never a retrievable code — "Set" implied it could be read back
                  (CTY-DSN-05). */}
              {e.requires_otp ? 'Required' : 'Not required'}
            </td>
            <td className="px-4 py-3">{e.attempt_count}</td>
            <td className="px-4 py-3">{e.max_attempts}</td>
            <td className="px-4 py-3">{e.results_released ? 'Released' : 'Pending'}</td>
            <td className="px-4 py-3">
              <div className="flex items-center gap-1">
                <EditExamDialog exam={e} onSaved={reload} />
                {!e.results_released ? (
                  <Button
                    size="sm"
                    disabled={busy === e.id || marksMismatch}
                    title={
                      marksMismatch
                        ? `Question marks add up to ${e.question_marks_total}, but the exam is declared out of ${e.total_marks} — fix the paper or the total first.`
                        : undefined
                    }
                    onClick={() => releaseResults(e.id)}
                  >
                    Release
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
          );
        })}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Donations ——— */
interface CampaignRow {
  id: string;
  name: string;
  city_name: string | null;
  target_amount_paise: number | null;
  raised_amount_paise: number;
  is_public: boolean;
}

interface DonationRow {
  id: string;
  donor_name: string;
  amount_paise: number;
  purpose: string;
  status: string;
  eighty_g_eligible: boolean;
  campaign_name: string | null;
  payment_captured_at: string | null;
}

export function DonationsPage() {
  const { items: campaigns, loading: cLoad, error: cErr } =
    useAdminList<CampaignRow>('/v1/admin/donations/campaigns');
  const { items: donations, loading: dLoad, error: dErr } =
    useAdminList<DonationRow>('/v1/admin/donations?limit=100');

  return (
    <AdminPageShell title="Donations" subtitle="Campaigns and captured donations.">
      {cErr ? <AdminError message={cErr} /> : null}
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Campaigns
      </h3>
      <AdminTable columns={['Name', 'City', 'Raised', 'Target', 'Public']} loading={cLoad} empty="" colSpan={5}>
        {campaigns.length === 0 && !cLoad ? <AdminEmptyRow colSpan={5} message="No campaigns." /> : null}
        {campaigns.map((c) => (
          <tr key={c.id}>
            <td className="px-4 py-3 font-medium">{c.name}</td>
            <td className="px-4 py-3 text-xs">{c.city_name ?? '—'}</td>
            <td className="px-4 py-3 font-mono">{formatInr(c.raised_amount_paise)}</td>
            <td className="px-4 py-3 font-mono">{c.target_amount_paise ? formatInr(c.target_amount_paise) : '—'}</td>
            <td className="px-4 py-3">{c.is_public ? 'Yes' : 'No'}</td>
          </tr>
        ))}
      </AdminTable>

      {dErr ? <AdminError message={dErr} /> : null}
      <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Donations
      </h3>
      <AdminTable
        columns={['Donor', 'Amount', 'Purpose', 'Campaign', '80G', 'Status', 'Date']}
        loading={dLoad}
        empty=""
        colSpan={7}
      >
        {donations.length === 0 && !dLoad ? <AdminEmptyRow colSpan={7} message="No donations." /> : null}
        {donations.map((d) => (
          <tr key={d.id} className="hover:bg-muted/30">
            <td className="px-4 py-3 font-medium">{d.donor_name}</td>
            <td className="px-4 py-3 font-mono font-semibold">{formatInr(d.amount_paise)}</td>
            <td className="px-4 py-3 text-xs capitalize">{d.purpose}</td>
            <td className="px-4 py-3 text-xs">{d.campaign_name ?? '—'}</td>
            <td className="px-4 py-3">{d.eighty_g_eligible ? 'Yes' : '—'}</td>
            <td className="px-4 py-3 text-xs capitalize">{d.status}</td>
            <td className="px-4 py-3 text-xs">
              {d.payment_captured_at
                ? new Date(d.payment_captured_at).toLocaleDateString('en-GB')
                : '—'}
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}

/* ——— Queues ——— */
interface QueueStatRow {
  queue_name: string;
  waiting: number;
  active: number;
  completed_24h: number;
  failed: number;
  updated_at: string;
}

interface DlqRow {
  id: string;
  job_id: string;
  queue_name: string;
  error_message: string | null;
  failed_at: string;
}

export function QueuesPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<QueueStatRow[]>([]);
  const [dlq, setDlq] = useState<DlqRow[]>([]);
  const [selectedQueue, setSelectedQueue] = useState('notifications.fanout');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const s = await apiGet<{ items: QueueStatRow[] }>('/v1/admin/queues/stats');
      setStats(s?.items ?? []);
      const d = await apiGet<{ items: DlqRow[] }>(
        `/v1/admin/queues/${encodeURIComponent(selectedQueue)}/dlq`,
      );
      setDlq(d?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load queues.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'super_admin') void load();
  }, [user?.role, selectedQueue]);

  async function replay(jobId: string) {
    try {
      await apiPost(
        `/v1/admin/queues/${encodeURIComponent(selectedQueue)}/dlq/${encodeURIComponent(jobId)}/replay`,
        {},
      );
      toast.success('Job replayed.');
      void load();
    } catch (err) {
      toast.error('Replay failed.', err instanceof ApiError ? err.message : undefined);
    }
  }

  if (user?.role !== 'super_admin') {
    return (
      <AdminPageShell title="Queues" subtitle="Background job queue status">
        <Card className="p-6 text-sm text-muted-foreground">
          Queue monitoring is restricted to super administrators.
        </Card>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell title="Queues" subtitle="Background job depth and dead-letter queue (super admin).">
      {error ? <AdminError message={error} /> : null}
      <AdminTable
        columns={['Queue', 'Waiting', 'Active', 'Completed (24h)', 'Failed', 'Updated']}
        loading={loading}
        empty=""
        colSpan={6}
      >
        {stats.length === 0 && !loading ? <AdminEmptyRow colSpan={6} message="No queue stats." /> : null}
        {stats.map((q) => (
          <tr
            key={q.queue_name}
            className={`hover:bg-muted/30 cursor-pointer ${selectedQueue === q.queue_name ? 'bg-muted/50' : ''}`}
            onClick={() => setSelectedQueue(q.queue_name)}
          >
            <td className="px-4 py-3 font-mono text-xs">{q.queue_name}</td>
            <td className="px-4 py-3">{q.waiting}</td>
            <td className="px-4 py-3">{q.active}</td>
            <td className="px-4 py-3">{q.completed_24h}</td>
            <td className="px-4 py-3 text-destructive font-semibold">{q.failed}</td>
            <td className="px-4 py-3 text-xs">
              {new Date(q.updated_at).toLocaleString('en-GB')}
            </td>
          </tr>
        ))}
      </AdminTable>

      <h3 className="mt-8 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        DLQ: {selectedQueue}
      </h3>
      <AdminTable columns={['Job ID', 'Error', 'Failed', 'Actions']} loading={loading} empty="" colSpan={4}>
        {dlq.length === 0 && !loading ? (
          <AdminEmptyRow colSpan={4} message="No failed jobs in DLQ." />
        ) : null}
        {dlq.map((j) => (
          <tr key={j.id}>
            <td className="px-4 py-3 font-mono text-xs">{j.job_id}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground max-w-md truncate">
              {j.error_message ?? '—'}
            </td>
            <td className="px-4 py-3 text-xs whitespace-nowrap">
              {new Date(j.failed_at).toLocaleString('en-GB')}
            </td>
            <td className="px-4 py-3">
              <Button size="sm" variant="outline" onClick={() => replay(j.job_id)}>
                Replay
              </Button>
            </td>
          </tr>
        ))}
      </AdminTable>
    </AdminPageShell>
  );
}
