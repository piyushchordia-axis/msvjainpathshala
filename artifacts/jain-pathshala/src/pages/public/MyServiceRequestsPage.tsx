import { useCallback, useEffect, useState } from 'react';
import { Link } from 'wouter';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { toast } from '@/components/ui/toast-jp';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Shapes mirror the /v1/service-requests API exactly (snake_case).
type RequestStatus = 'submitted' | 'in_review' | 'resolved';

interface MyRequestRow {
  id: string;
  category: string;
  subject: string;
  status: RequestStatus;
  student_name: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

interface ThreadMessage {
  id: string;
  message: string;
  author_user_id: string | null;
  author_name: string | null;
  created_at: string;
}

interface RequestDetail {
  id: string;
  category: string;
  subject: string;
  description: string;
  status: RequestStatus;
  parent_name: string | null;
  student_name: string | null;
  centre_name: string | null;
  assigned_to: string | null;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  messages: ThreadMessage[];
}

interface ChildOption {
  id: string;
  full_name: string;
  student_code: string;
}

// Category options keep parity with the values an admin sees on the list.
const CATEGORIES: { value: string; en: string; hi: string }[] = [
  { value: 'attendance', en: 'Attendance', hi: 'उपस्थिति' },
  { value: 'enrolment', en: 'Enrolment', hi: 'नामांकन' },
  { value: 'fees', en: 'Fees & donations', hi: 'शुल्क व दान' },
  { value: 'id_card', en: 'ID card', hi: 'पहचान पत्र' },
  { value: 'technical', en: 'App / technical', hi: 'ऐप / तकनीकी' },
  { value: 'other', en: 'Other', hi: 'अन्य' },
];

function statusVariant(status: RequestStatus): 'default' | 'secondary' | 'outline' {
  if (status === 'resolved') return 'secondary';
  if (status === 'in_review') return 'default';
  return 'outline';
}

function statusLabel(status: RequestStatus, hi: boolean): string {
  if (status === 'resolved') return hi ? 'सुलझाया गया' : 'Resolved';
  if (status === 'in_review') return hi ? 'समीक्षाधीन' : 'In review';
  return hi ? 'प्रस्तुत' : 'Submitted';
}

function categoryLabel(value: string, hi: boolean): string {
  const c = CATEGORIES.find((x) => x.value === value);
  if (!c) return value;
  return hi ? c.hi : c.en;
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-GB');
}

/* ─────────────────────────── create form ─────────────────────────── */

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { hi } = useLocaleFlags();
  const [children, setChildren] = useState<ChildOption[]>([]);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [studentId, setStudentId] = useState<string>('none');
  const [submitting, setSubmitting] = useState(false);

