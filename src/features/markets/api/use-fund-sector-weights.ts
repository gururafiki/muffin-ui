/**
 * Real sector weights for a fund, from `market.fund_sector_weight`.
 *
 * The Markets donut was `SECTOR_WEIGHTS`, an authored map badged SAMPLE, because the obvious
 * sources are gated: FMP's `etf/sectors` is premium (402) and `index/sectors` is TMX-only.
 * Fund holdings make it derivable instead — the fund's own filed positions joined to the sector
 * each security's sector SPDR puts it in.
 *
 * WHICH FUND MATTERS ENORMOUSLY, and the numbers say so (measured against production 2026-08-10):
 *
 *   IVV  (S&P 500)      0.29% unclassified  -> trustworthy
 *   URTH (MSCI World)  30.39% unclassified  -> a third of it is missing
 *   VEA  (developed ex-US) 100% unclassified -> nothing at all
 *
 * Sector classification comes from the ELEVEN US SECTOR SPDRs, so it covers US large caps and
 * essentially nothing else. IVV is almost exactly that universe, which is why its weights come out
 * right (IT 32.8%, financials 12.6% — the real S&P 500 figures). A global fund does not.
 *
 * Hence `MAX_UNCLASSIFIED`: if too much of a fund is unclassified the hook reports unavailable and
 * the caller keeps its SAMPLE badge. Rendering VEA's 100%-unclassified weights would produce a
 * donut of nothing, and rendering URTH's would quietly overstate every sector by ~43%. This is the
 * guard that makes the fund a safe thing to change.
 *
 * The label matters too: this is the S&P 500's allocation, NOT "the market's". Presenting one
 * index's number under a generic title is the thing this whole exercise was meant to stop.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

/**
 * The fund the donut represents.
 *
 * IVV over SPY because it is what `market.tracked_fund` already ingests, and over URTH because
 * only a US-large-cap fund is fully covered by US sector SPDRs.
 */
export const DONUT_FUND = 'IVV';
export const DONUT_FUND_LABEL = 'S&P 500';

/** Above this share of unclassified weight the data is not good enough to draw. */
const MAX_UNCLASSIFIED = 5;

const UNCLASSIFIED = 'unclassified';

/** Mirrors the `market.fund_sector_weight` view (13-derived-classification.sql). */
const zFundSectorWeight = z.looseObject({
  fund_symbol: z.string(),
  sector_id: z.string(),
  // The view already renormalises, because a fund's own reported weights do not sum to 100.
  weight_pct: z.coerce.number().nullish(),
  as_of: z.string().nullish(),
});

export interface FundSectorWeight {
  sectorId: string;
  /** Percent of the fund, renormalised across the CLASSIFIED slices. */
  weightPct: number;
}

export interface FundSectorWeights {
  items: FundSectorWeight[];
  asOf: Date | null;
  /** True when the donut is drawing authored numbers rather than filed holdings. */
  sample: boolean;
  /** Share of the fund with no sector — surfaced so a caller can say so rather than hide it. */
  unclassifiedPct: number;
}

async function fetchFundSectorWeights(fund: string) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    .from('fund_sector_weight')
    .select('fund_symbol,sector_id,weight_pct,as_of')
    .eq('fund_symbol', fund)
    .order('weight_pct', { ascending: false, nullsFirst: false });
  if (error) throw new Error(`market.fund_sector_weight read failed: ${error.message}`);
  return parseArray(zFundSectorWeight, data ?? [], 'market.fund_sector_weight');
}

export function useFundSectorWeights(fund: string = DONUT_FUND): FundSectorWeights {
  const query = useQuery({
    queryKey: ['market', 'fund-sector-weight', fund],
    queryFn: () => fetchFundSectorWeights(fund),
    // Holdings come from quarterly filings; there is nothing to gain from refetching often.
    staleTime: 24 * 60 * 60_000,
    gcTime: 30 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const unclassifiedPct = rows.find((r) => r.sector_id === UNCLASSIFIED)?.weight_pct ?? 0;
  const classified = rows.filter((r) => r.sector_id !== UNCLASSIFIED && (r.weight_pct ?? 0) > 0);

  if (classified.length === 0 || unclassifiedPct > MAX_UNCLASSIFIED) {
    return { items: [], asOf: null, sample: true, unclassifiedPct };
  }

  // Renormalise over the classified slices so the donut is a whole. Dropping `unclassified` and
  // leaving the rest summing to <100 would draw a wedge-shaped hole that means nothing.
  const total = classified.reduce((s, r) => s + (r.weight_pct ?? 0), 0);
  const items = classified.map((r) => ({
    sectorId: r.sector_id,
    weightPct: total > 0 ? ((r.weight_pct ?? 0) / total) * 100 : 0,
  }));

  const asOfRaw = rows.map((r) => r.as_of).find(Boolean);
  return {
    items,
    asOf: asOfRaw ? new Date(asOfRaw) : null,
    sample: false,
    unclassifiedPct,
  };
}
