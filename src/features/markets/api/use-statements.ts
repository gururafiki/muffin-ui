/**
 * A security's income statement, by period.
 *
 * Stored as one jsonb per period (see migration 29), because AAPL and Samsung differ by 19 income
 * line items — a column per item would be the union of everything any filer reports. The cost of
 * that choice lands here: line items are read by key, and a missing one is absent rather than a
 * type error, so each is checked before it is shown.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zRow = z.looseObject({
  period_ending: z.string(),
  currency: z.string().nullish(),
  // The embedded security, for its currency. A many-to-one embed comes back as an object.
  security: z.looseObject({ currency_code: z.string().nullish() }).nullish(),
  data: z.record(z.string(), z.unknown()),
});

export interface StatementPeriod {
  period: string;
  currency: string | null;
  revenue: number | null;
  netIncome: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
}

const pick = (d: Record<string, unknown>, ...keys: string[]): number | null => {
  for (const k of keys) {
    const n = Number(d[k]);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

export function useStatements(symbol: string | undefined) {
  const query = useQuery({
    queryKey: ['market', 'statements', symbol ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_statement')
        .select(
          'period_ending,currency,data,security!inner(currency_code,security_identifier!inner(value,kind_code))',
        )
        .eq('statement', 'income')
        .eq('security.security_identifier.kind_code', 'ticker')
        .eq('security.security_identifier.value', symbol as string)
        .order('period_ending', { ascending: false })
        .limit(4);
      if (error) throw new Error(`market.security_statement read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'security_statement');
    },
    enabled: !!symbol,
    staleTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const periods: StatementPeriod[] = (query.data ?? []).map((r) => ({
    period: r.period_ending,
    // `security_statement.currency` is null for EVERY row: the income/balance/cash endpoints carry
    // no currency field at all, so `reported_currency` was a wrong guess when migration 29 was
    // written. The security's own currency is the honest stand-in — it is the currency the filing
    // (N-PORT `curCd`) or the metrics response reported for this security, which is what the
    // statement is denominated in for all but a handful of cross-listed names. It is READ SECOND
    // so that a provider which starts sending a real per-statement currency immediately wins.
    currency: r.currency ?? r.security?.currency_code ?? null,
    // Providers name the same line item differently between filers, so each is tried in order
    // rather than assumed — an absent key is a missing number, not a crash.
    revenue: pick(r.data, 'total_revenue', 'operating_revenue', 'revenue'),
    netIncome: pick(r.data, 'net_income', 'net_income_common_stockholders'),
    grossProfit: pick(r.data, 'gross_profit'),
    operatingIncome: pick(r.data, 'operating_income', 'ebit'),
  }));

  return { periods, pending: query.isPending };
}
