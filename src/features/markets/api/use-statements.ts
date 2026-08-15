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
  // The security's own QUOTE currency, carried by the view.
  currency_code: z.string().nullish(),
  // Needed to know whether `currency_code` can be trusted as the REPORTING currency.
  country_iso2: z.string().nullish(),
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

/**
 * The quote currency, but only where it is also the reporting currency.
 *
 * A local listing reports in the currency it trades in. A US listing of a foreign company does not,
 * and nothing available here says what it does report in — so that case gets no label at all.
 */
function trustedQuoteCurrency(code: string | null | undefined, country: string | null | undefined) {
  if (!code) return null;
  if (code.toUpperCase() === 'USD' && country && country.toUpperCase() !== 'US') return null;
  return code;
}

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
        .select('period_ending,currency,currency_code,country_iso2,data')
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
    // `security_statement.currency` is null for EVERY row: the income/balance/cash endpoints carry
    // no currency field at all, so `reported_currency` was a wrong guess when migration 29 was
    // written. The security's own currency is the honest stand-in for a LOCAL listing — 7203.T is
    // JPY, 005930.KS is KRW, SAP.DE is EUR, and the accounts are in that currency too. It is READ
    // SECOND so a provider that starts sending a real per-statement currency immediately wins.
    //
    // BUT `currency_code` IS THE QUOTE CURRENCY, AND AN ADR DOES NOT REPORT IN IT. Measured
    // 2026-08-14: BABA's revenue of 1,023,670,000,000 is CNY and was being labelled USD, which
    // renders **$1.02 trillion** — larger than Walmart, against a true ~$141bn. Xiaomi (XIACF) and
    // Itaú (ITUB) are the same shape. 565 securities here are a non-US company quoted in USD and
    // 376 of them have statements.
    //
    // No source available here can say what they DO report in: the statement endpoints carry no
    // currency, `equity/fundamental/metrics` and Yahoo's chart meta both return the quote currency,
    // `quoteSummary.financialCurrency` needs a crumb, and deriving it from `enterprise_to_revenue`
    // was tested and fails (Yahoo computes that ratio inside the reporting currency, so BABA reads
    // 1.00, and it false-positives on VALE and Samsung). A country->currency guess is wrong too —
    // VALE and NU are Brazilian and genuinely report in USD.
    //
    // So the figure goes out UNLABELLED, which is this file's own rule applied to the case that
    // still defaulted: "with no currency the figure is left unlabelled — defaulting to dollars is
    // how the bug started". A number with no unit is worse than one with the right unit and far
    // better than one with the wrong unit.
    currency: r.currency ?? trustedQuoteCurrency(r.currency_code, r.country_iso2),
    // Providers name the same line item differently between filers, so each is tried in order
    // rather than assumed — an absent key is a missing number, not a crash.
    revenue: pick(r.data, 'total_revenue', 'operating_revenue', 'revenue'),
    netIncome: pick(r.data, 'net_income', 'net_income_common_stockholders'),
    grossProfit: pick(r.data, 'gross_profit'),
    operatingIncome: pick(r.data, 'operating_income', 'ebit'),
  }));

  return { periods, pending: query.isPending };
}
