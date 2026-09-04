/**
 * Macro series for a country — inflation, unemployment, the 10-year yield.
 *
 * Reads `market.macro_current`, which serves the LATEST value of every enabled series already
 * converted to the unit it claims. That conversion deliberately lives in the view rather than here:
 * OECD sends inflation as a FRACTION (0.0239 for 2.39%) and FRED sends the same idea as a PERCENT
 * (3.9 for 3.9%), and this codebase has already rendered a figure wrong by two orders of magnitude
 * from exactly that ambiguity. One reader converting and another not is how the two screens
 * disagree; `macro_indicator.value_is_fraction` settles it once, server-side.
 *
 * A country with no series shows NO panel rather than an empty one. 14 countries are covered today
 * and the app models 45 — "we have nothing for Poland" is the honest render, and it is different
 * from "Poland's inflation is zero".
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

const zMacro = z.looseObject({
  code: z.string(),
  name: z.string(),
  category: z.string(),
  country_iso2: z.string().nullable(),
  unit: z.string().nullable(),
  frequency: z.string().nullable(),
  dimension: z.string(),
  // PostgREST v14 sends `numeric` as a JSON number; coerce is the guard that keeps a driver which
  // quoted it from making parseArray drop every row and the panel silently vanish.
  value: z.coerce.number(),
  as_of: z.string(),
  fetched_at: z.string().nullable(),
});

export interface MacroSeries {
  code: string;
  name: string;
  category: string;
  countryIso2: string | null;
  unit: string | null;
  /** A yield curve's maturity; empty for a scalar series. */
  dimension: string;
  value: number;
  asOf: Date;
}

export interface CountryMacro {
  items: MacroSeries[];
  /** The freshest observation across the country's series — what the panel dates itself by. */
  asOf: Date | null;
  loading: boolean;
  /** True when the country genuinely has no series, not merely while loading. */
  empty: boolean;
}

async function fetchMacro(iso2: string) {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    .from('macro_current')
    .select('code,name,category,country_iso2,unit,frequency,dimension,value,as_of,fetched_at')
    .eq('country_iso2', iso2)
    .order('code');
  if (error) throw new Error(`market.macro_current read failed: ${error.message}`);
  return parseArray(zMacro, data ?? [], 'market.macro_current');
}

export function useCountryMacro(iso2: string | undefined): CountryMacro {
  const query = useQuery({
    queryKey: ['market', 'macro', iso2],
    queryFn: () => fetchMacro(iso2!),
    enabled: !!iso2,
    // Macro moves monthly at best; the refresh resource runs every six hours.
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const rows = query.data ?? [];
  const items: MacroSeries[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    category: r.category,
    countryIso2: r.country_iso2,
    unit: r.unit,
    dimension: r.dimension,
    value: r.value,
    asOf: new Date(r.as_of),
  }));
  const asOf = items.reduce<Date | null>(
    (max, i) => (max === null || i.asOf > max ? i.asOf : max),
    null,
  );
  return {
    items,
    asOf,
    loading: query.isPending && !!iso2,
    // PENDING IS NOT MISSING. Reporting `empty` while the query is still in flight would flash
    // "no macro data" on every country page before the first paint.
    // A DISABLED QUERY IS NOT A PENDING ONE. React Query reports `isPending` for a query that is
    // switched off, so `!isPending && <empty>` is FALSE while the id is null — and the section then
    // renders a card with a heading and nothing under it, which is the one thing this page's
    // convention forbids. Seen in a browser with the instrument unresolved: every section on the
    // stock page drew an empty card at once. `loading` already guards on the id; `empty` must too.
    empty: !(query.isPending && !!iso2) && items.length === 0,
  };
}
