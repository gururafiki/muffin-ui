/**
 * Browse the WHOLE security universe — 27,629 rows — with every facet filterable, server-side.
 *
 * This is the hook the filter feature exists for, and it is deliberately NOT a change to
 * `useAssetUniverse`. That one reads `market.instrument_current`, the CURATED overlay of 47 rows
 * (measured): editorial ADR picks and 12 things that are not securities at all — USD, US10Y, BTC,
 * WTI, GLD. Filtering 47 rows in memory is correct and cheap, and moving it server-side would have
 * been motion without a benefit. The gap was that nothing could browse the other 27,582.
 *
 * THREE RULES, EACH FROM A MEASURED FAILURE IN THIS CODEBASE:
 *
 * 1. THE FILTER GOES TO THE SERVER. `PGRST_DB_MAX_ROWS` is 1000, so a client that fetched and
 *    filtered locally would be filtering the first 1,000 of 27,629 and reporting it as the answer.
 *
 * 2. THE TOTAL IS COUNTED, NEVER INFERRED FROM A PAGE. `Prefer: count=exact` returns the true
 *    total in `content-range` without fetching rows. Sizing anything by measuring a page whose end
 *    you cannot see is how "1000" got reported as a measurement three times here — including once
 *    by me earlier today, reading 16 countries off a 1,000-row page of 2,704.
 *
 * 3. RETURNS ARE FETCHED FOR THE VISIBLE PAGE ONLY. `market.performance` is keyed by symbol; asking
 *    for all 27,629 to render 50 would be a 6.5 KB+ `in.()` URL and a bare 502. One page of symbols
 *    is comfortably inside the length budget.
 */
import { useQuery } from '@tanstack/react-query';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';
import { z } from 'zod';

import { fetchPerformance, MarketUnavailableError } from './market-client';
import type { Period } from './periods';
import { applyFilterToQuery, type MarketFilter } from '../market-filter';

export const PAGE_SIZE = 50;

const zFacet = z.looseObject({
  security_id: z.string(),
  symbol: z.string().nullable(),
  name: z.string().nullable(),
  security_type_code: z.string().nullable(),
  sector_id: z.string().nullable(),
  industry: z.string().nullable(),
  industry_code: z.string().nullable(),
  country_iso2: z.string().nullable(),
  country_name: z.string().nullable(),
  cap_band: z.string().nullable(),
  // PostgREST v14 sends `numeric` as a JSON number, so coerce is a guard rather than a fix for a
  // live bug — but without it a driver that quoted the value would make parseArray drop every row.
  market_cap_usd: z.coerce.number().nullable(),
  currency_code: z.string().nullable(),
  style: z.string().nullable(),
  style_source: z.string().nullable(),
  style_confidence: z.string().nullable(),
  value_score: z.coerce.number().nullable(),
  refreshed_at: z.string().nullable(),
});

export interface UniverseRow {
  securityId: string;
  symbol: string | null;
  name: string;
  securityType: string | null;
  sectorId: string | null;
  industry: string | null;
  /** The stable key a filter stores; `industry` is what a person reads. */
  industryCode: string | null;
  countryIso2: string | null;
  countryName: string | null;
  capBand: string | null;
  marketCapUsd: number | null;
  currencyCode: string | null;
  style: string | null;
  styleSource: string | null;
  styleConfidence: string | null;
  changePct: number | null;
}

export interface SecurityUniverse {
  items: UniverseRow[];
  /** The TRUE number of matches, from `content-range` — not `items.length`. */
  total: number | null;
  page: number;
  pageCount: number;
  /** When the materialised spine was last rebuilt. Null on the very first render. */
  refreshedAt: Date | null;
  loading: boolean;
  error: Error | null;
}

async function fetchUniversePage(filter: MarketFilter, period: Period, page: number) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();

  const from = page * PAGE_SIZE;
  let q = supabase
    .schema('market')
    .from('security_facets')
    .select(
      'security_id,symbol,name,security_type_code,sector_id,industry,country_iso2,country_name,' +
        'industry_code,cap_band,market_cap_usd,currency_code,style,style_source,style_confidence,value_score,refreshed_at',
      // `count: 'exact'` is what makes `total` a measurement instead of a guess.
      { count: 'exact' },
    );
  q = applyFilterToQuery(q, filter);
  // Largest first: a universe list with no order is a different list on every request, because
  // Postgres makes no ordering promise without one — and pagination over an unordered relation
  // silently repeats and skips rows.
  const { data, error, count } = await q
    .order('market_cap_usd', { ascending: false, nullsFirst: false })
    .order('security_id', { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`market.security_facets read failed: ${error.message}`);

  const rows = parseArray(zFacet, data ?? [], 'market.security_facets');

  // Returns for THIS PAGE's symbols only.
  const symbols = rows.map((r) => r.symbol).filter((s): s is string => !!s);
  const perf = symbols.length > 0 ? await fetchPerformance('instrument', period, symbols) : [];
  const bySymbol = new Map(perf.map((p) => [p.scope_id, p.change_pct]));

  const items: UniverseRow[] = rows.map((r) => ({
    securityId: r.security_id,
    symbol: r.symbol,
    name: r.name ?? r.symbol ?? r.security_id,
    securityType: r.security_type_code,
    sectorId: r.sector_id,
    industry: r.industry,
    industryCode: r.industry_code,
    countryIso2: r.country_iso2,
    countryName: r.country_name,
    capBand: r.cap_band,
    marketCapUsd: r.market_cap_usd,
    currencyCode: r.currency_code,
    style: r.style,
    styleSource: r.style_source,
    styleConfidence: r.style_confidence,
    // A security with no performance row shows NO number rather than a zero. `priced = false` is
    // not the same as "no data", and neither is "we have not fetched it yet".
    changePct: r.symbol ? (bySymbol.get(r.symbol) ?? null) : null,
  }));

  return { items, total: count ?? null, refreshedAt: rows[0]?.refreshed_at ?? null };
}

export function useSecurityUniverse(
  filter: MarketFilter,
  period: Period,
  page = 0,
): SecurityUniverse {
  const query = useQuery({
    // The filter is part of the key: two different filters are two different server answers, and
    // sharing a cache entry between them would show one filter's rows under another's chips.
    queryKey: ['market', 'security-universe', filter, period, page],
    queryFn: () => fetchUniversePage(filter, period, page),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    // Keeps the previous page visible while the next loads, so paging does not blank the list.
    placeholderData: (prev) => prev,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const total = query.data?.total ?? null;
  return {
    items: query.data?.items ?? [],
    total,
    page,
    pageCount: total === null ? 0 : Math.ceil(total / PAGE_SIZE),
    refreshedAt: query.data?.refreshedAt ? new Date(query.data.refreshedAt) : null,
    loading: query.isPending,
    error: query.error instanceof Error ? query.error : null,
  };
}
