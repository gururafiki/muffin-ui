/**
 * Securities that no list will ever show, because they are not placed anywhere.
 *
 * Two ways a real company disappears from this app:
 *
 * 1. **No country, or a country with no page.** N-PORT reports the INCORPORATION jurisdiction, so
 *    Alibaba is filed under `KY` — and there is no Cayman Islands page, because there is no Cayman
 *    market. 267 equities sit in such jurisdictions and 84 have no country at all. Search could
 *    find them; browsing never could.
 * 2. **No sector.** 1,290 equities have no sector yet, so they appear under no sector page.
 *
 * Neither is an error — they are honest gaps in classification. But a universe of 12,348 equities
 * that silently hides 1,300 of them is worse than one that says "and these are the ones I could not
 * place".
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const PAGE = 200;

const zRow = z.looseObject({
  security_id: z.string(),
  name: z.string(),
  symbol: z.string().nullish(),
  sector_id: z.string().nullish(),
  country_iso2: z.string().nullish(),
  country_name: z.string().nullish(),
});

export type UnplacedKind = 'no-country' | 'no-sector';

export interface UnplacedSecurity {
  id: string;
  name: string;
  symbol: string | null;
  countryIso: string | null;
  countryName: string | null;
  sectorId: string | null;
}

/**
 * @param drillableIsos The countries that DO have a page. Anything outside this set is unreachable
 *   by browsing even though it has a country, which is the Cayman Islands case — so the caller
 *   supplies it rather than this guessing from a hardcoded list of tax havens.
 */
export function useUnplaced(
  kind: UnplacedKind,
  drillableIsos: readonly string[],
  countryIso2?: string,
) {
  const query = useQuery({
    queryKey: ['market', 'unplaced', kind, countryIso2 ?? null, drillableIsos.length],
    queryFn: async () => {
      const supabase = getSupabase();
      if (!supabase) throw new MarketUnavailableError();
      let q = supabase
        .schema('market')
        .from('security_current')
        .select('security_id,name,symbol,sector_id,country_iso2,country_name')
        .eq('security_type_code', 'equity');

      if (kind === 'no-sector') {
        q = q.is('sector_id', null);
        // Scoped to one country when the reader came from that country's page.
        if (countryIso2) q = q.eq('country_iso2', countryIso2);
      } else {
        // No country at all, OR a country with no page. `not.in` needs the list inline; it is ~45
        // ISO codes, which is a short URL — unlike an `in.()` of security ids, where 500 earns a
        // bare 502 because the filter is a URL and its budget is LENGTH.
        const inList = drillableIsos.join(',');
        q = inList ? q.or(`country_iso2.is.null,country_iso2.not.in.(${inList})`) : q.is('country_iso2', null);
      }

      const { data, error } = await q.order('name').limit(PAGE);
      if (error) throw new Error(`market.security_current unplaced read failed: ${error.message}`);
      return parseArray(zRow, data ?? [], 'market.security_current');
    },
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  return {
    items: rows.map((r) => ({
      id: r.security_id,
      name: r.name,
      symbol: r.symbol ?? null,
      countryIso: r.country_iso2 ?? null,
      countryName: r.country_name ?? null,
      sectorId: r.sector_id ?? null,
    })) as UnplacedSecurity[],
    loading: query.isPending,
    /** True when the page is full, so the caller can say the list is capped rather than complete. */
    capped: rows.length >= PAGE,
  };
}
