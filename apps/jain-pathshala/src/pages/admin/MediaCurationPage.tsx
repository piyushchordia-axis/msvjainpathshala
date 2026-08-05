/**
 * Admin media curation — feature photos onto home / Punya Wall.
 * Sibling to GalleryAdminPage (upload/CRUD); this page is visual review only.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Redirect } from 'wouter';
import { Images, Home, Landmark } from 'lucide-react';
import { canFeatureMedia } from '@workspace/api-zod';
import { t, type Locale } from '@workspace/i18n';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { apiGet, apiPatch, ApiError } from '@/lib/api-client';
import { useAdminList } from '@/hooks/useAdminList';
import { toast } from '@/components/ui/toast-jp';
import { AdminPageShell, AdminError, AdminVirtualGrid } from '@/components/admin/AdminPageShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type FeaturedFilter = 'none' | 'home' | 'wall' | 'any';

interface QueueItem {
  id: string;
  student_id: string | null;
  first_name: string;
  age_group: string;
  centre_name: string | null;
  niyam_title_en: string | null;
  niyam_title_hi: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  featured_gallery: boolean;
  featured_home: boolean;
  is_public: boolean;
  city_id: string | null;
  submitted_at: string;
  consent_opt_in: boolean | null;
  can_publish: boolean;
}

interface GeoCity {
  id: string;
  name: string;
  state_id: string;
}

function tr(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  return t(`mediaCuration.${key}`, locale, vars);
}

function formatSubmitted(iso: string, locale: Locale): string {
  try {
    return new Date(iso).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function MediaCurationPage() {
  const { user } = useAuth();
  const locale = useLocale() as Locale;
  const canCurate = canFeatureMedia(user?.role);

  const [filter, setFilter] = useState<FeaturedFilter>('none');
  const [cityId, setCityId] = useState<string>('all');
  const [cities, setCities] = useState<GeoCity[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [localFlags, setLocalFlags] = useState<
    Record<string, { featured_home: boolean; featured_gallery: boolean }>
  >({});
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const showCitySelector =
    user?.role === 'super_admin' || user?.role === 'state_admin';

  useEffect(() => {
    if (!showCitySelector) return;
    void apiGet<{ cities: GeoCity[] }>('/v1/admin/geography')
      .then((r) => {
        let list = r?.cities ?? [];
        if (user?.role === 'state_admin' && user.state_id) {
          list = list.filter((c) => c.state_id === user.state_id);
        }
        setCities(list);
      })
      .catch(() => setCities([]));
  }, [showCitySelector, user?.role, user?.state_id]);

  const queuePath = useMemo(() => {
    const params = new URLSearchParams();
    params.set('featured', filter);
    params.set('limit', '100');
    if (showCitySelector && cityId !== 'all') {
      params.set('city_id', cityId);
    }
    return `/v1/gallery/admin/queue?${params.toString()}`;
  }, [filter, cityId, showCitySelector]);

  const { items, loading, error, reload } = useAdminList<QueueItem>(queuePath, [
    filter,
    cityId,
  ]);

  // Reset local optimistic overrides when the server list reloads.
  useEffect(() => {
    setLocalFlags({});
    setSelected(new Set());
  }, [items]);

  const resolved = useCallback(
    (item: QueueItem) => {
      const local = localFlags[item.id];
      return {
        featured_home: local?.featured_home ?? item.featured_home,
        featured_gallery: local?.featured_gallery ?? item.featured_gallery,
      };
    },
    [localFlags],
  );

  const setBusy = (id: string, on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  async function toggleFlag(
    item: QueueItem,
    flag: 'featured_home' | 'featured_gallery',
    next: boolean,
  ) {
    if (!item.can_publish) return;
    const prev = resolved(item);
    const optimistic = { ...prev, [flag]: next };
    setLocalFlags((m) => ({ ...m, [item.id]: optimistic }));
    setBusy(item.id, true);
    try {
      await apiPatch(`/v1/gallery/admin/${item.id}/featured`, { [flag]: next });
      if (flag === 'featured_home') {
        toast.success(next ? tr(locale, 'toastFeaturedHome') : tr(locale, 'toastUnfeaturedHome'));
      } else {
        toast.success(next ? tr(locale, 'toastFeaturedWall') : tr(locale, 'toastUnfeaturedWall'));
      }
    } catch (err) {
      setLocalFlags((m) => ({ ...m, [item.id]: prev }));
      toast.error(
        tr(locale, 'toastError'),
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBusy(item.id, false);
    }
  }

  function toggleSelect(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(on: boolean) {
    if (!on) {
      setSelected(new Set());
      return;
    }
    setSelected(
      new Set(items.filter((i) => i.can_publish).map((i) => i.id)),
    );
  }

  async function bulkFeature(flag: 'featured_home' | 'featured_gallery') {
    const ids = [...selected].filter((id) => {
      const item = items.find((i) => i.id === id);
      return item?.can_publish;
    });
    if (ids.length === 0) return;

    const snapshots = new Map(
      ids.map((id) => {
        const item = items.find((i) => i.id === id)!;
        return [id, resolved(item)] as const;
      }),
    );

    setLocalFlags((m) => {
      const next = { ...m };
      for (const id of ids) {
        const prev = snapshots.get(id)!;
        next[id] = { ...prev, [flag]: true };
      }
      return next;
    });

    setBulkBusy(true);
    try {
      const res = await apiPatch<{
        results: Array<{ id: string; result: 'applied' | 'forbidden' | 'not_found' }>;
      }>('/v1/gallery/admin/featured', { ids, [flag]: true });

      const results = res?.results ?? [];
      const applied = results.filter((r) => r.result === 'applied').length;
      const skipped = results.filter((r) => r.result !== 'applied').length;

      // Roll back non-applied.
      setLocalFlags((m) => {
        const next = { ...m };
        for (const r of results) {
          if (r.result !== 'applied') {
            const snap = snapshots.get(r.id);
            if (snap) next[r.id] = snap;
          }
        }
        return next;
      });

      if (skipped > 0) {
        toast.success(tr(locale, 'bulkSummary', { applied, skipped }));
      } else {
        toast.success(tr(locale, 'bulkSummaryOk', { applied }));
      }
      setSelected(new Set());
      void reload();
    } catch (err) {
      setLocalFlags((m) => {
        const next = { ...m };
        for (const [id, snap] of snapshots) next[id] = snap;
        return next;
      });
      toast.error(
        tr(locale, 'toastError'),
        err instanceof ApiError ? err.message : undefined,
      );
    } finally {
      setBulkBusy(false);
    }
  }

  if (!user || !canCurate) {
    return <Redirect to="/admin" />;
  }

  const selectableCount = items.filter((i) => i.can_publish).length;
  const allSelected =
    selectableCount > 0 &&
    items.filter((i) => i.can_publish).every((i) => selected.has(i.id));

  const filters: Array<{ id: FeaturedFilter; labelKey: string }> = [
    { id: 'none', labelKey: 'filterPending' },
    { id: 'home', labelKey: 'filterHome' },
    { id: 'wall', labelKey: 'filterWall' },
    { id: 'any', labelKey: 'filterAll' },
  ];

  return (
    <AdminPageShell title={tr(locale, 'title')} subtitle={tr(locale, 'subtitle')}>
      {error ? <AdminError message={error} /> : null}

      {/* Filter bar */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div
          className="flex flex-wrap gap-1 rounded-md border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label={tr(locale, 'title')}
        >
          {filters.map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              variant={filter === f.id ? 'default' : 'ghost'}
              className="min-w-[5.5rem]"
              onClick={() => setFilter(f.id)}
            >
              {tr(locale, f.labelKey)}
            </Button>
          ))}
        </div>

        {showCitySelector ? (
          <div className="flex min-w-[12rem] max-w-xs flex-col gap-1">
            <Label className="text-xs text-muted-foreground">{tr(locale, 'cityLabel')}</Label>
            <Select value={cityId} onValueChange={setCityId}>
              <SelectTrigger>
                <SelectValue placeholder={tr(locale, 'cityAll')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr(locale, 'cityAll')}</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 ? (
        <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-background/95 p-3 shadow-sm backdrop-blur">
          <span className="text-sm font-medium">
            {tr(locale, 'selectedCount', { n: selected.size })}
          </span>
          <Button
            size="sm"
            disabled={bulkBusy}
            onClick={() => void bulkFeature('featured_home')}
          >
            <Home className="mr-1.5 size-3.5 shrink-0" />
            <span className="whitespace-normal text-left leading-snug">
              {tr(locale, 'bulkShowHome', { n: selected.size })}
            </span>
          </Button>
          <Button
            size="sm"
            disabled={bulkBusy}
            onClick={() => void bulkFeature('featured_gallery')}
          >
            <Landmark className="mr-1.5 size-3.5 shrink-0" />
            <span className="whitespace-normal text-left leading-snug">
              {tr(locale, 'bulkShowWall', { n: selected.size })}
            </span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={() => setSelected(new Set())}
          >
            {tr(locale, 'bulkClear')}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{tr(locale, 'loading')}</p>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-10 text-center">
          <Images className="size-8 text-muted-foreground" aria-hidden />
          <p className="font-display text-lg text-secondary">{tr(locale, 'empty')}</p>
          <p className="max-w-md text-sm text-muted-foreground">{tr(locale, 'emptyHint')}</p>
        </Card>
      ) : (
        <>
          {selectableCount > 0 ? (
            <div className="mb-3 flex items-center gap-2">
              <Checkbox
                id="curation-select-all"
                checked={allSelected}
                onCheckedChange={(v) => toggleSelectAll(v === true)}
              />
              <Label htmlFor="curation-select-all" className="text-sm font-normal text-muted-foreground">
                {tr(locale, 'selectPhoto')}
              </Label>
            </div>
          ) : null}

          <AdminVirtualGrid
            count={items.length}
            columns={3}
            estimateRowHeight={420}
            renderItem={(i) => {
              const item = items[i]!;
              const flags = resolved(item);
              const src = item.thumbnail_url;
              const optedOut = item.student_id != null && !item.can_publish;
              const niyamTitle =
                locale === 'hi'
                  ? item.niyam_title_hi || item.niyam_title_en
                  : item.niyam_title_en || item.niyam_title_hi;
              const busy = busyIds.has(item.id) || bulkBusy;

              const toggles = (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor={`home-${item.id}`}
                      className={cn(
                        'min-w-0 flex-1 text-sm font-normal leading-snug',
                        optedOut && 'text-muted-foreground',
                      )}
                    >
                      {tr(locale, 'showOnHome')}
                    </Label>
                    <Switch
                      id={`home-${item.id}`}
                      checked={flags.featured_home}
                      disabled={optedOut || busy}
                      onCheckedChange={(v) => void toggleFlag(item, 'featured_home', v)}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <Label
                      htmlFor={`wall-${item.id}`}
                      className={cn(
                        'min-w-0 flex-1 text-sm font-normal leading-snug',
                        optedOut && 'text-muted-foreground',
                      )}
                    >
                      {tr(locale, 'showOnWall')}
                    </Label>
                    <Switch
                      id={`wall-${item.id}`}
                      checked={flags.featured_gallery}
                      disabled={optedOut || busy}
                      onCheckedChange={(v) => void toggleFlag(item, 'featured_gallery', v)}
                    />
                  </div>
                </div>
              );

              return (
                <Card key={item.id} className="overflow-hidden p-0">
                  <div className="relative aspect-[4/3] bg-muted">
                    {src ? (
                      <img
                        src={src}
                        alt=""
                        width={400}
                        height={300}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        {item.first_name || tr(locale, 'generalPhoto')}
                      </div>
                    )}
                    {item.can_publish ? (
                      <div className="absolute left-2 top-2">
                        <Checkbox
                          checked={selected.has(item.id)}
                          onCheckedChange={(v) => toggleSelect(item.id, v === true)}
                          aria-label={tr(locale, 'selectPhoto')}
                          className="border-background bg-background/90 shadow-sm"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-3 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {item.first_name || tr(locale, 'generalPhoto')}
                        </div>
                        {item.age_group ? (
                          <div className="text-xs text-muted-foreground">
                            {tr(locale, 'ageGroup')}: {item.age_group}
                          </div>
                        ) : null}
                      </div>
                      {item.centre_name ? (
                        <span className="max-w-[40%] shrink-0 truncate text-right text-xs text-muted-foreground">
                          {item.centre_name}
                        </span>
                      ) : null}
                    </div>

                    {niyamTitle ? (
                      <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                        <span className="font-medium text-foreground/80">{tr(locale, 'niyam')}: </span>
                        {niyamTitle}
                      </p>
                    ) : null}

                    <p className="text-xs text-muted-foreground">
                      {tr(locale, 'submitted')}: {formatSubmitted(item.submitted_at, locale)}
                    </p>

                    {optedOut ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge
                            variant="outline"
                            className="w-full justify-start whitespace-normal border-amber-700/30 bg-amber-500/10 px-2 py-1.5 text-left font-normal leading-snug text-amber-900 dark:text-amber-100"
                          >
                            {tr(locale, 'consentOptOut')}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-pretty">
                          {tr(locale, 'consentTooltip')}
                        </TooltipContent>
                      </Tooltip>
                    ) : null}

                    {optedOut ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="opacity-60">{toggles}</div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-pretty">
                          {tr(locale, 'consentTooltip')}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      toggles
                    )}
                  </div>
                </Card>
              );
            }}
          />
        </>
      )}
    </AdminPageShell>
  );
}
