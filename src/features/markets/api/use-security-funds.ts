/**
 * Which tracked funds hold a given security.
 *
 * Reads `market.security_funds`, added because `fund_holding_current` is deliberately internal —
 * a building block with no anon grant — so nothing could answer the most obvious question on a
 * stock page: who owns this?
 *
 * WEIGHTS ARE AS FILED AND DO NOT SUM TO 100. EWT's own N-PORT sums to 110.38, so a weight here is
 * the fund's own reported figure and not a share of anything this app computed. It is also up to
 * ~4 months old — N-PORT is filed roughly 60 days in arrears — which is why `asOf` is returned
 * alongside rather than left to the caller to remember.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zRow = z.looseObject({
  fund_symbol: z.string(),
  fund_name: z.string().nullish(),
  fund_kind: z.string().nullish(),
  weight: z.coerce.number().nullish(),
  as_of: z.string().nullish(),
});

export interface HoldingFund {
  symbol: string;
  name: string | null;
  kind: string | null;
  /** The fund's OWN reported weight. Not renormalised — see the note above. */
  weightPct: number | null;
}

export interface SecurityFunds {
  items: HoldingFund[];
  asOf: Date | null;
  loading: boolean;
}

export function useSecurityFunds(securityId: string | undefined): SecurityFunds {
  const query = useQuery({
    queryKey: ['market', 'security-funds', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_funds')
        .select('fund_symbol,fund_name,fund_kind,weight,as_of')
        .eq('security_id', securityId as string)
        .order('weight', { ascending: false, nullsFirst: false });
      if (error) throw new Error(`market.security_funds read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'market.security_funds');
    },
    enabled: !!securityId,
    // Holdings come from quarterly filings; refetching often gains nothing.
    staleTime: 24 * 60 * 60_000,
    gcTime: 30 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  return {
    items: rows.map((r) => ({
      symbol: r.fund_symbol,
      name: r.fund_name ?? null,
      kind: r.fund_kind ?? null,
      weightPct: r.weight ?? null,
    })),
    asOf: rows.map((r) => r.as_of).find(Boolean) ? new Date(rows.find((r) => r.as_of)!.as_of!) : null,
    loading: query.isPending && !!securityId,
  };
}
