/**
 * One instrument's profile and its returns across EVERY period.
 *
 * Unlike the list hooks, the stock page wants all periods at once (a performance
 * strip, not a single figure), so this reads `market.performance` unfiltered by
 * period for one `scope_id`.
 *
 * Returns `found: false` for a ticker not in the universe — the stock page is
 * reachable with any ticker via deep link, and inventing a profile for one we have
 * no row for would be worse than saying so.
 */
import { useQuery } from '@tanstack/react-query';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError, zPerformanceRow, type PerformanceRow } from './market-client';
import { PERIODS, type Period } from './periods';
import { zInstrument, type Instrument } from './use-sector-constituents';

async function fetchInstrument(symbol: string) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const market = supabase.schema('market');

  const [profile, performance] = await Promise.all([
    market
      .from('instruments')
      .select('symbol,name,sector_id,provider_sector,industry,country,market_cap,asset_type,priced')
      .eq('symbol', symbol)
      .limit(1),
    market
      .from('performance')
      .select('scope,scope_id,period,change_pct,as_of,stale_after,source')
      .eq('scope', 'instrument')
      .eq('scope_id', symbol),
  ]);
  for (const r of [profile, performance]) {
    if (r.error) throw new Error(`market read failed: ${r.error.message}`);
  }
  return {
    instrument: parseArray(zInstrument, profile.data ?? [], 'market.instruments')[0] ?? null,
    performance: parseArray(zPerformanceRow, performance.data ?? [], 'market.performance'),
  };
}

export interface InstrumentDetail {
  instrument: Instrument | null;
  /** Period -> change %, only for periods the server actually has. */
  returns: { period: Period; changePct: number }[];
  asOf: Date | null;
  source: string | null;
  found: boolean;
  loading: boolean;
}

export function useInstrument(symbol: string): InstrumentDetail {
  const query = useQuery({
    queryKey: ['market', 'instrument', symbol],
    queryFn: () => fetchInstrument(symbol),
    enabled: symbol.length > 0,
    staleTime: 10 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const instrument = query.data?.instrument ?? null;
  const rows: PerformanceRow[] = query.data?.performance ?? [];

  const byPeriod = new Map(rows.map((r) => [r.period, r.change_pct]));
  // Iterate PERIODS, not the rows: fixed display order, and an unknown period from
  // a future backend cannot slip into the strip unlabelled.
  const returns = PERIODS.flatMap((period) => {
    const changePct = byPeriod.get(period);
    return changePct === undefined || changePct === null ? [] : [{ period, changePct }];
  });

  let newest: number | null = null;
  for (const r of rows) {
    const t = new Date(r.as_of).getTime();
    if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
  }

  return {
    instrument,
    returns,
    asOf: newest === null ? null : new Date(newest),
    source: rows.find((r) => r.source)?.source ?? null,
    found: instrument !== null,
    loading: query.isPending && symbol.length > 0,
  };
}
