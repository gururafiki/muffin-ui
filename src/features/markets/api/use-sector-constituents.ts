/**
 * The securities shown under a sector, joined to their performance.
 *
 * The list now comes from `market.sector_constituents` — securities the SECTOR SPDR actually
 * holds, per its SEC N-PORT filing. That replaces `market.instruments`, a 35-row hand-authored
 * table which is why a sector page used to show two or three names. There are 514 constituents
 * across the 11 sectors, each with the weight the fund reports.
 *
 * RANKED BY FUND WEIGHT, not market cap. Market cap needs a paid provider (FMP gates it per
 * symbol), whereas weight is a fact from a filing — and for a cap-weighted sector fund the two
 * orderings are nearly the same, so the first page is still the recognisable names.
 *
 * `market.performance` (scope=`instrument`) still supplies the % change, and it only covers the
 * curated instruments — so most rows show NO number rather than an invented one, which is the
 * same rule the rest of these screens follow.
 *
 * SUB-SECTOR CHIPS ARE BACK, and real this time. They come from `taxonomy_node` level 2, written
 * by `security-industries` from yfinance's `industry_category` — 91 industries such as
 * "Semiconductors", "Banks - Regional" and "Insurance - Life", each hanging off its own sector.
 * They were removed when the only source was `instruments.industry`, which covered 35 securities
 * of 9,786: chips that partition 7% of a list imply a grouping the data cannot support.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';
import { getCountryByIso, stocksInSector } from '@/features/markets/taxonomy';

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

/** Mirrors the `market.sector_constituents` view (13-derived-classification.sql). */
export const zSectorConstituentRow = z.looseObject({
  security_id: z.string(),
  name: z.string(),
  symbol: z.string().nullish(),
  industry: z.string().nullish(),
  country_iso2: z.string().nullish(),
  // `z.coerce` guards the driver, not a live bug: PostgREST sends `numeric` as a JSON number
  // today, but a version that quoted it would make every row fail to parse and silently empty
  // the page.
  weight: z.coerce.number().nullish(),
  fund_symbol: z.string().nullish(),
  as_of: z.string().nullish(),
});
export type SectorConstituentRow = z.infer<typeof zSectorConstituentRow>;

async function fetchConstituents(
  sectorId: string,
  countryIso2: string | undefined,
  limit: number,
): Promise<SectorConstituentRow[]> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  let q = supabase
    .schema('market')
    .from('sector_constituents')
    .select('security_id,name,symbol,industry,country_iso2,weight,fund_symbol,as_of')
    .eq('sector_id', sectorId);
  // Drilling in from a country page means "this sector IN this country". Filtered on ISO-2 rather
  // than the country's display name: the server stores the code, and a name would have to match a
  // provider's spelling exactly.
  if (countryIso2) q = q.eq('country_iso2', countryIso2);
  const { data, error } = await q
    // Heaviest first: on a paged list the first page should be the names people recognise.
    .order('weight', { ascending: false, nullsFirst: false })
    .order('name')
    .range(0, limit - 1);
  if (error) throw new Error(`market.sector_constituents read failed: ${error.message}`);
  return parseArray(zSectorConstituentRow, data ?? [], 'market.sector_constituents');
}

export interface SectorConstituent {
  /** Stable key: a security always has one, a resolved ticker is not guaranteed. */
  id: string;
  /** The sub-sector — taxonomy level 2, from the provider's `industry_category`. */
  industry: string | null;
  /** Null until OpenFIGI resolves one — most non-US listings have no US symbol at all. */
  symbol: string | null;
  name: string;
  country: string | null;
  /** The security's weight in the sector fund, as a percent. */
  weight: number | null;
  /** WHICH fund that weight is a share of. A weight without it is unattributable. */
  fundSymbol: string | null;
  changePct: number | null;
}

export interface SectorConstituents {
  items: SectorConstituent[];
  /** Distinct sub-sectors among the rows fetched — the chips on the sector page. */
  subSectors: string[];
  asOf: Date | null;
  source: string | null;
  sample: boolean;
  refreshing: boolean;
  /** True when the server may hold more rows than `limit` returned. */
  hasMore: boolean;
  loadingMore: boolean;
  /** The fund the weights are shares of, when the page's rows agree on one. */
  fundSymbol: string | null;
}

