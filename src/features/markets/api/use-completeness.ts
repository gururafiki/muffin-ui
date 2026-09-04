/**
 * What this security has, what it owes, and what nobody could give it.
 *
 * Reads `market.security_facet_status`, which exists because `coverage_current` — the same question
 * for the whole universe — declares its `base` CTE `as materialized`, so a single-security filter
 * cannot be pushed through it and a per-security read would pay the entire 743 ms aggregate.
 *
 * THREE STATES, NOT TWO, and the third is the one that keeps a completeness number honest.
 * `applicable = false` means no regulator can serve this security the facet at all — a Cayman shell
 * cannot have a segment disclosure — and counting those as missing is what once made 74 funds read
 * 0% complete. `required` comes from the `required_facet` control table, so a bond is not charged
 * for the sector and industry it will never have.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zRow = z.looseObject({
  facet: z.string(),
  present: z.boolean(),
  applicable: z.boolean(),
  required: z.boolean(),
});

export interface FacetStatus {
  facet: string;
  present: boolean;
  applicable: boolean;
  required: boolean;
}

export function useCompleteness(securityId: string | null | undefined, enabled = true) {
  const query = useQuery({
    queryKey: ['market', 'completeness', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_facet_status')
        .select('facet,present,applicable,required')
        .eq('security_id', securityId as string)
        .order('facet');
      if (error) throw new Error(`market.security_facet_status read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'security_facet_status');
    },
    // Admin-only, so it is not fetched for the readers who will never see it.
    enabled: enabled && !!securityId,
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows: FacetStatus[] = query.data ?? [];
  const applicable = rows.filter((r) => r.applicable);
  const present = applicable.filter((r) => r.present);
  const requiredMissing = rows.filter((r) => r.required && r.applicable && !r.present);

  return {
    rows,
    /** Breadth: how much of what this security COULD have, it has. */
    presentCount: present.length,
    applicableCount: applicable.length,
    /** The gate: what its type owes and it does not have. Empty means complete. */
    requiredMissing,
    loading: query.isPending && !!securityId && enabled,
    empty: !(query.isPending && !!securityId && enabled) && rows.length === 0,
  };
}
