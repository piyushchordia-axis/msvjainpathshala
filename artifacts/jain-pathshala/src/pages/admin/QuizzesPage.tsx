import { useEffect, useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
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
  participation_points: number;
  win_points: number;
  question_count: number;
  created_at: string;
}

interface CentreRow { id: string; name: string; }

const QUIZ_SCOPES = ['national', 'state', 'city', 'centre', 'batch'] as const;

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
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
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors ${draft.correct[i] ? 'bg-emerald-500/10 border-emerald-500 text-emerald-700' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`}
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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string>('national');
  const [topic, setTopic] = useState('');
  const [draft, setDraft] = useState<DraftQ>(emptyDraftQ());

  function reset() { setScope('national'); setTopic(''); setDraft(emptyDraftQ()); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateDraft(draft);
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const p = draftToPayload(draft);
      await apiPost('/v1/quizzes/questions', {
        question_en: p.question_en,
        options: p.options,
        correct_indices: p.correct_indices,
        scope,
        topic: topic.trim() || undefined,
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
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add question to bank</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Scope">
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUIZ_SCOPES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Topic">
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Ahimsa" />
            </FormRow>
          </div>
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

// ─── Create event (pick questions from the bank) ────────────────────────────
function CreateEventDialog({ questions, onAdded }: { questions: QuestionRow[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState<string>('city');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [participation, setParticipation] = useState('5');
  const [win, setWin] = useState('10');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function reset() {
    setTitle(''); setScope('city'); setStartAt(''); setEndAt('');
    setParticipation('5'); setWin('10'); setPicked(new Set());
  }

  function togglePick(id: string) {
    setPicked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error('Title is required.'); return; }
    if (!startAt || !endAt) { toast.error('Start and end times are required.'); return; }
    if (picked.size === 0) { toast.error('Select at least one question.'); return; }
    setBusy(true);
    try {
      await apiPost('/v1/quizzes/events', {
        title_en: title.trim(),
        scope,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        participation_points: Number(participation) || 0,
        win_points: Number(win) || 0,
        question_ids: Array.from(picked),
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
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Create quiz event</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Title (English) *">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormRow>
          <div className="grid grid-cols-3 gap-3">
            <FormRow label="Scope">
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUIZ_SCOPES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
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
function CreatePushDialog({ centres, onAdded }: { centres: CentreRow[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [batchId, setBatchId] = useState('');
  const [minutes, setMinutes] = useState('15');
  const [points, setPoints] = useState('5');
  const [drafts, setDrafts] = useState<DraftQ[]>([emptyDraftQ()]);

  function reset() { setBatchId(''); setMinutes('15'); setPoints('5'); setDrafts([emptyDraftQ()]); }

  function setDraft(i: number, d: DraftQ) {
    setDrafts((prev) => prev.map((x, idx) => (idx === i ? d : x)));
  }
  function addDraft() { setDrafts((prev) => [...prev, emptyDraftQ()]); }
  function removeDraft(i: number) {
    setDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!batchId.trim()) { toast.error('A batch id is required.'); return; }
    for (const d of drafts) {
      const err = validateDraft(d);
      if (err) { toast.error(err); return; }
    }
    setBusy(true);
    try {
      const expires_at = new Date(Date.now() + (Number(minutes) || 15) * 60 * 1000).toISOString();
      await apiPost('/v1/quizzes/push', {
        batch_id: batchId.trim(),
        expires_at,
        completion_points: Number(points) || 0,
        questions: drafts.map((d) => draftToPayload(d)),
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
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Start a live push quiz</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <div className="grid grid-cols-3 gap-3">
            <FormRow label="Batch id *">
              <Input value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="UUID" />
            </FormRow>
            <FormRow label="Expires in (min)">
              <Input type="number" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </FormRow>
            <FormRow label="Completion pts">
              <Input type="number" min={0} value={points} onChange={(e) => setPoints(e.target.value)} />
            </FormRow>
          </div>
          {centres.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Paste a batch UUID from one of your centres ({centres.map((c) => c.name).join(', ')}).
            </p>
          ) : null}
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

// ─── Page ───────────────────────────────────────────────────────────────────
type Tab = 'bank' | 'events';

export default function QuizzesPage() {
  const [tab, setTab] = useState<Tab>('bank');
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [centres, setCentres] = useState<CentreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [q, ev, ce] = await Promise.all([
        apiGet<{ items: QuestionRow[] }>('/v1/quizzes/questions?limit=200'),
        apiGet<{ items: EventRow[] }>('/v1/quizzes/events?limit=200'),
        apiGet<{ items: CentreRow[] }>('/v1/admin/centres').catch(() => ({ items: [] as CentreRow[] })),
      ]);
      setQuestions(q?.items ?? []);
      setEvents(ev?.items ?? []);
      setCentres(ce?.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load quizzes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  const actions = (
    <div className="flex items-center gap-2">
      <AddQuestionDialog onAdded={loadAll} />
      <CreateEventDialog questions={questions} onAdded={loadAll} />
      <CreatePushDialog centres={centres} onAdded={loadAll} />
    </div>
  );

  return (
    <AdminPageShell
      title="Quizzes"
      subtitle="Question bank, scheduled quiz events, and live push quizzes for your scope."
      actions={actions}
    >
      {error ? <AdminError message={error} /> : null}

      <div className="flex gap-2">
        <Button size="sm" variant={tab === 'bank' ? 'default' : 'outline'} onClick={() => setTab('bank')}>
          Question bank ({questions.length})
        </Button>
        <Button size="sm" variant={tab === 'events' ? 'default' : 'outline'} onClick={() => setTab('events')}>
          Quiz events ({events.length})
        </Button>
      </div>

      {loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
      ) : tab === 'bank' ? (
        questions.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No questions yet. Add the first one.</Card>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <Card key={q.id} className="p-4">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">{q.scope}</span>
                  {q.topic ? <span className="text-xs text-muted-foreground">{q.topic}</span> : null}
                  <span className="text-xs capitalize text-muted-foreground">{q.difficulty}</span>
                </div>
                <p className="mt-2 text-sm font-medium">{q.question_en}</p>
                <ul className="mt-2 space-y-1">
                  {q.options.map((o, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm">
                      <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${q.correct_indices.includes(i) ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700' : 'border-input text-transparent'}`}>
                        <Check className="h-3 w-3" />
                      </span>
                      <span className={q.correct_indices.includes(i) ? 'font-medium' : ''}>{o.text_en}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )
      ) : (
        events.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No quiz events yet. Create one.</Card>
        ) : (
          <div className="space-y-3">
            {events.map((ev) => (
              <Card key={ev.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{ev.title_en}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="capitalize">{ev.scope}</span> · {ev.question_count} questions ·{' '}
                      {ev.participation_points} participation / {ev.win_points} win pts
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{new Date(ev.start_at).toLocaleString('en-GB')}</div>
                    <div>→ {new Date(ev.end_at).toLocaleString('en-GB')}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}
    </AdminPageShell>
  );
}
