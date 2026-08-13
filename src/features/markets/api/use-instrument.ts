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
import { zInstrument, type Instrument } from './market-instruments';

async function fetchInstrument(symbol: string) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const market = supabase.schema('market');

  const [profile, performance] = await Promise.all([
    market
      // The curated overlay, enriched from its linked security. `market.instruments` on its own
      // went stale the moment a provider refreshed the security instead.
      .from('instrument_current')
      .select(
        'symbol,name,sector_id,provider_sector,industry,country,market_cap,currency,asset_type,priced',
      )
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
  let instrument = parseArray(zInstrument, profile.data ?? [], 'market.instrument_current')[0] ?? null;

  // FALL BACK TO THE FUND-DERIVED UNIVERSE. `market.instruments` is the CURATED 35 rows, so every
  // other security opened a page with a bare ticker over blank space: no name, no sector, no
  // country, no market cap — while `market.security_current` had all four for ~10,000 of them.
  // That was tolerable while those rows were untappable; making them reachable is what turns it
  // into 3,400 half-empty pages, so the two changes ship together.
  //
  // Second query only on a miss, so the curated path costs nothing extra.
  if (!instrument) {
    const { data, error } = await market
      .from('security_current')
      .select('security_id,symbol,name,sector_id,industry,country_name,country_iso2,market_cap,currency_code')
      .eq('symbol', symbol)
      .limit(1);
    if (error) throw new Error(`market.security_current read failed: ${error.message}`);
    const row = (data ?? [])[0];
    if (row) {
      instrument = parseArray(zInstrument, [{
        ...row,
        country: row.country_name,
        // The ISO is what ROUTES. The display name alone left the country badge unclickable, since
        // `/country/[countryId]` is keyed on the registry id which is looked up from the ISO.
        countryIso: row.country_iso2,
        // `security_funds` is keyed on this, and it is the only stable key: migration 39 changed
        // the display symbol for 41% of non-US securities, so anything joined on symbol needed
        // re-keying by hand while anything joined on security_id needed nothing.
        securityId: row.security_id,
        currency: row.currency_code,
        // The fund-derived model has no `asset_type` and no `priced` flag. Both are hand-authored
        // columns on the curated table; absent is the honest answer, and `priced === false` is
        // load-bearing elsewhere (cash and bond yields render no number), so it must not default
        // to a value this row cannot support.
        asset_type: null,
        priced: null,
      }], 'market.security_current')[0] ?? null;
    }
  }

  return {
    instrument,
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
