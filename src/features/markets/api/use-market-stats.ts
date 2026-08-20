/**
 * Share statistics and analyst consensus for one security.
 *
 * Both are free and universal — measured across US, German, Japanese, Korean and Brazilian
 * listings — and both were being written server-side with nothing reading them.
 *
 * THE FRACTIONS ARRIVE AS FRACTIONS. `insider_ownership: 0.01648` means 1.648% and
 * `institution_ownership: 0.66482` means 66.482%; the server stores exactly what the provider
 * sends and names the unit in the column comment rather than converting on write. So the
 * multiplication happens HERE, once, at the point of display — the same discipline that keeps a
 * shared `pct()` from rendering NVIDIA at a 46% dividend yield.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zStats = z.looseObject({
  as_of: z.string(),
  float_shares: z.coerce.number().nullish(),
  outstanding_shares: z.coerce.number().nullish(),
  short_interest: z.coerce.number().nullish(),
  short_percent_of_float: z.coerce.number().nullish(),
  days_to_cover: z.coerce.number().nullish(),
  insider_ownership: z.coerce.number().nullish(),
  institution_ownership: z.coerce.number().nullish(),
});

const zEstimate = z.looseObject({
  as_of: z.string(),
  target_high: z.coerce.number().nullish(),
  target_low: z.coerce.number().nullish(),
  target_consensus: z.coerce.number().nullish(),
  recommendation: z.string().nullish(),
  number_of_analysts: z.coerce.number().nullish(),
  currency_code: z.string().nullish(),
});

export interface ShareStats {
  asOf: string;
  floatShares: number | null;
  outstandingShares: number | null;
  shortInterest: number | null;
  /** A FRACTION as stored; multiply for display. */
  shortPercentOfFloat: number | null;
  daysToCover: number | null;
  insiderOwnership: number | null;
  institutionOwnership: number | null;
}

export interface Estimate {
  asOf: string;
  targetHigh: number | null;
  targetLow: number | null;
  targetConsensus: number | null;
  recommendation: string | null;
  analysts: number | null;
  currency: string | null;
}

async function latest<T>(
  table: string,
  columns: string,
  securityId: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    .from(table)
    .select(columns)
    .eq('security_id', securityId)
    .order('as_of', { ascending: false })
    .limit(1);
  if (error) throw new Error(`market.${table} read failed: ${error.message}`);
  const rows = parseArray(schema, data ?? [], table);
  return rows[0] ?? null;
}

export function useMarketStats(securityId: string | null | undefined) {
  const stats = useQuery({
    queryKey: ['market', 'share-stats', securityId ?? null],
    queryFn: () =>
      latest(
        'security_share_stats',
        'as_of,float_shares,outstanding_shares,short_interest,short_percent_of_float,days_to_cover,insider_ownership,institution_ownership',
        securityId as string,
        zStats,
      ),
    enabled: !!securityId,
    staleTime: 12 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const est = useQuery({
    queryKey: ['market', 'estimates', securityId ?? null],
    queryFn: () =>
      latest(
        'security_estimate',
        'as_of,target_high,target_low,target_consensus,recommendation,number_of_analysts,currency_code',
        securityId as string,
        zEstimate,
      ),
    enabled: !!securityId,
    staleTime: 12 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const s = stats.data;
  const e = est.data;
  return {
    stats: s
      ? ({
          asOf: s.as_of,
          floatShares: s.float_shares ?? null,
          outstandingShares: s.outstanding_shares ?? null,
          shortInterest: s.short_interest ?? null,
          shortPercentOfFloat: s.short_percent_of_float ?? null,
          daysToCover: s.days_to_cover ?? null,
          insiderOwnership: s.insider_ownership ?? null,
          institutionOwnership: s.institution_ownership ?? null,
        } satisfies ShareStats)
      : null,
    estimate: e
      ? ({
          asOf: e.as_of,
          targetHigh: e.target_high ?? null,
          targetLow: e.target_low ?? null,
          targetConsensus: e.target_consensus ?? null,
          recommendation: e.recommendation ?? null,
          analysts: e.number_of_analysts ?? null,
          currency: e.currency_code ?? null,
        } satisfies Estimate)
      : null,
    loading: (stats.isPending || est.isPending) && !!securityId,
  };
}
