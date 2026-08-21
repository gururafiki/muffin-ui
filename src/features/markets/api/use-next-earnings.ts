/**
 * When this company next reports — or last did.
 *
 * `market.security_next_earnings` serves ONE row per security and makes the choice server-side: the
 * next SCHEDULED report where there is one, the most recent past one otherwise, with `upcoming`
 * saying which. That distinction is the whole value. A page rendering "reports 26 Aug" for a date
 * that has passed is worse than showing nothing — the reader cannot tell from the date alone that
 * the consensus beside it is now history.
 *
 * The feed (`equity/calendar/earnings`, nasdaq) covers US-listed companies, so most non-US
 * securities have no row. That is the ordinary case and renders as no section.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zEarnings = z.looseObject({
  report_date: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it.
  eps_consensus: z.coerce.number().nullish(),
  eps_previous: z.coerce.number().nullish(),
  num_estimates: z.coerce.number().nullish(),
  reporting_time: z.string().nullish(),
  period_ending: z.string().nullish(),
  upcoming: z.boolean(),
});

export interface NextEarnings {
  reportDate: string;
  consensus: number | null;
  previous: number | null;
  estimates: number | null;
  /** 'before-market' / 'after-hours' — whether the number lands inside a trading day. */
  reportingTime: string | null;
  periodEnding: string | null;
  upcoming: boolean;
}

export function useNextEarnings(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'next-earnings', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_next_earnings')
        .select('report_date,eps_consensus,eps_previous,num_estimates,reporting_time,period_ending,upcoming')
        .eq('security_id', securityId as string)
        .limit(1);
      if (error) throw new Error(`market.security_next_earnings read failed: ${error.message}`);
      return parseArray(zEarnings, data ?? [], 'security_next_earnings');
    },
    enabled: !!securityId,
    // A scheduled date moves rarely, and the resource re-reads the window on its own cadence.
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const row = (query.data ?? [])[0];
  const earnings: NextEarnings | null = row
    ? {
        reportDate: row.report_date,
        consensus: row.eps_consensus ?? null,
        previous: row.eps_previous ?? null,
        estimates: row.num_estimates ?? null,
        reportingTime: row.reporting_time ?? null,
        periodEnding: row.period_ending ?? null,
        upcoming: row.upcoming,
      }
    : null;

  return {
    earnings,
    loading: query.isPending && !!securityId,
    // PENDING IS NOT MISSING. The calendar is US-listed, so most securities genuinely have no row
    // and "no earnings date" must not flash on every page before the query resolves.
    empty: !query.isPending && !row,
  };
}
