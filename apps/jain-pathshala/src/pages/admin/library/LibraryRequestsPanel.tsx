/**
 * Content-request review queue — Section 17 v3 §17.10.4–§17.10.5.
 *
 * Action buttons are hidden from roles that cannot act, driven by `can_act` off
 * the API rather than a role list rebuilt here — one source, and it is the same
 * service check that will refuse the call. This SUPPLEMENTS the server
 * enforcement and never replaces it: a city_admin who forges the request still
 * gets a 403.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ExternalLink, Users } from "lucide-react";
import { apiGet, apiPatch, apiPost, get, ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LibraryAdminSection } from "./library-admin-types";

type RequestStatus = "pending" | "accepted" | "rejected" | "published";

interface QueueRow {
  id: string;
  section_id: string | null;
  section_name_en: string | null;
  section_name_hi: string | null;
  suggested_section: string | null;
  title: string;
  details: string;
  reference_url: string | null;
  requester_user_id: string | null;
  requester_device_id: string | null;
  requester_name: string;
  requester_phone: string;
  status: RequestStatus;
  admin_note: string | null;
  linked_item_id: string | null;
  actioned_at: string | null;
  created_at: string;
}

interface DetailPayload {
  request: QueueRow & { requester_account_name: string | null };
  similar_pending: Array<{
    id: string;
    title: string;
    requester_name: string;
    created_at: string;
  }>;
  can_act: boolean;
}

const STATUSES: RequestStatus[] = ["pending", "accepted", "rejected", "published"];
const ALL = "__all__";
const PAGE_SIZE = 25;

function statusVariant(status: RequestStatus): "default" | "secondary" | "outline" {
  if (status === "published") return "default";
  if (status === "rejected") return "outline";
  return "secondary";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  sections: LibraryAdminSection[];
}

export function LibraryRequestsPanel({ sections }: Props) {
  const [status, setStatus] = useState<RequestStatus | typeof ALL>("pending");
  const [sectionId, setSectionId] = useState<string>(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [canAct, setCanAct] = useState(false);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (status !== ALL) p.set("status", status);
    if (sectionId !== ALL) p.set("section_id", sectionId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("limit", String(PAGE_SIZE));
    p.set("offset", String(offset));
    return p.toString();
  }, [status, sectionId, from, to, offset]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // `get` (not apiGet) so the envelope survives — meta.total is how the
      // admin sees the size of the backlog, not just the page in front of them.
      const res = await get<{
        data: { requests: QueueRow[]; can_act: boolean };
        meta?: { total?: number };
      }>(`/v1/admin/library/requests?${query}`);
      setRows(res.data.requests);
      setCanAct(res.data.can_act);
      setTotal(res.meta?.total ?? res.data.requests.length);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load the request queue.");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await apiGet<DetailPayload>(`/v1/admin/library/requests/${id}`);
      setDetail(res);
      setNote(res.request.admin_note ?? "");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not load that request.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  async function decide(action: "accept" | "reject") {
    if (!selectedId || !canAct) return;
    if (action === "reject" && note.trim().length === 0) {
      const proceed = window.confirm(
        "Reject without a note? The requester sees this decision and a note is how they learn why.",
      );
      if (!proceed) return;
    }
    setBusy(true);
    try {
      await apiPatch(`/v1/admin/library/requests/${selectedId}`, {
        action,
        admin_note: note.trim() || null,
      });
      toast.success(action === "accept" ? "Request accepted." : "Request rejected.");
      await Promise.all([reload(), loadDetail(selectedId)]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not update that request.");
    } finally {
      setBusy(false);
    }
  }

  async function createItem() {
    if (!selectedId || !canAct) return;
    setBusy(true);
    try {
      const res = await apiPost<{ item_id: string; item_code: string }>(
        `/v1/admin/library/requests/${selectedId}/create-item`,
        {},
      );
      toast.success("Draft item created.", `Item code ${res.item_code} — publish it when ready.`);
      await Promise.all([reload(), loadDetail(selectedId)]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Could not create an item.");
    } finally {
      setBusy(false);
    }
  }

  const r = detail?.request;
  const terminal = r?.status === "rejected" || r?.status === "published";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="lrq-status" className="text-xs">
              Status
            </Label>
            <Select
              value={status}
              onValueChange={(v) => {
                setStatus(v as RequestStatus | typeof ALL);
                setOffset(0);
              }}
            >
              <SelectTrigger id="lrq-status" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s[0]!.toUpperCase() + s.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="lrq-section" className="text-xs">
              Section
            </Label>
            <Select
              value={sectionId}
              onValueChange={(v) => {
                setSectionId(v);
                setOffset(0);
              }}
            >
              <SelectTrigger id="lrq-section" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All sections</SelectItem>
                {sections.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.draft.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="lrq-from" className="text-xs">
              From
            </Label>
            <Input
              id="lrq-from"
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setOffset(0);
              }}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lrq-to" className="text-xs">
              To
            </Label>
            <Input
              id="lrq-to"
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setOffset(0);
              }}
              className="w-40"
            />
          </div>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading requests…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-border p-6 text-sm text-muted-foreground">
            Nothing matches these filters.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={`flex w-full flex-col gap-1 p-4 text-left transition hover:bg-muted/50 ${
                    selectedId === row.id ? "bg-muted" : ""
                  }`}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="font-medium">{row.title}</span>
                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.requester_name} · {formatDate(row.created_at)}
                    {row.section_name_en ? ` · ${row.section_name_en}` : ""}
                    {!row.section_name_en && row.suggested_section
                      ? ` · suggested: ${row.suggested_section}`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {offset + 1}–{Math.min(offset + rows.length, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + rows.length >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <aside className="rounded-md border border-border p-5">
        {!selectedId ? (
          <p className="text-sm text-muted-foreground">
            Pick a request to see the full ask, who sent it, and anyone else asking for the same
            thing.
          </p>
        ) : detailLoading || !r ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{r.title}</h3>
                <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Asked {formatDate(r.created_at)}
                {r.actioned_at ? ` · actioned ${formatDate(r.actioned_at)}` : ""}
              </p>
            </div>

            <p className="whitespace-pre-wrap text-sm">{r.details}</p>

            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Section</dt>
                <dd>
                  {r.section_name_en ??
                    (r.suggested_section ? `Suggested: ${r.suggested_section}` : "—")}
                </dd>
              </div>
              {r.reference_url ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Reference</dt>
                  <dd>
                    <a
                      href={r.reference_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      Open link <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-muted-foreground">Requester</dt>
                <dd>
                  {r.requester_name}
                  {r.requester_account_name && r.requester_account_name !== r.requester_name
                    ? ` (account: ${r.requester_account_name})`
                    : ""}
                </dd>
                <dd>
                  <a
                    href={`tel:${r.requester_phone}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {r.requester_phone}
                  </a>
                </dd>
                <dd className="text-xs text-muted-foreground">
                  {r.requester_user_id ? "Signed-in account" : "Guest (device-scoped)"}
                </dd>
              </div>
            </dl>

            {detail!.similar_pending.length > 0 ? (
              <div className="rounded-md bg-muted p-3">
                <p className="flex items-center gap-2 text-xs font-medium">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {detail!.similar_pending.length} other pending{" "}
                  {detail!.similar_pending.length === 1 ? "request looks" : "requests look"} like
                  this — sourcing it once answers them all.
                </p>
                <ul className="mt-2 space-y-1">
                  {detail!.similar_pending.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className="text-left text-xs text-primary underline-offset-4 hover:underline"
                      >
                        {s.title} — {s.requester_name}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {r.linked_item_id ? (
              <p className="text-sm">
                <a
                  href={`/admin/library/items/${r.linked_item_id}`}
                  className="text-primary underline-offset-4 hover:underline"
                >
                  Open the linked draft item
                </a>
              </p>
            ) : null}

            {/*
              Hidden for roles that cannot act — §17.10.5 asks the UI to
              supplement service enforcement. `can_act` comes from the API, so
              the button and the 403 can never disagree.
            */}
            {canAct && !terminal ? (
              <div className="space-y-3 border-t border-border pt-4">
                <div className="space-y-1">
                  <Label htmlFor="lrq-note" className="text-xs">
                    Note to the requester
                  </Label>
                  <Textarea
                    id="lrq-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Shown to whoever asked — say what will happen, or why not."
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.status === "pending" ? (
                    <Button size="sm" disabled={busy} onClick={() => void decide("accept")}>
                      Accept
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void decide("reject")}
                  >
                    Reject
                  </Button>
                  {!r.linked_item_id && r.section_id ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void createItem()}
                    >
                      Create draft item
                    </Button>
                  ) : null}
                </div>
                {!r.section_id && !r.linked_item_id ? (
                  <p className="text-xs text-muted-foreground">
                    This request suggests a new section, so an item cannot be spawned from it —
                    create the item by hand once you have decided where it belongs.
                  </p>
                ) : null}
              </div>
            ) : null}

            {canAct && terminal ? (
              <p className="border-t border-border pt-4 text-xs text-muted-foreground">
                {r.status === "published"
                  ? "Published — the requester has been told. This is a closed request."
                  : "Rejected. The requester can always send a fresh request."}
              </p>
            ) : null}

            {!canAct ? (
              <p className="border-t border-border pt-4 text-xs text-muted-foreground">
                Accepting, rejecting and sourcing are limited to state and national admins.
              </p>
            ) : null}

            {r.admin_note && !canAct ? (
              <div className="rounded-md bg-muted p-3">
                <p className="text-xs text-muted-foreground">Note to the requester</p>
                <p className="mt-1 text-sm">{r.admin_note}</p>
              </div>
            ) : null}
          </div>
        )}
      </aside>
    </div>
  );
}