/** Rows per page. Small enough that "load more" is meaningful on a phone. */
export const SECTOR_PAGE_SIZE = 20;

export function useSectorConstituents(
  sectorId: string,
  period: Period,
  options: { countryIso2?: string; limit?: number } = {},
): SectorConstituents {
  const queryClient = useQueryClient();
  const { countryIso2, limit = SECTOR_PAGE_SIZE } = options;

  const constituents = useQuery({
    // country + limit are part of the key: a different filter or page size is a different result
    // set, not the same one refetched.
    queryKey: ['market', 'sector-constituents', sectorId, countryIso2 ?? null, limit],
    queryFn: () => fetchConstituents(sectorId, countryIso2, limit),
    // Holdings come from quarterly filings — there is nothing to gain from refetching them often.
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
    !performance.isPending &&
    !performance.isError &&
    (constituents.data?.length ?? 0) > 0 &&
    isStale(perfRows);

  const triggeredFor = useRef<Period | null>(null);
  const { mutate: startRefresh } = refresh;
  useEffect(() => {
    if (!stale || triggeredFor.current === period) return;
    triggeredFor.current = period;
    startRefresh();
  }, [stale, period, startRefresh]);

  const rows = constituents.data ?? [];
  if (rows.length === 0) {
    // Bundled seed — authored tickers and authored numbers, badged accordingly. Filtered by
    // country too, or drilling in from a country would fall back to the full authored list and
    // show the very rows this is meant to exclude.
    // The authored seed identifies a country by DISPLAY NAME ("United States"), while the server
    // stores ISO-2 — so the filter is translated rather than applied to the wrong field, which
    // would match nothing and render an empty page instead of the sample.
    const seedCountry = countryIso2 ? getCountryByIso(countryIso2)?.name : undefined;
    const seed = stocksInSector(sectorId).filter((s) => !seedCountry || s.country === seedCountry);
    return {
      items: seed.map((s) => ({
        id: s.ticker,
        industry: null,
        symbol: s.ticker,
        name: s.name,
        country: countryIso2 ?? null,
        weight: null,
        fundSymbol: null,
        changePct: s.changePct,
      })),
      subSectors: [],
      asOf: null,
      source: null,
      sample: true,
      refreshing: refresh.isPending,
      hasMore: false,
      loadingMore: false,
      fundSymbol: null,
    };
  }

  const byId = new Map(perfRows.map((r) => [r.scope_id, r.change_pct]));
  const items: SectorConstituent[] = rows.map((r) => ({
    id: r.security_id,
    industry: r.industry ?? null,
    symbol: r.symbol ?? null,
    name: r.name,
    country: r.country_iso2 ?? null,
    weight: r.weight ?? null,
    fundSymbol: r.fund_symbol ?? null,
    // null (not an authored number) when the server has no row — the list must never mix live and
    // authored values unlabelled.
    changePct: r.symbol ? (byId.get(r.symbol) ?? null) : null,
  }));

  // Distinct industries among the rows actually fetched. Scoped to the page on purpose: claiming a
  // sector's full sub-sector list from 20 rows would be a different, larger claim than the data
  // behind it.
  const subSectors = [...new Set(rows.map((r) => r.industry).filter((v): v is string => !!v))].sort();

  return {
    items,
    subSectors,
    asOf: latestAsOf(perfRows),
    source: perfRows.find((r) => r.source)?.source ?? null,
    sample: false,
    refreshing: refresh.isPending,
    // A full page probably means there is another; the next fetch settles it.
    hasMore: rows.length >= limit,
    loadingMore: constituents.isFetching && !constituents.isPending,
    // Only when the rows agree. A page mixing funds has no single answer, and naming one of them
    // would be worse than naming none.
    fundSymbol:
      [...new Set(rows.map((r) => r.fund_symbol).filter(Boolean))].length === 1
        ? (rows.find((r) => r.fund_symbol)?.fund_symbol ?? null)
        : null,
  };
}
