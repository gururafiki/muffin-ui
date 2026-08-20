/**
 * Closes for one instrument, shaped for the existing `TimeSeriesChart`.
 *
 * Reuses the chart the agent renderers already use (`lib/agent/renderers/chart`)
 * rather than adding a second charting path — it takes a `TimeSeries`, which is all
 * this has to build.
 *
 * TWO RESOLUTIONS, AND THE RANGE PICKS ONE. The server stores a ~400-day DAILY window and a
 * twenty-year WEEKLY series that deliberately overlaps it (deployment migration 94), so one date
 * carries both a daily and a weekly bar. Asking without a `grain` filter would draw each
 * overlapping day twice; asking weekly for a 1M range would draw four points. So short ranges read
 * `daily` and long ones read `weekly`.
 *
 * AND IT PAGES. A twenty-year weekly series is 1,077 rows, above the server's `PGRST_DB_MAX_ROWS`
 * of 1,000 — which PostgREST does not report as an error, it simply returns a shorter answer. With
 * an ascending sort that silently drops the most RECENT bars, so a 20Y chart would end somewhere in
 * the past with no indication anything was missing. `fetchAllPages` is what makes the depth of the
 * series irrelevant to this file.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';
import type { TimeSeries } from '@/lib/agent/renderers/chart-data';

import { MarketUnavailableError } from './market-client';

const zPrice = z.looseObject({
  date: z.string(),
  close: z.coerce.number(),
});

/**
 * Chart ranges, in calendar days, each naming the resolution it draws at.
 *
 * The cut is at 2Y because that is where the server's daily window ends: a range longer than the
 * daily series would draw a line that stops partway and looks like missing data. Ranges are never
 * offered beyond what is stored — the same rule the period picker follows.
 */
export const CHART_RANGES = [
  { id: '1m', label: '1M', days: 30, grain: 'daily' },
  { id: '3m', label: '3M', days: 91, grain: 'daily' },
  { id: '6m', label: '6M', days: 182, grain: 'daily' },
  { id: '1y', label: '1Y', days: 365, grain: 'daily' },
  { id: '5y', label: '5Y', days: 5 * 365, grain: 'weekly' },
  { id: '10y', label: '10Y', days: 10 * 365, grain: 'weekly' },
  { id: '20y', label: '20Y', days: 20 * 365, grain: 'weekly' },
] as const;

/** Rows per request. The server caps a response at 1,000 whatever we ask for. */
const PAGE = 1000;

export type ChartRange = (typeof CHART_RANGES)[number]['id'];

async function fetchPrices(symbol: string, grain: string) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const rows: unknown[] = [];
  // PAGED EXPLICITLY. A full page back is not proof there is more, but it is the only signal the
  // server gives — `PGRST_DB_MAX_ROWS` truncates silently rather than erroring, so a loop that
  // stops on a short page is the one thing that cannot lose the tail.
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .schema('market')
      // `price_series`, not `prices`: the latter is foreign-keyed to the curated 47 instruments, so
      // reading it directly meant a chart was possible for 47 securities out of 10,060. The view
      // unions the curated series with the fund-derived one (`security_price`, keyed on security_id
      // so a symbol change cannot orphan it) and picks one row per (symbol, grain, date).
      .from('price_series')
      .select('date,close')
      .eq('symbol', symbol)
      .eq('grain', grain)
      .order('date')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`market.price_series read failed: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return parseArray(zPrice, rows, 'market.price_series');
}

export interface InstrumentPrices {
  /** Null when there is nothing to draw — the caller renders no chart at all. */
  series: TimeSeries | null;
  /**
   * The ranges this security can actually draw.
   *
   * The long ranges are omitted until the weekly backfill has reached this security, because
   * offering 20Y and drawing nothing is worse than not offering it: the chart simply vanishes when
   * the user picks it, which reads as a bug rather than as missing history. Same rule the period
   * picker follows — never offer a range the data cannot support.
   */
  ranges: { id: ChartRange; label: string }[];
  loading: boolean;
}

export function useInstrumentPrices(symbol: string, range: ChartRange): InstrumentPrices {
  const spec = CHART_RANGES.find((r) => r.id === range) ?? CHART_RANGES[3];

  // The weekly series is fetched regardless of the selected range, because whether it EXISTS is
  // what decides which ranges to offer. It is one request, cached for a day, and it is empty and
  // instant for a security the backfill has not reached.
  const weekly = useQuery({
    queryKey: ['market', 'prices', symbol, 'weekly'],
    queryFn: () => fetchPrices(symbol, 'weekly'),
    enabled: symbol.length > 0,
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const query = useQuery({
    // KEYED ON THE GRAIN, not the range: 5Y, 10Y and 20Y all read the same weekly series, so
    // switching between them is a client-side window over one cached fetch rather than three.
    queryKey: ['market', 'prices', symbol, spec.grain],
    queryFn: () => fetchPrices(symbol, spec.grain),
    enabled: symbol.length > 0,
    // Daily bars: refetching within the day cannot change them.
    staleTime: 12 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  // Three bars is the threshold everywhere here: one bar is a dot and two are a straight line.
  const hasWeekly = (weekly.data ?? []).length >= 3;
  const ranges = CHART_RANGES.filter((r) => r.grain === 'daily' || hasWeekly).map((r) => ({
    id: r.id,
    label: r.label,
  }));

  const rows = (spec.grain === 'weekly' ? weekly.data : query.data) ?? [];
  const days = spec.days;
  // Anchored on the LAST BAR, not `Date.now()`. Wall-clock in render is impure (the
  // window would differ between renders), and anchoring on the data is also more
  // correct: if the series is a few days stale, "1M" still shows a month of bars
  // instead of silently shrinking toward empty.
  const last = rows.length > 0 ? rows[rows.length - 1].date : null;
  const cutoff = last
    ? new Date(new Date(`${last}T00:00:00Z`).getTime() - days * 86_400_000).toISOString().slice(0, 10)
    : null;
  const windowed = cutoff ? rows.filter((r) => r.date >= cutoff) : [];

  // The chart needs a couple of points to mean anything; one bar is a dot.
  if (windowed.length < 3) {
    return { series: null, ranges, loading: query.isPending || weekly.isPending };
  }

  return {
    series: {
      lines: [
        {
          label: symbol,
          points: windowed.map((r) => ({ x: new Date(r.date).getTime(), y: r.close })),
        },
      ],
      startLabel: windowed[0].date,
      endLabel: windowed[windowed.length - 1].date,
    },
    ranges,
    loading: false,
  };
}
