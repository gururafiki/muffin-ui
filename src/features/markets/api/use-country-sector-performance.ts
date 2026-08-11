/**
 * A country's OWN sector returns.
 *
 * The country page has been showing `scope = 'sector'` — finviz's `equity/compare/groups`, which
 * is US-listed only. So a Korea page displayed US sector returns under a heading that read as
 * Korea's, and none of them matched EWY's +121.9%. They now come from
 * `market.country_sector_performance`, a weighted mean of the country's own constituents.
 *
 * Korea's technology sector is +309% across 4 names carrying 61% of the fund — which is what makes
 * the country's +121.9% legible rather than mysterious.
 *
 * COVERAGE IS REPORTED, NOT HIDDEN. A weighted mean over 2 names holding 1% of a fund is not a
 * sector return in any useful sense, so rows below a floor are dropped and the caller is told how
 * much of the fund the remainder represents. Showing a number without saying what it covers is the
 * failure this whole exercise has been about.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { latestAsOf, MarketUnavailableError } from './market-client';
import type { Period } from './periods';

/**
 * Minimum share of the country fund a sector must carry to be shown.
 *
 * 1%: below that the constituents are incidental holdings and their weighted mean says more about
 * which names happen to be priced than about the sector.
 */
const MIN_WEIGHT_PCT = 1;

const zRow = z.looseObject({
  country_iso2: z.string(),
  sector_id: z.string(),
  period: z.string(),
  change_pct: z.coerce.number().nullish(),
  constituents: z.coerce.number().nullish(),
  weight_covered: z.coerce.number().nullish(),
  as_of: z.string().nullish(),
});

export interface CountrySectorReturn {
  sectorId: string;
  changePct: number;
  /** How many priced constituents the mean is over. */
  constituents: number;
  /** Share of the country fund those constituents carry. */
  weightPct: number;
}

export interface CountrySectorPerformance {
  items: CountrySectorReturn[];
  asOf: Date | null;
  /** True when the server has nothing for this country — the caller shows no panel at all. */
  empty: boolean;
}

async function fetchCountrySectors(iso2: string, period: Period) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    .from('country_sector_performance')
    .select('country_iso2,sector_id,period,change_pct,constituents,weight_covered,as_of')
    .eq('country_iso2', iso2)
    .eq('period', period)
    .order('weight_covered', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`market.country_sector_performance read failed: ${error.message}`);
  return parseArray(zRow, data ?? [], 'market.country_sector_performance');
}

export function useCountrySectorPerformance(
  iso2: string | undefined,
  period: Period,
): CountrySectorPerformance {
  const query = useQuery({
    queryKey: ['market', 'country-sector-performance', iso2 ?? null, period],
    queryFn: () => fetchCountrySectors(iso2 as string, period),
    enabled: !!iso2,
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const items = rows
    .filter((r) => r.change_pct != null && (r.weight_covered ?? 0) >= MIN_WEIGHT_PCT)
    .map((r) => ({
      sectorId: r.sector_id,
      changePct: r.change_pct as number,
      constituents: r.constituents ?? 0,
      weightPct: r.weight_covered ?? 0,
    }));

  return {
    items,
    asOf: latestAsOf(rows.map((r) => ({ as_of: r.as_of ?? null })) as never),
    // Distinguishes "nothing for this country" from "still loading": a country with no sector
    // coverage must render no panel rather than an empty one.
    empty: !query.isPending && items.length === 0,
  };
}
