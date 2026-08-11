/**
 * The countries the app can open, from the server.
 *
 * `taxonomy.ts`'s `COUNTRIES` was a bundled list of 19. That was fine while 19 was also the number
 * of countries with data — but adding 27 more ETFs made the server know about 45 while the app
 * still offered 19, so a group page listed "Also in this group: Poland" with no page behind it.
 * The list is now `market.countries` where `drillable` is true.
 *
 * The bundled list stays as the FALLBACK, not as a second source of truth: it is what renders
 * before the query resolves and if Supabase is unreachable, so the globe is never blank. Server
 * rows win whenever they exist.
 *
 * `id` is the slug the routes use (`/country/south-korea`). The server keys on ISO-2, so the slug
 * is derived from the name — matching how the bundled entries were written, which is what keeps
 * existing links working.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { COUNTRIES, registerCountries, type Country, type Market, type RegionId } from '../taxonomy';
import { MarketUnavailableError } from './market-client';

const zCountryRow = z.looseObject({
  iso2: z.string(),
  name: z.string(),
  flag: z.string().nullish(),
  region_id: z.string().nullish(),
  market: z.string().nullish(),
  etf_symbol: z.string().nullish(),
});

/** `South Korea` -> `south-korea`, the form the existing routes and bundled ids already use. */
export function countrySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function fetchCountries(): Promise<Country[]> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const { data, error } = await supabase
    .schema('market')
    .from('countries')
    .select('iso2,name,flag,region_id,market,etf_symbol')
    .eq('drillable', true)
    .order('name');
  if (error) throw new Error(`market.countries read failed: ${error.message}`);

  const rows = parseArray(zCountryRow, data ?? [], 'market.countries');
  // A row missing a region or tier is DROPPED rather than defaulted: the globe groups by region
  // and the tier drives the map colour, so a country with neither would render as an uncoloured
  // shape in a group it does not belong to — worse than not offering it yet.
  const items = rows
    .filter((r) => r.region_id && r.market)
    .map((r) => ({
      id: countrySlug(r.name),
      name: r.name,
      iso: r.iso2,
      flag: r.flag ?? '',
      regionId: r.region_id as RegionId,
      market: r.market as Market,
      // Authored growth is gone; the real number comes from `market.performance` per period.
      changePct: 0,
    }));

  // Published from the QUERY, not from render: `registerCountries` is a side effect, and React
  // Compiler treats render as pure. This runs once per fetch, which is exactly when the list
  // changes.
  registerCountries(items);
  return items;
}

export interface Countries {
  items: Country[];
  /** True while the bundled 19 are standing in for the server's list. */
  sample: boolean;
}

/**
 * Resolve ONE country by its route slug, mounting the query so a deep link works.
 *
 * `getCountry` alone reads the registry, and the registry is only populated by a screen that has
 * already run `useCountries` — so a cold load straight to `/country/poland` resolved against the
 * bundled 19 and rendered "Unknown country" for a country the server knows. Measured on the
 * deployed site, not reasoned about.
 *
 * `pending` distinguishes "still loading" from "no such country": showing the not-found card while
 * the list is in flight is the same bug in a different costume.
 */
export function useCountry(id: string | undefined): { country: Country | undefined; pending: boolean } {
  const { items, sample } = useCountries();
  const country = id ? items.find((c) => c.id === id) : undefined;
  // Only "pending" while we are still on the bundled fallback AND have not found it there — once
  // the server list has arrived, a miss is a genuine miss.
  return { country, pending: !country && sample };
}

export function useCountries(): Countries {
  const query = useQuery({
    queryKey: ['market', 'countries'],
    queryFn: fetchCountries,
    // Reference data: a country's region and tier change a few times a decade.
    staleTime: 24 * 60 * 60_000,
    gcTime: 30 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const items = query.data ?? [];
  if (items.length === 0) return { items: COUNTRIES, sample: true };
  return { items, sample: false };
}
