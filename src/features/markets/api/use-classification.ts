/**
 * Classification schemes (MSCI / FTSE / World Bank) from the server.
 *
 * Returns the SAME `Scheme` shape the bundled `classification.ts` exports, so the
 * world map, legend and group pages consume server data with no change to their
 * logic — and the bundled constants remain a byte-for-byte valid fallback.
 *
 * WHY THE RAW ROWS ARE CACHED AND THE SCHEME IS ASSEMBLED PER RENDER:
 * `Scheme.groupOf` is a FUNCTION. The query cache is persisted to MMKV/localStorage
 * (see `lib/query.ts`), and a function cannot survive JSON serialisation — caching
 * the assembled object would restore `groupOf: undefined` on the next cold start and
 * blank the map. So the query holds plain rows and `useMemo` builds the lookups.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';

import { parseArray } from '@/lib/agent/schemas';
import { getSupabase } from '@/lib/auth/client';

import {
  SCHEMES,
  type Group,
  type LensId,
  type Scheme,
  type SchemeId,
} from '@/features/markets/classification';
import { MarketUnavailableError } from './market-client';

const zScheme = z.looseObject({
  id: z.string(),
  name: z.string(),
  blurb: z.string().nullish(),
  lens_region_label: z.string(),
  lens_tier_label: z.string(),
  sort_order: z.number().nullish(),
});

const zGroup = z.looseObject({
  scheme_id: z.string(),
  lens: z.string(),
  id: z.string(),
  name: z.string(),
  short: z.string().nullish(),
  color: z.string().nullish(),
  etf: z.string().nullish(),
  sort_order: z.number().nullish(),
});

const zMember = z.looseObject({
  scheme_id: z.string(),
  lens: z.string(),
  iso2: z.string(),
  group_id: z.string(),
});

interface RawClassification {
  schemes: z.infer<typeof zScheme>[];
  groups: z.infer<typeof zGroup>[];
  members: z.infer<typeof zMember>[];
}

async function fetchClassification(): Promise<RawClassification> {
  const supabase = getSupabase();
  if (!supabase) throw new MarketUnavailableError();
  const market = supabase.schema('market');

  const [schemes, groups, members] = await Promise.all([
    market.from('classification_schemes').select('*').order('sort_order'),
    market.from('classification_groups').select('*').order('sort_order'),
    market.from('classification_members').select('*'),
  ]);
  for (const r of [schemes, groups, members]) {
    if (r.error) throw new Error(`market classification read failed: ${r.error.message}`);
  }
  return {
    schemes: parseArray(zScheme, schemes.data ?? [], 'market.classification_schemes'),
    groups: parseArray(zGroup, groups.data ?? [], 'market.classification_groups'),
    members: parseArray(zMember, members.data ?? [], 'market.classification_members'),
  };
}

function assemble(raw: RawClassification): Scheme[] {
  const out: Scheme[] = [];
  for (const s of raw.schemes) {
    const groupsFor = (lens: LensId): Group[] =>
      raw.groups
        .filter((g) => g.scheme_id === s.id && g.lens === lens)
        .map((g) => ({
          id: g.id,
          name: g.name,
          short: g.short ?? g.name,
          color: g.color ?? '#CCCCCC',
          etf: g.etf ?? undefined,
        }));

    // One map per lens, keyed by ISO — the map colours 220 countries per render, so
    // a linear scan per country would be O(220 x 667).
    const byLens: Record<string, Map<string, string>> = { region: new Map(), tier: new Map() };
    for (const m of raw.members) {
      if (m.scheme_id !== s.id) continue;
      byLens[m.lens]?.set(m.iso2, m.group_id);
    }

    out.push({
      id: s.id as SchemeId,
      name: s.name,
      blurb: s.blurb ?? '',
      lensLabel: { region: s.lens_region_label, tier: s.lens_tier_label },
      groups: { region: groupsFor('region'), tier: groupsFor('tier') },
      groupOf: (lens, iso) => byLens[lens]?.get(iso),
    });
  }
  return out;
}

export interface Classification {
  schemes: Scheme[];
  /** True when falling back to the bundled constants. */
  sample: boolean;
}

export function useClassification(): Classification {
  const query = useQuery({
    queryKey: ['market', 'classification'],
    queryFn: fetchClassification,
    // Reference data: index providers reclassify countries a few times a year.
    staleTime: 24 * 60 * 60_000,
    gcTime: 30 * 24 * 60 * 60_000,
    retry: (count, error) => !(error instanceof MarketUnavailableError) && count < 1,
  });

  return useMemo(() => {
    const raw = query.data;
    if (!raw || raw.schemes.length === 0) return { schemes: SCHEMES, sample: true };
    const schemes = assemble(raw);
    // A scheme with no groups would render an empty map and an empty legend; the
    // bundled set is strictly better than a blank globe.
    if (schemes.length === 0 || schemes.some((s) => s.groups.region.length === 0)) {
      return { schemes: SCHEMES, sample: true };
    }
    return { schemes, sample: false };
  }, [query.data]);
}

/** One scheme by id, falling back to the first available (never undefined). */
export function useScheme(id: SchemeId): { scheme: Scheme; schemes: Scheme[]; sample: boolean } {
  const { schemes, sample } = useClassification();
  return { scheme: schemes.find((s) => s.id === id) ?? schemes[0], schemes, sample };
}
