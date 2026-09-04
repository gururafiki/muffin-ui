/**
 * Who runs the company — the officers `security-management` collects from `equity/profile`.
 *
 * `market.security_leadership` flags the chief executive rather than leaving the caller to order by
 * pay: whoever was granted the most equity in a given year lands at the top of a pay-sorted list,
 * and that is not who runs the company.
 *
 * PAY CARRIES ITS CURRENCY, AND SOMETIMES CARRIES NONE. `pay_currency` is the view's own answer
 * (migration 125), computed with the same expression `security_statement_current` labels statements
 * with, so two screens cannot disagree about one company. It is NULL where nothing in the data says
 * what the figure is denominated in — a non-US company quoted in USD reports in neither — and
 * `formatMoney` then renders the number unlabelled. That is the honest render: SK hynix's chief
 * executive is stored as 4,239,000,000, which is won and about $3m, and defaulting to dollars is
 * how the Alibaba bug started.
 *
 * Keyed on `security_id`, never a symbol — a symbol is not a stable key here.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zOfficer = z.looseObject({
  name: z.string(),
  title: z.string().nullish(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it, which
  // would otherwise make parseArray drop every row and the panel silently vanish.
  pay: z.coerce.number().nullish(),
  age: z.coerce.number().nullish(),
  fiscal_year: z.coerce.number().nullish(),
  is_ceo: z.boolean().nullish(),
  pay_currency: z.string().nullish(),
});

export interface Officer {
  name: string;
  title: string | null;
  pay: number | null;
  /** NULL means the currency is unknown — render the figure unlabelled, never as dollars. */
  payCurrency: string | null;
  age: number | null;
  fiscalYear: number | null;
  isCeo: boolean;
}

export function useLeadership(securityId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['market', 'leadership', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_leadership')
        .select('name,title,pay,age,fiscal_year,is_ceo,pay_currency')
        .eq('security_id', securityId as string)
        // THE CHIEF EXECUTIVE FIRST, then by pay. Ordering server-side keeps the two halves of the
        // rule (the flag and the tie-break) in one place instead of re-deriving them per screen.
        .order('is_ceo', { ascending: false })
        .order('pay', { ascending: false, nullsFirst: false })
        // A board list is a dozen people; anything longer is a provider artefact, not a board.
        .limit(12);
      if (error) throw new Error(`market.security_leadership read failed: ${error.message}`);
      return parseArray(zOfficer, data ?? [], 'security_leadership');
    },
    enabled: !!securityId,
    // Officers change on the scale of years, and the resource re-reads on its own cursor.
    staleTime: 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const officers: Officer[] = (query.data ?? []).map((r) => ({
    name: r.name,
    title: r.title ?? null,
    pay: r.pay ?? null,
    payCurrency: r.pay_currency ?? null,
    age: r.age ?? null,
    fiscalYear: r.fiscal_year ?? null,
    isCeo: r.is_ceo === true,
  }));

  return {
    officers,
    loading: query.isPending && !!securityId,
    // PENDING IS NOT MISSING. 94 securities have officers against ~12,000 in the universe, so
    // "nothing yet" is the common state and must not flash on every stock page before the query
    // resolves.
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while the id is null — and the section then
    // renders a card with a heading and nothing under it, which is the one thing this page's
    // convention forbids. Seen in a browser with the instrument unresolved: every section on the
    // stock page drew an empty card at once. `loading` already guards on the id; `empty` must too.
    empty: !(query.isPending && !!securityId) && officers.length === 0,
  };
}
