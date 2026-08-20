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
import {
  draftToPayload, emptyDraftQ, validateDraft, type DraftQ,
} from '@/pages/admin/quiz-draft';
import {
  PUSH_QUIZ_COMPLETION_FEATURE_KEY,
  QUIZ_PARTICIPATION_FEATURE_KEY,
  QUIZ_WIN_FEATURE_KEY,
  formatPointsOverride,
  pointsPayloadValue,
  pointsPlaceholder,
  useQuizPointFeatures,
  validatePointsField,
} from '@/pages/admin/quiz-points';
import { formatIst, istLocalInputToIso } from '@/pages/admin/quiz-time';

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

/**
 * M16 — API caps mirrored client-side so they surface as field errors instead
 * of "Failed to create event." with an empty details[] and a payload that will
 * fail identically forever.
 */
const MAX_EVENT_QUESTIONS = 100;
const MAX_PUSH_QUESTIONS = 50;

/**
 * M11 — age groups and difficulty are authorable.
 *
 * Both are fully implemented server-side (age_groups drives who a quiz is even
 * offered to), but neither was in any payload, so every web-authored row was
 * difficulty "medium" with no age targeting — and the card rendered that inert
 * default as though it meant something.
 */
const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;
type AgeGroup = (typeof AGE_GROUPS)[number];
const AGE_GROUP_LABELS: Record<AgeGroup, string> = {
  bal: 'Bal',
  kishor: 'Kishor',
  tarun: 'Tarun',
  yuva: 'Yuva',
};

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

/**
 * H5 — the gap has to be findable.
 *
 * Degrading to English is the right runtime behaviour, but it also makes a
 * missing translation invisible to the person who could fix it. CLAUDE.md
 * requires `_en` and `_hi` for all user-facing content; this is how an admin
 * sees which rows still owe one.
 */
function MissingHindiBadge() {
  return (
    <span className="ml-2 rounded bg-status-warning-soft px-2 py-0.5 text-xs text-status-warning">
      Hindi missing
    </span>
  );
}

/**
 * H3/L5 — destructive quiz actions ask first, in the product's own voice.
 *
 * Delete and Reset both fired on a single click. Reset was rendered on every
 * row regardless of state: resetting an unsubmitted attempt blanks a child's
 * answers mid-quiz, and resetting a submitted one reverses their Punya. One
 * misclick in a 200-row roster is unrecoverable. The force-delete path did
 * confirm — via `window.confirm`, which is unstyled and untranslatable — but
 * the ordinary path did not.
 */
