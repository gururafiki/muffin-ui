/**
 * Country classification schemes for the globe.
 *
 * The investable world is sliced by index providers, so the map can switch
 * between schemes (how iShares/Vanguard build regional & country ETFs) and a
 * "lens" (group countries by region or by market tier / income).
 *
 *   MSCI       — what most iShares/BlackRock ETFs track. Developed / Emerging /
 *                Frontier × region. The default "EM vs DM" benchmark.
 *   FTSE       — what Vanguard tracks. Korea & Poland = Developed; a 4-tier EM
 *                split (advanced / secondary).
 *   World Bank — every country: 7 geographic regions + 4 income groups (macro).
 *
 * Membership is authored as ISO-3166 alpha-2 lists (keyed to world-geo.ts). MSCI
 * is accurate; FTSE/World Bank are a best-effort starting point — correct by
 * editing the lists below. Countries absent from a scheme render "unclassified".
 */
import { palette } from '@/theme/colors';

export type SchemeId = 'msci' | 'ftse' | 'world-bank';
export type LensId = 'region' | 'tier';

export interface Group {
  id: string;
  name: string;
  short: string;
  color: string;
  /** Representative ETF for the group, where a clean one exists. */
  etf?: string;
}

export interface Scheme {
  id: SchemeId;
  name: string;
  blurb: string;
  lensLabel: Record<LensId, string>;
  groups: Record<LensId, Group[]>;
  /** ISO-2 → group id for a lens (undefined = unclassified by this scheme). */
  groupOf: (lens: LensId, iso: string) => string | undefined;
}

// Data-viz palette (harmonised with the bakery tokens, extended for distinctness).
const C = {
  grape: palette.frosting[500],
  violet: palette.frosting[300],
  blue: palette.blueberry[300],
  gold: palette.butter[500],
  amber: palette.butter[600],
  green: palette.leaf[500],
  mint: palette.leaf[400],
  berry: '#C0577B',
  teal: '#5B9AA8',
} as const;

export const UNCLASSIFIED_COLOR = '#E7DEF1';

const invert = (lists: Record<string, string[]>): Record<string, string> => {
  const m: Record<string, string> = {};
  for (const [g, isos] of Object.entries(lists)) for (const iso of isos) m[iso] = g;
  return m;
};

// ── MSCI ─────────────────────────────────────────────────────────────────────
const MSCI_REGION_LISTS: Record<string, string[]> = {
  na: ['US', 'CA'],
  'dev-europe': ['AT', 'BE', 'DK', 'FI', 'FR', 'DE', 'IE', 'IL', 'IT', 'NL', 'NO', 'PT', 'ES', 'SE', 'CH', 'GB'],
  'dev-pacific': ['AU', 'HK', 'JP', 'NZ', 'SG'],
  'em-asia': ['CN', 'IN', 'ID', 'KR', 'MY', 'PH', 'TW', 'TH'],
  'em-emea': ['CZ', 'EG', 'GR', 'HU', 'KW', 'PL', 'QA', 'SA', 'ZA', 'TR', 'AE'],
  'em-latam': ['BR', 'CL', 'CO', 'MX', 'PE'],
  frontier: ['BH', 'BD', 'HR', 'IS', 'JO', 'KZ', 'KE', 'LT', 'MU', 'MA', 'NG', 'OM', 'PK', 'RO', 'SN', 'RS', 'SI', 'LK', 'TN', 'VN', 'CI'],
};
const MSCI_REGION = invert(MSCI_REGION_LISTS);
const REGION_TIER: Record<string, string> = {
  na: 'developed', 'dev-europe': 'developed', 'dev-pacific': 'developed',
  'em-asia': 'emerging', 'em-emea': 'emerging', 'em-latam': 'emerging', frontier: 'frontier',
};

