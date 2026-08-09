/**
 * Country equity-market performance for a timeframe, keyed by ISO-3166 alpha-2.
 *
 * Same contract as `useSectorPerformance` — see that file for the three properties
 * this shares (instant paint from the bundled seed, stale-while-revalidate, one
 * auto-refresh per period per mount).
 *
 * The numbers are single-country ETF PRICE returns (dividends excluded), computed
 * server-side from daily closes; `market.countries.etf_symbol` holds the proxy and is
 * editable in Studio.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { COUNTRIES } from '@/features/markets/taxonomy';

import {
  fetchPerformance,
  isStale,
  latestAsOf,
  MarketUnavailableError,
  triggerRefresh,
  type PerformanceRow,
} from './market-client';
import { COUNTRY_PERIODS, type Period } from './periods';

const RESOURCE = 'country-performance';
const COUNTRY_KEY = ['market', 'performance', 'country'] as const;
const NO_ROWS: PerformanceRow[] = [];

export interface CountryPerformance {
  /** ISO-2 -> change % for the active period. Empty when falling back. */
  byIso: Map<string, number>;
  asOf: Date | null;
  source: string | null;
  sample: boolean;
  refreshing: boolean;
}

export function useCountryPerformance(period: Period): CountryPerformance {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...COUNTRY_KEY, period],
    queryFn: () => fetchPerformance('country', period),
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const refresh = useMutation({
    mutationFn: () => triggerRefresh(RESOURCE),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COUNTRY_KEY }),
    onError: (e) => console.warn(`[market] country refresh failed, keeping existing: ${String(e)}`),
  });

  const rows = query.data ?? NO_ROWS;
  const stale = !query.isPending && !query.isError && isStale(rows);

  const triggeredFor = useRef<Period | null>(null);
  const { mutate: startRefresh } = refresh;
  useEffect(() => {
    if (!stale || triggeredFor.current === period) return;
    triggeredFor.current = period;
    startRefresh();
  }, [stale, period, startRefresh]);

  const byIso = new Map<string, number>();
  for (const r of rows) if (r.change_pct !== null) byIso.set(r.scope_id, r.change_pct);

  if (byIso.size === 0) {
    // Bundled seed, keyed the same way so call sites never branch on provenance.
    return {
      byIso: new Map(COUNTRIES.map((c) => [c.iso, c.changePct])),
      asOf: null,
      source: null,
      sample: true,
      refreshing: refresh.isPending,
    };
  }

  return {
    byIso,
    asOf: latestAsOf(rows),
    source: rows.find((r) => r.source)?.source ?? null,
    sample: false,
    refreshing: refresh.isPending,
  };
}

export { COUNTRY_PERIODS };