function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2 pt-1 text-sm text-muted-foreground">{body}</div>
        <div className="flex justify-end gap-2 pt-3">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgeGroupPicker({
  selected,
  onChange,
  hint,
}: {
  selected: Set<AgeGroup>;
  onChange: (next: Set<AgeGroup>) => void;
  hint: string;
}) {
  function toggle(g: AgeGroup) {
    const next = new Set(selected);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    onChange(next);
  }
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">Age groups</Label>
      <div className="flex flex-wrap gap-2">
        {AGE_GROUPS.map((g) => (
          <Button
            key={g}
            type="button"
            size="sm"
            variant={selected.has(g) ? 'default' : 'outline'}
            aria-pressed={selected.has(g)}
            onClick={() => toggle(g)}
          >
            {AGE_GROUP_LABELS[g]}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function DifficultyPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <FormRow label="Difficulty">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {DIFFICULTIES.map((d) => (
            <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormRow>
  );
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
/**
 * H5 — Hindi is authored here, not just rendered.
 *
 * `_hi` appeared three times in the whole page, all type declarations: there
 * was no field for question_hi or per-option text_hi anywhere, so no
 * web-authored quiz could ever have Hindi, and the mobile `?? _en` fallback was
 * carrying every single string. CLAUDE.md requires `_en` and `_hi` variants for
 * all user-facing content.
 *
 * H4 — text_hi is also round-tripped through the draft. The edit dialog built
 * options from text_en only and the API overwrites the whole options array
 * whenever `options` is present, so changing a topic destroyed every Hindi
 * option on the question.
 */
function QuestionEditor({
  draft, onChange,
}: { draft: DraftQ; onChange: (d: DraftQ) => void }) {
  function setText(v: string) { onChange({ ...draft, question_en: v }); }
  function setTextHi(v: string) { onChange({ ...draft, question_hi: v }); }
  function setOpt(i: number, patch: { text_en?: string; text_hi?: string }) {
    onChange({
      ...draft,
      options: draft.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)),
    });
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
      <FormRow label="Question (Hindi)">
        <Textarea
          value={draft.question_hi ?? ''}
          onChange={(e) => setTextHi(e.target.value)}
          rows={2}
          lang="hi"
          placeholder="देवनागरी में लिखें"
        />
      </FormRow>
      <div className="space-y-2">
        <Label className="text-xs font-medium">Options (tick all correct)</Label>
        {draft.options.map((o, i) => {
          const isCorrect = !!draft.correct[i];
          const optionName = o.text_en.trim() || `option ${i + 1}`;
          return (
            <div key={i} className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => toggle(i)}
                aria-pressed={isCorrect}
                // L2 — the label was a static "Mark correct" on every row and
                // never announced state, so a screen reader could not tell
                // which option was the answer, or that anything had changed.
                aria-label={
                  isCorrect
                    ? `${optionName} is marked correct — tap to unmark`
                    : `Mark ${optionName} correct`
                }
                className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors ${isCorrect ? 'bg-status-success-soft border-[hsl(var(--status-success))] text-status-success' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`}
              >
                <Check className="h-4 w-4" />
              </button>
              <div className="flex-1 space-y-1">
                <Input
                  value={o.text_en}
                  onChange={(e) => setOpt(i, { text_en: e.target.value })}
                  placeholder={`Option ${i + 1} (English)`}
                  aria-label={`Option ${i + 1}, English`}
                />
                <Input
                  value={o.text_hi ?? ''}
                  onChange={(e) => setOpt(i, { text_hi: e.target.value })}
                  placeholder={`विकल्प ${i + 1} (Hindi)`}
                  aria-label={`Option ${i + 1}, Hindi`}
                  lang="hi"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1"
                disabled={draft.options.length <= 2}
                onClick={() => removeOpt(i)}
                // L4 — icon-only, so it announced as an unnamed button.
                aria-label={`Remove ${optionName}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        <Button type="button" size="sm" variant="outline" onClick={addOpt}>
          <Plus className="mr-1 h-4 w-4" />Add option
        </Button>
      </div>
    </div>
  );
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
  const [difficulty, setDifficulty] = useState('medium');
  const [ageGroups, setAgeGroups] = useState<Set<AgeGroup>>(new Set());
  const [draft, setDraft] = useState<DraftQ>(emptyDraftQ());
  const opts = useQuizTargetOptions(open);

  function reset() {
    setScope(defaultScopeForRole(user?.role));
    setSelectedIds(new Set());
    setTopic('');
    setDifficulty('medium');
    setAgeGroups(new Set());
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
        ...(p.question_hi ? { question_hi: p.question_hi } : {}),
        options: p.options,
        correct_indices: p.correct_indices,
        topic: topic.trim() || undefined,
        difficulty,
        age_groups: Array.from(ageGroups),
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
          {opts.error ? <TargetLoadError onRetry={opts.retry} /> : null}
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
            <FormRow label="Topic">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Ahimsa" />
            </FormRow>
            <DifficultyPicker value={difficulty} onChange={setDifficulty} />
          </div>
          <AgeGroupPicker
            selected={ageGroups}
            onChange={setAgeGroups}
            hint="Leave all unselected to make this question available to every age group."
          />
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
  /**
   * H4 — the draft carries text_hi both ways.
   *
   * It used to be built from text_en only, and the API replaces the WHOLE
   * options array whenever `options` is present — so an admin who opened this
   * dialog to fix a typo in the topic silently destroyed every Hindi option on
   * the question. (question_hi survived only because the key was omitted.)
   */
  const draftFromQuestion = (): DraftQ => ({
    question_en: question.question_en,
    question_hi: question.question_hi ?? '',
    options: question.options.map((o) => ({ text_en: o.text_en, text_hi: o.text_hi ?? '' })),
    correct: question.options.map((_, i) => question.correct_indices.includes(i)),
  });
  const [draft, setDraft] = useState<DraftQ>(draftFromQuestion);

  useEffect(() => {
    if (!open) return;
    setTopic(question.topic ?? '');
    setDraft(draftFromQuestion());
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // Explicit null clears it; draftToPayload omits the key when blank, and
        // an omitted key on PATCH means "leave unchanged".
        question_hi: p.question_hi ?? null,
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

/** M2 — the way back. PATCH has always accepted is_active: true. */
async function reactivateQuestion(id: string, onDone: () => void) {
  try {
    await apiPatch(`/v1/quizzes/questions/${id}`, { is_active: true });
    toast.success('Question reactivated.');
    onDone();
  } catch (er) {
    toast.error('Could not reactivate question.', er instanceof ApiError ? er.message : undefined);
  }
}

// ─── Create event (pick questions from the bank) ────────────────────────────
/**
 * M1 — the picker fetches its OWN bank.
 *
 * One `questions` state served both the bank tab and this dialog, so switching
 * the bank filter to "Inactive" emptied the picker and it said "No questions in
 * the bank yet" over a bank of 200 active questions. The causing filter is
 * rendered on the bank tab only, so it was off-screen and unfindable.
 */
function useActiveQuestionBank(open: boolean) {
  const [items, setItems] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void apiGet<{ items: QuestionRow[] }>(`/v1/quizzes/questions?limit=${LIST_MAX}&is_active=true`)
      .then((r) => {
        if (!cancelled) setItems(r?.items ?? []);
      })
      .catch(() => {
        // An empty picker must not read as "the bank is empty" (CTY-ERR-03).
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return { items, loading, failed };
}

function CreateEventDialog({ onAdded }: { onAdded: () => void }) {
  const { user } = useAuth();
  const allowedScopes = allowedScopesForRole(user?.role);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [scope, setScope] = useState<QuizScope>(defaultScopeForRole(user?.role));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [ageGroups, setAgeGroups] = useState<Set<AgeGroup>>(new Set());
  // H2 — empty means "use the punya_features default", NOT zero. These used to
  // be seeded with inlined '5'/'10' that had no relationship to the catalogue.
  const [participation, setParticipation] = useState('');
  const [win, setWin] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const opts = useQuizTargetOptions(open);
  const bank = useActiveQuestionBank(open);
  const pointFeatures = useQuizPointFeatures(open);

  function reset() {
    setTitle('');
    setTitleHi('');
    setScope(defaultScopeForRole(user?.role));
    setSelectedIds(new Set());
    setStartAt('');
    setEndAt('');
    setAgeGroups(new Set());
    setParticipation('');
    setWin('');
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
    // M16 — mirror the API cap so 101 questions is a field error, not a 422.
    if (picked.size > MAX_EVENT_QUESTIONS) {
      toast.error(`Select at most ${MAX_EVENT_QUESTIONS} questions.`);
      return;
    }
    const targetErr = validateTargets(scope, selectedIds);
    if (targetErr) { toast.error(targetErr); return; }
    const pointsErr =
      validatePointsField(participation, 'Participation points', pointFeatures?.[QUIZ_PARTICIPATION_FEATURE_KEY]) ??
      validatePointsField(win, 'Win points', pointFeatures?.[QUIZ_WIN_FEATURE_KEY]);
    if (pointsErr) { toast.error(pointsErr); return; }
    // M13 — the field is a bare wall-clock; read it as IST, not browser-local.
    const startIso = istLocalInputToIso(startAt);
    const endIso = istLocalInputToIso(endAt);
    if (!startIso || !endIso) { toast.error('Start and end times are not valid.'); return; }
    if (new Date(endIso) <= new Date(startIso)) {
      toast.error('The end time must be after the start time.');
      return;
    }
    setBusy(true);
    try {
      // An omitted key stores NULL = "use the catalogue default" (H2). Sending
      // 0 here would DISABLE the award, which is not what a blank field means.
      const participationPoints = pointsPayloadValue(participation);
      const winPoints = pointsPayloadValue(win);
      await apiPost('/v1/quizzes/events', {
        title_en: title.trim(),
        ...(titleHi.trim() ? { title_hi: titleHi.trim() } : {}),
        start_at: startIso,
        end_at: endIso,
        age_groups: Array.from(ageGroups),
        ...(participationPoints !== undefined ? { participation_points: participationPoints } : {}),
        ...(winPoints !== undefined ? { win_points: winPoints } : {}),
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
          <FormRow label="Title (Hindi)">
            <Input
              value={titleHi}
              onChange={(e) => setTitleHi(e.target.value)}
              lang="hi"
              placeholder="देवनागरी में लिखें"
            />
          </FormRow>
          {opts.error ? <TargetLoadError onRetry={opts.retry} /> : null}
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
              <Input
                type="number"
                min={0}
                max={pointFeatures?.[QUIZ_PARTICIPATION_FEATURE_KEY]?.maxPoints || undefined}
                value={participation}
                placeholder={pointsPlaceholder(pointFeatures?.[QUIZ_PARTICIPATION_FEATURE_KEY])}
                onChange={(e) => setParticipation(e.target.value)}
              />
            </FormRow>
            <FormRow label="Win pts">
              <Input
                type="number"
                min={0}
                max={pointFeatures?.[QUIZ_WIN_FEATURE_KEY]?.maxPoints || undefined}
                value={win}
                placeholder={pointsPlaceholder(pointFeatures?.[QUIZ_WIN_FEATURE_KEY])}
                onChange={(e) => setWin(e.target.value)}
              />
            </FormRow>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave a points field blank to use the standard award. Enter 0 to turn that
            award off for this quiz.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {/* M13 — labelled IST and converted as IST, so the window an admin
                types is the window students get, wherever the browser is. */}
            <FormRow label="Start (IST) *">
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </FormRow>
            <FormRow label="End (IST) *">
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </FormRow>
          </div>
          <p className="text-xs text-muted-foreground">
            Times are India Standard Time, whatever your device is set to.
          </p>
          <AgeGroupPicker
            selected={ageGroups}
            onChange={setAgeGroups}
            hint="Leave all unselected to open this quiz to every age group."
          />
          <div className="space-y-2">
            <Label className="text-xs font-medium">
              Questions ({picked.size} of {MAX_EVENT_QUESTIONS} selected) *
            </Label>
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {bank.loading ? (
                <p className="p-2 text-xs text-muted-foreground">Loading the question bank…</p>
              ) : bank.failed ? (
                <p className="p-2 text-xs text-destructive">
                  Couldn&apos;t load the question bank — close and reopen this dialog to retry.
                </p>
              ) : bank.items.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">No questions in the bank yet. Add some first.</p>
              ) : bank.items.map((q) => (
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
                    {q.question_hi ? null : <MissingHindiBadge />}
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
  // H2 — blank = the catalogue default, not 0.
  const [points, setPoints] = useState('');
  const [drafts, setDrafts] = useState<DraftQ[]>([emptyDraftQ()]);
  const opts = useQuizTargetOptions(open);
  const pointFeatures = useQuizPointFeatures(open);

  function reset() {
    setScope('batch');
    setSelectedIds(new Set());
    setMinutes('15');
    setPoints('');
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
    const pointsErr = validatePointsField(
      points,
      'Completion points',
      pointFeatures?.[PUSH_QUIZ_COMPLETION_FEATURE_KEY],
    );
    if (pointsErr) { toast.error(pointsErr); return; }
    setBusy(true);
    try {
      const expires_at = new Date(Date.now() + (Number(minutes) || 15) * 60 * 1000).toISOString();
      const completionPoints = pointsPayloadValue(points);
      await apiPost('/v1/quizzes/push', {
        expires_at,
        ...(completionPoints !== undefined ? { completion_points: completionPoints } : {}),
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
          {opts.error ? <TargetLoadError onRetry={opts.retry} /> : null}
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
              <Input
                type="number"
                min={0}
                max={pointFeatures?.[PUSH_QUIZ_COMPLETION_FEATURE_KEY]?.maxPoints || undefined}
                value={points}
                placeholder={pointsPlaceholder(pointFeatures?.[PUSH_QUIZ_COMPLETION_FEATURE_KEY])}
                onChange={(e) => setPoints(e.target.value)}
              />
            </FormRow>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave completion points blank to use the standard award. Enter 0 to turn it off.
          </p>
          <div className="space-y-3">
            {drafts.map((d, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Question {i + 1}</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={drafts.length <= 1}
                    onClick={() => removeDraft(i)}
                    aria-label={`Remove question ${i + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <QuestionEditor draft={d} onChange={(nd) => setDraft(i, nd)} />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              // M16 — the API caps push quizzes at 50 questions.
              disabled={drafts.length >= MAX_PUSH_QUESTIONS}
              onClick={addDraft}
            >
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
  const [confirmReset, setConfirmReset] = useState<AttemptRow | null>(null);
  /**
   * L6 — the 5s poll used to run forever, error or not.
   *
   * A dropped connection or an expired session meant a request every 5 seconds
   * for as long as the tab stayed open, each one failing, with the stale roster
   * still on screen looking live. Stop after a few consecutive failures and say
   * so, rather than hammering the API in the background.
   */
  const [pollFailures, setPollFailures] = useState(0);
  const POLL_FAILURE_LIMIT = 3;
  const pollStopped = pollFailures >= POLL_FAILURE_LIMIT;

  async function load() {
    try {
      const path =
        kind === 'event'
          ? `/v1/quizzes/events/${id}/attempts`
          : `/v1/quizzes/push/${id}/attempts`;
      const res = await apiGet<AttemptsPayload>(path);
      setData(res);
      setError(null);
      setPollFailures(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attempts.');
      setPollFailures((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }

  function retry() {
    setPollFailures(0);
    setLoading(true);
    void load();
  }

  useEffect(() => {
    void load();
  }, [kind, id]);

  // Live push quizzes: refresh the roster every 5s, until it stops working.
  useEffect(() => {
    if (kind !== 'push' || !data?.is_live || pollStopped) return;
    const t = window.setInterval(() => {
      void load();
    }, 5000);
    return () => window.clearInterval(t);
  }, [kind, id, data?.is_live, pollStopped]);

  async function resetAttempt(row: AttemptRow) {
    if (kind !== 'event') return;
    setResetting(row.attempt_id);
    try {
      await apiPost(`/v1/quizzes/events/${id}/attempts/${row.attempt_id}/reset`, {});
      toast.success('Attempt reset — Punya reversed where awarded.');
      await load();
    } catch (er) {
      toast.error('Could not reset attempt.', er instanceof ApiError ? er.message : undefined);
    } finally {
      setResetting(null);
      setConfirmReset(null);
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
      {pollStopped ? (
        <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span>Live updates stopped after repeated failures — the figures below may be out of date.</span>
          <Button type="button" size="sm" variant="outline" onClick={retry}>Resume</Button>
        </div>
      ) : null}
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
                          {/* L3 — these announced "Q1 Q2 Q3" with no outcome,
                              so the whole column was silent to a screen reader. */}
                          <span className="sr-only">
                            Q{i + 1} {q.correct ? 'correct' : 'incorrect'}
                          </span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {/* M13 — IST, matching the window the admin authored. */}
                    {formatIst(row.submitted_at)}
                  </td>
                  {kind === 'event' ? (
                    <td className="px-3 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        // H3 — an unsubmitted attempt has no award to reverse;
                        // resetting one just blanks a child's answers mid-quiz.
                        disabled={resetting === row.attempt_id || !row.submitted_at}
                        title={row.submitted_at ? undefined : 'Nothing to reset — this attempt is still in progress.'}
                        onClick={() => setConfirmReset(row)}
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

      <ConfirmDialog
        open={!!confirmReset}
        title="Reset this attempt?"
        confirmLabel="Reset attempt"
        busy={!!resetting}
        onCancel={() => setConfirmReset(null)}
        onConfirm={() => { if (confirmReset) void resetAttempt(confirmReset); }}
        body={
          confirmReset ? (
            <>
              <p>
                <span className="font-medium text-foreground">{confirmReset.full_name}</span>
                {confirmReset.centre_name ? ` · ${confirmReset.centre_name}` : ''}
              </p>
              <p>
                Their answers and score will be cleared, and the{' '}
                <span className="font-medium text-foreground">
                  {confirmReset.points_awarded} Punya
                </span>{' '}
                awarded for this quiz will be reversed. They can then take it again.
              </p>
              <p>This cannot be undone.</p>
            </>
          ) : null
        }
      />
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
type Tab = 'bank' | 'events' | 'push';

/** Server clamp on the three quiz list endpoints (clampLimit(…, 100, 300)). */
const LIST_MAX = 300;

/** A full page back means the server had at least this many — the rest is unreachable. */
function TruncationNotice({ count, noun }: { count: number; noun: string }) {
  if (count < LIST_MAX) return null;
  return (
    <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      Showing the newest {LIST_MAX} {noun}. There are more than this — narrow the
      filters to reach them.
    </p>
  );
}

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
  const [confirmDelete, setConfirmDelete] = useState<
    { event: EventRow; submitted: number; inProgress: number } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  /**
   * M12 — search, because the lists clamp at LIST_MAX with no cursor.
   *
   * The tab label read "Question bank (200)" as if it were a true count, and
   * anything past row 200 was simply unreachable — no offset, no cursor, no
   * search. Server-side filtering is the reachable half of the fix; real keyset
   * paging still needs a cursor (see TruncationNotice).
   */
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  async function loadAll(
    filter: 'true' | 'false' | 'all' = activeFilter,
    q: string = appliedSearch,
  ) {
    setLoading(true);
    setError(null);
    try {
      // XC-WEB-02 — these three endpoints clamp at LIST_MAX and expose no
      // cursor, so anything past it is unreachable. Ask for the full clamp and
      // report the ceiling rather than showing a truncated prefix as if it were
      // the whole list. M12 adds server-side search so rows past the clamp are
      // at least REACHABLE; real paging still needs cursors (see the notice
      // rendered below), and push quizzes additionally order by a computed
      // expiry-then-start expression that keyset paging cannot express as-is.
      const term = q.trim() ? `&q=${encodeURIComponent(q.trim())}` : '';
      const [qs, ev, pq] = await Promise.all([
        apiGet<{ items: QuestionRow[] }>(
          `/v1/quizzes/questions?limit=${LIST_MAX}&is_active=${filter}${term}`,
        ),
        apiGet<{ items: EventRow[] }>(`/v1/quizzes/events?limit=${LIST_MAX}${term}`),
        apiGet<{ items: PushRow[] }>(`/v1/quizzes/push?limit=${LIST_MAX}`),
      ]);
      setQuestions(qs?.items ?? []);
      setEvents(ev?.items ?? []);
      setPushes(pq?.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load quizzes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(activeFilter, appliedSearch); }, [activeFilter, appliedSearch]);

  /**
   * H3 — Delete is confirmed on BOTH paths.
   *
   * A single click hard-deleted the event. The API's 409 only fired for
   * SUBMITTED attempts, so an event with 30 students mid-quiz deleted silently
   * and destroyed their in-progress work; the server now counts every attempt
   * and reports both numbers in `details`, which this dialog reads back.
   */
  async function deleteEvent(ev: EventRow, force: boolean) {
    setDeleting(true);
    try {
      await apiDelete(`/v1/quizzes/events/${ev.id}`, force ? { force: true } : {});
      toast.success(force ? 'Event deleted (awards reversed).' : 'Event deleted.');
      if (results?.kind === 'event' && results.id === ev.id) setResults(null);
      setConfirmDelete(null);
      await loadAll();
    } catch (er) {
      if (er instanceof ApiError && er.code === 'ERR_EVENT_HAS_ATTEMPTS') {
        const detail = Array.isArray(er.details) ? er.details[0] : undefined;
        const counts = (detail ?? {}) as { submitted_attempts?: number; in_progress_attempts?: number };
        setConfirmDelete({
          event: ev,
          submitted: counts.submitted_attempts ?? 0,
          inProgress: counts.in_progress_attempts ?? 0,
        });
        return;
      }
      toast.error('Could not delete event.', er instanceof ApiError ? er.message : undefined);
    } finally {
      setDeleting(false);
    }
  }

  const actions = (
    <div className="flex items-center gap-2">
      <AddQuestionDialog onAdded={() => void loadAll()} />
      <CreateEventDialog onAdded={() => void loadAll()} />
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

      {/* M12 — the lists clamp with no cursor, so search is how a row past the
          ceiling is reached at all. Server-side, not a filter over the page. */}
      {tab !== 'push' ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); setAppliedSearch(search); }}
        >
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'bank' ? 'Search question or topic…' : 'Search event title…'}
            aria-label={tab === 'bank' ? 'Search the question bank' : 'Search quiz events'}
            className="max-w-xs"
          />
          <Button size="sm" type="submit" variant="outline">Search</Button>
          {appliedSearch ? (
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => { setSearch(''); setAppliedSearch(''); }}
            >
              Clear
            </Button>
          ) : null}
        </form>
      ) : null}

      {tab === 'bank' ? <TruncationNotice count={questions.length} noun="questions" /> : null}
      {tab === 'events' ? <TruncationNotice count={events.length} noun="quiz events" /> : null}
      {tab === 'push' ? <TruncationNotice count={pushes.length} noun="push quizzes" /> : null}

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
                      {/* H5 — surface the gap where someone can act on it. */}
                      {!q.question_hi || q.options.some((o) => !o.text_hi) ? <MissingHindiBadge /> : null}
                    </div>
                    <p className="mt-2 text-sm font-medium">{q.question_en}</p>
                    {q.question_hi ? (
                      <p className="mt-1 text-sm text-muted-foreground" lang="hi">{q.question_hi}</p>
                    ) : null}
                    <ul className="mt-2 space-y-1">
                      {q.options.map((o, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${q.correct_indices.includes(i) ? 'border-[hsl(var(--status-success))] bg-status-success-soft text-status-success' : 'border-input text-transparent'}`}>
                            <Check className="h-3 w-3" />
                          </span>
                          <span className={q.correct_indices.includes(i) ? 'font-medium' : ''}>
                            {o.text_en}
                            {o.text_hi ? (
                              <span className="ml-2 text-muted-foreground" lang="hi">· {o.text_hi}</span>
                            ) : null}
                          </span>
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
                    ) : (
                      /* M2 — deactivation was a one-way door: Edit is disabled
                         and nothing else rendered, though PATCH has always
                         accepted is_active: true. The 409 copy tells admins to
                         "deactivate it and author a new question", which made
                         that door permanent. */
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void reactivateQuestion(q.id, () => void loadAll())}
                      >
                        Reactivate
                      </Button>
                    )}
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
                    <p className="text-sm font-medium">
                      {ev.title_en}
                      {ev.title_hi ? null : <MissingHindiBadge />}
                    </p>
                    {ev.title_hi ? (
                      <p className="text-xs text-muted-foreground" lang="hi">{ev.title_hi}</p>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="capitalize">{ev.scope}</span> · {ev.question_count} questions ·{' '}
                      {formatPointsOverride(ev.participation_points)} participation / {formatPointsOverride(ev.win_points)} win pts
                    </p>
                    <p className="mt-1 text-xs text-primary">View results</p>
                  </button>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <div className="text-right text-xs text-muted-foreground">
                      {/* M13 — IST, matching the labelled inputs. */}
                      <div>{formatIst(ev.start_at)}</div>
                      <div>→ {formatIst(ev.end_at)}</div>
                      <div className="text-[10px] uppercase tracking-wide">IST</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setConfirmDelete({ event: ev, submitted: 0, inProgress: 0 })
                      }
                    >
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
          {pushes.map((pq) => {
            const openResults = () =>
              setResults({
                kind: 'push',
                id: pq.id,
                title: `Push quiz · ${formatIst(pq.started_at)} IST`,
              });
            return (
            <Card
              key={pq.id}
              // L1 — the card was mouse-only: no role, no tabIndex, no key
              // handler, so keyboard and screen-reader users had no way into
              // the push results at all.
              role="button"
              tabIndex={0}
              aria-label={`Push quiz started ${formatIst(pq.started_at)} IST — view results`}
              className="cursor-pointer p-4 transition-colors hover:bg-muted/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={openResults}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openResults();
                }
              }}
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
                     · {formatPointsOverride(pq.completion_points)} pts
                  </p>
                  <p className="mt-1 text-xs text-primary">View results</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div>{formatIst(pq.started_at)}</div>
                  <div>expires {formatIst(pq.expires_at)}</div>
                  <div className="text-[10px] uppercase tracking-wide">IST</div>
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete this quiz event?"
        confirmLabel={
          confirmDelete && (confirmDelete.submitted > 0 || confirmDelete.inProgress > 0)
            ? 'Delete and reverse Punya'
            : 'Delete event'
        }
        busy={deleting}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return;
          const needsForce = confirmDelete.submitted > 0 || confirmDelete.inProgress > 0;
          void deleteEvent(confirmDelete.event, needsForce);
        }}
        body={
          confirmDelete ? (
            <>
              <p className="font-medium text-foreground">{confirmDelete.event.title_en}</p>
              {confirmDelete.submitted > 0 ? (
                <p>
                  {confirmDelete.submitted} student(s) have already submitted. Their answers
                  will be deleted and the Punya they earned reversed.
                </p>
              ) : null}
              {confirmDelete.inProgress > 0 ? (
                <p>
                  {confirmDelete.inProgress} student(s) are still taking it right now. Their
                  answers so far will be lost.
                </p>
              ) : null}
              {confirmDelete.submitted === 0 && confirmDelete.inProgress === 0 ? (
                <p>The event and its question links will be removed.</p>
              ) : null}
              <p>This cannot be undone.</p>
            </>
          ) : null
        }
      />
    </AdminPageShell>
  );
}
