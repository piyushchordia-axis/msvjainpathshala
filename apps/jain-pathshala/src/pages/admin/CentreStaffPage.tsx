import { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiGet, apiPost, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface StaffUser {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  gender?: string | null;
  batch_count?: number;
}

interface PickUser {
  id: string;
  full_name: string | null;
  phone: string | null;
  gender: string | null;
}

function staffLabel(gender: string | null | undefined, hi = false): string {
  if (gender === 'female') return hi ? 'दीदी' : 'Didi';
  if (gender === 'male') return hi ? 'गुरुजी' : 'Guruji';
  return hi ? 'शिक्षक' : 'Shikshak';
}

export default function CentreStaffPage() {
  const params = useParams<{ id: string }>();
  const centreId = params.id;
  const [sanchalaks, setSanchalaks] = useState<StaffUser[]>([]);
  const [shikshaks, setShikshaks] = useState<StaffUser[]>([]);
  const [pickSanch, setPickSanch] = useState<PickUser[]>([]);
  const [pickShik, setPickShik] = useState<PickUser[]>([]);
  const [addSanch, setAddSanch] = useState('');
  const [addShik, setAddShik] = useState('');
  const [loading, setLoading] = useState(true);
  const [centreName, setCentreName] = useState('Centre');

  async function reload() {
    if (!centreId) return;
    setLoading(true);
    try {
      const [sanc, shik, centres] = await Promise.all([
        apiGet<{ items: StaffUser[] }>(`/v1/admin/centres/${centreId}/sanchalaks`),
        apiGet<{ items: StaffUser[] }>(`/v1/admin/centres/${centreId}/shikshaks`),
        apiGet<{ items: { id: string; name: string }[] }>('/v1/admin/centres'),
      ]);
      setSanchalaks(sanc?.items ?? []);
      setShikshaks(shik?.items ?? []);
      const c = (centres?.items ?? []).find((x) => x.id === centreId);
      if (c) setCentreName(c.name);
    } catch (err) {
      toast.error('Could not load staffing.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    void apiGet<{ items: PickUser[] }>('/v1/admin/users/pick?role=sanchalak')
      .then((r) => setPickSanch(r?.items ?? []))
      .catch(() => setPickSanch([]));
    void apiGet<{ items: PickUser[] }>('/v1/admin/users/pick?role=shikshak')
      .then((r) => setPickShik(r?.items ?? []))
      .catch(() => setPickShik([]));
  }, [centreId]);

  async function assignSanchalak() {
    if (!addSanch || !centreId) return;
    try {
      await apiPost(`/v1/admin/centres/${centreId}/sanchalaks`, { user_id: addSanch });
      toast.success('Sanchalak assigned.');
      setAddSanch('');
      await reload();
    } catch (err) {
      toast.error('Could not assign sanchalak.', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function removeSanchalak(userId: string, name: string | null) {
    if (!centreId) return;
    if (!window.confirm(`Remove ${name ?? 'this sanchalak'} from the centre?`)) return;
    try {
      await apiPost(`/v1/admin/centres/${centreId}/sanchalaks/${userId}/remove`, {});
      toast.success('Sanchalak removed.');
      await reload();
    } catch (err) {
      toast.error('Could not remove sanchalak.', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function assignShikshak() {
    if (!addShik || !centreId) return;
    try {
      await apiPost(`/v1/admin/centres/${centreId}/shikshaks`, { user_id: addShik });
      toast.success('Shikshak tagged to centre.');
      setAddShik('');
      await reload();
    } catch (err) {
      toast.error('Could not tag shikshak.', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function removeShikshak(userId: string, name: string | null) {
    if (!centreId) return;
    try {
      // Preview: confirm with batch impact from remove response after confirm
      if (!window.confirm(
        `Remove ${name ?? 'this shikshak'} from the centre? Their batch assignments at this centre will also be cleared.`,
      )) return;
      const res = await apiPost<{
        deactivated_batch_ids: string[];
        primary_batch_ids: string[];
      }>(`/v1/admin/centres/${centreId}/shikshaks/${userId}/remove`, {});
      const n = res?.deactivated_batch_ids?.length ?? 0;
      const p = res?.primary_batch_ids?.length ?? 0;
      toast.success(
        n
          ? `Removed. Cleared ${n} batch assignment(s)${p ? ` (${p} were primary)` : ''}.`
          : 'Removed from centre.',
      );
      await reload();
    } catch (err) {
      toast.error('Could not remove shikshak.', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link href="/admin/centres" className="underline">Centres</Link>
            {' / '}
            Staffing
          </p>
          <h1 className="font-display text-2xl text-secondary">{centreName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign sanchalaks and tag Guruji / Didi / Shikshak to this centre.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="space-y-4 p-5">
            <h2 className="font-display text-lg text-secondary">Sanchalaks</h2>
            <div className="flex gap-2">
              <Select value={addSanch} onValueChange={setAddSanch}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select sanchalak" />
                </SelectTrigger>
                <SelectContent>
                  {pickSanch.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name ?? u.phone ?? u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => void assignSanchalak()} disabled={!addSanch}>
                Add
              </Button>
            </div>
            <ul className="divide-y divide-border text-sm">
              {sanchalaks.length === 0 ? (
                <li className="py-3 text-muted-foreground">No sanchalaks assigned.</li>
              ) : (
                sanchalaks.map((s) => (
                  <li key={s.user_id} className="flex items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">{s.full_name ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">{s.phone}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => void removeSanchalak(s.user_id, s.full_name)}>
                      Remove
                    </Button>
                  </li>
                ))
              )}
            </ul>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="font-display text-lg text-secondary">Shikshaks</h2>
            <p className="text-xs text-muted-foreground">
              Tag to the centre first, then assign batches from the Batches page.
            </p>
            <div className="flex gap-2">
              <Select value={addShik} onValueChange={setAddShik}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select shikshak" />
                </SelectTrigger>
                <SelectContent>
                  {pickShik.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name ?? u.phone ?? u.id} ({staffLabel(u.gender)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => void assignShikshak()} disabled={!addShik}>
                Tag
              </Button>
            </div>
            <ul className="divide-y divide-border text-sm">
              {shikshaks.length === 0 ? (
                <li className="py-3 text-muted-foreground">No shikshaks tagged.</li>
              ) : (
                shikshaks.map((s) => (
                    <li key={s.user_id} className="flex items-center justify-between gap-2 py-3">
                      <div>
                        <p className="font-medium">
                          {s.full_name ?? '—'}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            ({staffLabel(s.gender)})
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.batch_count ?? 0} batch{(s.batch_count ?? 0) === 1 ? '' : 'es'}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => void removeShikshak(s.user_id, s.full_name)}>
                        Remove
                      </Button>
                    </li>
                  ))
              )}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
