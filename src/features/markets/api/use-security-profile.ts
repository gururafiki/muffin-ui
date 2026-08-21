/**
 * What a company actually is — description, size, where it is, and how it moves with the market.
 *
 * `market.security_profile` is filled by `security-profile-detail` from fields `equity/profile` has
 * been returning all along and this pipeline discarded. It is a SEPARATE table from `security`
 * because a description is a paragraph and that table is joined by the spine matview and every
 * serving view.
 *
 * Keyed on `security_id`, never a symbol: a symbol is not a stable key here (migration 39 changed
 * the display symbol for 41% of non-US securities, and everything joined on the id needed nothing).
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zProfile = z.looseObject({
  description: z.string().nullish(),
  employees: z.coerce.number().nullish(),
  website: z.string().nullish(),
  hq_city: z.string().nullish(),
  hq_state: z.string().nullish(),
  hq_country: z.string().nullish(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it.
  beta: z.coerce.number().nullish(),
  as_of: z.string().nullish(),
});

export interface CompanyProfile {
  description: string | null;
  employees: number | null;
  website: string | null;
  /** City, state and country as the provider gave them — already joined for display. */
  location: string | null;
  beta: number | null;
  asOf: string | null;
}

export function useSecurityProfile(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'security-profile', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_profile')
        .select('description,employees,website,hq_city,hq_state,hq_country,beta,as_of')
        .eq('security_id', securityId as string)
        .limit(1);
      if (error) throw new Error(`market.security_profile read failed: ${error.message}`);
      return parseArray(zProfile, data ?? [], 'security_profile');
    },
    enabled: !!securityId,
    // A company description changes on the scale of years.
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const row = (query.data ?? [])[0];
  const profile: CompanyProfile | null = row
    ? {
        description: row.description ?? null,
        employees: row.employees ?? null,
        website: row.website ?? null,
        // Joined here rather than in three call sites, and EMPTY PARTS ARE DROPPED: most US
        // securities return a city and no state or country, so a naive join renders "Cupertino, , ".
        location: [row.hq_city, row.hq_state, row.hq_country].filter(Boolean).join(', ') || null,
        beta: row.beta ?? null,
        asOf: row.as_of ?? null,
      }
    : null;

  return {
    profile,
    loading: query.isPending && !!securityId,
    // PENDING IS NOT MISSING — the backlog is ~12,000 deep, so "no profile yet" is the common state
    // and must not flash on every stock page before the query resolves.
    empty: !query.isPending && !row,
  };
}
