/**
 * Sector performance for a timeframe — server rows when they exist, the bundled
 * authored numbers when they do not.
 *
 * Three deliberate properties:
 *
 * 1. **The screen never blanks and never spins.** `SECTORS` stays in the bundle as
 *    the seed, so the panel paints instantly, works offline, and works before
 *    Supabase is configured. Real rows replace it when they arrive. The `sample`
 *    flag is what the UI badges — so a fallback is always visibly labelled rather
 *    than passed off as live data.
 *
 * 2. **Stale-while-revalidate, never read-through.** A stale row is still returned
 *    immediately; the refresh runs in the background and the query is invalidated
 *    when it lands. Nobody waits on OpenBB.
 *
 * 3. **At most ONE auto-refresh per period per mount.** Without that guard an
 *    upstream outage loops: rows stay stale, so the effect re-fires, forever. The
 *    server-side claim in `market.begin_refresh` bounds it across clients, but the
 *    client must not depend on the server to stop it hammering.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { SECTORS, type MoverItem } from '@/features/markets/taxonomy';

import {
  fetchPerformance,
  isStale,
  latestAsOf,
  MarketUnavailableError,
  triggerRefresh,
  type PerformanceRow,
} from './market-client';
import type { Period } from './periods';

const RESOURCE = 'sector-performance';
const SECTOR_KEY = ['market', 'performance', 'sector'] as const;

/**
 * Stable identity for the empty case. `query.data ?? []` allocates a NEW array on
 * every render while the query has no data, which would make the effect below see
 * changed deps forever.
 */
const NO_ROWS: PerformanceRow[] = [];

export interface SectorPerformance {
  items: MoverItem[];
  /** When the upstream reported these numbers; null for the bundled seed. */
  asOf: Date | null;
  source: string | null;
  /** True when showing the authored fallback rather than server data. */
  sample: boolean;
  loading: boolean;
  /** A background refresh is in flight (the panel keeps showing current values). */
  refreshing: boolean;
}

/** The authored fallback, shaped exactly like the server-backed result. */
function seedItems(): MoverItem[] {
  return SECTORS.map((s) => ({ key: s.id, label: s.name, icon: s.icon, changePct: s.changePct }));
}

function toItems(rows: PerformanceRow[]): MoverItem[] {
  const byId = new Map(rows.map((r) => [r.scope_id, r]));
  const out: MoverItem[] = [];
  // Iterate SECTORS, not the rows: it keeps display order and the icon/name copy
  // owned by the app, and drops any scope_id the app has no sector for.
  for (const s of SECTORS) {
    const row = byId.get(s.id);
    if (!row || row.change_pct === null) continue;
    out.push({ key: s.id, label: s.name, icon: s.icon, changePct: row.change_pct });
  }
  return out;
}

export function useSectorPerformance(period: Period): SectorPerformance {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...SECTOR_KEY, period],
    queryFn: () => fetchPerformance('sector', period),
    // Market facts, not user data: reuse across mounts and don't refetch on every
    // navigation. Actual freshness is driven by `stale_after` on the rows.
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    // Supabase not configured is a permanent condition, not a blip — retrying it
    // would cost round trips for a fallback we already have.
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  // useMutation rather than a ref: `isPending` is reactive, so the "updating" badge
  // actually re-renders. A ref read during render cannot trigger one.
  const refresh = useMutation({
    mutationFn: () => triggerRefresh(RESOURCE),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SECTOR_KEY }),
    onError: (e) => console.warn(`[market] refresh failed, showing existing data: ${String(e)}`),
  });

  const rows = query.data ?? NO_ROWS;
  const settled = !query.isPending && !query.isError;
  const stale = settled && isStale(rows);

  // One attempt per period per mount — see property 3 above.
  const triggeredFor = useRef<Period | null>(null);
  const { mutate: startRefresh } = refresh;
  useEffect(() => {
    if (!stale || triggeredFor.current === period) return;
    triggeredFor.current = period;
    startRefresh();
  }, [stale, period, startRefresh]);

  const items = toItems(rows);
  if (items.length === 0) {
    return {
      items: seedItems(),
      asOf: null,
      source: null,
      sample: true,
      loading: query.isPending,
      refreshing: refresh.isPending,
    };
  }

  return {
    items,
    asOf: latestAsOf(rows),
    source: rows.find((r) => r.source)?.source ?? null,
    sample: false,
    loading: false,
    refreshing: refresh.isPending,
  };
}
