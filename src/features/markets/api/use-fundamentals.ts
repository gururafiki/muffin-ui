/**
 * Fundamentals for one security.
 *
 * Keyless, from yfinance via the OpenBB already deployed — the providers we hold keys for cannot
 * serve this universe (FMP gates per symbol, Tiingo free is DOW-30 only, Alpha Vantage is US-only
 * at 25 calls/day), while `equity/fundamental/metrics` answers for non-US local listings too.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zRow = z.looseObject({
  pe_ratio: z.coerce.number().nullish(),
  forward_pe: z.coerce.number().nullish(),
  price_to_book: z.coerce.number().nullish(),
  profit_margin: z.coerce.number().nullish(),
  operating_margin: z.coerce.number().nullish(),
  return_on_equity: z.coerce.number().nullish(),
  revenue_growth: z.coerce.number().nullish(),
  debt_to_equity: z.coerce.number().nullish(),
  dividend_yield: z.coerce.number().nullish(),
  beta: z.coerce.number().nullish(),
  as_of: z.string().nullish(),
});

export interface Metric {
  label: string;
  value: string;
}

/**
 * UNITS ARE MIXED WITHIN ONE RESPONSE, so each field has to say which it is.
 *
 * Measured on the stored rows: `profit_margin` 0.62966 and `return_on_equity` 1.14288 are
 * FRACTIONS, while `dividend_yield` is ALREADY A PERCENT — NVDA 0.46, Samsung 0.65, AB InBev 1.6.
 * (`dividend_yield_5y_avg` is a fraction again at 0.0005, which is how confusing this is.)
 *
 * Treating them uniformly rendered NVIDIA at a 46% dividend yield on the deployed page.
 */
const fraction = (v: number | null | undefined) => (v == null ? null : `${(v * 100).toFixed(1)}%`);
const percent = (v: number | null | undefined) => (v == null ? null : `${v.toFixed(2)}%`);
const ratio = (v: number | null | undefined) => (v == null ? null : v.toFixed(2));

/**
 * Keyed on the SYMBOL, because that is what the stock page has. `useInstrument` reads the curated
 * `market.instruments` table and carries no `security_id`, so resolving here keeps the embedding
 * in one place rather than widening an unrelated hook.
 */
export function useFundamentals(symbol: string | undefined) {
  const query = useQuery({
    queryKey: ['market', 'fundamentals', symbol ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_fundamentals')
        // Embedded through the security, so one request resolves symbol -> fundamentals.
        .select('pe_ratio,forward_pe,price_to_book,profit_margin,operating_margin,return_on_equity,revenue_growth,debt_to_equity,dividend_yield,beta,as_of,security!inner(security_identifier!inner(value,kind_code))')
        .eq('security.security_identifier.kind_code', 'ticker')
        .eq('security.security_identifier.value', symbol as string)
        .limit(1);
      if (error) throw new Error(`market.security_fundamentals read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'security_fundamentals');
    },
    enabled: !!symbol,
    staleTime: 6 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const r = (query.data ?? [])[0];
  // Only metrics that HAVE a value. A grid of "—" says nothing and takes up the space that says
  // there is nothing.
  const metrics: Metric[] = !r
    ? []
    : ([
        ['P/E', ratio(r.pe_ratio)],
        ['Forward P/E', ratio(r.forward_pe)],
        ['Price / book', ratio(r.price_to_book)],
        ['Profit margin', fraction(r.profit_margin)],
        ['Operating margin', fraction(r.operating_margin)],
        ['Return on equity', fraction(r.return_on_equity)],
        ['Revenue growth', fraction(r.revenue_growth)],
        ['Dividend yield', percent(r.dividend_yield)],
        ['Debt / equity', ratio(r.debt_to_equity)],
        ['Beta', ratio(r.beta)],
      ] as [string, string | null][])
        .filter((m): m is [string, string] => m[1] != null)
        .map(([label, value]) => ({ label, value }));

  return { metrics, asOf: r?.as_of ? new Date(r.as_of) : null, pending: query.isPending };
}
