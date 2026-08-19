/**
 * ONE filter model for the Markets tab.
 *
 * Before this there were four unrelated mechanisms: a zustand store for the period, a `countryId`
 * route param, a `useState` chip row, and a client-side text search. Only the `countryId` path on
 * `sector/[sectorId].tsx` filtered server-side, and it is the template this generalises.
 *
 * THE DIMENSIONS ARE NOT INVENTED HERE. Every field below is a column on `market.security_facets`
 * and an argument to `market.aggregate_performance`, so a filter the UI can express is a filter the
 * server can compute. Adding one is a column there and a field here — never a client-side `.filter()`.
 *
 * WHY FILTERING MUST BE SERVER-SIDE. `PGRST_DB_MAX_ROWS` is 1000. A client that fetches a list and
 * filters it locally is filtering the first 1,000 rows of 27,629, and the result looks like a
 * complete answer. The same ceiling has already produced four wrong numbers in this codebase, so
 * every hook takes a `MarketFilter` and pushes it into the query.
 *
 * `undefined` means NO OPINION and an empty array means MATCH NOTHING — the same distinction the
 * RPC draws. They must not be collapsed: a user who clears their last chip is asking to see
 * everything, while a user whose selection matched nothing must not silently be shown the world.
 */
import type { Period } from './api/periods';

/** Market-cap bands, matching `security_facets.cap_band` exactly. */
export const CAP_BANDS = ['large', 'mid', 'small'] as const;
export type CapBand = (typeof CAP_BANDS)[number];

export const CAP_BAND_LABELS: Record<CapBand, string> = {
  large: 'Large cap',
  mid: 'Mid cap',
  small: 'Small cap',
};

/** Growth/value, matching `security_style.style`. */
export const STYLES = ['growth', 'blend', 'value'] as const;
export type StyleId = (typeof STYLES)[number];

export const STYLE_LABELS: Record<StyleId, string> = {
  growth: 'Growth',
  blend: 'Blend',
  value: 'Value',
};

/**
 * A style label is NOT uniformly trustworthy and the UI must be able to say so. `index` means
 * IWF/IWD membership — a fact. `composite` is our book-to-price model, measured at 0.678 accuracy
 * with 0.48 recall on growth. Rendering both identically would present a guess as a classification.
 */
export type StyleSource = 'index' | 'composite';
export type StyleConfidence = 'high' | 'moderate' | 'low';

export interface MarketFilter {
  /** ISO-3166 alpha-2, the EFFECTIVE country (`coalesce(provider, filed)`). */
  countries?: string[];
  /** `market.countries.region_id` — the app's own six regions. */
  appRegions?: string[];
  /** MSCI tier: developed / emerging / frontier. */
  msciTiers?: string[];
  msciRegions?: string[];
  ftseTiers?: string[];
  /** World Bank income group: high / upper-middle / lower-middle / low. */
  incomeGroups?: string[];
  wbRegions?: string[];
  sectors?: string[];
  industries?: string[];
  capBands?: CapBand[];
  styles?: StyleId[];
  /** `market.security_type.code` — equity / bond / cash / derivative. */
  securityTypes?: string[];
  minMarketCapUsd?: number;
  maxMarketCapUsd?: number;
}

export const EMPTY_FILTER: MarketFilter = {};

/** Fields that carry a list of values, so generic code never has to enumerate them by hand. */
const LIST_KEYS = [
  'countries',
  'appRegions',
  'msciTiers',
  'msciRegions',
  'ftseTiers',
  'incomeGroups',
  'wbRegions',
  'sectors',
  'industries',
  'capBands',
  'styles',
  'securityTypes',
] as const satisfies readonly (keyof MarketFilter)[];

export type MarketFilterListKey = (typeof LIST_KEYS)[number];

/** How many dimensions are constrained — drives the "N filters" badge and the Clear affordance. */
export function activeFilterCount(f: MarketFilter): number {
  let n = 0;
  for (const k of LIST_KEYS) if (f[k] !== undefined) n += 1;
  if (f.minMarketCapUsd !== undefined) n += 1;
  if (f.maxMarketCapUsd !== undefined) n += 1;
  return n;
}

export const isFilterEmpty = (f: MarketFilter): boolean => activeFilterCount(f) === 0;

/**
 * Toggle one value of one dimension.
 *
 * Removing the LAST value returns the key to `undefined` (no opinion) rather than leaving `[]`
 * (match nothing) — otherwise unticking the final chip would empty the screen instead of restoring
 * it, which is the opposite of what the gesture means.
 */
export function toggleFilterValue<K extends MarketFilterListKey>(
  filter: MarketFilter,
  key: K,
  value: NonNullable<MarketFilter[K]>[number],
): MarketFilter {
  const current = filter[key] as readonly string[] | undefined;
  const has = current?.includes(value as string) ?? false;
  const next = has
    ? (current ?? []).filter((v) => v !== value)
    : [...(current ?? []), value as string];
  const out = { ...filter };
  if (next.length === 0) delete out[key];
  else (out[key] as readonly string[]) = next;
  return out;
}

