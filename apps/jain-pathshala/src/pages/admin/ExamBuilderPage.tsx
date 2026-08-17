import { useEffect, useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { apiGet, apiPost, del, ApiError } from '@/lib/api-client';
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

interface ExamOption {
  id: string;
  exam_id?: string;
  title_en: string;
  city_name?: string;
  window_start?: string;
  total_marks?: number;
  question_marks_total?: number;
}

/** Same-named exams were indistinguishable in the picker (CTY-DSN-06). */
function examOptionLabel(e: ExamOption): string {
  const parts = [e.title_en];
  if (e.city_name) parts.push(e.city_name);
  if (e.window_start) {
    parts.push(new Date(e.window_start).toLocaleDateString('en-GB'));
  }
  return parts.join(' · ');
}

interface QuestionOption {
  id: string;
  option_en: string;
  option_hi: string | null;
  is_correct: boolean;
  order_index: number;
}

interface QuestionRow {
  id: string;
  question_en: string;
  question_hi: string | null;
  question_type: 'single_choice' | 'multi_choice' | 'text';
  marks: number;
  order_index: number;
  options: QuestionOption[];
}

const QUESTION_TYPES = [
  { value: 'single_choice', label: 'Single choice' },
  { value: 'multi_choice', label: 'Multi choice' },
  { value: 'text', label: 'Text (manual grading)' },
] as const;

interface DraftOption { option_en: string; option_hi: string; is_correct: boolean; }

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs font-medium">{label}</Label>{children}</div>;
}

