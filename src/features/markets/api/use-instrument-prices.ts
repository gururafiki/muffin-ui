/**
 * Daily closes for one instrument, shaped for the existing `TimeSeriesChart`.
 *
 * Reuses the chart the agent renderers already use (`lib/agent/renderers/chart`)
 * rather than adding a second charting path — it takes a `TimeSeries`, which is all
 * this has to build.
 *
 * The stored window is ~400 calendar days (see 08-instrument-prices.sql), so the
 * ranges offered here stop at 1Y. The 3Y/5Y *numbers* still exist in the
 * performance strip; only the chart is bounded, and it never offers a range it
 * cannot draw.
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

/** Chart ranges, in calendar days. Bounded by what the server stores. */
export const CHART_RANGES = [
  { id: '1m', label: '1M', days: 30 },
  { id: '3m', label: '3M', days: 91 },
  { id: '6m', label: '6M', days: 182 },
  { id: '1y', label: '1Y', days: 365 },
] as const;

export type ChartRange = (typeof CHART_RANGES)[number]['id'];

async function fetchPrices(symbol: string) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    // `price_series`, not `prices`: the latter is foreign-keyed to the curated 47 instruments, so
    // reading it directly meant a chart was possible for 47 securities out of 10,060. The view
    // unions the curated series with the fund-derived one (`security_price`, keyed on security_id
    // so a symbol change cannot orphan it) and picks one row per (symbol, date).
    .from('price_series')
    .select('date,close')
    .eq('symbol', symbol)
    .order('date');
  if (error) throw new Error(`market.price_series read failed: ${error.message}`);
  return parseArray(zPrice, data ?? [], 'market.price_series');
}

export interface InstrumentPrices {
  /** Null when there is nothing to draw — the caller renders no chart at all. */
  series: TimeSeries | null;
  loading: boolean;
}

export function useInstrumentPrices(symbol: string, range: ChartRange): InstrumentPrices {
  const query = useQuery({
    queryKey: ['market', 'prices', symbol],
    queryFn: () => fetchPrices(symbol),
    enabled: symbol.length > 0,
    // Daily bars: refetching within the day cannot change them.
    staleTime: 12 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const days = CHART_RANGES.find((r) => r.id === range)?.days ?? 365;
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
  if (windowed.length < 3) return { series: null, loading: query.isPending };

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
    loading: false,
  };
}