/** Arguments for `market.aggregate_performance`. Keys are the SQL parameter names. */
export interface AggregateArgs {
  p_period: Period;
  p_group_by: string;
  [param: string]: unknown;
}

/**
 * Map the filter onto the RPC's named parameters.
 *
 * Only DEFINED keys are emitted. Sending `null` explicitly would be identical to omitting it (the
 * function defaults every filter to null), but sending `[]` is NOT — it means "match nothing" — so
 * an empty array is passed through deliberately rather than being pruned as if it were absent.
 */
export function toAggregateArgs(
  filter: MarketFilter,
  period: Period,
  groupBy: string,
): AggregateArgs {
  const args: AggregateArgs = { p_period: period, p_group_by: groupBy };
  const put = (param: string, value: unknown) => {
    if (value !== undefined) args[param] = value;
  };
  put('p_country', filter.countries);
  put('p_app_region', filter.appRegions);
  put('p_msci_tier', filter.msciTiers);
  put('p_msci_region', filter.msciRegions);
  put('p_ftse_tier', filter.ftseTiers);
  put('p_income_group', filter.incomeGroups);
  put('p_wb_region', filter.wbRegions);
  put('p_sector', filter.sectors);
  put('p_industry', filter.industries);
  put('p_cap_band', filter.capBands);
  put('p_style', filter.styles);
  put('p_security_type', filter.securityTypes);
  put('p_min_market_cap_usd', filter.minMarketCapUsd);
  put('p_max_market_cap_usd', filter.maxMarketCapUsd);
  return args;
}

/** `security_facets` column for each filter dimension, for direct PostgREST reads. */
const FACET_COLUMN: Record<MarketFilterListKey, string> = {
  countries: 'country_iso2',
  appRegions: 'app_region_id',
  msciTiers: 'msci_tier',
  msciRegions: 'msci_region',
  ftseTiers: 'ftse_tier',
  incomeGroups: 'income_group',
  wbRegions: 'wb_region',
  sectors: 'sector_id',
  industries: 'industry',
  capBands: 'cap_band',
  styles: 'style',
  securityTypes: 'security_type_code',
};

/**
 * Apply the filter to a PostgREST query builder for a `security_facets`-shaped relation.
 *
 * Typed as a minimal structural interface rather than importing Supabase's builder generics, which
 * are not exported in a usable form and would couple every caller to a client version.
 */
export interface FacetQuery<Q> {
  in: (column: string, values: readonly unknown[]) => Q;
  gte: (column: string, value: unknown) => Q;
  lte: (column: string, value: unknown) => Q;
}

export function applyFilterToQuery<Q extends FacetQuery<Q>>(query: Q, filter: MarketFilter): Q {
  let q = query;
  for (const key of LIST_KEYS) {
    const values = filter[key] as readonly string[] | undefined;
    // An empty array is passed to `.in()` on purpose: PostgREST renders `in.()`, which matches
    // nothing. Skipping it would turn "match nothing" into "no opinion".
    if (values !== undefined) q = q.in(FACET_COLUMN[key], values);
  }
  if (filter.minMarketCapUsd !== undefined) q = q.gte('market_cap_usd', filter.minMarketCapUsd);
  if (filter.maxMarketCapUsd !== undefined) q = q.lte('market_cap_usd', filter.maxMarketCapUsd);
  return q;
}

/**
 * Serialise to URL search params so a filtered view is shareable, and parse back.
 *
 * Lists join on `,`; a value containing a comma would break the round trip, so it is rejected on
 * the way out rather than silently splitting into two filter values on the way back in. None of the
 * current dimensions (ISO codes, slugs, enum labels) can contain one.
 */
export function filterToParams(filter: MarketFilter): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of LIST_KEYS) {
    const values = filter[key] as readonly string[] | undefined;
    if (values === undefined) continue;
    if (values.some((v) => v.includes(','))) continue;
    out[key] = values.join(',');
  }
  if (filter.minMarketCapUsd !== undefined) out.minMarketCapUsd = String(filter.minMarketCapUsd);
  if (filter.maxMarketCapUsd !== undefined) out.maxMarketCapUsd = String(filter.maxMarketCapUsd);
  return out;
}

export function filterFromParams(params: Record<string, string | string[] | undefined>): MarketFilter {
  const filter: MarketFilter = {};
  for (const key of LIST_KEYS) {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined) continue;
    // An explicitly empty param round-trips to an empty array — "match nothing" survives a reload.
    (filter[key] as readonly string[]) = value === '' ? [] : value.split(',');
  }
  const num = (v: string | string[] | undefined): number | undefined => {
    const s = Array.isArray(v) ? v[0] : v;
    if (s === undefined || s === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const min = num(params.minMarketCapUsd);
  const max = num(params.maxMarketCapUsd);
  if (min !== undefined) filter.minMarketCapUsd = min;
  if (max !== undefined) filter.maxMarketCapUsd = max;
  return filter;
}
