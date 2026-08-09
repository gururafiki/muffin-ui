/**
 * The timeframe vocabulary shared by the UI control, the `market.performance`
 * table's CHECK constraint, and the market-refresh edge function's provider
 * mappings. Changing it means changing all three — the DB constraint will reject
 * an unknown period rather than storing it, which is the intended failure mode.
 */
export const PERIODS = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y', '10y'] as const;

export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  '1d': '1D',
  '1w': '1W',
  '1m': '1M',
  '3m': '3M',
  '6m': '6M',
  ytd: 'YTD',
  '1y': '1Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};

export const DEFAULT_PERIOD: Period = '1y';

export const isPeriod = (v: unknown): v is Period =>
  typeof v === 'string' && (PERIODS as readonly string[]).includes(v);

/**
 * Periods the SECTOR resource can actually serve.
 *
 * finviz's grouped performance carries 1w/1m/3m/6m/ytd/1y plus a day change, and
 * has no multi-year windows at all. Offering 3Y/5Y/10Y here would render an empty
 * panel that looks like a failure, so the control only shows what exists. Other
 * scopes (country ETFs via FMP) support more, hence this is per-scope and not one
 * global list.
 */
export const SECTOR_PERIODS: Period[] = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y'];

/**
 * Periods the COUNTRY resource can serve.
 *
 * Wider than sectors because country returns are computed from ~5 years of daily
 * closes rather than taken from a provider's fixed columns — so the multi-year
 * windows genuinely exist here. 10Y is excluded: the refresh only fetches ~5.2
 * years, and several country ETFs are younger than that anyway.
 */
export const COUNTRY_PERIODS: Period[] = ['1d', '1w', '1m', '3m', '6m', 'ytd', '1y', '3y', '5y'];
