// `MarketFilter` — offline, no credentials, no browser.
//
// WHY THIS EXISTS. The whole filter feature rests on ONE distinction that has no visible symptom
// when it breaks: `undefined` means NO OPINION and `[]` means MATCH NOTHING. Collapse them and a
// user who unticks their last chip is shown either the entire 27,629-security universe or a blank
// screen — both of which look like a working filter with a surprising result, not like a bug.
//
// The second reason is the ceiling. `PGRST_DB_MAX_ROWS` is 1000, so any dimension that quietly
// fails to reach the server becomes a client-side filter over the first 1,000 rows and returns a
// confident wrong answer. That has already happened four times in this codebase, so every
// dimension is asserted to actually appear in the query — not merely to be present in the object.
import {
  activeFilterCount,
  applyFilterToQuery,
  CAP_BANDS,
  EMPTY_FILTER,
  filterFromParams,
  filterToParams,
  isFilterEmpty,
  STYLES,
  toAggregateArgs,
  toggleFilterValue,
  type MarketFilter,
} from '../src/features/markets/market-filter';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\n## undefined is NO OPINION, [] is MATCH NOTHING — never the same thing');
{
  const none = toAggregateArgs({}, '1y', 'sector_id');
  check('an absent dimension is omitted entirely', !('p_country' in none), JSON.stringify(none));

  const empty = toAggregateArgs({ countries: [] }, '1y', 'sector_id');
  check(
    'an EMPTY dimension is SENT, as []',
    Array.isArray(empty.p_country) && (empty.p_country as unknown[]).length === 0,
    JSON.stringify(empty.p_country),
  );
  // If these two produced the same payload, "match nothing" would render as "the whole world".
  check(
    'the two produce different payloads',
    JSON.stringify(none) !== JSON.stringify(empty),
    `${JSON.stringify(none)} vs ${JSON.stringify(empty)}`,
  );
}

console.log('\n## unticking the LAST chip restores "no opinion", it does not empty the screen');
{
  let f: MarketFilter = {};
  f = toggleFilterValue(f, 'capBands', 'large');
  check('first toggle selects', JSON.stringify(f.capBands) === '["large"]', JSON.stringify(f.capBands));
  f = toggleFilterValue(f, 'capBands', 'mid');
  check('second toggle adds', JSON.stringify(f.capBands) === '["large","mid"]', JSON.stringify(f.capBands));
  f = toggleFilterValue(f, 'capBands', 'large');
  check('untoggle removes one', JSON.stringify(f.capBands) === '["mid"]', JSON.stringify(f.capBands));
  f = toggleFilterValue(f, 'capBands', 'mid');
  check(
    'untoggling the LAST one returns to undefined, not []',
    f.capBands === undefined && !('capBands' in f),
    JSON.stringify(f),
  );
  check('and the filter reads as empty again', isFilterEmpty(f), String(activeFilterCount(f)));
}

console.log('\n## EVERY dimension reaches the server (a dimension that does not is a silent no-op)');
{
  // One value per dimension, all set at once, so a forgotten mapping shows up as a missing param
  // rather than as a filter that appears to work because another one narrowed the list.
  const all: MarketFilter = {
    countries: ['US'],
    appRegions: ['emea'],
    msciTiers: ['developed'],
    msciRegions: ['na'],
    ftseTiers: ['developed'],
    incomeGroups: ['high'],
    wbRegions: ['north-america'],
    sectors: ['financials'],
    industries: ['financials--banks-regional'],
    capBands: ['large'],
    styles: ['value'],
    securityTypes: ['equity'],
    minMarketCapUsd: 1e9,
    maxMarketCapUsd: 1e12,
  };
  check('activeFilterCount counts every dimension', activeFilterCount(all) === 14, String(activeFilterCount(all)));
  // AN EMPTY ARRAY IS AN ACTIVE FILTER. It constrains the result to nothing, which is very much an
  // opinion — if it did not count, the "N filters" badge would read 0 and the Clear affordance
  // would be hidden on the one screen a user most needs it: an empty list they cannot explain.
  check(
    'an EMPTY dimension still counts as active',
    activeFilterCount({ countries: [] }) === 1,
    String(activeFilterCount({ countries: [] })),
  );
  check('and the filter does not read as empty', !isFilterEmpty({ countries: [] }));

  const args = toAggregateArgs(all, '1y', 'sector_id');
  const expected = [
    'p_country', 'p_app_region', 'p_msci_tier', 'p_msci_region', 'p_ftse_tier',
    'p_income_group', 'p_wb_region', 'p_sector', 'p_industry', 'p_cap_band',
    'p_style', 'p_security_type', 'p_min_market_cap_usd', 'p_max_market_cap_usd',
  ];
  for (const p of expected) check(`RPC receives ${p}`, p in args);

  // The same, through the PostgREST path. A fake builder records what was asked for.
  const calls: string[] = [];
  const fake = {
    in(column: string, values: readonly unknown[]) {
      calls.push(`in:${column}=${JSON.stringify(values)}`);
      return fake;
    },
    gte(column: string, value: unknown) {
      calls.push(`gte:${column}=${String(value)}`);
      return fake;
    },
    lte(column: string, value: unknown) {
      calls.push(`lte:${column}=${String(value)}`);
      return fake;
    },
  };
  applyFilterToQuery(fake, all);
  const columns = [
    'country_iso2', 'app_region_id', 'msci_tier', 'msci_region', 'ftse_tier',
    'income_group', 'wb_region', 'sector_id', 'industry_code', 'cap_band',
    'style', 'security_type_code',
  ];
  for (const c of columns) {
    check(`query filters on ${c}`, calls.some((k) => k.startsWith(`in:${c}=`)), calls.join(' '));
  }
  check('query applies the cap floor', calls.includes('gte:market_cap_usd=1000000000'));
  check('query applies the cap ceiling', calls.includes('lte:market_cap_usd=1000000000000'));
}

