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
/**
 * How many DIRECTORY hits to show under the tracked ones.
 *
 * Deliberately small. These are listings the app has catalogued but does not track — it holds no
 * price, no sector and no fundamentals for them — so they are an answer to "does this company
 * exist and do you know about it", not a browsable list. Burying five real tracked results under
 * thirty untracked ones would make search worse, not better.
 */
const DIRECTORY_LIMIT = 8;

/**
 * What a person can actually open. The universe is built from fund holdings, so it contains
 * everything the tracked funds hold — and once the bond ETFs were added (AGG alone brought 13,266)
 * the securities table became **majority bonds**: 15,159 against 12,348 equities.
 *
 * Searching "bank" returned eight consecutive `AFRICAN DEVELOPMENT BANK` rows, symbol-less and
 * indistinguishable from each other, above every real bank — the order is alphabetical because
 * PostgREST cannot rank, so a common word in a bond's issuer name crowds out the whole first page.
 * None of them has a page to open: no symbol, no price series, no sector.
 *
 * Filtered here rather than in `security_current`, which is the security record and is correct as
 * it stands — `use-instrument` looks a row up by id and should still resolve whatever it is handed.
 */
const SEARCHABLE_TYPES = ['equity', 'etf'] as const;

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
  /**
   * True when this came from the EXCHANGE DIRECTORY rather than the tracked universe.
   *
   * The directory is what the OpenFIGI sweep enumerates — 63,411 listings across 54 venues on
   * 2026-08-14, of which **62,880 are untracked**. Nothing in the app could reach any of them:
   * search read `security_current` alone, so the entire catalogue was invisible to the one feature
   * whose job is finding a company. Searching "Samsung" returned nothing for Samsung Biologics or
   * Samsung C&T, both of which the app had catalogued and could name.
   *
   * They are surfaced as findable but NOT openable: there is no stock page for a security with no
   * price series, and offering a chevron to one is the fake affordance a screenshot caught on the
   * sector list. Promoting a listing into the universe is `promote-listing`, which is admin-only
   * and is a separate action.
   */
  untracked?: boolean;
  /** Venue the directory listing sits on, e.g. `KS`. Only set for directory hits. */
  exchange?: string;
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
    .in('security_type_code', SEARCHABLE_TYPES)
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

const zListing = z.looseObject({
  figi: z.string(),
  composite_figi: z.string().nullish(),
  ticker: z.string(),
  name: z.string(),
  exch_code: z.string(),
  country_iso2: z.string().nullish(),
  provider_symbol: z.string().nullish(),
});

/**
 * The exchange directory: everything the OpenFIGI sweep has enumerated and the universe does not
 * track. Read as a SECOND query rather than a union, because the two answer different questions and
 * the tracked ones must always come first.
 *
 * DEDUPED BY NAME, and the two identifiers that look like they should do this job do not:
 *
 *   `country_iso2` is the VENUE's country, not the company's. Measured on TOYOTA BOSHOKU — JP/JP,
 *   GR/DE, JT/JP, US/US — so "is this the local line" cannot be asked of it, and a rule shaped that
 *   way is true for every row while reading as logic.
 *
 *   `composite_figi` is per COUNTRY OF LISTING, not per company. Same measurement: BBG000BBRS83 for
 *   the two Japanese venues, BBG000BS1B63 for Frankfurt, BBG000C0L6P1 for the US OTC line. It
 *   collapses JP and JT and nothing else, so four rows would still become three.
 *
 * The name is the only thing all four share, and one row per company is what a search result wants.
 * Where several venues carry a name, the LOCAL line wins — a `provider_symbol` with an exchange
 * suffix (`3116.T`) over a bare US OTC foreign-ordinary (`TDBOF`) — which is the same rule the
 * display-symbol work settled on after 365 of 900 sampled non-US securities were being shown under
 * their thin OTC ticker.
 */
async function searchDirectory(query: string): Promise<SecurityHit[]> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const q = sanitise(query);
  if (q.length < MIN_QUERY) return [];

  const { data, error } = await supabase
    .schema('market')
    .from('untracked_listing')
    .select('figi,composite_figi,ticker,name,exch_code,country_iso2,provider_symbol')
    .or(`ticker.ilike.${q}%,name.ilike.%${q}%`)
    .order('name')
    // Over-fetch, because deduping happens here: one company on four venues is four rows, and
    // collapsing them afterwards would otherwise leave the list nearly empty.
    .limit(DIRECTORY_LIMIT * 6);
  if (error) throw new Error(`market.untracked_listing search failed: ${error.message}`);

  const rows = parseArray(zListing, data ?? [], 'directory search');
  const hasSuffix = (x: { provider_symbol?: string | null }) => (x.provider_symbol ?? '').includes('.');
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = r.name.trim().toUpperCase();
    const held = best.get(key);
    if (!held || (!hasSuffix(held) && hasSuffix(r))) best.set(key, r);
  }

  return [...best.values()].slice(0, DIRECTORY_LIMIT).map((r) => ({
    id: `listing:${r.figi}`,
    name: r.name,
    symbol: r.provider_symbol ?? r.ticker,
    sectorId: null,
    country: r.country_iso2 ?? null,
    untracked: true,
    exchange: r.exch_code,
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

  // A SECOND, INDEPENDENT QUERY — not a fallback chained off the first.
  //
  // Chaining would make the directory appear only when the universe returns nothing, and the case
  // that matters most is the opposite: "samsung" DOES match tracked securities while Samsung
  // Biologics and Samsung C&T sit uncatalogued below them. A separate query also means a slow or
  // failing directory read cannot delay or break the tracked results, which are the ones a person
  // can actually open.
  const directory = useQuery({
    queryKey: ['market', 'directory-search', debounced],
    queryFn: () => searchDirectory(debounced),
    enabled,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  const tracked = result.data ?? [];
  // Never above the tracked ones: an untracked listing has no price, no sector and no page, so it
  // is the weaker answer even when its name matches better.
  const untracked = (directory.data ?? []).filter(
    (d) => !tracked.some((t) => t.symbol && d.symbol && t.symbol.toUpperCase() === d.symbol.toUpperCase()),
  );

  return {
    items: [...tracked, ...untracked],
    trackedCount: tracked.length,
    untrackedCount: untracked.length,
    // `enabled` distinguishes "too short to search" from "searched and found nothing" — they look
    // identical otherwise, and only one of them deserves an empty-state message.
    searching: enabled && (result.isFetching || directory.isFetching),
    ready: enabled,
  };
}
