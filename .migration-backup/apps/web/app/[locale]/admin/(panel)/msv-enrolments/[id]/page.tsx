/**
 * MSV application detail — `/admin/msv-enrolments/:id`.
 *
 * Same approve / waitlist / reject server actions as the standard
 * enrolment detail page. Q1: decision is pure discretion.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { authenticatedServerClient, ApiError } from '@/api/server-client';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

type MsvStatus = 'applied' | 'waitlisted' | 'approved' | 'rejected' | 'revoked';

interface MsvEnrolment {
  id: string;
  student_id: string;
  motivation_statement_redacted: string | null;
  status: MsvStatus;
  decided_at: string | null;
  notes: string | null;
  created_at: string;
}

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}

async function getMsv(id: string): Promise<MsvEnrolment> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/msv/enrolments/${id}`);
  return res.data.data as MsvEnrolment;
}

async function approveAction(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  const locale = (formData.get('locale') as string) || 'en';
  const notes = (formData.get('notes') as string) || undefined;
  const client = await authenticatedServerClient();
  try {
    await client.post(`/v1/msv/enrolments/${id}/approve`, notes ? { notes } : {});
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'ERR_INTERNAL';
    const message = err instanceof ApiError ? err.message : 'Could not approve.';
    redirect(
      `/${locale}/admin/msv-enrolments/${id}?error=${encodeURIComponent(`${code}: ${message}`)}`,
    );
  }
  revalidatePath(`/${locale}/admin/msv-enrolments/${id}`);
  redirect(`/${locale}/admin/msv-enrolments/${id}`);
}

async function rejectAction(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  const locale = (formData.get('locale') as string) || 'en';
  const notes = (formData.get('notes') as string) || 'No reason given';
  const client = await authenticatedServerClient();
  try {
    await client.post(`/v1/msv/enrolments/${id}/reject`, { notes });
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'ERR_INTERNAL';
    const message = err instanceof ApiError ? err.message : 'Could not reject.';
    redirect(
      `/${locale}/admin/msv-enrolments/${id}?error=${encodeURIComponent(`${code}: ${message}`)}`,
    );
  }
  revalidatePath(`/${locale}/admin/msv-enrolments/${id}`);
  redirect(`/${locale}/admin/msv-enrolments/${id}`);
}

export default async function MsvDetailPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params;
  const { error } = await searchParams;
  const msv = await getMsv(id);
  const decided = msv.status !== 'applied' && msv.status !== 'waitlisted';

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link
            href="/admin/msv-enrolments"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            ← Back to MSV applications
          </Link>
          <h2 className="mt-2 font-display text-2xl text-secondary">MSV application</h2>
        </div>
        <StatusBadge status={msv.status} />
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{decodeURIComponent(error)}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Parent&apos;s note</CardTitle>
            <CardDescription>
              Q1 reminder: the system does not evaluate eligibility — decide on your own merit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-foreground">
              {msv.motivation_statement_redacted ?? 'No note provided.'}
            </p>
            {msv.notes ? (
              <div className="mt-4 rounded-md border border-border bg-muted/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reviewer notes
                </div>
                <p className="mt-1 text-sm text-foreground">{msv.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decide</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={approveAction} className="space-y-2">
              <input type="hidden" name="id" value={msv.id} />
              <input type="hidden" name="locale" value={locale} />
              <textarea
                name="notes"
                placeholder="Optional reviewer notes…"
                rows={2}
                disabled={decided}
                className="w-full rounded-md border border-input bg-card p-2 text-sm placeholder:text-ink-dim disabled:opacity-50"
              />
              <Button type="submit" className="w-full" disabled={decided}>
                Approve
              </Button>
            </form>

            <form action={rejectAction} className="space-y-2">
              <input type="hidden" name="id" value={msv.id} />
              <input type="hidden" name="locale" value={locale} />
              <textarea
                name="notes"
                placeholder="Reason for rejection…"
                rows={2}
                required
                disabled={decided}
                className="w-full rounded-md border border-input bg-card p-2 text-sm placeholder:text-ink-dim disabled:opacity-50"
              />
              <Button type="submit" variant="destructive" className="w-full" disabled={decided}>
                Reject
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