function AddQuestionDialog({ examId, onAdded }: { examId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [textHi, setTextHi] = useState('');
  const [type, setType] = useState<'single_choice' | 'multi_choice' | 'text'>('single_choice');
  const [marks, setMarks] = useState('1');
  const [options, setOptions] = useState<DraftOption[]>([
    { option_en: '', option_hi: '', is_correct: false },
    { option_en: '', option_hi: '', is_correct: false },
  ]);

  const isChoice = type === 'single_choice' || type === 'multi_choice';

  function reset() {
    setText(''); setTextHi(''); setType('single_choice'); setMarks('1');
    setOptions([
      { option_en: '', option_hi: '', is_correct: false },
      { option_en: '', option_hi: '', is_correct: false },
    ]);
  }

  function setOptionText(i: number, field: 'option_en' | 'option_hi', value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  }

  function toggleCorrect(i: number) {
    setOptions((prev) => prev.map((o, idx) => {
      if (idx !== i) {
        return type === 'single_choice' ? { ...o, is_correct: false } : o;
      }
      return { ...o, is_correct: !o.is_correct };
    }));
  }

  function addOption() {
    setOptions((prev) => [...prev, { option_en: '', option_hi: '', is_correct: false }]);
  }

  function removeOption(i: number) {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function validate(): string | null {
    if (!text.trim()) return 'Question text (English) is required.';
    if (!textHi.trim()) return 'Question text (Hindi) is required.';
    if (!isChoice) return null;
    const filled = options.filter((o) => o.option_en.trim());
    if (filled.length < 2) return 'Choice questions need at least two options.';
    const correct = filled.filter((o) => o.is_correct).length;
    if (type === 'single_choice' && correct !== 1) return 'Mark exactly one correct option.';
    if (type === 'multi_choice' && correct < 1) return 'Mark at least one correct option.';
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate();
    if (err) { toast.error(err); return; }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        question_en: text.trim(),
        question_hi: textHi.trim(),
        question_type: type,
        marks: Number(marks) || 1,
      };
      if (isChoice) {
        payload.options = options
          .filter((o) => o.option_en.trim())
          .map((o) => ({
            option_en: o.option_en.trim(),
            option_hi: o.option_hi.trim() || undefined,
            is_correct: o.is_correct,
          }));
      }
      await apiPost(`/v1/exams/${examId}/questions`, payload);
      toast.success('Question added.');
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
        <DialogHeader><DialogTitle>Add question</DialogTitle></DialogHeader>
        <form className="space-y-4 pt-2" onSubmit={submit}>
          <FormRow label="Question (English) *">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} required />
          </FormRow>
          <FormRow label="Question (Hindi) *">
            <Textarea value={textHi} onChange={(e) => setTextHi(e.target.value)} rows={2} required placeholder="प्रश्न…" />
          </FormRow>
          <div className="grid grid-cols-2 gap-3">
            <FormRow label="Type *">
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUESTION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Marks *">
              <Input type="number" min={1} max={100} value={marks} onChange={(e) => setMarks(e.target.value)} />
            </FormRow>
          </div>

          {isChoice ? (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Options ({type === 'single_choice' ? 'one correct' : 'one or more correct'})</Label>
              {options.map((o, i) => (
                <div key={i} className="space-y-1.5 rounded-md border border-border p-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleCorrect(i)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded border transition-colors ${o.is_correct ? 'bg-status-success-soft border-[hsl(var(--status-success))] text-status-success' : 'border-input bg-background text-muted-foreground hover:bg-muted'}`}
                      aria-label="Mark correct"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <Input
                      value={o.option_en}
                      onChange={(e) => setOptionText(i, 'option_en', e.target.value)}
                      placeholder={`Option ${i + 1} (English)`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={options.length <= 2}
                      onClick={() => removeOption(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Input
                    value={o.option_hi}
                    onChange={(e) => setOptionText(i, 'option_hi', e.target.value)}
                    placeholder={`विकल्प ${i + 1} (हिंदी)`}
                    className="ml-10"
                  />
                </div>
              ))}
              <Button type="button" size="sm" variant="outline" onClick={addOption}>
                <Plus className="mr-1 h-4 w-4" />Add option
              </Button>
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={busy || !text.trim() || !textHi.trim()}>{busy ? 'Saving…' : 'Add question'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QuestionCard({ examId, q, onChanged }: { examId: string; q: QuestionRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    if (!window.confirm('Delete this question?')) return;
    setBusy(true);
    try {
      await del(`/v1/exams/${examId}/questions/${q.id}`);
      toast.success('Question deleted.');
      onChanged();
    } catch (err) {
      toast.error('Failed to delete question.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium capitalize text-muted-foreground">
              {q.question_type.replace('_', ' ')}
            </span>
            <span className="text-xs text-muted-foreground">{q.marks} {q.marks === 1 ? 'mark' : 'marks'}</span>
          </div>
          <p className="mt-2 text-sm font-medium">{q.question_en}</p>
          {q.question_hi ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{q.question_hi}</p>
          ) : null}
          {q.question_type !== 'text' ? (
            <ul className="mt-2 space-y-1">
              {q.options.map((o) => (
                <li key={o.id} className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${o.is_correct ? 'border-[hsl(var(--status-success))] bg-status-success-soft text-status-success' : 'border-input text-transparent'}`}>
                    <Check className="h-3 w-3" />
                  </span>
                  <span className={o.is_correct ? 'font-medium' : ''}>
                    {o.option_en}
                    {o.option_hi ? <span className="text-muted-foreground"> / {o.option_hi}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs italic text-muted-foreground">Free-text answer — graded manually.</p>
          )}
        </div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={remove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

export default function ExamBuilderPage() {
  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState('');
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: ExamOption[] }>('/v1/admin/exams?limit=100')
      .then((r) => setExams(r?.items ?? []))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load exams.'));
  }, []);

  async function loadQuestions(id: string) {
    if (!id) { setQuestions([]); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: QuestionRow[] }>(`/v1/exams/${id}/questions`);
      setQuestions(res?.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load questions.');
    } finally {
      setLoading(false);
    }
  }

  function onSelect(id: string) {
    setExamId(id);
    void loadQuestions(id);
  }

  const selectedExam = exams.find((e) => e.id === examId) ?? null;
  // Running paper total vs declared total (CTY-API-07b) — the builder never
  // showed the sum, so a 20-mark paper declared out of 100 looked finished.
  const questionSum = questions.reduce((acc, q) => acc + (q.marks ?? 0), 0);
  const declaredTotal = selectedExam?.total_marks;
  const marksMismatch =
    declaredTotal !== undefined && !loading && questionSum !== declaredTotal;

  return (
    <AdminPageShell
      title="Exam builder"
      subtitle="Author questions and options for online exams in your city."
      actions={examId ? <AddQuestionDialog examId={examId} onAdded={() => loadQuestions(examId)} /> : undefined}
    >
      {error ? <AdminError message={error} /> : null}

      <Card className="p-4">
        <div className="max-w-sm space-y-1">
          <Label className="text-xs font-medium">Exam</Label>
          <Select value={examId} onValueChange={onSelect}>
            <SelectTrigger><SelectValue placeholder="Select an exam" /></SelectTrigger>
            <SelectContent>
              {exams.map((e) => <SelectItem key={e.id} value={e.id}>{examOptionLabel(e)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {examId && declaredTotal !== undefined ? (
          <p className={`mt-3 text-sm ${marksMismatch ? 'font-medium text-destructive' : 'text-muted-foreground'}`}>
            Question marks: {questionSum} / declared total: {declaredTotal}
            {marksMismatch
              ? ' — results cannot be released until these match. Add questions or edit the exam total.'
              : ' — matches.'}
          </p>
        ) : null}
      </Card>

      {!examId ? (
        <Card className="p-6 text-sm text-muted-foreground">Select an exam to view and edit its questions.</Card>
      ) : loading ? (
        <Card className="p-6 text-sm text-muted-foreground">Loading…</Card>
      ) : questions.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No questions yet. Add the first one.</Card>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <QuestionCard key={q.id} examId={examId} q={q} onChanged={() => loadQuestions(examId)} />
          ))}
        </div>
      )}
    </AdminPageShell>
  );
}
