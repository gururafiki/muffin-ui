/**
 * The instruments shown under a sector, joined to their performance.
 *
 * Two server sources, one hook:
 *   * `market.instruments` — the curated universe (`sector_id`) enriched by the
 *     refresh with the provider's real `industry`, `country` and market cap.
 *   * `market.performance` scope=`instrument` — returns for the active period.
 *
 * The SUB-SECTOR chips on the sector page come from the distinct `industry` values
 * here, replacing `taxonomy.ts`'s authored slugs (`software-saas`, `semiconductors`)
 * which had nothing behind them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';
import { stocksInSector } from '@/features/markets/taxonomy';

import {
  fetchPerformance,
  isStale,
  latestAsOf,
  MarketUnavailableError,
  triggerRefresh,
  type PerformanceRow,
} from './market-client';
import type { Period } from './periods';

const RESOURCE = 'instrument-performance';
const INSTRUMENT_KEY = ['market', 'performance', 'instrument'] as const;
const NO_ROWS: PerformanceRow[] = [];

/** Mirrors `market.instruments` (05-market-instruments.sql). */
export const zInstrument = z.looseObject({
  symbol: z.string(),
  name: z.string().nullish(),
  sector_id: z.string().nullish(),
  provider_sector: z.string().nullish(),
  industry: z.string().nullish(),
  country: z.string().nullish(),
  market_cap: z.coerce.number().nullish(),
  sort_order: z.coerce.number().nullish(),
});
export type Instrument = z.infer<typeof zInstrument>;

async function fetchInstruments(sectorId: string): Promise<Instrument[]> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    .from('instruments')
    .select('symbol,name,sector_id,provider_sector,industry,country,market_cap,sort_order')
    .eq('sector_id', sectorId)
    .order('sort_order');
  if (error) throw new Error(`market.instruments read failed: ${error.message}`);
  return parseArray(zInstrument, data ?? [], 'market.instruments');
}

export interface SectorConstituent {
  symbol: string;
  name: string;
  /** The provider's real industry — the sub-sector. */
  industry: string | null;
  country: string | null;
  changePct: number | null;
}

export interface SectorConstituents {
  items: SectorConstituent[];
  /** Distinct industries present, for the sub-sector chips. */
  subSectors: string[];
  asOf: Date | null;
  source: string | null;
  sample: boolean;
  refreshing: boolean;
}

export function useSectorConstituents(sectorId: string, period: Period): SectorConstituents {
  const queryClient = useQueryClient();

  const instruments = useQuery({
    queryKey: ['market', 'instruments', sectorId],
    queryFn: () => fetchInstruments(sectorId),
    staleTime: 24 * 60 * 60_000,
    gcTime: 30 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const performance = useQuery({
    queryKey: [...INSTRUMENT_KEY, period],
    queryFn: () => fetchPerformance('instrument', period),
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const refresh = useMutation({
    mutationFn: () => triggerRefresh(RESOURCE),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INSTRUMENT_KEY }),
    onError: (e) => console.warn(`[market] instrument refresh failed, keeping existing: ${String(e)}`),
  });

  const perfRows = performance.data ?? NO_ROWS;
  const stale =
    !performance.isPending && !performance.isError && (instruments.data?.length ?? 0) > 0 && isStale(perfRows);

  const triggeredFor = useRef<Period | null>(null);
  const { mutate: startRefresh } = refresh;
  useEffect(() => {
    if (!stale || triggeredFor.current === period) return;
    triggeredFor.current = period;
    startRefresh();
  }, [stale, period, startRefresh]);

  const rows = instruments.data ?? [];
  if (rows.length === 0) {
    // Bundled seed — authored tickers and authored numbers, badged accordingly.
    const seed = stocksInSector(sectorId);
    return {
      items: seed.map((s) => ({
        symbol: s.ticker,
        name: s.name,
        industry: null,
        country: s.country,
        changePct: s.changePct,
      })),
      subSectors: [],
      asOf: null,
      source: null,
      sample: true,
      refreshing: refresh.isPending,
    };
  }

  const byId = new Map(perfRows.map((r) => [r.scope_id, r.change_pct]));
  const items: SectorConstituent[] = rows.map((i) => ({
    symbol: i.symbol,
    name: i.name ?? i.symbol,
    industry: i.industry ?? null,
    country: i.country ?? null,
    // null (not the authored number) when the server has no row — the list must
    // never mix live and authored values unlabelled.
    changePct: byId.get(i.symbol) ?? null,
  }));

  const subSectors = [...new Set(rows.map((i) => i.industry).filter((v): v is string => !!v))].sort();

  return {
    items,
    subSectors,
    asOf: latestAsOf(perfRows),
    source: perfRows.find((r) => r.source)?.source ?? null,
    sample: false,
    refreshing: refresh.isPending,
  };
}
