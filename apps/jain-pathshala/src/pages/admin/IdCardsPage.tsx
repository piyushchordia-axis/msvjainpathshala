import { useMemo, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { apiPost, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminError } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

interface AdminStudentRow {
  id: string;
  full_name: string | null;
  student_code: string;
  age_group: string;
  msv_status: string;
  status: string;
}

interface GeneratedCard {
  student_id: string;
  card_number: string;
  png_url: string;
  version_no: number;
}

interface BulkGenerateResult {
  generated: number;
  skipped: number;
  failed: number;
  total: number;
}

export default function IdCardsPage() {
  const { items, loading, error, reload } = useAdminList<AdminStudentRow>('/v1/admin/students?limit=500');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [card, setCard] = useState<GeneratedCard | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (s) =>
        (s.full_name ?? '').toLowerCase().includes(q) ||
        s.student_code.toLowerCase().includes(q),
    );
  }, [items, query]);

  const selected = useMemo(
    () => items.find((s) => s.id === selectedId) ?? null,
    [items, selectedId],
  );

  async function generate() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const res = await apiPost<GeneratedCard>(`/v1/id-cards/generate/${selectedId}`, {});
      setCard(res);
      toast.success('ID card generated.', `Card ${res.card_number} (v${res.version_no})`);
    } catch (err) {
      toast.error('Failed to generate card.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function generateAll(onlyMissing: boolean) {
    const label = onlyMissing ? 'missing cards only' : 'all active students';
    if (!window.confirm(`Generate ID cards for ${label}? This may take a minute.`)) return;
    setBulkBusy(true);
    try {
      const res = await apiPost<BulkGenerateResult>('/v1/id-cards/generate-all', {
        only_missing: onlyMissing,
      });
      toast.success(
        'Bulk generation finished.',
        `${res.generated} generated, ${res.skipped} skipped, ${res.failed} failed (of ${res.total}).`,
      );
      reload();
    } catch (err) {
      toast.error('Bulk generation failed.', err instanceof ApiError ? err.message : undefined);
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <AdminPageShell
      title="Digital ID Cards"
      subtitle="Generate signed, scannable QR ID cards for students in your scope."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={bulkBusy || loading}
            onClick={() => void generateAll(true)}
          >
            {bulkBusy ? 'Working…' : 'Generate missing'}
          </Button>
          <Button
            size="sm"
            disabled={bulkBusy || loading}
            onClick={() => void generateAll(false)}
          >
            <CreditCard className="mr-1 h-4 w-4" />
            {bulkBusy ? 'Working…' : 'Generate all'}
          </Button>
        </div>
      }
    >
      {error ? <AdminError message={error} /> : null}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Student picker */}
        <Card className="p-5">
          <Label className="text-xs font-medium">Find a student</Label>
          <Input
            className="mt-1"
            placeholder="Search by name or student code…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="mt-3 max-h-80 overflow-y-auto rounded-md border">
            {loading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No students match.</div>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(s.id);
                    setCard(null);
                  }}
                  className={
                    'flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/40 ' +
                    (selectedId === s.id ? 'bg-muted/60' : '')
                  }
                >
                  <span className="text-sm font-medium">{s.full_name ?? '—'}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s.student_code}</span>
                </button>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button onClick={generate} disabled={!selectedId || busy || bulkBusy}>
              <CreditCard className="mr-1 h-4 w-4" />
              {busy ? 'Generating…' : 'Generate / Regenerate'}
            </Button>
            {selected ? (
              <span className="text-sm text-muted-foreground">
                {selected.full_name ?? selected.student_code}
              </span>
            ) : null}
          </div>
        </Card>

        {/* Preview */}
        <Card className="p-5">
          <div className="text-sm font-medium">Preview</div>
          {!card ? (
            <div className="mt-3 text-sm text-muted-foreground">
              Select a student and generate a card to preview it here.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <img
                src={card.png_url}
                alt={`ID card ${card.card_number}`}
                className="w-full rounded-md border"
              />
              <div className="text-sm">
                <span className="text-muted-foreground">Card number: </span>
                <span className="font-mono">{card.card_number}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Version: </span>
                <span>{card.version_no}</span>
              </div>
              <a
                href={card.png_url}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-sm text-primary underline"
              >
                Open PNG
              </a>
            </div>
          )}
        </Card>
      </div>
    </AdminPageShell>
  );
}
