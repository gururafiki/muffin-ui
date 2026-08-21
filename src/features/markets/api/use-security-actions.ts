/**
 * Dividends and splits — `market.security_corporate_action`, 9,066 rows nothing read.
 *
 * KEYED ON `security_id`, NOT ON A SYMBOL. The table also carries `observed_symbol`, which is the
 * name the provider happened to answer under; a symbol is not a stable key here (41% of non-US
 * securities were once displayed under a thin US OTC line while being priced off their local one),
 * and `security_id` is the key that needed no migration when that was fixed.
 *
 * THE AMOUNT HAS NO CURRENCY OF ITS OWN. The table stores a bare `value`, so the currency must come
 * from the security — a dividend is paid in the currency its listing trades in. That is why the
 * caller passes one, and why it may be null: with no currency the figure is rendered unlabelled
 * rather than as dollars.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zAction = z.looseObject({
  ex_date: z.string(),
  kind: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce guards a driver that quotes it.
  value: z.coerce.number(),
  source_code: z.string().nullish(),
});

export interface CorporateAction {
  exDate: string;
  kind: 'dividend' | 'split' | string;
  value: number;
  source: string | null;
}

export interface SecurityActions {
  dividends: CorporateAction[];
  splits: CorporateAction[];
  loading: boolean;
  empty: boolean;
}

export function useSecurityActions(securityId: string | null | undefined): SecurityActions {
  const query = useQuery({
    queryKey: ['market', 'corporate-actions', securityId ?? null],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      const { data, error } = await supabase
        .schema('market')
        .from('security_corporate_action')
        .select('ex_date,kind,value,source_code')
        .eq('security_id', securityId as string)
        .order('ex_date', { ascending: false })
        // Well under PGRST_DB_MAX_ROWS: a request above it is not an error, just a shorter answer.
        .limit(200);
      if (error)
        throw new Error(`market.security_corporate_action read failed: ${error.message}`);
      return parseArray(zAction, data ?? [], 'security_corporate_action');
    },
    enabled: !!securityId,
    // Corporate actions are announced weeks ahead and never change once past.
    staleTime: 12 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const all: CorporateAction[] = rows.map((r) => ({
    exDate: r.ex_date,
    kind: r.kind,
    value: r.value,
    source: r.source_code ?? null,
  }));
  return {
    dividends: all.filter((a) => a.kind === 'dividend'),
    splits: all.filter((a) => a.kind === 'split'),
    loading: query.isPending && !!securityId,
    // PENDING IS NOT MISSING — reporting empty mid-flight flashes "no dividends" on every page.
    empty: !query.isPending && rows.length === 0,
  };
}
