/**
 * Sector performance for a timeframe — server rows when they exist, the bundled
 * authored numbers when they do not.
 *
 * Two deliberate properties:
 *
 * 1. **The screen never blanks and never spins.** `SECTORS` stays in the bundle as
 *    the seed, so the panel paints instantly, works offline, and works before
 *    Supabase is configured. Real rows replace it when they arrive. The `sample`
 *    flag is what the UI badges — so a fallback is always visibly labelled rather
 *    than passed off as live data.
 *
 * 2. **Read-only: reading the page never triggers a refresh.** Until 2026-09-25 a
 *    stale row made this hook ask `market-refresh` for `sector-performance` in the
 *    background (stale-while-revalidate, at most once per period per mount). Since
 *    the D2 cutover (2026-09-12) the numbers come from Dagster's `daily_indices` on
 *    its own schedule and `market.performance` is a view over them; the old resource
 *    is retired and the function answers 410.
 */
import { useQuery } from '@tanstack/react-query';

import { SECTORS, type MoverItem } from '@/features/markets/taxonomy';

import {
  fetchPerformance,
  latestAsOf,
  MarketUnavailableError,
  type PerformanceRow,
} from './market-client';
import type { Period } from './periods';

const SECTOR_KEY = ['market', 'performance', 'sector'] as const;

/**
 * Stable identity for the empty case: `query.data ?? []` would allocate a NEW array
 * on every render while the query has no data.
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
  const query = useQuery({
    queryKey: [...SECTOR_KEY, period],
    queryFn: () => fetchPerformance('sector', period),
    // Market facts, not user data: reuse across mounts and don't refetch on every
    // navigation. The Dagster lanes decide how fresh the rows are, not this query.
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    // Supabase not configured is a permanent condition, not a blip — retrying it
    // would cost round trips for a fallback we already have.
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? NO_ROWS;

  const items = toItems(rows);
  if (items.length === 0) {
    return {
      items: seedItems(),
      asOf: null,
      source: null,
      sample: true,
      loading: query.isPending,
    };
  }

  return {
    items,
    asOf: latestAsOf(rows),
    source: rows.find((r) => r.source)?.source ?? null,
    sample: false,
    loading: false,
  };
}
