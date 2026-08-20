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
  // THE VIEW RESOLVES THIS, and this file no longer decides it. See the note at the mapping below.
  reporting_currency: z.string().nullish(),
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
      // Read the SYMBOL-KEYED view, not an embed filtered on `kind_code = 'ticker'`. That filter
      // was the reason ~3,400 securities opened to a blank page: their only address is a local
      // provider symbol (`005930.KS`), which is not a `ticker` identifier at all. The view resolves
      // `coalesce(ticker, provider_symbol)` — the same precedence the ingest backlogs use — so the
      // serving side and the fetching side agree on what a security is called.
      const { data, error } = await supabase
        .schema('market')
        .from('security_statement_current')
        .select('period_ending,reporting_currency,data')
        .eq('statement', 'income')
        .eq('symbol', symbol as string)
        .order('period_ending', { ascending: false })
        .limit(4);
      if (error) throw new Error(`market.security_statement_current read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'security_statement_current');
    },
    enabled: !!symbol,
    staleTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const periods: StatementPeriod[] = (query.data ?? []).map((r) => ({
    period: r.period_ending,
    // THE SERVER DECIDES WHAT THIS FIGURE IS DENOMINATED IN, and this file no longer has a copy
    // of that rule. It used to: `trustedQuoteCurrency` applied "the quote currency, unless the
    // company is quoted in USD and is not American". Two things were wrong with keeping it here.
    //
    // It was the SAME FACT IN TWO PLACES. `security_statement_current.reporting_currency` now
    // expresses the whole precedence once — the filing's own currency where a provider supplied
    // it, the quote currency only where it can stand in, NULL otherwise — using the EFFECTIVE
    // country (operating, falling back to filed) that `security_current` answers with. A second
    // copy here could only ever drift from it.
    //
    // And the copy was still WRONG for one case. `country && country.toUpperCase() !== 'US'`
    // short-circuits to false when there is no country at all, so a countryless security quoted in
    // USD was labelled USD — the same falsy-NULL shape that let BABA's CNY 1,023,670,000,000 render
    // as **$1.02 trillion**, larger than Walmart against a true ~$141bn.
    //
    // Since migration 88 the better answer is usually available anyway: SEC returns
    // `reported_currency`, and it is genuinely multi-currency — of the first 522 rows, EUR 111,
    // DKK 30, PEN 24, TWD 24 beside USD 333. Where nothing knows, the figure goes out UNLABELLED,
    // which is this file's own rule: a number with no unit is worse than one with the right unit
    // and far better than one with the wrong unit.
    currency: r.reporting_currency ?? null,
    // Providers name the same line item differently between filers, so each is tried in order
    // rather than assumed — an absent key is a missing number, not a crash.
    revenue: pick(r.data, 'total_revenue', 'operating_revenue', 'revenue'),
    netIncome: pick(r.data, 'net_income', 'net_income_common_stockholders'),
    grossProfit: pick(r.data, 'gross_profit'),
    operatingIncome: pick(r.data, 'operating_income', 'ebit'),
  }));

  return { periods, pending: query.isPending };
}
