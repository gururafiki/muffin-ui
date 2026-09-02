/**
 * The income statement as a flow: revenue in, profit and cost out.
 *
 * This is the RIGHT half of the Sankey and it is the half that works. Measured 2026-09-01, 8,949 of
 * 12,350 equities hold metrics against 66 with business lines — so the chart draws the waterfall
 * alone and gains the revenue streams only where a filer discloses them.
 *
 * THE ARITHMETIC IS NOT HERE. It lives in `../income-flow.ts`, which imports nothing, so
 * `scripts/income-flow-check.ts` can drive it against Amazon's real figures — a module that
 * imports react-native cannot be loaded by `tsx`. This file only fetches and picks the periods.
 *
 * `security_metric`'s period column is `as_of`, not `period_ending`.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { FLOW_METRICS, buildFlow, type MetricsAt } from '../income-flow';
import { MarketUnavailableError } from './market-client';

const zMetric = z.looseObject({
  metric_code: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it, which
  // would otherwise make `parseArray` drop every row and the chart silently vanish.
  value: z.coerce.number().nullish(),
  as_of: z.string(),
  currency_code: z.string().nullish(),
});

export function useIncomeFlow(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'income-flow', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_metric')
        .select('metric_code,value,as_of,currency_code')
        .eq('security_id', securityId as string)
        .eq('period_type', 'annual')
        .in('metric_code', FLOW_METRICS as unknown as string[])
        // Two periods' worth, so the newest has a prior to compare against. Bounded rather than
        // open-ended: a filer with twenty years of history would otherwise send every one of them.
        .order('as_of', { ascending: false })
        .limit(FLOW_METRICS.length * 3);
      if (error) throw new Error(`market.security_metric read failed: ${error.message}`);
      return parseArray(zMetric, data ?? [], 'security_metric');
    },
    enabled: !!securityId,
    // Annual statements change once a year; the resource re-reads on its own cursor.
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  // DESCENDING BY DATE, so [0] is the latest and [1] the prior. A fiscal-year end is a date rather
  // than a year, so sorting the strings is correct and comparing years would not be.
  const periods = [...new Set(rows.map((r) => r.as_of))].sort().reverse();
  const [latest, prior] = periods;

  const at = (period: string | undefined): MetricsAt => {
    const m: MetricsAt = new Map();
    if (!period) return m;
    for (const r of rows) {
      if (r.as_of === period && typeof r.value === 'number') m.set(r.metric_code, r.value);
    }
    return m;
  };

  const flow = buildFlow(at(latest), at(prior));

  return {
    nodes: flow.nodes,
    links: flow.links,
    currency: rows.find((r) => r.as_of === latest && r.currency_code)?.currency_code ?? null,
    periodEnding: latest ?? null,
    priorPeriod: prior ?? null,
    loading: query.isPending && !!securityId,
    // PENDING IS NOT MISSING — 3,401 equities hold no metrics at all, so "nothing yet" is a common
    // state that must not flash on every stock page before the query resolves.
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while `securityId` is null — and the
    // section then renders a card with a heading and nothing under it, which is the one thing this
    // page's convention forbids. Observed in a browser with the instrument unresolved: every
    // section on the stock page drew an empty card. `loading` already guards on `securityId`;
    // `empty` must too.
    empty: !(query.isPending && !!securityId) && flow.nodes.length === 0,
  };
}
