/**
 * Recent analyst actions for one security — who re-rated it, when, and which way.
 *
 * DISTINCT FROM THE CONSENSUS, WHICH WE ALSO HOLD. `market.security_estimate` carries the aggregate
 * (`target_consensus`, `recommendation`, `number_of_analysts`). This reads the individual events
 * behind that level through `market.security_analyst_action`, which serves each action once by its
 * best source: Yahoo's `upgradeDowngradeHistory` (from 2026-11, back to 2012) ahead of finviz's
 * frozen rows. Yahoo states analyst history mostly for US listings, so a security having no rows
 * here is the ordinary case, not a fault.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import type { AnalystAction } from '../analyst-action-parts';
import { MarketUnavailableError } from './market-client';

const zAction = z.looseObject({
  published_at: z.string(),
  published_date: z.string(),
  analyst_company: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it, which
  // would otherwise make parseArray drop every row and the section silently render nothing.
  target_from: z.coerce.number().nullish(),
  target_to: z.coerce.number().nullish(),
  status: z.string().nullish(),
  rating_change: z.string().nullish(),
  currency_code: z.string().nullish(),
});

/** Enough to show a pattern of re-rating without turning the stock page into a feed. */
const LIMIT = 8;

export function useAnalystActions(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'analyst-actions', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_analyst_action')
        .select(
          'published_at,published_date,analyst_company,target_from,target_to,currency_code,status,rating_change',
        )
        .eq('security_id', securityId as string)
        // BY THE TIMESTAMP, NOT THE DATE: one firm can act twice in a day (2 of AAPL's 971), and the
        // date alone leaves their order to chance. Served by `security_price_target_recent_idx`.
        .order('published_at', { ascending: false })
        .limit(LIMIT);
      if (error) throw new Error(`market.security_analyst_action read failed: ${error.message}`);
      return parseArray(zAction, data ?? [], 'security_analyst_action');
    },
    enabled: !!securityId,
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const actions: AnalystAction[] = (query.data ?? []).map((r) => ({
    publishedAt: r.published_at,
    publishedDate: r.published_date,
    analystCompany: r.analyst_company,
    targetFrom: r.target_from ?? null,
    targetTo: r.target_to ?? null,
    status: r.status ?? null,
    ratingChange: r.rating_change ?? null,
    currency: r.currency_code ?? null,
  }));

  return {
    actions,
    loading: query.isPending && !!securityId,
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a switched-off
    // query, so `!isPending && empty` is FALSE while the id is null and the section renders a card
    // with a heading and nothing under it — the one thing this page's convention forbids.
    empty: !(query.isPending && !!securityId) && actions.length === 0,
  };
}
