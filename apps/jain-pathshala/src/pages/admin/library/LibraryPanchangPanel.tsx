import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiGet, apiPatch, apiPost, apiPut, ApiError } from "@/lib/api-client";
import { toast } from "@/components/ui/toast-jp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PublishControls } from "./PublishControls";

type YearListItem = {
  id: string;
  year: number;
  sect: string;
  is_published: boolean;
  content_version: number;
};

type PanchangDay = {
  date: string;
  vaar: string;
  month: string;
  isAdhikMaas: boolean;
  paksha: "sud" | "vad";
  tithi: number;
  tithiKey: string;
  tithiStatus: "normal" | "kshay" | "vridhi";
  nakshatra: string;
  parvTithi: boolean;
  events: unknown[];
};

type YearDetail = {
  year: number;
  is_published: boolean;
  content_version: number;
  draft: {
    year?: number;
    months: Array<{ key: string; name_en: string }>;
    days: PanchangDay[];
  };
};

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

function formatZodDetails(details: unknown): string {
  if (!Array.isArray(details)) return "";
  return details
    .map((d) => {
      if (d && typeof d === "object" && "path" in d && "message" in d) {
        const row = d as { path: string; message: string };
        return `${row.path || "(root)"}: ${row.message}`;
      }
      return String(d);
    })
    .join("\n");
}

interface Props {
  canPublish: boolean;
}

