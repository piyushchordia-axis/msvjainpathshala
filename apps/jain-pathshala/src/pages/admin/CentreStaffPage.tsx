import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'wouter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiGet, apiPost, apiPut, ApiError } from '@/lib/api-client';
import { toast } from '@/components/ui/toast-jp';
import { useAuth } from '@/lib/auth-context';
import type { Role } from '@/lib/auth';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface StaffBatch {
  batch_id: string;
  batch_name: string;
  is_primary: boolean;
}

interface StaffUser {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  gender?: string | null;
  batch_count?: number;
  batches?: StaffBatch[];
}

interface PickUser {
  id: string;
  full_name: string | null;
  phone: string | null;
  gender: string | null;
}

interface CentreBatch {
  id: string;
  name: string;
  centre_id: string;
  status: string;
}

const CITY_PLUS: Role[] = ['super_admin', 'state_admin', 'city_admin'];

function staffLabel(gender: string | null | undefined): string {
  if (gender === 'female') return 'Didi';
  if (gender === 'male') return 'Guruji';
  return 'Shikshak';
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return raw.trim();
}

export default function CentreStaffPage() {
  const params = useParams<{ id: string }>();
  const centreId = params.id;
  const { user } = useAuth();
  const canManageSanchalaks = !!user && CITY_PLUS.includes(user.role);

  const [sanchalaks, setSanchalaks] = useState<StaffUser[]>([]);
  const [shikshaks, setShikshaks] = useState<StaffUser[]>([]);
  const [pickSanch, setPickSanch] = useState<PickUser[]>([]);
  const [pickShik, setPickShik] = useState<PickUser[]>([]);
  const [centreBatches, setCentreBatches] = useState<CentreBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [centreName, setCentreName] = useState('Centre');
  const [busy, setBusy] = useState(false);

  // Sanchalak form
  const [sanchMode, setSanchMode] = useState<'create' | 'pick'>('create');
  const [sanchPhone, setSanchPhone] = useState('');
  const [sanchName, setSanchName] = useState('');
  const [addSanch, setAddSanch] = useState('');

  // Shikshak form
  const [shikMode, setShikMode] = useState<'create' | 'pick'>('create');
  const [shikPhone, setShikPhone] = useState('');
  const [shikName, setShikName] = useState('');
  const [shikGender, setShikGender] = useState<string>('male');
  const [addShik, setAddShik] = useState('');
  const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
  const [primaryBatchId, setPrimaryBatchId] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editBatchIds, setEditBatchIds] = useState<string[]>([]);
  const [editPrimaryId, setEditPrimaryId] = useState('');

  async function reload() {
    if (!centreId) return;
    setLoading(true);
    setLoadError(false);
    try {
      const [sanc, shik, centres, batches] = await Promise.all([
        canManageSanchalaks
          ? apiGet<{ items: StaffUser[] }>(`/v1/admin/centres/${centreId}/sanchalaks`)
          : Promise.resolve({ items: [] as StaffUser[] }),
        apiGet<{ items: StaffUser[] }>(`/v1/admin/centres/${centreId}/shikshaks`),
        apiGet<{ items: { id: string; name: string }[] }>('/v1/admin/centres'),
        apiGet<{ items: CentreBatch[] }>('/v1/admin/batches'),
      ]);
      setSanchalaks(sanc?.items ?? []);
      setShikshaks(shik?.items ?? []);
      const c = (centres?.items ?? []).find((x) => x.id === centreId);
      if (c) setCentreName(c.name);
      setCentreBatches((batches?.items ?? []).filter((b) => b.centre_id === centreId));
    } catch (err) {
      // A failed load must not render as "no staff" (SAN-ERR-03).
      setLoadError(true);
      toast.error('Could not load staffing.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }

  async function reloadPickers() {
    if (!centreId) return;
    const qs = `centre_id=${encodeURIComponent(centreId)}`;
    if (canManageSanchalaks) {
      void apiGet<{ items: PickUser[] }>(`/v1/admin/users/pick?role=sanchalak&${qs}`)
        .then((r) => setPickSanch(r?.items ?? []))
        .catch(() => setPickSanch([]));
    }
    void apiGet<{ items: PickUser[] }>(`/v1/admin/users/pick?role=shikshak&${qs}`)
      .then((r) => setPickShik(r?.items ?? []))
      .catch(() => setPickShik([]));
  }

  useEffect(() => {
    void reload();
    void reloadPickers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centreId, canManageSanchalaks]);

  useEffect(() => {
    if (selectedBatchIds.length === 0) {
      setPrimaryBatchId('');
      return;
    }
    if (!selectedBatchIds.includes(primaryBatchId)) {
      setPrimaryBatchId(selectedBatchIds[0]!);
    }
  }, [selectedBatchIds, primaryBatchId]);

  const batchNameById = useMemo(
    () => new Map(centreBatches.map((b) => [b.id, b.name])),
    [centreBatches],
  );

  function toggleBatch(id: string, list: string[], setList: (v: string[]) => void) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function submitSanchalak() {
    if (!centreId || busy) return;
    setBusy(true);
    try {
      if (sanchMode === 'create') {
        const phone = normalizePhone(sanchPhone);
        if (!sanchName.trim() || !phone.startsWith('+')) {
          toast.error('Enter a name and phone (+91…).');
          return;
        }
        await apiPost(`/v1/admin/centres/${centreId}/staff`, {
          role: 'sanchalak',
          phone,
          full_name: sanchName.trim(),
        });
        setSanchPhone('');
        setSanchName('');
      } else {
        if (!addSanch) return;
        await apiPost(`/v1/admin/centres/${centreId}/staff`, {
          role: 'sanchalak',
          user_id: addSanch,
        });
        setAddSanch('');
      }
      toast.success('Sanchalak added.');
      await reload();
      await reloadPickers();
    } catch (err) {
      toast.error('Could not add sanchalak.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function removeSanchalak(userId: string, name: string | null) {
    if (!centreId) return;
    if (!window.confirm(`Remove ${name ?? 'this sanchalak'} from the centre?`)) return;
    try {
      await apiPost(`/v1/admin/centres/${centreId}/sanchalaks/${userId}/remove`, {});
      toast.success('Sanchalak removed.');
      await reload();
      await reloadPickers();
    } catch (err) {
      toast.error('Could not remove sanchalak.', err instanceof ApiError ? err.message : undefined);
    }
  }

  async function submitShikshak() {
    if (!centreId || busy) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        role: 'shikshak',
        batch_ids: selectedBatchIds,
        ...(primaryBatchId ? { primary_batch_id: primaryBatchId } : {}),
      };
      if (shikMode === 'create') {
        const phone = normalizePhone(shikPhone);
        if (!shikName.trim() || !phone.startsWith('+')) {
          toast.error('Enter a name and phone (+91…).');
          return;
        }
        payload.phone = phone;
        payload.full_name = shikName.trim();
        payload.gender = shikGender;
      } else {
        if (!addShik) return;
        payload.user_id = addShik;
      }
      await apiPost(`/v1/admin/centres/${centreId}/staff`, payload);
      toast.success('Guruji / Didi added to centre.');
      setShikPhone('');
      setShikName('');
      setAddShik('');
      setSelectedBatchIds([]);
      setPrimaryBatchId('');
      await reload();
      await reloadPickers();
    } catch (err) {
      toast.error('Could not add staff.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function removeShikshak(userId: string, name: string | null) {
    if (!centreId) return;
    if (
      !window.confirm(
        `Remove ${name ?? 'this shikshak'} from the centre? Their batch assignments at this centre will also be cleared.`,
      )
    ) {
      return;
    }
    try {
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
      setEditingUserId(null);
      await reload();
      await reloadPickers();
    } catch (err) {
      toast.error('Could not remove shikshak.', err instanceof ApiError ? err.message : undefined);
    }
  }

  function startEditBatches(s: StaffUser) {
    const ids = (s.batches ?? []).map((b) => b.batch_id);
    setEditingUserId(s.user_id);
    setEditBatchIds(ids);
    const primary = (s.batches ?? []).find((b) => b.is_primary)?.batch_id ?? ids[0] ?? '';
    setEditPrimaryId(primary);
  }

  async function saveEditBatches(userId: string) {
    if (!centreId || busy) return;
    setBusy(true);
    try {
      // One atomic reconcile (SAN-PRF-02) — the old serial remove/add/primary
      // loop left partial assignments whenever a mid-flight call failed.
      const primary =
        editPrimaryId && editBatchIds.includes(editPrimaryId)
          ? editPrimaryId
          : editBatchIds[0];
      await apiPut(`/v1/admin/centres/${centreId}/shikshaks/${userId}/batches`, {
        batch_ids: editBatchIds,
        ...(primary ? { primary_batch_id: primary } : {}),
      });
      toast.success('Batch assignments updated.');
      setEditingUserId(null);
      await reload();
    } catch (err) {
      toast.error('Could not update batches.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
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
            Create or pick staff, tag them to this centre, and assign Guruji / Didi to batches here.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loadError ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="text-sm font-medium text-destructive">
            Couldn't load this centre's staffing — the lists below are unavailable, not empty.
          </p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void reload()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {canManageSanchalaks ? (
            <Card className="space-y-4 p-5">
              <h2 className="font-display text-lg text-secondary">Sanchalaks</h2>
              <div className="flex gap-2 text-sm">
                <Button
                  size="sm"
                  variant={sanchMode === 'create' ? 'default' : 'outline'}
                  onClick={() => setSanchMode('create')}
                >
                  Create new
                </Button>
                <Button
                  size="sm"
                  variant={sanchMode === 'pick' ? 'default' : 'outline'}
                  onClick={() => setSanchMode('pick')}
                >
                  Pick existing
                </Button>
              </div>

              {sanchMode === 'create' ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Full name</Label>
                    <Input value={sanchName} onChange={(e) => setSanchName(e.target.value)} placeholder="Name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input
                      value={sanchPhone}
                      onChange={(e) => setSanchPhone(e.target.value)}
                      placeholder="+9198…"
                    />
                  </div>
                  <Button size="sm" disabled={busy} onClick={() => void submitSanchalak()}>
                    Add sanchalak
                  </Button>
                </div>
              ) : (
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
                  <Button size="sm" onClick={() => void submitSanchalak()} disabled={!addSanch || busy}>
                    Add
                  </Button>
                </div>
              )}

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
          ) : null}

          <Card className={`space-y-4 p-5 ${canManageSanchalaks ? '' : 'lg:col-span-2'}`}>
            <h2 className="font-display text-lg text-secondary">Guruji / Didi (Shikshak)</h2>
            <div className="flex gap-2 text-sm">
              <Button
                size="sm"
                variant={shikMode === 'create' ? 'default' : 'outline'}
                onClick={() => setShikMode('create')}
              >
                Create new
              </Button>
              <Button
                size="sm"
                variant={shikMode === 'pick' ? 'default' : 'outline'}
                onClick={() => setShikMode('pick')}
              >
                Pick existing
              </Button>
            </div>

            {shikMode === 'create' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Full name</Label>
                  <Input value={shikName} onChange={(e) => setShikName(e.target.value)} placeholder="Name" />
                </div>
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input
                    value={shikPhone}
                    onChange={(e) => setShikPhone(e.target.value)}
                    placeholder="+9198…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Gender (label)</Label>
                  <Select value={shikGender} onValueChange={setShikGender}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male — Guruji</SelectItem>
                      <SelectItem value="female">Female — Didi</SelectItem>
                      <SelectItem value="other">Other — Shikshak</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <Select value={addShik} onValueChange={setAddShik}>
                <SelectTrigger>
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
            )}

            <div className="space-y-2">
              <Label>Assign to batches (optional)</Label>
              {centreBatches.length === 0 ? (
                <p className="text-xs text-muted-foreground">No batches at this centre yet.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2 text-sm">
                  {centreBatches.map((b) => (
                    <li key={b.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`batch-${b.id}`}
                        checked={selectedBatchIds.includes(b.id)}
                        onChange={() => toggleBatch(b.id, selectedBatchIds, setSelectedBatchIds)}
                      />
                      <label htmlFor={`batch-${b.id}`} className="flex-1 cursor-pointer">
                        {b.name}
                        <span className="ml-1 text-xs text-muted-foreground">({b.status})</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {selectedBatchIds.length > 0 ? (
                <div className="space-y-1.5">
                  <Label>Primary batch</Label>
                  <Select value={primaryBatchId} onValueChange={setPrimaryBatchId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Primary batch" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedBatchIds.map((id) => (
                        <SelectItem key={id} value={id}>
                          {batchNameById.get(id) ?? id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>

            <Button
              size="sm"
              disabled={busy || (shikMode === 'pick' && !addShik)}
              onClick={() => void submitShikshak()}
            >
              Add Guruji / Didi
            </Button>

            <ul className="divide-y divide-border text-sm">
              {shikshaks.length === 0 ? (
                <li className="py-3 text-muted-foreground">No shikshaks tagged yet.</li>
              ) : (
                shikshaks.map((s) => (
                  <li key={s.user_id} className="space-y-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {s.full_name ?? '—'}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            ({staffLabel(s.gender)})
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">{s.phone}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {(s.batches ?? []).length === 0
                            ? 'No batches'
                            : (s.batches ?? [])
                                .map((b) => `${b.batch_name}${b.is_primary ? ' ★' : ''}`)
                                .join(', ')}
                        </p>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button size="sm" variant="outline" onClick={() => startEditBatches(s)}>
                          Batches
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void removeShikshak(s.user_id, s.full_name)}>
                          Remove
                        </Button>
                      </div>
                    </div>

                    {editingUserId === s.user_id ? (
                      <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                        <ul className="space-y-1">
                          {centreBatches.map((b) => (
                            <li key={b.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                id={`edit-${s.user_id}-${b.id}`}
                                checked={editBatchIds.includes(b.id)}
                                onChange={() => toggleBatch(b.id, editBatchIds, setEditBatchIds)}
                              />
                              <label htmlFor={`edit-${s.user_id}-${b.id}`} className="cursor-pointer">
                                {b.name}
                              </label>
                            </li>
                          ))}
                        </ul>
                        {editBatchIds.length > 0 ? (
                          <Select value={editPrimaryId} onValueChange={setEditPrimaryId}>
                            <SelectTrigger>
                              <SelectValue placeholder="Primary batch" />
                            </SelectTrigger>
                            <SelectContent>
                              {editBatchIds.map((id) => (
                                <SelectItem key={id} value={id}>
                                  {batchNameById.get(id) ?? id}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}
                        <div className="flex gap-2">
                          <Button size="sm" disabled={busy} onClick={() => void saveEditBatches(s.user_id)}>
                            Save batches
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
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
