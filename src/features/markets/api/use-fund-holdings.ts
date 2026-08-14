/**
 * Everything a tracked fund holds, heaviest first.
 *
 * Reads `market.fund_holdings` — the counterpart of `security_funds`, the same join read from the
 * other end. Both were added because `fund_holding_current` is deliberately internal, so nothing
 * could get from a security to its funds or back again.
 *
 * WEIGHTS ARE AS FILED and are not renormalised: a fund's own weights do not sum to 100 (EWT files
 * 110.38), so turning them into shares of a whole would invent a denominator the filing does not
 * have. N-PORT is ~60 days in arrears, hence `asOf`.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

/** One page is plenty for a fund; AGG's 13,267 would be neither useful nor fast. */
const LIMIT = 500;

const zRow = z.looseObject({
  security_id: z.string(),
  name: z.string().nullish(),
  symbol: z.string().nullish(),
  country_iso2: z.string().nullish(),
  security_type_code: z.string().nullish(),
  weight: z.coerce.number().nullish(),
  as_of: z.string().nullish(),
});

export interface FundHolding {
  securityId: string;
  name: string | null;
  symbol: string | null;
  country: string | null;
  type: string | null;
  weightPct: number | null;
}

export function useFundHoldings(fundSymbol: string | undefined) {
  const query = useQuery({
    queryKey: ['market', 'fund-holdings', fundSymbol ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('fund_holdings')
        .select('security_id,name,symbol,country_iso2,security_type_code,weight,as_of')
        .eq('fund_symbol', fundSymbol as string)
        .order('weight', { ascending: false, nullsFirst: false })
        // Explicit, because `PGRST_DB_MAX_ROWS` is 1000 and a missing limit is not an error — just
        // a shorter answer. That silence is what hid 89% of instrument returns from the sector page.
        .limit(LIMIT);
      if (error) throw new Error(`market.fund_holdings read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'market.fund_holdings');
    },
    enabled: !!fundSymbol,
    staleTime: 24 * 60 * 60_000,
    gcTime: 30 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const withDate = rows.find((r) => r.as_of);
  return {
    items: rows.map((r) => ({
      securityId: r.security_id,
      name: r.name ?? null,
      symbol: r.symbol ?? null,
      country: r.country_iso2 ?? null,
      type: r.security_type_code ?? null,
      weightPct: r.weight ?? null,
    })) as FundHolding[],
    asOf: withDate?.as_of ? new Date(withDate.as_of) : null,
    loading: query.isPending && !!fundSymbol,
  };
}
