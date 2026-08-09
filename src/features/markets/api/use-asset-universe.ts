/**
 * The multi-asset universe for the Markets tab, joined to its returns.
 *
 * This is the surface the README called out as the ONE place invented numbers
 * rendered with no caveat at all: ~50 authored `changePct` values in a drill list
 * with no sample badge. It now reads `market.instruments` (every asset type, not
 * just equities) plus `market.performance` scope=`instrument`.
 *
 * `priced = false` rows (cash, a bond yield) are kept in the LIST — they are part of
 * the universe — but carry no number, because a price return for them would be
 * meaningless rather than merely missing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';
import { ASSETS, type AssetType } from '@/features/markets/taxonomy';

import {
  fetchPerformance,
  isStale,
  latestAsOf,
  MarketUnavailableError,
  triggerRefresh,
  type PerformanceRow,
} from './market-client';
import type { Period } from './periods';
import { zInstrument } from './use-sector-constituents';

const RESOURCE = 'instrument-performance';
const INSTRUMENT_KEY = ['market', 'performance', 'instrument'] as const;
const NO_ROWS: PerformanceRow[] = [];

async function fetchUniverse() {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    .from('instruments')
    .select('symbol,name,sector_id,industry,country,asset_type,priced,sort_order')
    .order('sort_order');
  if (error) throw new Error(`market.instruments read failed: ${error.message}`);
  return parseArray(zInstrument, data ?? [], 'market.instruments');
}

export interface UniverseAsset {
  symbol: string;
  name: string;
  assetType: AssetType;
  sectorId: string | null;
  industry: string | null;
  country: string | null;
  changePct: number | null;
}

export interface AssetUniverse {
  items: UniverseAsset[];
  asOf: Date | null;
  source: string | null;
  sample: boolean;
  refreshing: boolean;
}

export function useAssetUniverse(period: Period, filter: AssetType | 'all'): AssetUniverse {
  const queryClient = useQueryClient();

  const universe = useQuery({
    queryKey: ['market', 'instruments', 'all'],
    queryFn: fetchUniverse,
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
    onError: (e) => console.warn(`[market] universe refresh failed, keeping existing: ${String(e)}`),
  });

  const perfRows = performance.data ?? NO_ROWS;
  const rows = universe.data ?? [];
  const stale = !performance.isPending && !performance.isError && rows.length > 0 && isStale(perfRows);

  const triggeredFor = useRef<Period | null>(null);
  const { mutate: startRefresh } = refresh;
  useEffect(() => {
    if (!stale || triggeredFor.current === period) return;
    triggeredFor.current = period;
    startRefresh();
  }, [stale, period, startRefresh]);

  if (rows.length === 0) {
    // Bundled seed. Note this is the fallback that used to be the ONLY path, and it
    // is now badged — previously these numbers rendered with no caveat at all.
    const seed = ASSETS.filter((a) => filter === 'all' || a.assetType === filter).map((a) => ({
      symbol: a.symbol,
      name: a.name,
      assetType: a.assetType,
      sectorId: a.sectorId ?? null,
      industry: null,
      country: a.country ?? null,
      changePct: a.changePct,
    }));
    return { items: seed, asOf: null, source: null, sample: true, refreshing: refresh.isPending };
  }

  const byId = new Map(perfRows.map((r) => [r.scope_id, r.change_pct]));
  const items: UniverseAsset[] = rows
    .filter((i) => filter === 'all' || (i.asset_type ?? 'equity') === filter)
    .map((i) => ({
      symbol: i.symbol,
      name: i.name ?? i.symbol,
      assetType: (i.asset_type ?? 'equity') as AssetType,
      sectorId: i.sector_id ?? null,
      industry: i.industry ?? null,
      country: i.country ?? null,
      changePct: byId.get(i.symbol) ?? null,
    }));

  return {
    items,
    asOf: latestAsOf(perfRows),
    source: perfRows.find((r) => r.source)?.source ?? null,
    sample: false,
    refreshing: refresh.isPending,
  };
}
