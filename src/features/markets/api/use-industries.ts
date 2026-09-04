/**
 * Every classification a security carries, with who says so.
 *
 * `security_current.industry` picks ONE — the highest-priority source — and the screener, the
 * sector pages and the donut all depend on that choice. This reads the whole set instead, and
 * changes nothing about the pick.
 *
 * The interesting rows are the DERIVED ones. `segment-revenue` and `segment-profit` weight a
 * company across sectors from its own filed business lines, so Amazon is 61.6% consumer
 * discretionary by revenue and 57.0% information technology by PROFIT — two true statements that
 * a single label cannot hold.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zRow = z.looseObject({
  taxonomy_id: z.string(),
  code: z.string(),
  name: z.string(),
  level: z.coerce.number(),
  parent_name: z.string().nullish(),
  source_code: z.string(),
  source_priority: z.coerce.number().nullish(),
  weight: z.coerce.number().nullish(),
  as_of: z.string().nullish(),
});

export interface ClassificationGroup {
  sourceCode: string;
  /** Highest priority wins the label on the rest of the page; shown so a reader knows which did. */
  priority: number;
  /** True for the one source `security_current` actually picks its sector from. */
  authoritative: boolean;
  rows: {
    code: string;
    name: string;
    level: number;
    parentName: string | null;
    /** A fraction of the company, where the source apportions rather than labels. */
    weight: number | null;
  }[];
}

export function useIndustries(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'industries', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_industries')
        .select(
          'taxonomy_id,code,name,level,parent_name,source_code,source_priority,weight,as_of',
        )
        .eq('security_id', securityId as string)
        .order('source_priority', { ascending: false, nullsFirst: false })
        .order('weight', { ascending: false, nullsFirst: false });
      if (error)
        throw new Error(
          `market.security_industries read failed: ${error.message}`,
        );
      return parseArray(zRow, data ?? [], 'security_industries');
    },
    enabled: !!securityId,
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) =>
      !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const bySource = new Map<string, ClassificationGroup>();
  for (const r of rows) {
    const g = bySource.get(r.source_code) ?? {
      sourceCode: r.source_code,
      priority: r.source_priority ?? 0,
      authoritative: false,
      rows: [],
    };
    g.rows.push({
      code: r.code,
      name: r.name,
      level: r.level,
      parentName: r.parent_name ?? null,
      weight: r.weight ?? null,
    });
    bySource.set(r.source_code, g);
  }

  const groups = [...bySource.values()].sort((a, b) => b.priority - a.priority);
  // The label the rest of the page shows comes from the highest-priority source that supplies a
  // LEVEL-1 sector — flagged rather than re-derived, so this section explains the page instead of
  // contradicting it.
  const winner = groups.find((g) => g.rows.some((r) => r.level === 1));
  if (winner) winner.authoritative = true;

  return {
    groups,
    loading: query.isPending && !!securityId,
    // A security classified by exactly one source has nothing to compare, so the section is not
    // worth a card — the page already shows that single label.
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while `securityId` is null — and the section
    // then renders a card with a heading and nothing under it, which is the one thing this page's
    // convention forbids. Observed in a browser: with the instrument unresolved, every section on the
    // stock page drew an empty card. `loading` already guards on `securityId`; `empty` must too.
    empty: !(query.isPending && !!securityId) && groups.length < 2,
  };
}
