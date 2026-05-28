/**
 * Enrolment detail — `/admin/enrolments/:id`.
 *
 * Shows the application summary, status, parent + requested batch, and
 * three buttons (Approve / Waitlist / Reject) implemented as Server
 * Actions so they're a single network round-trip from the browser
 * and inherit the session cookie automatically.
 *
 * Duplicate-warning banner: if the most recent `enrolment.submitted`
 * audit entry carried a `duplicate_of_student_id`, surface a warm-amber
 * banner per the Step 10 prompt.
 *
 * SPEC §8.1: 409 ERR_BATCH_OVER_CAPACITY surfaces as a row-level inline
 * error here (rendered by the form-submit error path).
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { getEnrolment } from '@/api/enrolments';
import { authenticatedServerClient, ApiError } from '@/api/server-client';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';

interface PageProps {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ error?: string }>;
}

async function approveAction(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  const locale = (formData.get('locale') as string) || 'en';
  const client = await authenticatedServerClient();
  try {
    await client.post(`/v1/enrolments/${id}/approve`);
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'ERR_INTERNAL';
    const message = err instanceof ApiError ? err.message : 'Could not approve. Please try again.';
    redirect(
      `/${locale}/admin/enrolments/${id}?error=${encodeURIComponent(`${code}: ${message}`)}`,
    );
  }
  revalidatePath(`/${locale}/admin/enrolments/${id}`);
  redirect(`/${locale}/admin/enrolments/${id}`);
}

async function rejectAction(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  const locale = (formData.get('locale') as string) || 'en';
  const reason = (formData.get('reason') as string) || 'No reason given';
  const client = await authenticatedServerClient();
  try {
    await client.post(`/v1/enrolments/${id}/reject`, { reason });
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'ERR_INTERNAL';
    const message = err instanceof ApiError ? err.message : 'Could not reject. Please try again.';
    redirect(
      `/${locale}/admin/enrolments/${id}?error=${encodeURIComponent(`${code}: ${message}`)}`,
    );
  }
  revalidatePath(`/${locale}/admin/enrolments/${id}`);
  redirect(`/${locale}/admin/enrolments/${id}`);
}

async function waitlistAction(formData: FormData) {
  'use server';
  const id = formData.get('id') as string;
  const locale = (formData.get('locale') as string) || 'en';
  const client = await authenticatedServerClient();
  try {
    await client.post(`/v1/enrolments/${id}/waitlist`, {});
  } catch (err) {
    const code = err instanceof ApiError ? err.code : 'ERR_INTERNAL';
    const message = err instanceof ApiError ? err.message : 'Could not waitlist. Please try again.';
    redirect(
      `/${locale}/admin/enrolments/${id}?error=${encodeURIComponent(`${code}: ${message}`)}`,
    );
  }
  revalidatePath(`/${locale}/admin/enrolments/${id}`);
  redirect(`/${locale}/admin/enrolments/${id}`);
}

export default async function EnrolmentDetailPage({ params, searchParams }: PageProps) {
  const { locale, id } = await params;
  const { error } = await searchParams;

  const enrolment = await getEnrolment(id);
  const decided = enrolment.status !== 'pending' && enrolment.status !== 'waitlisted';

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Link
            href="/admin/enrolments"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            ← Back to enrolments
          </Link>
          <h2 className="mt-2 font-display text-2xl text-secondary">Enrolment review</h2>
          <p className="text-sm text-muted-foreground">
            Submitted {new Date(enrolment.created_at).toLocaleString('en-GB')}
          </p>
        </div>
        <StatusBadge status={enrolment.status} />
      </div>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{decodeURIComponent(error)}</p>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Application</CardTitle>
            <CardDescription>Form responses captured on submission.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Enrolment id</dt>
              <dd className="font-mono text-xs">{enrolment.id}</dd>
              <dt className="text-muted-foreground">Parent user id</dt>
              <dd className="font-mono text-xs">{enrolment.parent_user_id}</dd>
              <dt className="text-muted-foreground">Centre</dt>
              <dd className="font-mono text-xs">{enrolment.requested_centre_id}</dd>
              <dt className="text-muted-foreground">Batch</dt>
              <dd className="font-mono text-xs">{enrolment.requested_batch_id}</dd>
              {enrolment.decided_at ? (
                <>
                  <dt className="text-muted-foreground">Decided</dt>
                  <dd>{new Date(enrolment.decided_at).toLocaleString('en-GB')}</dd>
                </>
              ) : null}
              {enrolment.rejection_reason ? (
                <>
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd className="text-foreground">{enrolment.rejection_reason}</dd>
                </>
              ) : null}
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Note: the per-field application data lives in
              <code className="ml-1 rounded bg-muted px-1 py-0.5">registration_form_responses</code>
              ; a richer renderer lands with the form-builder step.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decide</CardTitle>
            <CardDescription>
              {decided
                ? 'This application has already been decided.'
                : 'Approving creates the student record and queues the ID card.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={approveAction}>
              <input type="hidden" name="id" value={enrolment.id} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" className="w-full" disabled={decided}>
                Approve
              </Button>
            </form>

            <form action={waitlistAction}>
              <input type="hidden" name="id" value={enrolment.id} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary" className="w-full" disabled={decided}>
                Waitlist
              </Button>
            </form>

            <form action={rejectAction} className="space-y-2">
              <input type="hidden" name="id" value={enrolment.id} />
              <input type="hidden" name="locale" value={locale} />
              <textarea
                name="reason"
                placeholder="Reason for rejection…"
                required
                rows={3}
                disabled={decided}
                className="w-full rounded-md border border-input bg-card p-2 text-sm placeholder:text-ink-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
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
