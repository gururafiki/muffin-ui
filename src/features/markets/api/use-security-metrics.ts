/**
 * A company's reported financials, as a chartable series.
 *
 * `market.security_metric` holds one row per (security, metric, period type, period end) — 776,000
 * of them, up to 22 annual periods and 17 years of quarters, derived from SEC XBRL where the filer
 * publishes it and from statement documents otherwise. None of it was visible in the app.
 *
 * TWO QUERIES, NOT ONE, AND THAT IS FORCED BY THE SERVER. Every annual metric for one symbol is
 * ~520 rows (measured, AAPL) — but every QUARTERLY metric is ~1,375, and `PGRST_DB_MAX_ROWS` is
 * 1,000. PostgREST does not error on that, it returns a shorter answer, so a single fetch would
 * silently drop whole metrics for exactly the companies with the most history. Asking for the
 * available metric NAMES and then one metric's series is both under the cap by a wide margin and
 * the shape the UI wants anyway: a chart shows one line.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zMetricRow = z.looseObject({
  metric_code: z.string(),
  metric_name: z.string(),
  category: z.string(),
  unit: z.string(),
  is_derived: z.boolean().nullish(),
});

const zPoint = z.looseObject({
  as_of: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce is the guard that keeps a driver which
  // quoted it from making parseArray drop every row and the section silently vanish.
  value: z.coerce.number(),
  currency_code: z.string().nullish(),
  source_code: z.string().nullish(),
});

export type PeriodType = 'annual' | 'quarter';

export interface MetricOption {
  code: string;
  name: string;
  category: string;
  unit: string;
  isDerived: boolean;
}

export interface MetricPoint {
  asOf: string;
  value: number;
  currency: string | null;
  source: string | null;
}

/**
 * Which metrics this security actually has, in catalogue order.
 *
 * Asked of the SERIES rather than the catalogue: `market.metric` lists what the system can hold,
 * which is not what this company reports. Offering `research_and_development` for a bank would
 * render an empty chart and read as a broken page rather than as a company that has no R&D line.
 */
export function useAvailableMetrics(symbol: string | undefined, period: PeriodType) {
  const query = useQuery({
    queryKey: ['market', 'metric-options', symbol ?? null, period],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_metric_series')
        .select('metric_code,metric_name,category,unit,is_derived')
        .eq('symbol', symbol as string)
        .eq('period_type', period);
      if (error) throw new Error(`market.security_metric_series read failed: ${error.message}`);
      return parseArray(zMetricRow, data ?? [], 'security_metric_series');
    },
    enabled: !!symbol,
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const seen = new Map<string, MetricOption>();
  for (const r of query.data ?? []) {
    if (seen.has(r.metric_code)) continue;
    seen.set(r.metric_code, {
      code: r.metric_code,
      name: r.metric_name,
      category: r.category,
      unit: r.unit,
      isDerived: !!r.is_derived,
    });
  }
  return { options: [...seen.values()], loading: query.isPending && !!symbol };
}

/** One metric's history, oldest first. 22 rows for an annual series, ~55 for quarters. */
export function useMetricSeries(
  symbol: string | undefined,
  metricCode: string | undefined,
  period: PeriodType,
) {
  const query = useQuery({
    queryKey: ['market', 'metric-series', symbol ?? null, metricCode ?? null, period],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_metric_series')
        .select('as_of,value,currency_code,source_code')
        .eq('symbol', symbol as string)
        .eq('metric_code', metricCode as string)
        .eq('period_type', period)
        .order('as_of');
      if (error) throw new Error(`market.security_metric_series read failed: ${error.message}`);
      return parseArray(zPoint, data ?? [], 'security_metric_series');
    },
    enabled: !!symbol && !!metricCode,
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const points: MetricPoint[] = (query.data ?? []).map((r) => ({
    asOf: r.as_of,
    value: r.value,
    currency: r.currency_code ?? null,
    source: r.source_code ?? null,
  }));
  return { points, loading: query.isPending && !!symbol && !!metricCode };
}
