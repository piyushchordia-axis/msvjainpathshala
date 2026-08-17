import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Check, X, ChevronLeft } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useScopedGeography } from '@/hooks/useScopedGeography';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminError } from '@/components/admin/AdminPageShell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogClose,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ─── Types ────────────────────────────────────────────────────────────────
interface QuizOption { text_en: string; text_hi?: string; }

interface QuestionRow {
  id: string;
  scope: string;
  city_id: string | null;
  question_en: string;
  question_hi: string | null;
  options: QuizOption[];
  correct_indices: number[];
  difficulty: string;
  topic: string | null;
  source: string;
  is_active: boolean;
  created_at: string;
}

interface EventRow {
  id: string;
  scope: string;
  title_en: string;
  title_hi: string | null;
  start_at: string;
  end_at: string;
  participation_points: number | null;
  win_points: number | null;
  question_count: number;
  created_at: string;
  state_ids?: string[];
  city_ids?: string[];
  centre_ids?: string[];
  batch_ids?: string[];
}

interface PushRow {
  id: string;
  scope: string;
  started_at: string;
  expires_at: string;
  completion_points: number | null;
  question_count: number;
  submitted_count: number;
  is_live: boolean;
}

interface AttemptQuestionResult {
  question_id: string;
  correct: boolean;
}

interface AttemptRow {
  attempt_id: string;
  student_id: string;
  full_name: string;
  centre_name: string | null;
  batch_name: string | null;
  started_at: string | null;
  submitted_at: string | null;
  correct_count: number | null;
  total_count: number | null;
  score: number | null;
  points_awarded: number;
  question_results: AttemptQuestionResult[];
}

interface AttemptsPayload {
  items: AttemptRow[];
  attempted_count: number;
  submitted_count: number;
  eligible_count: number;
  average_score: number;
  is_live?: boolean;
}

type QuizScope = 'national' | 'state' | 'city' | 'centre' | 'batch';
const QUIZ_SCOPES: QuizScope[] = ['national', 'state', 'city', 'centre', 'batch'];

interface GeoState { id: string; name: string }
interface GeoCity { id: string; name: string; state_id: string }
interface CentreOpt { id: string; name: string; city_name?: string }
interface BatchOpt { id: string; name: string | null; centre_name: string; centre_id?: string }

function allowedScopesForRole(role: string | undefined): QuizScope[] {
  if (role === 'super_admin') return [...QUIZ_SCOPES];
  if (role === 'state_admin') return ['state', 'city', 'centre', 'batch'];
  if (role === 'city_admin') return ['city', 'centre', 'batch'];
  return ['centre', 'batch'];
}

function defaultScopeForRole(role: string | undefined): QuizScope {
  const allowed = allowedScopesForRole(role);
  return allowed.includes('city') ? 'city' : allowed[0] ?? 'batch';
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
}

