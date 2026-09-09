/**
 * Recent analyst actions for one security — who re-rated it, when, and which way.
 *
 * DISTINCT FROM THE CONSENSUS, WHICH WE ALSO HOLD. `market.security_estimate` carries the aggregate
 * (`target_consensus`, `recommendation`, `number_of_analysts`) for 9,009 securities GLOBALLY. This
 * reads `market.security_price_target`, the individual events behind that level, and it is US-listed
 * only: finviz answers 400 for every suffixed symbol and for the OTC foreign-ordinary lines. So a
 * security having no rows here is the ordinary case, not a fault.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import type { AnalystAction } from '../analyst-action-parts';
import { MarketUnavailableError } from './market-client';

const zAction = z.looseObject({
  published_date: z.string(),
  analyst_company: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it, which
  // would otherwise make parseArray drop every row and the section silently render nothing.
  target_from: z.coerce.number().nullish(),
  target_to: z.coerce.number().nullish(),
  status: z.string().nullish(),
  rating_change: z.string().nullish(),
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
        .from('security_price_target')
        .select('published_date,analyst_company,target_from,target_to,status,rating_change')
        .eq('security_id', securityId as string)
        // Served by `security_price_target_recent_idx`, which is (security_id, published_date desc).
        .order('published_date', { ascending: false })
        .limit(LIMIT);
      if (error) throw new Error(`market.security_price_target read failed: ${error.message}`);
      return parseArray(zAction, data ?? [], 'security_price_target');
    },
    enabled: !!securityId,
    staleTime: 6 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const actions: AnalystAction[] = (query.data ?? []).map((r) => ({
    publishedDate: r.published_date,
    analystCompany: r.analyst_company,
    targetFrom: r.target_from ?? null,
    targetTo: r.target_to ?? null,
    status: r.status ?? null,
    ratingChange: r.rating_change ?? null,
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
