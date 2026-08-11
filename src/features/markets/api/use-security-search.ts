/**
 * Search the securities universe by name or symbol.
 *
 * The app had no way to reach a company except by drilling Globe → country → sector, so anything
 * the tracked funds hold but no page happens to list was unreachable. There are 10,060 securities;
 * the sector pages surface a few hundred.
 *
 * Reads `market.security_current`, which already resolves the primary ticker and preferred sector,
 * so this needs no new server work.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import { MarketUnavailableError } from './market-client';

/** Below this a query matches thousands of rows and means nothing. */
const MIN_QUERY = 2;
const LIMIT = 25;

const zRow = z.looseObject({
  security_id: z.string(),
  name: z.string(),
  symbol: z.string().nullish(),
  sector_id: z.string().nullish(),
  country_iso2: z.string().nullish(),
});

export interface SecurityHit {
  id: string;
  name: string;
  symbol: string | null;
  sectorId: string | null;
  country: string | null;
}

/** `%` and `,` break a PostgREST `or=(...)` filter; a comma ends the term list. */
const sanitise = (q: string) => q.replace(/[%,()]/g, ' ').trim();

async function searchSecurities(query: string): Promise<SecurityHit[]> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const q = sanitise(query);
  if (q.length < MIN_QUERY) return [];

  const { data, error } = await supabase
    .schema('market')
    .from('security_current')
    .select('security_id,name,symbol,sector_id,country_iso2')
    // Symbol first in the OR so an exact ticker still matches, but ordering is by name below —
    // PostgREST cannot rank, so a stable alphabetical order beats an arbitrary one.
    .or(`symbol.ilike.${q}%,name.ilike.%${q}%`)
    .order('name')
    .limit(LIMIT);
  if (error) throw new Error(`market.security_current search failed: ${error.message}`);

  return parseArray(zRow, data ?? [], 'security search').map((r) => ({
    id: r.security_id,
    name: r.name,
    symbol: r.symbol ?? null,
    sectorId: r.sector_id ?? null,
    country: r.country_iso2 ?? null,
  }));
}

/** Debounced so a typed word is one request, not one per keystroke. */
export function useSecuritySearch(query: string) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const enabled = sanitise(debounced).length >= MIN_QUERY;
  const result = useQuery({
    queryKey: ['market', 'security-search', debounced],
    queryFn: () => searchSecurities(debounced),
    enabled,
    staleTime: 5 * 60_000,
    // Keeps the previous page visible while the next query resolves, so the list does not blank
    // between keystrokes.
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  return {
    items: result.data ?? [],
    // `enabled` distinguishes "too short to search" from "searched and found nothing" — they look
    // identical otherwise, and only one of them deserves an empty-state message.
    searching: enabled && result.isFetching,
    ready: enabled,
  };
}