const REGION_GROUPS: Group[] = [
  { id: 'na', name: 'North America', short: 'N. America', color: C.grape, etf: 'IVV' },
  { id: 'dev-europe', name: 'Developed Europe', short: 'Dev Europe', color: C.blue, etf: 'IEUR' },
  { id: 'dev-pacific', name: 'Developed Pacific', short: 'Dev Pacific', color: C.gold, etf: 'EPP' },
  { id: 'em-asia', name: 'Emerging Asia', short: 'EM Asia', color: C.berry, etf: 'EEMA' },
  { id: 'em-emea', name: 'Emerging EMEA', short: 'EM EMEA', color: C.amber, etf: 'EEM' },
  { id: 'em-latam', name: 'Latin America', short: 'LatAm', color: C.green, etf: 'ILF' },
  { id: 'frontier', name: 'Frontier', short: 'Frontier', color: C.mint, etf: 'FM' },
];

// ── FTSE (Vanguard) — Korea & Poland Developed; 4-tier EM split ───────────────
const FTSE_REGION_LISTS: Record<string, string[]> = {
  na: ['US', 'CA'],
  'dev-europe': ['AT', 'BE', 'DK', 'FI', 'FR', 'DE', 'IE', 'IL', 'IT', 'NL', 'NO', 'PT', 'ES', 'SE', 'CH', 'GB', 'PL'],
  'dev-pacific': ['AU', 'HK', 'JP', 'NZ', 'SG', 'KR'],
  'em-asia': ['CN', 'IN', 'ID', 'MY', 'PH', 'TW', 'TH', 'PK'],
  'em-emea': ['CZ', 'EG', 'GR', 'HU', 'KW', 'QA', 'SA', 'ZA', 'TR', 'AE'],
  'em-latam': ['BR', 'CL', 'CO', 'MX', 'PE'],
  frontier: ['BH', 'BD', 'HR', 'IS', 'JO', 'KZ', 'KE', 'MU', 'MA', 'NG', 'OM', 'RO', 'SN', 'RS', 'SI', 'LK', 'TN', 'VN', 'CI'],
};
const FTSE_REGION = invert(FTSE_REGION_LISTS);
const FTSE_TIER_LISTS: Record<string, string[]> = {
  developed: [...FTSE_REGION_LISTS.na, ...FTSE_REGION_LISTS['dev-europe'], ...FTSE_REGION_LISTS['dev-pacific']],
  'advanced-emerging': ['BR', 'CZ', 'GR', 'HU', 'MY', 'MX', 'ZA', 'TW', 'TH', 'TR'],
  'secondary-emerging': ['CL', 'CN', 'CO', 'EG', 'IN', 'ID', 'KW', 'PK', 'PH', 'QA', 'RO', 'SA', 'AE'],
  frontier: ['BH', 'BD', 'HR', 'IS', 'JO', 'KZ', 'KE', 'MU', 'MA', 'NG', 'OM', 'SN', 'RS', 'SI', 'LK', 'TN', 'VN', 'CI'],
};
const FTSE_TIER = invert(FTSE_TIER_LISTS);
const FTSE_TIER_GROUPS: Group[] = [
  { id: 'developed', name: 'Developed', short: 'Developed', color: C.grape, etf: 'VEA' },
  { id: 'advanced-emerging', name: 'Advanced Emerging', short: 'Adv EM', color: C.gold, etf: 'VWO' },
  { id: 'secondary-emerging', name: 'Secondary Emerging', short: 'Sec EM', color: C.amber, etf: 'VWO' },
  { id: 'frontier', name: 'Frontier', short: 'Frontier', color: C.green, etf: 'FM' },
];

const TIER_GROUPS: Group[] = [
  { id: 'developed', name: 'Developed', short: 'Developed', color: C.grape, etf: 'URTH' },
  { id: 'emerging', name: 'Emerging', short: 'Emerging', color: C.gold, etf: 'EEM' },
  { id: 'frontier', name: 'Frontier', short: 'Frontier', color: C.green, etf: 'FM' },
];

