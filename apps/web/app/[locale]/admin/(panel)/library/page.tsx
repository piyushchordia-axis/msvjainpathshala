/**
 * Admin → Library (`/admin/library`).
 *
 * Audio / video / PDF directory. Q7: video items store a YouTube or
 * Vimeo embed URL — no file uploads.
 */

import { listAdminLibrary, type LibraryRow } from '@/api/admin-misc';
import { Card } from '@/components/ui/card';

export default async function AdminLibraryPage() {
  let items: LibraryRow[] = [];
  let error: string | null = null;
  try {
    const res = await listAdminLibrary({ limit: 100 });
    items = res.items;
  } catch (err) {
    error = err instanceof Error ? err.message : 'Could not load library.';
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="font-display text-2xl text-secondary">Library</h2>
        <p className="text-sm text-muted-foreground">
          Curated audio, video (YouTube / Vimeo embed only — Q7), and PDFs.
        </p>
      </header>

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Access tier</th>
                <th className="px-4 py-3">MSV</th>
                <th className="px-4 py-3">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No library items yet.
                  </td>
                </tr>
              ) : (
                items.map((l) => (
                  <tr key={l.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{l.title_en || '—'}</div>
                      <div className="text-xs text-muted-foreground">{l.title_hi || ''}</div>
                    </td>
                    <td className="px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground">
                      {l.content_type}
                    </td>
                    <td className="px-4 py-3 text-xs">{l.access_tier}</td>
                    <td className="px-4 py-3">
                      {l.msv_only ? (
                        <span className="rounded-pill bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                          MSV
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {new Date(l.created_at).toLocaleDateString('en-IN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