/** Scope dropdown + multi-select of matching geo/entities (filtered by access). */
function QuizScopeTargets({
  scope,
  onScopeChange,
  selectedIds,
  onSelectedChange,
  allowedScopes,
  states,
  cities,
  centres,
  batches,
}: {
  scope: QuizScope;
  onScopeChange: (s: QuizScope) => void;
  selectedIds: Set<string>;
  onSelectedChange: (next: Set<string>) => void;
  allowedScopes: QuizScope[];
  states: GeoState[];
  cities: GeoCity[];
  centres: CentreOpt[];
  batches: BatchOpt[];
}) {
  const options = useMemo(() => {
    if (scope === 'state') return states.map((s) => ({ id: s.id, label: s.name }));
    if (scope === 'city') return cities.map((c) => ({ id: c.id, label: c.name }));
    if (scope === 'centre') {
      return centres.map((c) => ({ id: c.id, label: c.city_name ? `${c.name} · ${c.city_name}` : c.name }));
    }
    if (scope === 'batch') {
      return batches.map((b) => ({ id: b.id, label: `${b.name ?? 'Batch'} · ${b.centre_name}` }));
    }
    return [];
  }, [scope, states, cities, centres, batches]);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next);
  }

  function setScope(s: QuizScope) {
    onScopeChange(s);
    onSelectedChange(new Set());
  }

  return (
    <div className="space-y-3">
      <FormRow label="Scope *">
        <Select value={scope} onValueChange={(v) => setScope(v as QuizScope)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {allowedScopes.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormRow>
      {scope === 'national' ? (
        <p className="text-xs text-muted-foreground">National quizzes are available to all students.</p>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs font-medium">
            {scope === 'state' ? 'States' : scope === 'city' ? 'Cities' : scope === 'centre' ? 'Centres' : 'Batches'}
            {' '}({selectedIds.size} selected) *
          </Label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
            {options.length === 0 ? (
              <p className="p-2 text-xs text-muted-foreground">No options in your access scope.</p>
            ) : (
              options.map((o) => (
                <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40">
                  <input type="checkbox" checked={selectedIds.has(o.id)} onChange={() => toggle(o.id)} />
                  <span>{o.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function useQuizTargetOptions(open: boolean) {
  const { user } = useAuth();
  // Cached + scope-filtered geography (CTY-API-05/PRF-01).
  const geo = useScopedGeography(open);
  const [centres, setCentres] = useState<CentreOpt[]>([]);
  const [batches, setBatches] = useState<BatchOpt[]>([]);
  const [listError, setListError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setListError(false);
    void Promise.all([
      apiGet<{ items: CentreOpt[] }>('/v1/admin/centres'),
      apiGet<{ items: BatchOpt[] }>('/v1/admin/batches'),
    ])
      .then(([c, b]) => {
        if (cancelled) return;
        setCentres(c?.items ?? []);
        setBatches(b?.items ?? []);
      })
      .catch(() => {
        // Empty pickers used to read as "empty scope" — a load failure must
        // say so and offer a retry (CTY-ERR-03).
        if (!cancelled) setListError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadKey]);

  const error = geo.error || listError;
  const retry = () => {
    setReloadKey((k) => k + 1);
    geo.retry();
  };

  return { states: geo.states, cities: geo.cities, centres, batches, user, error, retry };
}

/** Inline load-failure strip for target pickers (CTY-ERR-03). */
function TargetLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
      <span>Couldn't load the target options — this is a load failure, not an empty scope.</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function targetsPayload(scope: QuizScope, selected: Set<string>) {
  const ids = Array.from(selected);
  return {
    scope,
    state_ids: scope === 'state' ? ids : [],
    city_ids: scope === 'city' ? ids : [],
    centre_ids: scope === 'centre' ? ids : [],
    batch_ids: scope === 'batch' ? ids : [],
  };
}

function validateTargets(scope: QuizScope, selected: Set<string>): string | null {
  if (scope !== 'national' && selected.size === 0) {
    return `Select at least one ${scope}.`;
  }
  return null;
}

// ─── Reusable option editor (text_en + correct toggle) ──────────────────────
interface DraftQ {
  question_en: string;
  options: { text_en: string }[];
  correct: boolean[];
}

function emptyDraftQ(): DraftQ {
  return { question_en: '', options: [{ text_en: '' }, { text_en: '' }], correct: [false, false] };
}

function QuestionEditor({
  draft, onChange,
}: { draft: DraftQ; onChange: (d: DraftQ) => void }) {
  function setText(v: string) { onChange({ ...draft, question_en: v }); }
  function setOpt(i: number, v: string) {
    onChange({ ...draft, options: draft.options.map((o, idx) => (idx === i ? { text_en: v } : o)) });
  }
  function toggle(i: number) {
    onChange({ ...draft, correct: draft.correct.map((c, idx) => (idx === i ? !c : c)) });
  }
  function addOpt() {
    onChange({ ...draft, options: [...draft.options, { text_en: '' }], correct: [...draft.correct, false] });
  }
  function removeOpt(i: number) {
    if (draft.options.length <= 2) return;
    onChange({
      ...draft,
      options: draft.options.filter((_, idx) => idx !== i),
      correct: draft.correct.filter((_, idx) => idx !== i),
    });
  }
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <FormRow label="Question (English) *">
        <Textarea value={draft.question_en} onChange={(e) => setText(e.target.value)} rows={2} />
      </FormRow>
      <div className="space-y-2">
        <Label className="text-xs font-medium">Options (tick all correct)</Label>
        {draft.options.map((o, i) => (
          <div key={i} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggle(i)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors ${draft.correct[i] ? 'bg-status-success-soft border-[hsl(var(--status-success))] text-status-success' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`}
              aria-label="Mark correct"
            >
              <Check className="h-4 w-4" />
            </button>
            <Input value={o.text_en} onChange={(e) => setOpt(i, e.target.value)} placeholder={`Option ${i + 1}`} />
            <Button type="button" size="sm" variant="ghost" disabled={draft.options.length <= 2} onClick={() => removeOpt(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={addOpt}>
          <Plus className="mr-1 h-4 w-4" />Add option
        </Button>
      </div>
    </div>
  );
}

function draftToPayload(d: DraftQ) {
  const options = d.options.filter((o) => o.text_en.trim()).map((o) => ({ text_en: o.text_en.trim() }));
  const correct_indices = d.correct
    .map((c, i) => (c && d.options[i]?.text_en.trim() ? i : -1))
    .filter((i) => i >= 0);
  return { question_en: d.question_en.trim(), options, correct_indices };
}

function validateDraft(d: DraftQ): string | null {
  if (!d.question_en.trim()) return 'Question text is required.';
  const filled = d.options.filter((o) => o.text_en.trim());
  if (filled.length < 2) return 'At least two options are required.';
  const p = draftToPayload(d);
  if (p.correct_indices.length < 1) return 'Mark at least one correct option.';
  return null;
}

// ─── Add question to bank ───────────────────────────────────────────────────
function AddQuestionDialog({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const allowedScopes = allowedScopesForRole(user?.role);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<QuizScope>(defaultScopeForRole(user?.role));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState<DraftQ>(emptyDraftQ());
  const opts = useQuizTargetOptions(open);

  function reset() {
    setScope(defaultScopeForRole(user?.role));
    setSelectedIds(new Set());
    setTopic('');
    setDraft(emptyDraftQ());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateDraft(draft) ?? validateTargets(scope, selectedIds);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const p = draftToPayload(draft);
      await apiPost('/v1/quizzes/questions', {
        question_en: p.question_en,
        options: p.options,
        correct_indices: p.correct_indices,
        topic: topic.trim() || undefined,
        ...targetsPayload(scope, selectedIds),
      });
      toast.success('Question added to bank.');
      setOpen(false);
      reset();
      onAdded();
    } catch (er) {
      toast.error('Failed to add question.', er instanceof ApiError ? er.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />Add question</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add question to bank</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <QuizScopeTargets
            scope={scope}
            onScopeChange={setScope}
            selectedIds={selectedIds}
            onSelectedChange={setSelectedIds}
            allowedScopes={allowedScopes}
            states={opts.states}
            cities={opts.cities}
            centres={opts.centres}
            batches={opts.batches}
          />
          <FormRow label="Topic">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Ahimsa" />
          </FormRow>
          <QuestionEditor draft={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add question'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit / deactivate question ─────────────────────────────────────────────
function EditQuestionDialog({
  question,
  onSaved,
}: {
  question: QuestionRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [topic, setTopic] = useState(question.topic ?? '');
  const [draft, setDraft] = useState<DraftQ>(() => ({
    question_en: question.question_en,
    options: question.options.map((o) => ({ text_en: o.text_en })),
    correct: question.options.map((_, i) => question.correct_indices.includes(i)),
  }));

  useEffect(() => {
    if (!open) return;
    setTopic(question.topic ?? '');
    setDraft({
      question_en: question.question_en,
      options: question.options.map((o) => ({ text_en: o.text_en })),
      correct: question.options.map((_, i) => question.correct_indices.includes(i)),
    });
  }, [open, question]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateDraft(draft);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const p = draftToPayload(draft);
      await apiPatch(`/v1/quizzes/questions/${question.id}`, {
        question_en: p.question_en,
        options: p.options,
        correct_indices: p.correct_indices,
        topic: topic.trim() || null,
      });
      toast.success('Question updated.');
      setOpen(false);
      onSaved();
    } catch (er) {
      toast.error('Could not update question.', er instanceof ApiError ? er.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!question.is_active}>Edit</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit question</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Topic">
            <Input value={topic} onChange={(e) => setTopic(e.target.value)} />
          </FormRow>
          <QuestionEditor draft={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

async function deactivateQuestion(id: string, onDone: () => void) {
  try {
    await apiDelete(`/v1/quizzes/questions/${id}`);
    toast.success('Question deactivated.');
    onDone();
  } catch (er) {
    toast.error('Could not deactivate question.', er instanceof ApiError ? er.message : undefined);
  }
}

// ─── Create event (pick questions from the bank) ────────────────────────────
function CreateEventDialog({ questions, onAdded }: { questions: QuestionRow[]; onAdded: () => void }) {
  const { user } = useAuth();
  const allowedScopes = allowedScopesForRole(user?.role);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<QuizScope>(defaultScopeForRole(user?.role));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [participation, setParticipation] = useState('5');
  const [win, setWin] = useState('10');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const opts = useQuizTargetOptions(open);

  function reset() {
    setTitle('');
    setScope(defaultScopeForRole(user?.role));
    setSelectedIds(new Set());
    setStartAt('');
    setEndAt('');
    setParticipation('5');
    setWin('10');
    setPicked(new Set());
  }

  function togglePick(id: string) {
    setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error('Title is required.'); return; }
    if (!startAt || !endAt) { toast.error('Start and end times are required.'); return; }
    if (picked.size === 0) { toast.error('Select at least one question.'); return; }
    const targetErr = validateTargets(scope, selectedIds);
    if (targetErr) { toast.error(targetErr); return; }
    setBusy(true);
    try {
      await apiPost('/v1/quizzes/events', {
        title_en: title.trim(),
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        participation_points: Number(participation) || 0,
        win_points: Number(win) || 0,
        question_ids: Array.from(picked),
        ...targetsPayload(scope, selectedIds),
      });
      toast.success('Quiz event created.');
      setOpen(false);
      reset();
      onAdded();
    } catch (er) {
      toast.error('Failed to create event.', er instanceof ApiError ? er.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="mr-1 h-4 w-4" />New event</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create quiz event</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormRow>
          <QuizScopeTargets
            scope={scope}
            onScopeChange={setScope}
            selectedIds={selectedIds}
            onSelectedChange={setSelectedIds}
            allowedScopes={allowedScopes}
            states={opts.states}
            cities={opts.cities}
            centres={opts.centres}
            batches={opts.batches}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Participation pts">
              <Input type="number" min={0} value={participation} onChange={(e) => setParticipation(e.target.value)} />
            </FormRow>
            <FormRow label="Win pts">
              <Input type="number" min={0} value={win} onChange={(e) => setWin(e.target.value)} />
            </FormRow>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Start *">
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </FormRow>
            <FormRow label="End *">
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </FormRow>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-medium">Questions ({picked.size} selected) *</Label>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {questions.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">No questions in the bank yet. Add some first.</p>
              ) : questions.map((q) => (
                <label key={q.id} className="flex cursor-pointer items-start gap-2 rounded p-2 text-sm hover:bg-muted/40">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={picked.has(q.id)}
                    onChange={() => togglePick(q.id)}
                  />
                  <span className="flex-1">
                    <span className="font-medium">{q.question_en}</span>
                    <span className="ml-2 text-xs capitalize text-muted-foreground">{q.scope}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create event'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create push quiz (inline questions) ────────────────────────────────────
function CreatePushDialog({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const allowedScopes = allowedScopesForRole(user?.role);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<QuizScope>('batch');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [minutes, setMinutes] = useState('15');
  const [points, setPoints] = useState('5');
  const [drafts, setDrafts] = useState<DraftQ[]>([emptyDraftQ()]);
  const opts = useQuizTargetOptions(open);

  function reset() {
    setScope('batch');
    setSelectedIds(new Set());
    setMinutes('15');
    setPoints('5');
    setDrafts([emptyDraftQ()]);
  }

  function setDraft(i: number, d: DraftQ) {
    setDrafts((prev) => prev.map((x, idx) => (idx === i ? d : x)));
  }
  function addDraft() { setDrafts((prev) => [...prev, emptyDraftQ()]); }
  function removeDraft(i: number) {
    setDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const targetErr = validateTargets(scope, selectedIds);
    if (targetErr) { toast.error(targetErr); return; }
    for (const d of drafts) {
      const err = validateDraft(d);
      if (err) { toast.error(err); return; }
    }
    setBusy(true);
    try {
      const expires_at = new Date(Date.now() + (Number(minutes) || 15) * 60 * 1000).toISOString();
      await apiPost('/v1/quizzes/push', {
        expires_at,
        completion_points: Number(points) || 0,
        questions: drafts.map((d) => draftToPayload(d)),
        ...targetsPayload(scope, selectedIds),
      });
      toast.success('Push quiz started.');
      setOpen(false);
      reset();
      onAdded();
    } catch (er) {
      toast.error('Failed to start push quiz.', er instanceof ApiError ? er.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="mr-1 h-4 w-4" />Start push quiz</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Start a live push quiz</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <QuizScopeTargets
            scope={scope}
            onScopeChange={setScope}
            selectedIds={selectedIds}
            onSelectedChange={setSelectedIds}
            allowedScopes={allowedScopes}
            states={opts.states}
            cities={opts.cities}
            centres={opts.centres}
            batches={opts.batches}
          />
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Expires in (min)">
              <Input type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </FormRow>
            <FormRow label="Completion pts">
              <Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />
            </FormRow>
          </div>
          <div className="space-y-3">
            {drafts.map((d, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Question {i + 1}</Label>
                  <Button type="button" size="sm" variant="ghost" disabled={drafts.length <= 1} onClick={() => removeDraft(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <QuestionEditor draft={d} onChange={(nd) => setDraft(i, nd)} />
              </div>
            ))}
            <Button type="button" size="sm" variant="outline" onClick={addDraft}>
              <Plus className="mr-1 h-4 w-4" />Add another question
            </Button>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy}>{busy ? 'Starting…' : 'Start quiz'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Results panel ──────────────────────────────────────────────────────────
function AttemptsResultsPanel({
  title,
  kind,
  id,
  onBack,
}: {
  title: string;
  kind: 'event' | 'push';
  id: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<AttemptsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<string | null>(null);

  async function load() {
    try {
      const path =
        kind === 'event'
          ? `/v1/quizzes/events/${id}/attempts`
          : `/v1/quizzes/push/${id}/attempts`;
      const res = await apiGet<AttemptsPayload>(path);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attempts.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [kind, id]);

  // Live push quizzes: refresh the roster every 5s.
  useEffect(() => {
    if (kind !== 'push' || !data?.is_live) return;
    const t = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(t);
  }, [kind, id, data?.is_live]);

  async function resetAttempt(attemptId: string) {
    if (kind !== 'event') return;
    setResetting(attemptId);
    try {
      await apiPost(`/v1/quizzes/events/${id}/attempts/${attemptId}/reset`, {});
      toast.success('Attempt reset — Punya reversed where awarded.');
      await load();
    } catch (er) {
      toast.error('Could not reset attempt.', er instanceof ApiError ? er.message : undefined);
    } finally {
      setResetting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />Back
        </Button>
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {data ? (
            <p className="text-xs text-muted-foreground">
              {data.submitted_count} submitted
              {typeof data.eligible_count === 'number' ? ` / ${data.eligible_count} eligible` : ''}
              {' · '}
              avg score {Number(data.average_score ?? 0).toFixed(1)}
              {data.is_live ? ' · Live' : ''}
            </p>
          ) : null}
        </div>
      </div>

      {error ? <AdminError message={error} /> : null}
      {loading && !data ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading results…</Card>
      ) : !data || data.items.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No attempts yet.</Card>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Student</th>
                <th className="px-3 py-2 font-medium">Centre</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Punya</th>
                <th className="px-3 py-2 font-medium">Questions</th>
                <th className="px-3 py-2 font-medium">Submitted</th>
                {kind === 'event' ? <th className="px-3 py-2 font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.attempt_id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{row.full_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{row.centre_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    {row.submitted_at
                      ? `${row.correct_count ?? row.score ?? 0}/${row.total_count ?? row.question_results.length}`
                      : 'In progress'}
                  </td>
                  <td className="px-3 py-2">{row.points_awarded}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {row.question_results.map((q, i) => (
                        <span
                          key={q.question_id}
                          title={q.correct ? 'Correct' : 'Incorrect'}
                          className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                            q.correct
                              ? 'border-[hsl(var(--status-success))] bg-status-success-soft text-status-success'
                              : 'border-input bg-muted/30 text-muted-foreground'
                          }`}
                        >
                          {q.correct ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                          <span className="sr-only">Q{i + 1}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.submitted_at ? new Date(row.submitted_at).toLocaleString('en-GB') : '—'}
                  </td>
                  {kind === 'event' ? (
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resetting === row.attempt_id}
                        onClick={() => void resetAttempt(row.attempt_id)}
                      >
                        {resetting === row.attempt_id ? 'Resetting…' : 'Reset'}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
type Tab = 'bank' | 'events' | 'push';

type ResultsView =
  | { kind: 'event'; id: string; title: string }
  | { kind: 'push'; id: string; title: string }
  | null;

export default function QuizzesPage() {
  const [tab, setTab] = useState<Tab>('bank');
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [pushes, setPushes] = useState<PushRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ResultsView>(null);
  const [activeFilter, setActiveFilter] = useState<'true' | 'false' | 'all'>('true');

  async function loadAll(filter: 'true' | 'false' | 'all' = activeFilter) {
    setLoading(true);
    setError(null);
    try {
      const [q, ev, pq] = await Promise.all([
        apiGet<{ items: QuestionRow[] }>(`/v1/quizzes/questions?limit=200&is_active=${filter}`),
        apiGet<{ items: EventRow[] }>('/v1/quizzes/events?limit=200'),
        apiGet<{ items: PushRow[] }>('/v1/quizzes/push?limit=200'),
      ]);
      setQuestions(q?.items ?? []);
      setEvents(ev?.items ?? []);
      setPushes(pq?.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load quizzes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(activeFilter); }, [activeFilter]);

  async function deleteEvent(ev: EventRow, force: boolean) {
    try {
      await apiDelete(`/v1/quizzes/events/${ev.id}`, force ? { force: true } : {});
      toast.success(force ? 'Event deleted (awards reversed).' : 'Event deleted.');
      if (results?.kind === 'event' && results.id === ev.id) setResults(null);
      await loadAll();
    } catch (er) {
      if (er instanceof ApiError && er.code === 'ERR_EVENT_HAS_ATTEMPTS') {
        const okForce = window.confirm(
          'This event has submitted attempts. Delete anyway and reverse awarded Punya?',
        );
        if (okForce) await deleteEvent(ev, true);
        return;
      }
      toast.error('Could not delete event.', er instanceof ApiError ? er.message : undefined);
    }
  }

  const actions = (
    <div className="flex items-center gap-2">
      <AddQuestionDialog onAdded={() => void loadAll()} />
      <CreateEventDialog questions={questions.filter((q) => q.is_active)} onAdded={() => void loadAll()} />
      <CreatePushDialog onAdded={() => void loadAll()} />
    </div>
  );

  if (results) {
    return (
      <AdminPageShell
        title="Quizzes"
        subtitle="Question bank, scheduled quiz events, and live push quizzes for your scope."
        actions={actions}
      >
        <AttemptsResultsPanel
          title={results.title}
          kind={results.kind}
          id={results.id}
          onBack={() => setResults(null)}
        />
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      title="Quizzes"
      subtitle="Question bank, scheduled quiz events, and live push quizzes for your scope."
      actions={actions}
    >
      {error ? <AdminError message={error} /> : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tab === 'bank' ? 'default' : 'outline'} onClick={() => setTab('bank')}>
          Question bank ({questions.length})
        </Button>
        <Button size="sm" variant={tab === 'events' ? 'default' : 'outline'} onClick={() => setTab('events')}>
          Quiz events ({events.length})
        </Button>
        <Button size="sm" variant={tab === 'push' ? 'default' : 'outline'} onClick={() => setTab('push')}>
          Push quizzes ({pushes.length})
        </Button>
      </div>

      {tab === 'bank' ? (
        <div className="flex flex-wrap gap-2">
          {([
            ['true', 'Active'],
            ['false', 'Inactive'],
            ['all', 'All'],
          ] as const).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={activeFilter === value ? 'default' : 'outline'}
              onClick={() => setActiveFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      ) : null}

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
      ) : tab === 'bank' ? (
        questions.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No questions yet. Add the first one.</Card>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <Card key={q.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">{q.scope}</span>
                      {q.topic ? <span className="text-xs text-muted-foreground">{q.topic}</span> : null}
                      <span className="text-xs capitalize text-muted-foreground">{q.difficulty}</span>
                      {!q.is_active ? (
                        <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">Inactive</span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm font-medium">{q.question_en}</p>
                    <ul className="mt-2 space-y-1">
                      {q.options.map((o, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${q.correct_indices.includes(i) ? 'border-[hsl(var(--status-success))] bg-status-success-soft text-status-success' : 'border-input text-transparent'}`}>
                            <Check className="h-3 w-3" />
                          </span>
                          <span className={q.correct_indices.includes(i) ? 'font-medium' : ''}>{o.text_en}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <EditQuestionDialog question={q} onSaved={() => void loadAll()} />
                    {q.is_active ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void deactivateQuestion(q.id, () => void loadAll())}
                      >
                        Deactivate
                      </Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : tab === 'events' ? (
        events.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No quiz events yet. Create one.</Card>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => (
              <Card key={ev.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setResults({ kind: 'event', id: ev.id, title: ev.title_en })}
                  >
                    <p className="text-sm font-medium">{ev.title_en}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="capitalize">{ev.scope}</span> · {ev.question_count} questions ·{' '}
                      {ev.participation_points ?? '—'} participation / {ev.win_points ?? '—'} win pts
                    </p>
                    <p className="mt-1 text-xs text-primary">View results</p>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{new Date(ev.start_at).toLocaleString('en-GB')}</div>
                      <div>→ {new Date(ev.end_at).toLocaleString('en-GB')}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => void deleteEvent(ev, false)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : pushes.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No push quizzes yet. Start one.</Card>
      ) : (
        <div className="space-y-3">
          {pushes.map((pq) => (
            <Card
              key={pq.id}
              className="cursor-pointer p-4 transition-colors hover:bg-muted/30"
              onClick={() =>
                setResults({
                  kind: 'push',
                  id: pq.id,
                  title: `Push quiz · ${new Date(pq.started_at).toLocaleString('en-GB')}`,
                })
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
                      {pq.scope}
                    </span>
                    {pq.is_live ? (
                      <span className="rounded bg-status-success-soft px-2 py-0.5 text-xs font-medium text-status-success">
                        Live
                      </span>
                    ) : (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">Ended</span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {pq.question_count} questions · {pq.submitted_count} submitted
                    {pq.completion_points != null ? ` · ${pq.completion_points} pts` : ''}
                  </p>
                  <p className="mt-1 text-xs text-primary">View results</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{new Date(pq.started_at).toLocaleString('en-GB')}</div>
                  <div>expires {new Date(pq.expires_at).toLocaleString('en-GB')}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </AdminPageShell>
  );
}