export function LibraryPanchangPanel({ canPublish }: Props) {
  const [years, setYears] = useState<YearListItem[]>([]);
  const [year, setYear] = useState<string>("");
  const [detail, setDetail] = useState<YearDetail | null>(null);
  const [monthKey, setMonthKey] = useState("");
  const [fieldErrors, setFieldErrors] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editDay, setEditDay] = useState<PanchangDay | null>(null);

  async function loadYears() {
    const res = await apiGet<{ items: YearListItem[] }>("/v1/admin/library/panchang/years");
    setYears(res.items);
    if (!year && res.items[0]) setYear(String(res.items[0].year));
  }

  async function loadYear(y: string) {
    if (!y) {
      setDetail(null);
      return;
    }
    setBusy(true);
    setFieldErrors(null);
    try {
      const res = await apiGet<YearDetail>(`/v1/admin/library/panchang/years/${y}`);
      setDetail(res);
      const firstMonth = res.draft.days[0]?.month ?? res.draft.months[0]?.key ?? "";
      setMonthKey(firstMonth);
    } catch (err) {
      setDetail(null);
      toast.error(err instanceof ApiError ? err.message : "Could not load Panchang year.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadYears().catch((err) =>
      toast.error(err instanceof ApiError ? err.message : "Could not list Panchang years."),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (year) void loadYear(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const monthDays = useMemo(() => {
    if (!detail) return [];
    return detail.draft.days.filter((d) => d.month === monthKey);
  }, [detail, monthKey]);

  const daysByDate = useMemo(() => {
    const map = new Map<string, PanchangDay>();
    for (const d of monthDays) map.set(d.date, d);
    return map;
  }, [monthDays]);

  const calendarCells = useMemo(() => {
    if (monthDays.length === 0) return [];
    const dates = monthDays.map((d) => d.date).sort();
    const start = new Date(`${dates[0]}T12:00:00`);
    const end = new Date(`${dates[dates.length - 1]}T12:00:00`);
    const gridStart = new Date(start);
    gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7)); // Monday-first
    const cells: Array<{ date: string | null; day: PanchangDay | null }> = [];
    const cursor = new Date(gridStart);
    while (cursor <= end || cells.length % 7 !== 0) {
      const iso = cursor.toISOString().slice(0, 10);
      const inRange = iso >= dates[0]! && iso <= dates[dates.length - 1]!;
      cells.push({
        date: inRange ? iso : null,
        day: inRange ? daysByDate.get(iso) ?? null : null,
      });
      cursor.setDate(cursor.getDate() + 1);
      if (cells.length > 42) break;
    }
    return cells;
  }, [monthDays, daysByDate]);

  async function onJsonFile(file: File | null) {
    if (!file) return;
    setFieldErrors(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as Record<string, unknown>;
      const y = Number(payload.year);
      const exists = years.some((row) => row.year === y);
      if (exists) {
        await apiPut(`/v1/admin/library/panchang/years/${y}`, payload);
        toast.success(`Updated draft for ${y}.`);
      } else {
        await apiPost("/v1/admin/library/panchang/years", payload);
        toast.success(`Created draft for ${y}.`);
      }
      await loadYears();
      setYear(String(y));
    } catch (err) {
      if (err instanceof ApiError) {
        const details = formatZodDetails(err.details);
        setFieldErrors(details || err.message);
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Invalid JSON.");
      }
    }
  }

  async function saveDay(day: PanchangDay) {
    if (!year) return;
    try {
      await apiPatch(`/v1/admin/library/panchang/years/${year}/days/${day.date}`, day);
      toast.success("Day updated.");
      setEditDay(null);
      await loadYear(year);
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(formatZodDetails(err.details) || err.message);
        toast.error(err.message);
      } else {
        toast.error("Could not save day.");
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40 space-y-1">
          <Label className="text-xs">Year</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger>
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y.id} value={String(y.year)}>
                  {y.year} {y.is_published ? "(published)" : "(draft)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Upload year JSON</Label>
          <Input
            type="file"
            accept="application/json,.json"
            onChange={(e) => void onJsonFile(e.target.files?.[0] ?? null)}
          />
        </div>
        {detail ? (
          <PublishControls
            canPublish={canPublish}
            isPublished={detail.is_published}
            busy={busy}
            onPublish={async () => {
              await apiPost(`/v1/admin/library/panchang/years/${year}/publish`, {});
              await loadYears();
              await loadYear(year);
              toast.success("Panchang year published.");
            }}
            onUnpublish={async () => {
              await apiPost(`/v1/admin/library/panchang/years/${year}/unpublish`, {});
              await loadYears();
              await loadYear(year);
              toast.success("Panchang year unpublished.");
            }}
          />
        ) : null}
      </div>

      {fieldErrors ? (
        <pre className="whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
          {fieldErrors}
        </pre>
      ) : null}

      {busy ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : null}

      {detail ? (
        <>
          <div className="w-56 space-y-1">
            <Label className="text-xs">Month</Label>
            <Select value={monthKey} onValueChange={setMonthKey}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {detail.draft.months.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.name_en} ({m.key})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-1 font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {calendarCells.map((cell, i) => (
              <button
                key={i}
                type="button"
                disabled={!cell.day}
                className="min-h-[64px] rounded border border-border p-1 text-left disabled:opacity-30"
                onClick={() => cell.day && setEditDay({ ...cell.day })}
              >
                {cell.date ? (
                  <>
                    <div className="font-medium">{Number(cell.date.slice(8))}</div>
                    {cell.day ? (
                      <div className="text-[10px] text-muted-foreground">
                        {cell.day.paksha} {cell.day.tithi}
                        {cell.day.tithiStatus !== "normal" ? ` · ${cell.day.tithiStatus}` : ""}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Upload a year JSON or select an existing year.</p>
      )}

      {editDay ? (
        <div className="space-y-3 rounded-md border border-border p-4">
          <h3 className="font-medium">Edit {editDay.date}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow label="Vaar">
              <Input
                value={editDay.vaar}
                onChange={(e) => setEditDay({ ...editDay, vaar: e.target.value })}
              />
            </FormRow>
            <FormRow label="Month key">
              <Input
                value={editDay.month}
                onChange={(e) => setEditDay({ ...editDay, month: e.target.value })}
              />
            </FormRow>
            <FormRow label="Paksha">
              <Select
                value={editDay.paksha}
                onValueChange={(v) => setEditDay({ ...editDay, paksha: v as "sud" | "vad" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sud">Sud</SelectItem>
                  <SelectItem value="vad">Vad</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Tithi (1–15)">
              <Input
                type="number"
                min={1}
                max={15}
                value={editDay.tithi}
                onChange={(e) => setEditDay({ ...editDay, tithi: Number(e.target.value) })}
              />
            </FormRow>
            <FormRow label="Tithi key">
              <Input
                value={editDay.tithiKey}
                onChange={(e) => setEditDay({ ...editDay, tithiKey: e.target.value })}
              />
            </FormRow>
            <FormRow label="Tithi status">
              <Select
                value={editDay.tithiStatus}
                onValueChange={(v) =>
                  setEditDay({
                    ...editDay,
                    tithiStatus: v as PanchangDay["tithiStatus"],
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="kshay">Kshay</SelectItem>
                  <SelectItem value="vridhi">Vridhi</SelectItem>
                </SelectContent>
              </Select>
            </FormRow>
            <FormRow label="Nakshatra">
              <Input
                value={editDay.nakshatra}
                onChange={(e) => setEditDay({ ...editDay, nakshatra: e.target.value })}
              />
            </FormRow>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setEditDay(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveDay(editDay)}>
              Save day
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