console.log('\n## an EMPTY dimension still reaches the query, as in.() — "match nothing" survives');
{
  const calls: string[] = [];
  const fake = {
    in(column: string, values: readonly unknown[]) { calls.push(`${column}:${values.length}`); return fake; },
    gte() { return fake; },
    lte() { return fake; },
  };
  applyFilterToQuery(fake, { countries: [] });
  check('an empty array is passed to .in()', calls.includes('country_iso2:0'), calls.join(' '));

  const none: string[] = [];
  const fake2 = {
    in(column: string) { none.push(column); return fake2; },
    gte() { return fake2; },
    lte() { return fake2; },
  };
  applyFilterToQuery(fake2, {});
  check('an absent array touches the query not at all', none.length === 0, none.join(' '));
}

console.log('\n## a filtered view is shareable — the URL round-trips exactly');
{
  const original: MarketFilter = {
    countries: ['US', 'JP'],
    msciTiers: ['developed'],
    capBands: ['large', 'mid'],
    styles: ['value'],
    minMarketCapUsd: 2e9,
  };
  const round = filterFromParams(filterToParams(original));
  check(
    'round trip is lossless',
    JSON.stringify(round) === JSON.stringify(original),
    `${JSON.stringify(round)} vs ${JSON.stringify(original)}`,
  );

  // The distinction has to survive a reload too, or a shared link means something else.
  const emptyRound = filterFromParams(filterToParams({ countries: [] }));
  check(
    '"match nothing" survives the round trip',
    Array.isArray(emptyRound.countries) && emptyRound.countries.length === 0,
    JSON.stringify(emptyRound),
  );
  const absentRound = filterFromParams(filterToParams({}));
  check('"no opinion" survives the round trip', absentRound.countries === undefined, JSON.stringify(absentRound));

  check('a junk cap bound is dropped, not NaN', filterFromParams({ minMarketCapUsd: 'abc' }).minMarketCapUsd === undefined);
  check('a missing param is undefined', filterFromParams({}).countries === undefined);
}

console.log('\n## the vocabularies match the server');
{
  // These strings are compared against `security_facets.cap_band` and `security_style.style` by
  // equality on the server. A rename on either side silently matches nothing.
  check('cap bands are exactly the SQL case labels', CAP_BANDS.join(',') === 'large,mid,small', CAP_BANDS.join(','));
  // The industry filter must target the STABLE code column. Keyed on `industry` it would be
  // filtering on a yfinance display string, which matches nothing the day that string is renamed.
  {
    const calls: string[] = [];
    const fake = {
      in(column: string) { calls.push(column); return fake; },
      gte() { return fake; }, lte() { return fake; },
    };
    applyFilterToQuery(fake, { industries: ['information-technology--semiconductors'] });
    check('industry filters on industry_code, not the display name',
      calls.includes('industry_code') && !calls.includes('industry'), calls.join(' '));
  }
  check('styles are exactly the SQL labels', STYLES.join(',') === 'growth,blend,value', STYLES.join(','));
  check('EMPTY_FILTER really is empty', isFilterEmpty(EMPTY_FILTER));
}

console.log(failures === 0 ? '\nAll filter checks passed.\n' : `\n${failures} filter check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
