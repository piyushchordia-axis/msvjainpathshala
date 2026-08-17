/**
 * Cached, scope-filtered geography for admin pickers.
 *
 * Every dialog with a city picker used to feed the unscoped
 * `/v1/admin/geography` straight into a `<Select>`, offering every city in
 * India and re-downloading the national list on each open (CTY-API-05,
 * CTY-PRF-01) — the server then 403'd only after the whole form was filled.
 * This hook mirrors the QuizzesPage/AddNiyamDialog role filter in one place
 * and shares one in-flight/settled response per session.
 *
 * Load failures are surfaced (`error` + `retry`) instead of rendering empty
 * pickers that read as "empty scope" (CTY-ERR-03).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiGet } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

export interface GeoState {
  id: string;
  name: string;
  code?: string;
}

export interface GeoCity {
  id: string;
  name: string;
  code?: string;
  slug?: string;
  state_id: string;
  state_name?: string;
  state_code?: string;
}

interface GeographyPayload {
  states: GeoState[];
  cities: GeoCity[];
}

const TTL_MS = 5 * 60 * 1000;
let cached: { promise: Promise<GeographyPayload>; at: number } | null = null;

function fetchGeography(force = false): Promise<GeographyPayload> {
  const now = Date.now();
  if (!force && cached && now - cached.at < TTL_MS) return cached.promise;
  const promise = apiGet<GeographyPayload>('/v1/admin/geography')
    .then((r) => ({ states: r?.states ?? [], cities: r?.cities ?? [] }))
    .catch((err) => {
      // Never cache a failure — the next call retries.
      cached = null;
      throw err;
    });
  cached = { promise, at: now };
  return promise;
}

export function invalidateGeographyCache(): void {
  cached = null;
}

/**
 * @param enabled  typically the dialog's `open` flag — nothing is fetched
 *                 until true.
 */
export function useScopedGeography(enabled: boolean): {
  states: GeoState[];
  cities: GeoCity[];
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const { user } = useAuth();
  const [all, setAll] = useState<GeographyPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchGeography(reloadKey > 0)
      .then((payload) => {
        if (!cancelled) setAll(payload);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const filtered = useMemo<GeographyPayload>(() => {
    if (!all) return { states: [], cities: [] };
    let stateList = all.states;
    let cityList = all.cities;
    if (user?.role === 'state_admin' && user.state_id) {
      stateList = stateList.filter((s) => s.id === user.state_id);
      cityList = cityList.filter((c) => c.state_id === user.state_id);
    }
    if (user?.role === 'city_admin' && user.city_id) {
      cityList = cityList.filter((c) => c.id === user.city_id);
      const sid = cityList[0]?.state_id;
      stateList = sid ? stateList.filter((s) => s.id === sid) : [];
    }
    return { states: stateList, cities: cityList };
  }, [all, user?.role, user?.state_id, user?.city_id]);

  return { states: filtered.states, cities: filtered.cities, loading, error, retry };
}