  // Best-effort: a student picker for parents. If the member has no children
  // (e.g. a guest-linked account), we simply omit the optional field.
  useEffect(() => {
    let active = true;
    apiGet<{ items: ChildOption[] }>('/v1/me/children')
      .then((res) => {
        if (active) setChildren(res?.items ?? []);
      })
      .catch(() => {
        if (active) setChildren([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const canSubmit = !!category && subject.trim().length > 0 && description.trim().length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await apiPost('/v1/service-requests', {
        category,
        subject: subject.trim(),
        description: description.trim(),
        student_id: studentId !== 'none' ? studentId : undefined,
      });
      toast.success(hi ? 'अनुरोध भेजा गया।' : 'Request submitted.');
      setCategory('');
      setSubject('');
      setDescription('');
      setStudentId('none');
      onCreated();
    } catch (err) {
      toast.error(
        hi ? 'अनुरोध नहीं भेजा जा सका।' : 'Could not submit your request.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="p-6 md:p-8">
      <h2 className="font-display text-2xl text-secondary">
        {hi ? 'नया अनुरोध' : 'New request'}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {hi
          ? 'अपनी समस्या या प्रश्न बताएं — आपके केंद्र की टीम उत्तर देगी।'
          : 'Describe your issue or question — your centre team will respond.'}
      </p>

      <form className="mt-6 space-y-5" onSubmit={submit}>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              {hi ? 'श्रेणी' : 'Category'} <span className="text-destructive">*</span>
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder={hi ? 'श्रेणी चुनें' : 'Choose a category'} />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {hi ? c.hi : c.en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {children.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                {hi ? 'विद्यार्थी (वैकल्पिक)' : 'Student (optional)'}
              </Label>
              <Select value={studentId} onValueChange={setStudentId}>
                <SelectTrigger>
                  <SelectValue placeholder={hi ? 'कोई नहीं' : 'None'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{hi ? 'कोई नहीं' : 'None'}</SelectItem>
                  {children.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.full_name} · {s.student_code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">
            {hi ? 'विषय' : 'Subject'} <span className="text-destructive">*</span>
          </Label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder={hi ? 'संक्षिप्त विषय' : 'A short subject'}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm font-medium">
            {hi ? 'विवरण' : 'Description'} <span className="text-destructive">*</span>
          </Label>
          <Textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={5000}
            placeholder={hi ? 'अपनी समस्या विस्तार से लिखें…' : 'Describe your issue in detail…'}
            required
          />
        </div>

        <Button type="submit" disabled={!canSubmit || submitting}>
          {submitting ? (hi ? 'भेजा जा रहा है…' : 'Submitting…') : hi ? 'अनुरोध भेजें' : 'Submit request'}
        </Button>
      </form>
    </Card>
  );
}

/* ─────────────────────────── thread view ─────────────────────────── */

function ThreadPanel({
  requestId,
  onChanged,
  onClose,
}: {
  requestId: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { hi } = useLocaleFlags();
  const { user } = useAuth();
  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<RequestDetail>(`/v1/service-requests/${requestId}`);
      setDetail(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : hi ? 'अनुरोध लोड नहीं हुआ।' : 'Could not load this request.');
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [requestId, hi]);

  useEffect(() => {
    void load();
  }, [load]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim() || sending) return;
    setSending(true);
    try {
      await apiPost(`/v1/service-requests/${requestId}/messages`, { message: reply.trim() });
      toast.success(hi ? 'उत्तर भेजा गया।' : 'Reply sent.');
      setReply('');
      await load();
      onChanged();
    } catch (err) {
      toast.error(
        hi ? 'उत्तर नहीं भेजा जा सका।' : 'Could not send your reply.',
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="p-6 md:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl text-secondary">
            {detail?.subject ?? (hi ? 'अनुरोध' : 'Request')}
          </h2>
          {detail ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={statusVariant(detail.status)}>{statusLabel(detail.status, hi)}</Badge>
              <span>{categoryLabel(detail.category, hi)}</span>
              {detail.student_name ? (
                <>
                  <span>·</span>
                  <span>{detail.student_name}</span>
                </>
              ) : null}
              {detail.centre_name ? (
                <>
                  <span>·</span>
                  <span>{detail.centre_name}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {hi ? '← वापस' : '← Back'}
        </Button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      ) : error ? (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            {hi ? 'पुनः प्रयास करें' : 'Try again'}
          </Button>
        </div>
      ) : detail ? (
        <div className="mt-6 space-y-5">
          <div className="rounded-md border bg-muted/20 p-4 text-sm whitespace-pre-wrap">
            {detail.description}
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-medium">{hi ? 'बातचीत' : 'Conversation'}</Label>
            {detail.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {hi ? 'अभी कोई उत्तर नहीं है।' : 'No replies yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                {detail.messages.map((m) => {
                  const mine = m.author_user_id && user?.id === m.author_user_id;
                  return (
                    <div
                      key={m.id}
                      className={`rounded-md border px-3 py-2 ${mine ? 'bg-primary/5' : ''}`}
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {mine ? (hi ? 'आप' : 'You') : m.author_name ?? (hi ? 'टीम' : 'Team')}
                        </span>
                        <span>{fmt(m.created_at)}</span>
                      </div>
                      <div className="mt-1 text-sm whitespace-pre-wrap">{m.message}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {detail.status === 'resolved' ? (
            <p className="rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {hi
                ? 'यह अनुरोध सुलझाया जा चुका है। उत्तर भेजने पर यह फिर से खुल जाएगा।'
                : 'This request was resolved. Replying will reopen it.'}
            </p>
          ) : null}

          <form className="space-y-2" onSubmit={sendReply}>
            <Label className="text-xs font-medium">{hi ? 'उत्तर लिखें' : 'Write a reply'}</Label>
            <Textarea
              rows={3}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              maxLength={5000}
              placeholder={hi ? 'अपना संदेश लिखें…' : 'Type your message…'}
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!reply.trim() || sending}>
                {sending ? (hi ? 'भेजा जा रहा है…' : 'Sending…') : hi ? 'उत्तर भेजें' : 'Send reply'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </Card>
  );
}

/* ─────────────────────────── page ─────────────────────────── */

// Small wrapper so children components read the boolean without re-deriving it.
function useLocaleFlags() {
  const locale = useLocale();
  return { hi: locale === 'hi' };
}

export default function MyServiceRequestsPage() {
  const { hi } = useLocaleFlags();
  const { user, loading: authLoading } = useAuth();

  const [items, setItems] = useState<MyRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: MyRequestRow[] }>('/v1/service-requests/mine?limit=100');
      setItems(res?.items ?? []);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : hi ? 'अनुरोध लोड नहीं हुए।' : 'Could not load your requests.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [hi]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // Gate on authentication — members sign in via the shared OTP login.
  if (authLoading) {
    return (
      <section className="container py-12 md:py-16">
        <p className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="container py-12 md:py-16">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
          {hi ? 'सहायता' : 'Support'}
        </p>
        <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
          {hi ? 'मेरे अनुरोध' : 'My requests'}
        </h1>
        <Card className="mt-8 max-w-xl p-8">
          <p className="text-muted-foreground">
            {hi
              ? 'सहायता अनुरोध बनाने और देखने के लिए कृपया अपने पंजीकृत मोबाइल नंबर से लॉगिन करें।'
              : 'Please sign in with your registered mobile number to create and view support requests.'}
          </p>
          <Button asChild className="mt-6">
            <Link href="/admin/login">{hi ? 'लॉगिन करें' : 'Sign in'}</Link>
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section className="container py-12 md:py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary">
        {hi ? 'सहायता' : 'Support'}
      </p>
      <h1 className="mt-3 font-display text-4xl text-secondary md:text-5xl">
        {hi ? 'मेरे अनुरोध' : 'My requests'}
      </h1>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {hi
          ? 'अपने केंद्र की टीम से सहायता मांगें और बातचीत यहीं देखें।'
          : 'Raise a request with your centre team and follow the conversation here.'}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          {activeId ? (
            <ThreadPanel
              requestId={activeId}
              onChanged={() => void load()}
              onClose={() => setActiveId(null)}
            />
          ) : (
            <CreateForm onCreated={() => void load()} />
          )}
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-xl text-secondary">
            {hi ? 'मेरे पिछले अनुरोध' : 'Your requests'}
          </h2>

          {loading ? (
            <p className="text-muted-foreground">{hi ? 'लोड हो रहा है…' : 'Loading…'}</p>
          ) : error ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {hi ? 'पुनः प्रयास करें' : 'Try again'}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <Card className="p-6">
              <p className="text-muted-foreground">
                {hi ? 'अभी आपका कोई अनुरोध नहीं है।' : 'You have no requests yet.'}
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {items.map((r) => {
                const isActive = r.id === activeId;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveId(r.id)}
                    className={`block w-full rounded-lg border px-4 py-3 text-left transition hover:bg-accent ${
                      isActive ? 'border-primary bg-accent' : 'border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-foreground">{r.subject}</span>
                      <Badge variant={statusVariant(r.status)}>{statusLabel(r.status, hi)}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{categoryLabel(r.category, hi)}</span>
                      {r.student_name ? (
                        <>
                          <span>·</span>
                          <span>{r.student_name}</span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span>{new Date(r.created_at).toLocaleDateString('en-GB')}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
