/**
 * When this company next reports — or last did.
 *
 * `market.security_next_earnings` serves ONE row per security and makes the choice server-side: the
 * next SCHEDULED report where there is one, the most recent past one otherwise, with `upcoming`
 * saying which. That distinction is the whole value. A page rendering "reports 26 Aug" for a date
 * that has passed is worse than showing nothing — the reader cannot tell from the date alone that
 * the consensus beside it is now history.
 *
 * Two sources since Phase 6b (2026-11-21): nasdaq's daily calendar for US listings, and Yahoo's next
 * date from the company lane's weekly summaries for everything else. The view picks ONE source per
 * company, so a security with neither has no row, which renders as no section.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zQuarter = z.looseObject({
  period_ending: z.string(),
  reported_date: z.string().nullish(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it.
  actual: z.coerce.number().nullish(),
  estimate: z.coerce.number().nullish(),
  surprise_pct: z.coerce.number().nullish(),
  beat: z.boolean().nullish(),
  source_code: z.string(),
});

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

export interface EarningsQuarter {
  /** The quarter's last month-end, `2026-06-30`. */
  periodEnding: string;
  reportedDate: string | null;
  actual: number | null;
  estimate: number | null;
  /** Of the estimate's MAGNITUDE, server-side, so a smaller loss than expected is a positive beat. */
  surprisePct: number | null;
  beat: boolean | null;
  /** Whose figures these are: `nasdaq` or `yfinance`. One source per company, never mixed. */
  source: string;
}

/** How many quarters the stock page shows: two years. */
export const EARNINGS_QUARTERS = 8;

/**
 * The last quarters' reported EPS against the estimate that preceded them.
 *
 * `market.security_earnings_history` picks ONE source per company (Phase 6b): nasdaq and Yahoo
 * agree on a quarter's EPS only 65% of the time — ADR ratios and other adjusted bases — so a series
 * mixing them would put two bases side by side. Global where Yahoo covers the company.
 */
export function useEarningsHistory(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'earnings-history', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_earnings_history')
        .select('period_ending,reported_date,actual,estimate,surprise_pct,beat,source_code')
        .eq('security_id', securityId as string)
        .order('period_ending', { ascending: false })
        .limit(EARNINGS_QUARTERS);
      if (error) throw new Error(`market.security_earnings_history read failed: ${error.message}`);
      return parseArray(zQuarter, data ?? [], 'security_earnings_history');
    },
    enabled: !!securityId,
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });
  const quarters: EarningsQuarter[] = (query.data ?? []).map((row) => ({
    periodEnding: row.period_ending,
    reportedDate: row.reported_date ?? null,
    actual: row.actual ?? null,
    estimate: row.estimate ?? null,
    surprisePct: row.surprise_pct ?? null,
    beat: row.beat ?? null,
    source: row.source_code,
  }));
  return { quarters, loading: query.isPending && !!securityId };
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
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while the id is null — and the section then
    // renders a card with a heading and nothing under it, which is the one thing this page's
    // convention forbids. Seen in a browser with the instrument unresolved: every section on the
    // stock page drew an empty card at once. `loading` already guards on the id; `empty` must too.
    empty: !(query.isPending && !!securityId) && !row,
  };
}
