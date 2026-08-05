/**
 * Admin exam grading - mark free-text answers for submitted attempts.
 * Choice questions are auto-scored; this screen only awards marks for text.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Redirect } from 'wouter';
import { canAdministerExams } from '@workspace/api-zod';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminError } from '@/components/admin/AdminPageShell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface ExamOption {
  id: string;
  title_en: string;
}

interface AttemptListRow {
  id: string;
  student_name: string;
  student_code: string;
  status: string;
  score: number | null;
  auto_score: number | null;
  manual_score: number | null;
  needs_grading: boolean;
  started_at: string;
  submitted_at: string | null;
}

interface QuestionOption {
  id: string;
  option_en: string;
  option_hi: string | null;
}

interface QuestionRow {
  id: string;
  options: QuestionOption[];
}

interface AttemptAnswer {
  question_id: string;
  question_en: string;
  question_hi: string | null;
  question_type: 'single_choice' | 'multi_choice' | 'text' | string;
  marks: number;
  selected_option_ids: string[];
  text_answer: string | null;
  is_correct: boolean | null;
  marks_awarded: number | null;
  admin_comment: string | null;
}

interface AttemptDetail {
  id: string;
  student_name: string;
  student_code: string;
  status: string;
  score: number | null;
  auto_score: number | null;
  manual_score: number | null;
  needs_grading: boolean;
  answers: AttemptAnswer[];
}

interface GradeResponse {
  attempt_id: string;
  status: string;
  score?: number;
  needs_grading?: boolean;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function ExamGradingPage() {
  const { user } = useAuth();
  const allowed = canAdministerExams(user?.role);

  const [exams, setExams] = useState<ExamOption[]>([]);
  const [examId, setExamId] = useState('');
  const [attempts, setAttempts] = useState<AttemptListRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [needsOnly, setNeedsOnly] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  /** Text question_id -> marks string in the input. */
  const [marksDraft, setMarksDraft] = useState<Record<string, string>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const optionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const q of questions) {
      for (const o of q.options ?? []) {
        map.set(o.id, o.option_en);
      }
    }
    return map;
  }, [questions]);

  useEffect(() => {
    if (!allowed) return;
    void apiGet<{ items: ExamOption[] }>('/v1/admin/exams?limit=100')
      .then((r) => setExams(r?.items ?? []))
      .catch((err) =>
        setListError(err instanceof ApiError ? err.message : 'Could not load exams.'),
      );
  }, [allowed]);

  const loadAttempts = useCallback(async (id: string) => {
    if (!id) {
      setAttempts([]);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const [attRes, qRes] = await Promise.all([
        apiGet<{ items: AttemptListRow[] }>(`/v1/admin/exams/${id}/attempts`),
        apiGet<{ items: QuestionRow[] }>(`/v1/exams/${id}/questions`),
      ]);
      setAttempts(attRes?.items ?? []);
      setQuestions(qRes?.items ?? []);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Could not load attempts.');
      setAttempts([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  function onSelectExam(id: string) {
    setExamId(id);
    setSelectedId(null);
    setDetail(null);
    setMarksDraft({});
    void loadAttempts(id);
  }

  const visibleAttempts = useMemo(() => {
    const filtered = needsOnly ? attempts.filter((a) => a.needs_grading) : attempts;
    return [...filtered].sort((a, b) => {
      if (a.needs_grading !== b.needs_grading) return a.needs_grading ? -1 : 1;
      const at = a.submitted_at ?? a.started_at;
      const bt = b.submitted_at ?? b.started_at;
      return bt.localeCompare(at);
    });
  }, [attempts, needsOnly]);

  async function openAttempt(attemptId: string) {
    if (!examId) return;
    setSelectedId(attemptId);
    setDetailLoading(true);
    setDetailError(null);
    setDetail(null);
    setMarksDraft({});
    setCommentDraft({});
    try {
      const res = await apiGet<AttemptDetail>(`/v1/exams/${examId}/attempts/${attemptId}`);
      setDetail(res);
      const draft: Record<string, string> = {};
      const comments: Record<string, string> = {};
      for (const a of res.answers ?? []) {
        if (a.question_type === 'text') {
          draft[a.question_id] =
            a.marks_awarded != null ? String(a.marks_awarded) : '';
          comments[a.question_id] = a.admin_comment ?? '';
        }
      }
      setMarksDraft(draft);
      setCommentDraft(comments);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : 'Could not load this attempt.');
    } finally {
      setDetailLoading(false);
    }
  }

  const textAnswers = useMemo(
    () => (detail?.answers ?? []).filter((a) => a.question_type === 'text'),
    [detail],
  );

  const runningManual = useMemo(() => {
    let sum = 0;
    for (const a of textAnswers) {
      const raw = marksDraft[a.question_id];
      if (raw === undefined || raw.trim() === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      sum += Math.max(0, Math.min(Math.trunc(n), a.marks));
    }
    return sum;
  }, [textAnswers, marksDraft]);

  const autoScore = detail?.auto_score ?? 0;
  const runningTotal = autoScore + runningManual;

  function setMark(questionId: string, max: number, value: string) {
    // Allow empty while typing; clamp when numeric.
    if (value.trim() === '') {
      setMarksDraft((prev) => ({ ...prev, [questionId]: '' }));
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(0, Math.min(Math.trunc(n), max));
    setMarksDraft((prev) => ({ ...prev, [questionId]: String(clamped) }));
  }

  async function submitGrades() {
    if (!examId || !detail) return;
    const grades: { question_id: string; marks_awarded: number; admin_comment?: string }[] = [];
    for (const a of textAnswers) {
      const raw = marksDraft[a.question_id];
      if (raw === undefined || raw.trim() === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      const comment = (commentDraft[a.question_id] ?? '').trim();
      grades.push({
        question_id: a.question_id,
        marks_awarded: Math.max(0, Math.min(Math.trunc(n), a.marks)),
        ...(comment ? { admin_comment: comment } : {}),
      });
    }
    if (grades.length === 0) {
      toast.error('Enter marks for at least one text question before you submit.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<GradeResponse>(
        `/v1/exams/${examId}/attempts/${detail.id}/grade`,
        { grades },
      );
      if (res.status === 'graded') {
        toast.success(
          `Grading finalized. Total score: ${res.score ?? runningTotal}.`,
        );
      } else {
        toast.success(
          'Marks saved. This attempt still needs grading on remaining text answers.',
        );
      }
      await loadAttempts(examId);
      await openAttempt(detail.id);
    } catch (err) {
      toast.error(
        'Could not save grades.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return <Redirect to="/admin" />;
  }

  return (
    <AdminPageShell
      title="Exam grading"
      subtitle="Award marks for free-text answers. Choice questions are scored automatically."
    >
      {listError ? <AdminError message={listError} /> : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="max-w-sm flex-1 space-y-1">
            <Label className="text-xs font-medium">Exam</Label>
            <Select value={examId} onValueChange={onSelectExam}>
              <SelectTrigger>
                <SelectValue placeholder="Select an exam" />
              </SelectTrigger>
              <SelectContent>
                {exams.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.title_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input accent-primary"
              checked={needsOnly}
              onChange={(e) => setNeedsOnly(e.target.checked)}
              disabled={!examId}
            />
            <span>Needs grading</span>
          </label>
        </div>
      </Card>

      {!examId ? (
        <Card className="p-6 text-sm text-muted-foreground">
          Select an exam to see submitted attempts.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-medium">
                Attempts ({visibleAttempts.length})
              </p>
            </div>
            {listLoading ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</p>
            ) : visibleAttempts.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {needsOnly
                  ? 'No attempts need grading right now.'
                  : 'No attempts for this exam yet.'}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {visibleAttempts.map((a) => {
                  const active = selectedId === a.id;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => void openAttempt(a.id)}
                        className={cn(
                          'flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                          active && 'bg-accent',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium">{a.student_name}</p>
                            <p className="text-xs text-muted-foreground">{a.student_code}</p>
                          </div>
                          {a.needs_grading ? (
                            <Badge
                              variant="outline"
                              className="border-status-warning bg-status-warning-soft text-status-warning"
                            >
                              Needs grading
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="capitalize">
                              {a.status}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Submitted {formatWhen(a.submitted_at)}
                          {a.score != null ? ` · Score ${a.score}` : ''}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            {!selectedId ? (
              <p className="text-sm text-muted-foreground">
                Choose an attempt to review answers and award marks.
              </p>
            ) : detailLoading ? (
              <p className="text-sm text-muted-foreground">Loading attempt...</p>
            ) : detailError ? (
              <AdminError message={detailError} />
            ) : detail ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-display text-lg text-secondary">{detail.student_name}</h3>
                    <p className="text-sm text-muted-foreground">{detail.student_code}</p>
                  </div>
                  {detail.needs_grading ? (
                    <Badge
                      variant="outline"
                      className="border-status-warning bg-status-warning-soft text-status-warning"
                    >
                      Needs grading
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="capitalize">
                      {detail.status}
                    </Badge>
                  )}
                </div>

                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Running total: </span>
                  <span className="font-medium">
                    {autoScore} auto + {runningManual} manual = {runningTotal}
                  </span>
                </div>

                <div className="space-y-3">
                  {(detail.answers ?? []).map((a, idx) => {
                    const isText = a.question_type === 'text';
                    const selectedLabels = (a.selected_option_ids ?? [])
                      .map((id) => optionLabelById.get(id) ?? id)
                      .filter(Boolean);
                    return (
                      <div
                        key={a.question_id}
                        className="rounded-md border border-border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            Q{idx + 1}
                          </span>
                          <span className="rounded bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                            {String(a.question_type).replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {a.marks} {a.marks === 1 ? 'mark' : 'marks'}
                          </span>
                          {!isText && a.is_correct != null ? (
                            <span
                              className={cn(
                                'text-xs font-medium',
                                a.is_correct
                                  ? 'text-status-success'
                                  : 'text-destructive',
                              )}
                            >
                              {a.is_correct ? 'Correct' : 'Incorrect'}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 text-sm font-medium">{a.question_en}</p>

                        {isText ? (
                          <div className="mt-3 space-y-2">
                            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-sm">
                              {a.text_answer?.trim()
                                ? a.text_answer
                                : 'No answer submitted.'}
                            </p>
                            <div className="flex max-w-[10rem] flex-col gap-1">
                              <Label className="text-xs font-medium">
                                Marks (0-{a.marks})
                              </Label>
                              <Input
                                type="number"
                                min={0}
                                max={a.marks}
                                step={1}
                                value={marksDraft[a.question_id] ?? ''}
                                onChange={(e) =>
                                  setMark(a.question_id, a.marks, e.target.value)
                                }
                                placeholder="-"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs font-medium">Comment (optional)</Label>
                              <Input
                                value={commentDraft[a.question_id] ?? ''}
                                onChange={(e) =>
                                  setCommentDraft((prev) => ({
                                    ...prev,
                                    [a.question_id]: e.target.value,
                                  }))
                                }
                                placeholder="Feedback for the student…"
                              />
                              {a.admin_comment && !(commentDraft[a.question_id] ?? '').trim() ? (
                                <p className="text-xs text-muted-foreground">
                                  Previous: {a.admin_comment}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <ul className="mt-2 space-y-1 text-sm">
                            {selectedLabels.length === 0 ? (
                              <li className="text-muted-foreground">No option selected.</li>
                            ) : (
                              selectedLabels.map((label) => (
                                <li key={label} className="flex items-start gap-2">
                                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                  <span>{label}</span>
                                </li>
                              ))
                            )}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </div>

                {textAnswers.length > 0 ? (
                  <div className="flex justify-end pt-2">
                    <Button
                      type="button"
                      disabled={saving}
                      onClick={() => void submitGrades()}
                    >
                      {saving ? 'Saving...' : 'Submit grades'}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This attempt has no text questions to grade.
                  </p>
                )}
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </AdminPageShell>
  );
}
