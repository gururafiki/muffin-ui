/**
 * Valuation ratios over time — P/E, P/S, P/B, price/FCF, the two yields, and the margin/return
 * ratios that need no price at all.
 *
 * Read from `market.security_ratio_series`, which computes them PER PRICE BAR from
 * `security_price x security_metric` rather than storing them. Nothing read that view until this
 * hook, and an unread view cannot be wrong — so treat what it claims as measured, not assumed.
 *
 * THREE THINGS THIS FILE EXISTS TO GET RIGHT:
 *
 * 1. THE ROW CAP IS REAL AND SILENT. `PGRST_DB_MAX_ROWS` is 1,000 and AAPL's weekly series is
 *    already **947 rows**. PostgREST does not error on a request for more, it returns a shorter
 *    answer — so a company with twenty years of history would quietly lose its oldest bars and
 *    draw a chart that looks complete. Every range here is bounded BY CONSTRUCTION with an
 *    explicit limit under the cap, ordered newest-first so what a bound drops is always the far
 *    past rather than an arbitrary middle.
 *
 * 2. A WITHHELD RATIO IS NOT MISSING DATA. Where a filer reports in one currency and trades in
 *    another — Novo Nordisk reports DKK, its US line trades USD — the view returns NULL for every
 *    price-based ratio rather than dividing dollars by kroner and producing a number that is wrong
 *    by the exchange rate and looks entirely ordinary. `currencyComparable` carries that distinction
 *    out so the UI can say WHY a chart is empty instead of implying the company has no earnings.
 *
 * 3. THE MARGIN RATIOS SURVIVE THAT. Net margin, ROE and ROA are filing-over-filing, so they need
 *    no currency agreement and are populated for exactly the securities whose P/E is withheld.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

/** How a ratio reads, which decides its axis label — not a cosmetic choice. */
export type RatioUnit = 'multiple' | 'percent';

export interface RatioOption {
  code: string;
  name: string;
  unit: RatioUnit;
  /** False for the margin/return ratios, which are computed entirely inside the filing. */
  needsPrice: boolean;
}

/**
 * The columns of `security_ratio_series` worth charting, in the order a valuation page reads them:
 * what you pay for a unit of each thing first, then what each unit yields, then how the business
 * itself performs.
 */
export const RATIO_OPTIONS: RatioOption[] = [
  { code: 'pe_ratio', name: 'P/E', unit: 'multiple', needsPrice: true },
  { code: 'ps_ratio', name: 'P/S', unit: 'multiple', needsPrice: true },
  { code: 'pb_ratio', name: 'P/B', unit: 'multiple', needsPrice: true },
  { code: 'price_to_fcf', name: 'P/FCF', unit: 'multiple', needsPrice: true },
  { code: 'earnings_yield_pct', name: 'Earnings yield', unit: 'percent', needsPrice: true },
  { code: 'fcf_yield_pct', name: 'FCF yield', unit: 'percent', needsPrice: true },
  { code: 'net_margin_pct', name: 'Net margin', unit: 'percent', needsPrice: false },
  { code: 'roe_pct', name: 'ROE', unit: 'percent', needsPrice: false },
  { code: 'roa_pct', name: 'ROA', unit: 'percent', needsPrice: false },
];

/**
 * A range is a (grain, row budget) pair, and both halves matter.
 *
 * Daily bars cover roughly the last year (276 for AAPL, measured); weekly reach back to 2006. Every
 * budget sits under `PGRST_DB_MAX_ROWS` so the server can never truncate an answer we then present
 * as whole.
 */
export const RATIO_RANGES = {
  '1Y': { grain: 'daily', limit: 400 },
  '5Y': { grain: 'weekly', limit: 270 },
  Max: { grain: 'weekly', limit: 950 },
} as const;

export type RatioRange = keyof typeof RATIO_RANGES;

const zRatioRow = z.looseObject({
  date: z.string(),
  close: z.coerce.number(),
  // PostgREST v14 sends `numeric` as a JSON number. `coerce` is the guard that keeps a driver
  // which quoted it from making parseArray drop every row and the chart silently vanish.
  value: z.coerce.number().nullable(),
  currency_comparable: z.boolean().nullish(),
  report_currency: z.string().nullish(),
  quote_currency: z.string().nullish(),
});

export interface RatioPoint {
  date: string;
  close: number;
  value: number | null;
}

export interface RatioSeries {
  points: RatioPoint[];
  loading: boolean;
  /** False when the filer's reporting currency differs from the currency it trades in. */
  currencyComparable: boolean;
  reportCurrency: string | null;
  quoteCurrency: string | null;
  /** True once loaded and genuinely empty — the security has no bars or no metrics at all. */
  empty: boolean;
}

export function useRatioSeries(
  symbol: string | undefined,
  ratio: string,
  range: RatioRange,
): RatioSeries {
  const { grain, limit } = RATIO_RANGES[range];

  const query = useQuery({
    queryKey: ['market', 'ratio-series', symbol ?? null, ratio, range],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_ratio_series')
        .select(`date,close,currency_comparable,report_currency,quote_currency,value:${ratio}`)
        .eq('symbol', symbol as string)
        .eq('grain', grain)
        // NEWEST FIRST, then reversed below. A bound must drop the far past, never a middle.
        .order('date', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`market.security_ratio_series read failed: ${error.message}`);
      return parseArray(zRatioRow, data ?? [], 'security_ratio_series');
    },
    enabled: !!symbol,
    // A ratio moves with the price, so it is stale within the trading day — but the underlying
    // bars are end-of-day, so there is nothing newer to fetch more often than this.
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const points: RatioPoint[] = rows
    .map((r) => ({ date: r.date, close: r.close, value: r.value }))
    .reverse();

  // Read off any row: these are properties of the SECURITY, identical across its bars.
  const head = rows[0];
  return {
    points,
    loading: query.isPending && !!symbol,
    // Absent rows tell us nothing about currency, so default to comparable and let `empty` speak.
    currencyComparable: head?.currency_comparable ?? true,
    reportCurrency: head?.report_currency ?? null,
    quoteCurrency: head?.quote_currency ?? null,
    // PENDING IS NOT MISSING — reporting empty mid-flight flashes "no data" on every stock page.
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while the id is null — and the section then
    // renders a card with a heading and nothing under it, which is the one thing this page's
    // convention forbids. Seen in a browser with the instrument unresolved: every section on the
    // stock page drew an empty card at once. `loading` already guards on the id; `empty` must too.
    empty: !(query.isPending && !!symbol) && rows.length === 0,
  };
}