// ── World Bank — 7 geographic regions (all economies) + income groups ─────────
const WB_REGION_LISTS: Record<string, string[]> = {
  'north-america': ['US', 'CA', 'BM', 'GL'],
  'latin-america-caribbean': ['MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA', 'CO', 'VE', 'EC', 'PE', 'BR', 'BO', 'PY', 'UY', 'AR', 'CL', 'GY', 'SR', 'GF', 'CU', 'HT', 'DO', 'JM', 'BS', 'BB', 'TT', 'GD', 'LC', 'VC', 'DM', 'AG', 'KN', 'PR', 'KY', 'AI', 'VG', 'VI', 'TC', 'MS', 'AW', 'CW', 'SX', 'BL', 'MF', 'BQBO', 'BQSA', 'BQSE', 'GP', 'MQ', 'FK'],
  'europe-central-asia': ['AL', 'AT', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FO', 'FI', 'FR', 'GE', 'DE', 'GR', 'HU', 'IS', 'IE', 'IT', 'XK', 'LV', 'LT', 'LU', 'MK', 'MT', 'MD', 'ME', 'NL', 'NO', 'PL', 'PT', 'RO', 'RU', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'TR', 'UA', 'GB', 'AM', 'AZ', 'KZ', 'KG', 'TJ', 'TM', 'UZ'],
  'middle-east-north-africa': ['DZ', 'BH', 'DJ', 'EG', 'IR', 'IQ', 'IL', 'JO', 'KW', 'LB', 'LY', 'MA', 'OM', 'PS', 'QA', 'SA', 'SY', 'TN', 'AE', 'YE', 'EH'],
  'sub-saharan-africa': ['AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'MG', 'MW', 'ML', 'MR', 'MU', 'YT', 'MZ', 'NA', 'NE', 'NG', 'RW', 'RE', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'UG', 'ZM', 'ZW'],
  'south-asia': ['AF', 'BD', 'BT', 'IN', 'MV', 'NP', 'PK', 'LK'],
  'east-asia-pacific': ['CN', 'HK', 'JP', 'KP', 'KR', 'MN', 'TW', 'BN', 'KH', 'ID', 'LA', 'MY', 'MM', 'PH', 'SG', 'TH', 'TL', 'VN', 'AU', 'NZ', 'PG', 'FJ', 'SB', 'VU', 'NC', 'PF', 'WS', 'TO', 'TV', 'NR', 'PW', 'FM', 'MH', 'GU', 'MP', 'AS'],
};
const WB_REGION = invert(WB_REGION_LISTS);
const WB_REGION_GROUPS: Group[] = [
  { id: 'north-america', name: 'North America', short: 'N. America', color: C.grape },
  { id: 'latin-america-caribbean', name: 'Latin America & Caribbean', short: 'LAC', color: C.green },
  { id: 'europe-central-asia', name: 'Europe & Central Asia', short: 'ECA', color: C.blue },
  { id: 'middle-east-north-africa', name: 'Middle East & N. Africa', short: 'MENA', color: C.amber },
  { id: 'sub-saharan-africa', name: 'Sub-Saharan Africa', short: 'SSA', color: C.teal },
  { id: 'south-asia', name: 'South Asia', short: 'S. Asia', color: C.berry },
  { id: 'east-asia-pacific', name: 'East Asia & Pacific', short: 'EAP', color: C.gold },
];

const WB_INCOME_LISTS: Record<string, string[]> = {
  high: ['US', 'CA', 'GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'CH', 'AT', 'DK', 'SE', 'NO', 'FI', 'IS', 'IT', 'ES', 'PT', 'GR', 'MT', 'CY', 'SI', 'CZ', 'SK', 'EE', 'LV', 'LT', 'HR', 'PL', 'HU', 'RO', 'JP', 'KR', 'AU', 'NZ', 'SG', 'HK', 'TW', 'IL', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'CL', 'UY', 'PA', 'TT', 'BS', 'BB', 'PR', 'GL', 'BM', 'KY', 'AW', 'CW', 'GU', 'PF', 'NC', 'FO', 'RU'],
  'upper-middle': ['MX', 'BR', 'CO', 'PE', 'EC', 'PY', 'AR', 'VE', 'CR', 'DO', 'JM', 'GD', 'BZ', 'CN', 'MY', 'TH', 'TR', 'ZA', 'BW', 'NA', 'GA', 'MU', 'BY', 'RS', 'BA', 'AL', 'MK', 'ME', 'XK', 'MD', 'GE', 'AM', 'AZ', 'KZ', 'TM', 'IQ', 'JO', 'LB', 'LY', 'DZ', 'GT', 'SR', 'FJ', 'TO', 'MV', 'ID', 'PS'],
  'lower-middle': ['IN', 'PK', 'BD', 'NP', 'BT', 'LK', 'PH', 'VN', 'LA', 'KH', 'MM', 'MN', 'PG', 'TL', 'VU', 'WS', 'SB', 'KE', 'GH', 'CI', 'NG', 'SN', 'CM', 'CG', 'ZM', 'ZW', 'TZ', 'AO', 'CV', 'MR', 'BO', 'HN', 'NI', 'SV', 'HT', 'EG', 'MA', 'TN', 'DJ', 'IR', 'UA', 'UZ', 'KG', 'TJ', 'NC'],
  low: ['AF', 'YE', 'SY', 'ET', 'SO', 'SS', 'SD', 'ER', 'CD', 'CF', 'TD', 'NE', 'ML', 'BF', 'BI', 'RW', 'UG', 'MW', 'MZ', 'MG', 'LR', 'SL', 'GN', 'GW', 'GM', 'TG', 'BJ', 'KP'],
};
const WB_INCOME = invert(WB_INCOME_LISTS);
const WB_INCOME_GROUPS: Group[] = [
  { id: 'high', name: 'High income', short: 'High', color: C.grape },
  { id: 'upper-middle', name: 'Upper-middle income', short: 'Upper-mid', color: C.violet },
  { id: 'lower-middle', name: 'Lower-middle income', short: 'Lower-mid', color: C.gold },
  { id: 'low', name: 'Low income', short: 'Low', color: C.amber },
];

// ── Schemes ──────────────────────────────────────────────────────────────────
export const SCHEMES: Scheme[] = [
  {
    id: 'msci',
    name: 'MSCI',
    blurb: 'iShares / BlackRock benchmark — Developed · Emerging · Frontier.',
    lensLabel: { region: 'Region', tier: 'Market tier' },
    groups: { region: REGION_GROUPS, tier: TIER_GROUPS },
    groupOf: (lens, iso) => {
      const r = MSCI_REGION[iso];
      return lens === 'region' ? r : r ? REGION_TIER[r] : undefined;
    },
  },
  {
    id: 'ftse',
    name: 'FTSE',
    blurb: 'Vanguard benchmark — Korea & Poland Developed; advanced/secondary EM.',
    lensLabel: { region: 'Region', tier: 'Market tier' },
    groups: { region: REGION_GROUPS, tier: FTSE_TIER_GROUPS },
    groupOf: (lens, iso) => (lens === 'region' ? FTSE_REGION[iso] : FTSE_TIER[iso]),
  },
  {
    id: 'world-bank',
    name: 'World Bank',
    blurb: 'Macro view — 7 geographic regions and income groups (all economies).',
    lensLabel: { region: 'Region', tier: 'Income group' },
    groups: { region: WB_REGION_GROUPS, tier: WB_INCOME_GROUPS },
    groupOf: (lens, iso) => (lens === 'region' ? WB_REGION[iso] : WB_INCOME[iso]),
  },
];

export const getScheme = (id: SchemeId): Scheme =>
  SCHEMES.find((s) => s.id === id) ?? SCHEMES[0];

export const groupById = (scheme: Scheme, lens: LensId, id: string | undefined): Group | undefined =>
  id ? scheme.groups[lens].find((g) => g.id === id) : undefined;
