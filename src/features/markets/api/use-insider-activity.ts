/**
 * Whether the people who know most about this company have been buying or selling.
 *
 * Reads `market.security_insider_summary`, which aggregates Form 4 filings over the last 90 days
 * SERVER-SIDE and returns both a net share figure and a count of distinct PEOPLE on each side.
 *
 * The people count is not decoration and must not be dropped in the client: one officer exercising
 * a large option grant can outweigh a dozen colleagues buying, and a net share figure alone would
 * report that as selling — the arithmetic right and the statement wrong.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zSummary = z.looseObject({
  buys: z.coerce.number(),
  sells: z.coerce.number(),
  buyers: z.coerce.number(),
  sellers: z.coerce.number(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it.
  net_shares: z.coerce.number(),
  trades: z.coerce.number(),
  latest: z.string().nullish(),
});

export interface InsiderActivity {
  buys: number;
  sells: number;
  buyers: number;
  sellers: number;
  netShares: number;
  trades: number;
  latest: string | null;
}

export function useInsiderActivity(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'insider-summary', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_insider_summary')
        .select('buys,sells,buyers,sellers,net_shares,trades,latest')
        .eq('security_id', securityId as string)
        .limit(1);
      if (error) throw new Error(`market.security_insider_summary read failed: ${error.message}`);
      return parseArray(zSummary, data ?? [], 'security_insider_summary');
    },
    enabled: !!securityId,
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const row = (query.data ?? [])[0];
  return {
    activity: row
      ? {
          buys: row.buys,
          sells: row.sells,
          buyers: row.buyers,
          sellers: row.sellers,
          netShares: row.net_shares,
          trades: row.trades,
          latest: row.latest ?? null,
        }
      : null,
    loading: query.isPending && !!securityId,
    // Form 4 is SEC-only, and plenty of filers go a quarter without an insider transaction. No row
    // is the ordinary case, not a fault.
    empty: !query.isPending && !row,
  };
}
