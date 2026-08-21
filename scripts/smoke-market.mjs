// Market data: the sample fallback, the live path, and the timeframe switch.
//
// WHY: three failure modes here are all SILENT.
//   1. A `numeric` column arriving QUOTED. PostgREST v14.12 sends it as a JSON
//      number (measured), so this is a guard rather than a live bug — but if a
//      driver or version ever quoted it, `z.coerce` in `market-client.ts` is the
//      only thing standing between that and `parseArray` dropping every row, with
//      the panel quietly falling back to authored numbers as if the backend were
//      empty. The fixtures below are quoted on purpose to keep that guard honest.
//   2. The fallback must stay BADGED. A real number labelled "sample" and an
//      authored number presented as live are equally wrong, and neither throws.
//   3. Switching the timeframe must actually requery. The period lives in a
//      persisted store, so a wrong key just re-renders the same numbers.
//
//   node scripts/smoke-market.mjs
//
// Serves `dist/` locally and MOCKS Supabase, so it needs no credentials and no
// deployment — run `npx expo export -p web --output-dir dist` first.
import puppeteer from 'puppeteer-core';

import { serveDist } from './lib/serve-dist.mjs';

// A structurally valid unsigned HS256 JWT. supabase-js only needs the anon key to be
// present and parseable to construct a client; every request is intercepted below.
const FAKE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0.smoke';

/**
 * `change_pct` is deliberately QUOTED here even though PostgREST currently sends it
 * unquoted — see assertion 1. Feeding the harder shape keeps `z.coerce` load-bearing.
 */
/** Country rows, keyed by ISO-2 like `market.performance` scope='country'. */
const COUNTRY_ROWS = {
  '1y': [
    ['US', '21.3167'],
    ['JP', '24.3424'],
    ['CA', '29.4888'],
  ],
};

/**
 * `market.instruments` for information-technology, as the refresh leaves it:
 * curated `sector_id`, provider-filled `industry` (the REAL sub-sector) and country.
 * NVDA deliberately has no performance row below, to prove a missing value renders
 * as nothing rather than as its authored +41.3%.
 */
/**
 * `market.fund_sector_weight` for IVV, as production reports it: essentially fully classified
 * (0.29% unclassified), because the S&P 500 IS the universe the 11 US sector SPDRs cover.
 */
const FUND_SECTOR_WEIGHT = [
  { fund_symbol: 'IVV', sector_id: 'information-technology', weight_pct: 32.81, as_of: '2026-03-31' },
  { fund_symbol: 'IVV', sector_id: 'financials', weight_pct: 12.56, as_of: '2026-03-31' },
  { fund_symbol: 'IVV', sector_id: 'communication-services', weight_pct: 10.26, as_of: '2026-03-31' },
  { fund_symbol: 'IVV', sector_id: 'health-care', weight_pct: 9.44, as_of: '2026-03-31' },
  { fund_symbol: 'IVV', sector_id: 'unclassified', weight_pct: 0.29, as_of: '2026-03-31' },
];

/** The guard case: a global fund most of which has no sector. Must NOT be drawn. */
const FUND_SECTOR_WEIGHT_UNCOVERED = [
  { fund_symbol: 'IVV', sector_id: 'information-technology', weight_pct: 26.72, as_of: '2026-03-31' },
  { fund_symbol: 'IVV', sector_id: 'unclassified', weight_pct: 30.39, as_of: '2026-03-31' },
];

/** Filler so the list is longer than one page; paging cannot be tested against 4 rows. */
const FILLER = Array.from({ length: 40 }, (_, i) => ({
  security_id: `ffff0000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: `Filler Holding ${i + 1}`,
  symbol: `FIL${i}`,
  industry: 'Semiconductors',
  country_iso2: 'US',
  weight: 0.5,
  fund_symbol: 'XLK',
  as_of: '2026-03-31',
}));

const SECTOR_CONSTITUENTS = [
  // Heaviest first, as the view orders them. NVDA deliberately has NO performance row below, to
  // prove a missing value renders as nothing rather than as its authored +41.3%.
  { security_id: '11111111-1111-4111-8111-111111111111', name: 'NVIDIA Corp.', symbol: 'NVDA', industry: 'Semiconductors', country_iso2: 'US', weight: 15.5, fund_symbol: 'XLK', as_of: '2026-03-31' },
  { security_id: '22222222-2222-4222-8222-222222222222', name: 'Apple Inc.', symbol: 'AAPL', industry: 'Consumer Electronics', country_iso2: 'US', weight: 13.63, fund_symbol: 'XLK', as_of: '2026-03-31' },
  { security_id: '33333333-3333-4333-8333-333333333333', name: 'SAP SE', symbol: 'SAP', industry: 'Software - Application', country_iso2: 'DE', weight: 1.24, fund_symbol: 'XLK', as_of: '2026-03-31' },
  // No ticker: OpenFIGI resolves the US line, and most non-US listings have none. The row must
  // still render, by name, and must not read "undefined · Tokyo Electron".
  { security_id: '44444444-4444-4444-8444-444444444444', name: 'Tokyo Electron Ltd', symbol: null, country_iso2: 'JP', weight: 0.91, fund_symbol: 'XLK', as_of: '2026-03-31' },
];

const INSTRUMENTS = [
  {
    // `instrument_current` DOES expose `security_id` (verified against production) and the app was
    // not selecting it, so every section keyed on the id was silently dead for the curated 35 —
    // the most-visited pages in the app. The fixture carries it so this stays caught.
    security_id: 'cccc3333-3333-4333-8333-333333333333',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    sector_id: 'information-technology',
    provider_sector: 'Technology',
    industry: 'Consumer Electronics',
    country: 'United States',
    market_cap: 4572794322944,
    // WITHOUT THIS THE MONEY PATH IS NEVER EXERCISED. `formatMoney` and `formatPerShare` both leave
    // a figure UNLABELLED when the currency is absent, which is the correct behaviour and also
    // means a fixture with no currency asserts nothing about labelling — the market-cap check had
    // been failing for exactly that reason.
    currency: 'USD',
    sort_order: 1,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corporation',
    sector_id: 'information-technology',
    provider_sector: 'Technology',
    industry: 'Semiconductors',
    country: 'United States',
    market_cap: 5424535306240,
    sort_order: 2,
  },
  {
    symbol: 'SAP',
    name: 'SAP SE',
    sector_id: 'information-technology',
    provider_sector: 'Technology',
    industry: 'Software - Application',
    country: 'Germany',
    market_cap: 237950763008,
    sort_order: 3,
  },
];

const INSTRUMENT_ROWS = {
  '1y': [
    ['AAPL', '17.7700'],
    ['SAP', '-8.8800'],
    ['BTC', '55.4000'],
  ],
};

/** The multi-asset rows the Markets tab reads (crypto + an UNPRICED cash row). */
const NON_EQUITY = [
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    sector_id: null,
    industry: null,
    country: null,
    asset_type: 'crypto',
    priced: true,
    sort_order: 106,
  },
  {
    symbol: 'USD',
    name: 'US Dollar (cash)',
    sector_id: null,
    industry: null,
    country: 'United States',
    asset_type: 'cash',
    priced: false,
    sort_order: 112,
  },
];

/** Minimal server classification: one scheme, one region group, three members. */
const CLASSIFICATION = {
  classification_schemes: [
    {
      id: 'msci',
      name: 'MSCI',
      blurb: 'Server-provided blurb.',
      lens_region_label: 'Region',
      lens_tier_label: 'Market tier',
      sort_order: 1,
    },
  ],
  classification_groups: [
    {
      scheme_id: 'msci',
      lens: 'region',
      id: 'na',
      name: 'North America',
      short: 'N. America',
      color: '#8B5FBF',
      etf: 'IVV',
      sort_order: 1,
    },
    {
      scheme_id: 'msci',
      lens: 'tier',
      id: 'developed',
      name: 'Developed',
      short: 'Developed',
      color: '#8B5FBF',
      etf: 'URTH',
      sort_order: 1,
    },
  ],
  classification_members: [
    { scheme_id: 'msci', lens: 'region', iso2: 'US', group_id: 'na' },
    { scheme_id: 'msci', lens: 'region', iso2: 'CA', group_id: 'na' },
    { scheme_id: 'msci', lens: 'region', iso2: 'MX', group_id: 'na' },
  ],
};

const rowsFor = (period) => {
  const byPeriod = {
    '1y': [
      ['information-technology', '34.1100'],
      ['energy', '34.1600'],
      ['utilities', '4.9700'],
    ],
    // Values chosen to render UNAMBIGUOUSLY through MoversPanel's `toFixed(1)`
    // and to share no leading digits with the 1y set — otherwise "did the numbers
    // change?" can pass on a substring that never moved.
    '1m': [
      ['information-technology', '11.1100'],
      ['energy', '12.2200'],
      ['utilities', '-13.3300'],
    ],
  };
  const asOf = new Date(Date.now() - 5 * 60_000).toISOString();
  const staleAfter = new Date(Date.now() + 25 * 60_000).toISOString();
  return (byPeriod[period] ?? []).map(([scope_id, change_pct]) => ({
    scope: 'sector',
    scope_id,
    period,
    change_pct,
    as_of: asOf,
    stale_after: staleAfter,
    source: 'finviz',
  }));
};

/** Local `dist/` with a runtime-config that points the app at our mock Supabase. */
const serve = ({ supabase }) => {
  let port;
  return serveDist({
    runtimeConfig: () =>
      supabase
        ? `window.__MUFFIN_CONFIG__=${JSON.stringify({
            supabaseUrl: `http://localhost:${port}/supabase`,
            supabaseAnonKey: FAKE_ANON,
          })};`
        : '/* no supabase configured */',
  }).then((handle) => {
    port = handle.port;
    return handle;
  });
};

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Assert case-insensitively: the design system uppercases labels and badges. */
const has = (body, text) => body.toLowerCase().includes(text.toLowerCase());

async function openPage(browser, port, path, { mockRows, uncoveredWeights = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 1200 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

  // React reports render errors as `pageerror`, NOT console — listen to both, or a
  // broken page reports a clean bill of health.
  //
  // #418 (hydration text mismatch) is PRE-EXISTING and app-wide: root-caused in M28
  // to nginx `try_files` vs Expo's bracket filenames, measured identical on all 18
  // routes by scripts/hydration-check.mjs, and unrelated to market data. Whitelisted
  // here so this script fails on regressions it can actually attribute.
  const errors = [];
  const ignore = (text) => /Minified React error #418/.test(text);
  const record = (text) => {
    if (!ignore(text)) errors.push(text);
  };
  page.on('pageerror', (e) => record(`[pageerror] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && record(`[console] ${m.text()}`));

  const seen = [];
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/supabase/rest/v1/performance')) {
      seen.push(u);
      const period = /period=eq\.([a-z0-9]+)/.exec(u)?.[1] ?? '1y';
      const scope = /scope=eq\.([a-z]+)/.exec(u)?.[1] ?? 'sector';
      // The stock page reads one scope_id across ALL periods; without honouring the
      // filter the mock hands it every instrument's row and the page shows another
      // ticker's number.
      const scopeId = /scope_id=eq\.([A-Z.]+)/.exec(u)?.[1];
      let body = [];
      if (mockRows) {
        const dated = (scopeName, table) =>
          (table[period] ?? []).map(([scope_id, change_pct]) => ({
            scope: scopeName,
            scope_id,
            period,
            change_pct,
            as_of: new Date(Date.now() - 5 * 60_000).toISOString(),
            stale_after: new Date(Date.now() + 25 * 60_000).toISOString(),
            source: 'yfinance',
          }));
        body =
          scope === 'country'
            ? dated('country', COUNTRY_ROWS)
            : scope === 'instrument'
              ? dated('instrument', INSTRUMENT_ROWS)
              : rowsFor(period);
      }
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(scopeId ? body.filter((x) => x.scope_id === scopeId) : body),
      });
    }
    if (u.includes('/threads/search')) {
      seen.push(u);
      const mk = (id, graph, ticker, status) => ({
        thread_id: id,
        created_at: new Date(Date.now() - 3600_000).toISOString(),
        updated_at: new Date().toISOString(),
        status,
        metadata: { graph_id: graph },
        extracted: { ticker },
      });
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(
          mockRows
            ? [
                mk('t-1', 'council', 'AAPL', 'idle'),
                mk('t-2', 'criteria_analysis', 'AAPL', 'idle'),
                mk('t-3', 'council', 'MSFT', 'idle'),
              ]
            : [],
        ),
      });
    }
    // `prices` (the instrument overlay) AND `price_series` (the per-security history migration 94
    // introduced). The app moved to the latter and this stub did not, so the chart silently had no
    // bars — the assertion below said "market.prices was read" and had been failing ever since.
    if (u.includes('/supabase/rest/v1/prices') || u.includes('/supabase/rest/v1/price_series')) {
      seen.push(u);
      // ~280 synthetic daily bars, the shape 08-instrument-prices.sql stores.
      const rows = [];
      const start = new Date('2025-07-07T00:00:00Z').getTime();
      for (let i = 0; i < 280; i++) {
        rows.push({
          date: new Date(start + i * 86400000).toISOString().slice(0, 10),
          close: (100 + Math.sin(i / 12) * 18 + i * 0.08).toFixed(4),
        });
      }
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(mockRows ? rows : []),
      });
    }
    if (u.includes('/supabase/rest/v1/security_current')) {
      seen.push(u);
      // Only answers when a query is present, mirroring the hook's minimum length. The URL is
      // DECODED first: PostgREST percent-encodes the parens of an `or=(...)` filter, so matching
      // the raw string finds nothing and the stub silently returns an empty list.
      const decoded = decodeURIComponent(u);
      // TWO CALLERS SHARE THIS TABLE and only one was stubbed. The search box sends `or=(...)`;
      // the stock page sends a plain `symbol=eq.X` to resolve the security's ID, market cap and
      // currency. Answering only the first left `securityId` undefined, which silently disabled
      // every section keyed on it — the dividends panel simply never asked for its data.
      const bySymbol = /symbol=eq\.([A-Z.]+)/.exec(decoded)?.[1];
      if (mockRows && bySymbol) {
        return r.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify([
            {
              security_id: 'cccc3333-3333-4333-8333-333333333333',
              symbol: bySymbol,
              name: 'Apple Inc.',
              sector_id: 'information-technology',
              industry: 'Consumer Electronics',
              country_name: 'United States',
              country_iso2: 'US',
              market_cap: 3_410_000_000_000,
              currency_code: 'USD',
            },
          ]),
        });
      }
      const q = /or=\(([^)]*)\)/.exec(decoded)?.[1] ?? '';
      const rows = !mockRows || !q ? [] : [
        { security_id: 'aaaa1111-1111-4111-8111-111111111111', name: 'Samsung Electronics Co., Ltd.', symbol: '005930.KS', sector_id: 'information-technology', country_iso2: 'KR' },
        // No symbol: must render, must not be tappable.
        { security_id: 'bbbb2222-2222-4222-8222-222222222222', name: 'Samsung Life Insurance', symbol: null, sector_id: 'financials', country_iso2: 'KR' },
      ];
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    if (u.includes('/supabase/rest/v1/fund_sector_weight')) {
      seen.push(u);
      const rows = uncoveredWeights ? FUND_SECTOR_WEIGHT_UNCOVERED : FUND_SECTOR_WEIGHT;
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(mockRows ? rows : []),
      });
    }
    if (u.includes('/supabase/rest/v1/sector_constituents')) {
      seen.push(u);
      // PostgREST applies `country_iso2=eq.` server-side; the mock must too, or the country-filter
      // assertion below would pass on an unfiltered list.
      const iso = /country_iso2=eq\.([A-Z]{2})/.exec(u)?.[1];
      let body = mockRows ? [...SECTOR_CONSTITUENTS, ...FILLER] : [];
      if (iso) body = body.filter((r) => r.country_iso2 === iso);
      // Honour the page window. supabase-js `.range()` sends a `Range` header, and a stub that
      // ignores it returns the same rows for every page — so "growing the list" never grows and
      // a guard against the list SHRINKING can never fail. Verified by reintroducing the bug.
      const range = /(\d+)-(\d+)/.exec(r.headers()['range'] ?? '');
      if (range) body = body.slice(Number(range[1]), Number(range[2]) + 1);
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    }
    // `instrument_current` is what the app reads; `instruments` is the pre-migration-40 name.
    if (u.includes('/supabase/rest/v1/instrument_current') || u.includes('/supabase/rest/v1/instruments')) {
      seen.push(u);
      // The sector page filters by sector_id; the Markets tab and the stock page
      // read the whole universe.
      const single = /symbol=eq\.([A-Z.]+)/.exec(u)?.[1];
      const all = [...INSTRUMENTS, ...NON_EQUITY];
      // PostgREST applies `country=eq.` server-side; the mock must too, or the
      // country-filter assertion below would pass on an unfiltered list.
      const country = decodeURIComponent(/country=eq\.([^&]+)/.exec(u)?.[1] ?? '');
      let body = !mockRows
        ? []
        : single
          ? all.filter((i) => i.symbol === single)
          : u.includes('sector_id=eq.')
            ? INSTRUMENTS
            : all;
      if (country) body = body.filter((i) => i.country === country);
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
      });
    }
    // Dividends and splits.
    //
    // THE DIVIDEND IS DELIBERATELY SUB-DOLLAR WITH FOUR DECIMALS. `formatMoney` drops decimals
    // below a million, so it renders 1.2087 as "$1" — a fixture using a round number could not
    // tell the market-cap formatter from the per-share one, and that is exactly the swap a future
    // "simplification" would make.
    if (u.includes('/supabase/rest/v1/security_corporate_action')) {
      seen.push(u);
      const rows = !mockRows
        ? []
        : [
            { ex_date: '2022-06-06', kind: 'split', value: 20, source_code: 'tiingo' },
            { ex_date: '2025-05-12', kind: 'dividend', value: 1.2087, source_code: 'tiingo' },
            { ex_date: '2025-02-10', kind: 'dividend', value: 0.24, source_code: 'tiingo' },
          ];
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    // News. The fixture carries a story that is NOT about the company, because that is the real
    // failure mode — yfinance returned a Waymo article under AAPL — and the panel's job is to
    // attribute the association to the provider rather than to muffin.
    if (u.includes('/supabase/rest/v1/security_news')) {
      seen.push(u);
      const rows = !mockRows
        ? []
        : [
            {
              url: 'https://example.com/a',
              title: 'Waymo expands robotaxi service',
              published_at: new Date(Date.now() - 86400000).toISOString(),
              source: 'Simply Wall St.',
              summary: 'A story the provider attached to this symbol.',
            },
          ];
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    // Insider activity. The fixture makes PEOPLE and SHARES DISAGREE — four buyers against one
    // much larger seller — because a panel that reported only the net share balance would say
    // "insiders sold" about a company four of them were buying, and a fixture where both agree
    // could not tell the two presentations apart.
    if (u.includes('/supabase/rest/v1/security_insider_summary')) {
      seen.push(u);
      const rows = !mockRows
        ? []
        : [{ buys: 5, sells: 1, buyers: 4, sellers: 1, net_shares: -46000, trades: 6,
             latest: '2026-08-18' }];
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    // The next earnings date. `upcoming` is served by the VIEW, not inferred here — the fixture
    // pins the tense, because rendering "Reports" above a date that has passed presents history as
    // a forecast and the consensus beside it reads as something still to be beaten.
    if (u.includes('/supabase/rest/v1/security_next_earnings')) {
      seen.push(u);
      const rows = !mockRows
        ? []
        : [{
            report_date: '2026-08-26',
            eps_consensus: 2.01,
            eps_previous: 0.99,
            num_estimates: 11,
            reporting_time: 'after-hours',
            period_ending: '2026-07',
            upcoming: true,
          }];
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    // The company profile. The fixture uses AMAZON'S REAL SHAPE — 1,595,000 employees, a city and
    // NO state or country, which is what yfinance returns for most US securities. A fixture with all
    // three location parts would never catch the naive join that renders "Seattle, , ".
    if (u.includes('/supabase/rest/v1/security_profile')) {
      seen.push(u);
      const rows = !mockRows
        ? []
        : [{
            description: 'Amazon.com, Inc. engages in the retail sale of consumer products.',
            employees: 1595000,
            website: 'https://www.amazon.com',
            hq_city: 'Seattle',
            hq_state: null,
            hq_country: null,
            beta: 1.454,
            as_of: '2026-08-21T00:00:00Z',
          }];
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    // A country's sector returns, WEIGHTED FROM THE FUND THAT ACTUALLY HOLDS THE COUNTRY.
    //
    // The page used to fall back to US sectors for any country without its own rows, labelled "US
    // sector performance" — and a reader opening Vietnam saw eleven familiar sector names with
    // American numbers and read it as a bug. It is one. So the fixture covers BOTH states: rows
    // for the US, nothing for a country with no tracked fund, and the assertions below require an
    // honest gap rather than a labelled substitute.
    if (u.includes('/supabase/rest/v1/country_sector_performance')) {
      seen.push(u);
      const iso = /country_iso2=eq\.([A-Z]{2})/.exec(u)?.[1] ?? '';
      const period = /period=eq\.([a-z0-9]+)/.exec(u)?.[1] ?? '1y';
      // Only the US has a country fund in this fixture; VN deliberately has none.
      const rows = !mockRows || iso !== 'US'
        ? []
        : [
            {
              country_iso2: 'US', sector_id: 'information-technology', period,
              // The period is in the VALUE, so a failure to requery on switching is visible as a
              // number that did not move rather than only as a missing request.
              change_pct: period === '1m' ? 4.2 : 34.1,
              // `weight_covered` is a PERCENT, not a fraction: the hook drops anything under 1, so a
              // fixture using 0.61 is silently filtered out and the panel reads as empty.
              constituents: 61, weight_covered: 61, fund_symbol: 'SPY',
              as_of: '2026-08-20',
            },
            {
              country_iso2: 'US', sector_id: 'financials', period,
              change_pct: period === '1m' ? 1.1 : 12.4,
              constituents: 48, weight_covered: 52, fund_symbol: 'SPY',
              as_of: '2026-08-20',
            },
          ];
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    // The valuation section: ratios computed per price bar.
    //
    // THE FIXTURE MAKES THE TWO CANDIDATE BEHAVIOURS DISAGREE. A withheld ratio (reporting currency
    // != quote currency) is served with `pe_ratio: null` but a POPULATED `net_margin_pct`, because
    // margins are filing-over-filing and need no currency agreement. So a build that ignored the
    // currency gate would chart a P/E here, and one that dropped the whole section on a null P/E
    // would lose the margin too — the mock can tell those apart, which a fixture of all-comparable
    // rows could not.
    if (u.includes('/supabase/rest/v1/security_ratio_series')) {
      seen.push(u);
      const sym = /symbol=eq\.([A-Z.]+)/.exec(u)?.[1] ?? '';
      const metric = /value:([a-z_]+)/.exec(u)?.[1] ?? 'pe_ratio';
      const withheld = sym === 'NVO';
      const priceBased = !['net_margin_pct', 'roe_pct', 'roa_pct'].includes(metric);
      const rows = !mockRows
        ? []
        : Array.from({ length: 24 }, (_, i) => ({
            date: `2025-${String((i % 12) + 1).padStart(2, '0')}-01`,
            close: 300 + i,
            value: withheld && priceBased ? null : 30 + i * 0.5,
            currency_comparable: !withheld,
            report_currency: withheld ? 'DKK' : 'USD',
            quote_currency: 'USD',
          }));
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(rows),
      });
    }
    // Classification tables (schemes / groups / members).
    const table = /\/supabase\/rest\/v1\/(classification_[a-z]+)/.exec(u)?.[1];
    if (table) {
      seen.push(u);
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(mockRows ? (CLASSIFICATION[table] ?? []) : []),
      });
    }
    // Everything else Supabase (auth, functions) resolves as an empty success so
    // nothing hangs and no unhandled rejection reaches the page.
    if (u.includes('/supabase/')) {
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      });
    }
    r.continue().catch(() => {});
  });

  await page.goto(`http://localhost:${port}${path}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  // Persisted zustand rehydrates after mount, so wait for the body to settle rather
  // than sleeping a constant.
  let previous = '';
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 400));
    const body = await page.evaluate(() => document.body.innerText);
    if (body === previous && body.length > 200) break;
    previous = body;
  }
  return { page, body: previous, errors, seen };
}

const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });

try {
  // --- 1. No Supabase configured: the authored fallback, clearly badged ---------
  {
    const { server, port } = await serve({ supabase: false });
    console.log('\nfallback (no Supabase configured)');
    const { page, body, errors } = await openPage(browser, port, '/country/united-states', { mockRows: false });
    // AN HONEST GAP BEATS A LABELLED SUBSTITUTE. With no server rows this page used to show US
    // sectors under a label; 19 of 45 drillable countries have no sector rows, so a reader on
    // Vietnam saw American numbers wearing local sector names. It now says it has nothing.
    check('the empty state names the section', has(body, 'Sectors'));
    check('it says plainly that there is no data', has(body, 'No sector data'));
    check('it explains WHY, not just that', has(body, 'tracked fund'));
    // The substitute must not come back: no foreign numbers presented as this country's.
    check('no authored sector return is shown', !/[+-]\d+\.\d%/.test(body));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
    server.close();
  }

  // --- 2. Supabase serving rows: live numbers, no sample badge ------------------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nlive rows from market.country_sector_performance');
    const { page, body, errors, seen } = await openPage(browser, port, '/country/united-states', { mockRows: true });

    const perfRequests = seen.filter((u) => u.includes('country_sector_performance'));
    check('the country\'s own sector rows were queried', perfRequests.length > 0, `${perfRequests.length} request(s)`);
    check(
      'the query is scoped to this country + a period',
      perfRequests.some((u) => u.includes('country_iso2=eq.US') && /period=eq\./.test(u)),
      // Report the MATCHING request, not seen[0] — `seen` also holds the classification reads, so
      // seen[0] printed a misleading URL here.
      perfRequests[0]?.split('?')[1] ?? '(none)',
    );
    check('the live return renders', has(body, '34.1'), 'expected +34.1%');
    check('the "sample" badge is gone', !has(body, 'sample'));
    // "61%" is unattributable on its own: a reader cannot tell whether it is a share of this
    // country's fund or of something else, so the panel names the fund it weighted from.
    check('the panel names the fund it weighted from', has(body, 'SPY'));
    check('the weighting is stated, not implied', has(body, 'weighted constituents'));

    // --- 3. The timeframe switch requeries ------------------------------------
    const before = seen.length;
    const clicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('[role="button"], div, span')) {
        if (el.textContent?.trim() === '1M' && el.children.length === 0) {
          el.closest('[role="button"]')?.click() ?? el.click();
          return true;
        }
      }
      return false;
    });
    check('the 1M control exists', clicked);
    await new Promise((r) => setTimeout(r, 2500));
    const after = await page.evaluate(() => document.body.innerText);
    check('switching period issued a new query', seen.length > before, `${before} -> ${seen.length}`);
    check('the 1M query was made', seen.some((u) => u.includes('period=eq.1m')));
    // The fixture returns a DIFFERENT value per period (1y 34.1/12.4, 1m 4.2/1.1), so a page that
    // requeried and then rendered the old rows anyway is visible here — a request count alone
    // cannot see that. The 1y figures must be gone ENTIRELY, not merely joined by the new ones.
    check(
      'the displayed numbers changed',
      has(after, '4.2') && has(after, '1.1') && !has(after, '34.1'),
      after.match(/[+-]\d+\.\d%/g)?.join(' ') ?? '(no returns rendered)',
    );
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    if (process.env.SCREENSHOT) {
      await page.screenshot({ path: process.env.SCREENSHOT, fullPage: true });
      console.log(`  screenshot -> ${process.env.SCREENSHOT}`);
    }

    await page.close();
    server.close();
  }

  // --- 4. Group page: server classification + live country growth --------------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\ngroup page (server classification + country performance)');
    const { page, body, errors, seen } = await openPage(
      browser,
      port,
      '/group/na?scheme=msci&lens=region',
      { mockRows: true },
    );

    check(
      'the classification tables were read',
      seen.some((u) => u.includes('classification_schemes')) &&
        seen.some((u) => u.includes('classification_members')),
    );
    // The blurb/name come from the mocked SERVER rows, not the bundle — proof the
    // globe's schemes are no longer hardcoded.
    check('the group renders from server rows', has(body, 'North America'));
    check('country performance was queried', seen.some((u) => u.includes('scope=eq.country')));
    // US 21.3167 -> "+21.3%", CA 29.4888 -> "+29.5%".
    check('live country growth rendered', has(body, '21.3') && has(body, '29.5'));
    // Mexico is a member of the group but has no mocked row: it must show NO
    // number rather than its authored +5.4%.
    check('a country with no server row shows no number', !has(body, '5.4%'));
    check('provenance is shown', has(body, 'yfinance'));
    check('multi-year periods are offered for countries', has(body, '5Y') && has(body, '3Y'));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    if (process.env.SCREENSHOT_GROUP) {
      await page.screenshot({ path: process.env.SCREENSHOT_GROUP, fullPage: true });
      console.log(`  screenshot -> ${process.env.SCREENSHOT_GROUP}`);
    }

    await page.close();
    server.close();
  }

  // --- 5. Sector page: server constituents + REAL sub-sectors ------------------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nsector page (server constituents + real sub-sectors)');
    const { page, body, errors, seen } = await openPage(
      browser,
      port,
      '/sector/information-technology',
      { mockRows: true },
    );

    check(
      'market.sector_constituents was queried',
      seen.some((u) => u.includes('/sector_constituents')),
    );
    check('instrument performance was queried', seen.some((u) => u.includes('scope=eq.instrument')));
    // The list is now fund holdings, not the 35 curated tickers.
    check('fund constituents are listed', has(body, 'NVIDIA') && has(body, 'Tokyo Electron'));
    // The authored sub-sector slugs must NOT come back as a fallback: fund holdings carry no
    // industry, and three invented chips are the fake taxonomy this work removed.
    check('no authored sub-sector slugs', !has(body, 'software saas') && !has(body, 'software-saas'));
    // The chips are back, and REAL — taxonomy level 2, not the authored slugs they replaced.
    check('live sub-sector chips render', has(body, 'Semiconductors') && has(body, 'Consumer Electronics'));
    // Weight in the sector fund replaces market cap as the size signal.
    check('the fund weight renders', has(body, '13.63'));
    // A weight must say WHICH fund it is a share of, or it is unattributable.
    check('the weights name their fund', has(body, 'weights from XLK'));
    // A holding with no resolved US ticker must render by NAME, never as "undefined · ...".
    check('a security with no ticker still renders', has(body, 'Tokyo Electron'));
    check('no row renders an undefined symbol', !has(body, 'undefined ·'));
    // AAPL 17.77 -> "+17.8%", SAP -8.88 -> "-8.9%".
    check('live instrument returns rendered', has(body, '17.8') && has(body, '8.9'));
    // NVDA is a constituent but has NO performance row: it must show no number rather than the
    // authored +41.3%.
    check('a constituent with no performance row shows no number', !has(body, '41.3'));
    check('provenance is shown', has(body, 'yfinance'));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    // The constituents query must carry the sector AND respect a page range.
    const instReq = seen.find((u) => u.includes('/sector_constituents') && u.includes('sector_id=eq.'));
    check('the sector query is paged', !!instReq);

    if (process.env.SCREENSHOT_SECTOR) {
      await page.screenshot({ path: process.env.SCREENSHOT_SECTOR, fullPage: true });
      console.log(`  screenshot -> ${process.env.SCREENSHOT_SECTOR}`);
    }

    await page.close();
    server.close();
  }
  // --- 6c. Search actually finds something ------------------------------------
  // Asserting the box renders proves nothing about whether typing in it works. This types, waits
  // for the debounce, and checks both a resolvable hit and one with no ticker — the row that must
  // render without promising a stock page.
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nmarkets tab (security search)');
    const { page, body: _b, errors } = await openPage(browser, port, '/markets', { mockRows: true });

    const input = await page.$('input[aria-label="Search securities"]');
    check('the search input is reachable', !!input);
    if (input) {
      await input.type('samsung');
      // 250ms debounce plus the query; poll rather than sleep a constant.
      let text = '';
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 250));
        text = await page.evaluate(() => document.body.innerText);
        if (/Samsung Electronics/i.test(text)) break;
      }
      check('a resolvable hit is listed', /005930\.KS/.test(text) && /Samsung Electronics/i.test(text));
      check('a hit with no ticker still renders', /Samsung Life Insurance/i.test(text));
      check('the sector and country show', /information technology/i.test(text) || /South Korea|KR/.test(text));
    }
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
    server.close();
  }
  // --- 6b. The donut REFUSES under-classified data ------------------------------
  // Sector classification comes from the 11 US sector SPDRs, so it covers US large caps and
  // little else: measured in production, IVV is 0.29% unclassified but MSCI World is 30% and
  // developed-ex-US is 100%. Drawing those would silently overstate every sector. This asserts
  // the guard fires rather than trusting that it would.
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nmarkets tab (allocation coverage guard)');
    const { page, body, errors } = await openPage(browser, port, '/markets', {
      mockRows: true,
      uncoveredWeights: true,
    });

    check('an under-classified fund is NOT drawn as fact', !has(body, 'S&P 500'));
    check('it falls back to the sample badge', has(body, 'sample'));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
    server.close();
  }
  // --- 6. Markets tab: the asset universe is server-backed and BADGED ----------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nmarkets tab (asset universe)');
    const { page, body, errors, seen } = await openPage(browser, port, '/markets', { mockRows: true });

    check('the fund allocation was read', seen.some((u) => u.includes('/fund_sector_weight')));
    // The search box exists and does NOT query on an empty field — a blank query would match
    // everything and cost a scan per keystroke.
    check('the search box renders', has(body, 'Find a company'));
    check('no search request without a query', !seen.some((u) => u.includes('security_current')));
    // The refresh control is ADMIN-ONLY and this session is anonymous. Asserted because the
    // server rejects a non-admin token, so a visible button would be a button that always fails.
    check('no refresh control for an anonymous visitor', !has(body, 'refresh'));
    // The donut was an authored map badged SAMPLE. It is now the fund's filed holdings — and it
    // must NAME the index, because one index's allocation under a generic title is the exact
    // conflation this data was meant to remove.
    check('the donut names its index', has(body, 'S&P 500'));
    // 32.81 renormalised over the classified slices (total 65.07) -> 50.4%.
    check('the real allocation is drawn', has(body, '50') || has(body, '32.8'));
    // `instrument_current` since migration 40 made instruments a curated OVERLAY.
    check('the universe was read', seen.some((u) => u.includes('/instrument_current') || u.includes('/instruments')));
    check('a non-equity asset is listed', has(body, 'Bitcoin'));
    check('its live return renders', has(body, '55.4'), 'BTC 55.40 -> +55.4%');
    // This list previously showed ~50 authored values with NO caveat at all.
    check('provenance replaces the missing caveat', has(body, 'yfinance'));
    // `priced = false`: a price return would be meaningless, not merely missing.
    check('an unpriced asset is listed', has(body, 'US Dollar'));
    check('the unpriced asset shows no number', !/US Dollar[^\n]*[+-]\d/.test(body));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
    server.close();
  }

  // --- 7. Stock page: profile + the full performance strip ---------------------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nstock page (profile + performance strip)');
    const { page, body, errors, seen } = await openPage(browser, port, '/stock/AAPL', { mockRows: true });

    check('the instrument was read', seen.some((u) => u.includes('symbol=eq.AAPL')));
    check('its performance was read', seen.some((u) => u.includes('scope_id=eq.AAPL')));
    check('the company name renders', has(body, 'Apple Inc.'));
    // Server data must win over route params — none were passed on this link.
    check('the REAL sub-sector renders', has(body, 'Consumer Electronics'));
    check('the country renders', has(body, 'United States'));
    check('a return renders in the strip', has(body, '17.8'));
    check('market cap is formatted', /\$\d+\.\d{2}[TBM]/.test(body), (body.match(/\$[\d.]+[TBM]/) || [])[0] ?? '');
    check('the agent launchers survive', has(body, 'Investor Council') || has(body, 'Criteria'));

    // --- past runs for this ticker --------------------------------------------
    check('threads were searched', seen.some((u) => u.includes('/threads/search')));
    check('the past-analysis section renders', has(body, 'Past analysis'));
    // Both AAPL runs, and NOT the MSFT one that shares the thread list.
    const councilCount = (body.match(/Investor Council/gi) || []).length;
    check('this ticker\'s runs are listed', councilCount >= 2, `${councilCount} council mentions`);
    check('another ticker\'s run is filtered out', !has(body, 'MSFT'));

    // --- the price chart ------------------------------------------------------
    check('the price series was read', seen.some((u) => u.includes('/prices') || u.includes('/price_series')));
    const svgPaths = await page.evaluate(
      () => document.querySelectorAll('svg polyline, svg path').length,
    );
    check('the chart drew a line', svgPaths > 0, `${svgPaths} svg shapes`);
    check('chart ranges are offered', has(body, '1M') && has(body, '1Y'));

    // --- the valuation section (ratios computed per price bar) ----------------
    // --- insider activity --------------------------------------------------------
    check('the insider summary was read', seen.some((u) => u.includes('security_insider_summary')));
    check('the section renders', has(body, 'Insider activity'));
    // PEOPLE, not transaction counts: four distinct buyers across five trades.
    check('it reports PEOPLE on each side', has(body, '4 people') && has(body, '1 person'));
    // The share balance is signed the other way. Both must be present, or the panel is telling
    // half the story — and it must be labelled by direction, not by a minus sign the reader decodes.
    check('the share balance says its direction', has(body, 'Net sold'));
    check('the share count is humanised', has(body, '46k shares'), (body.match(/[\d.]+k shares/) || [])[0] ?? '');
    // No verdict: selling is often scheduled or for tax, and a bullish/bearish badge would be an
    // interpretation this data does not support.
    check('no buy/sell verdict is offered', !/bullish|bearish/i.test(body));
    check('the caveat is stated', has(body, 'not a signal on its own'));

    // --- the next earnings date ------------------------------------------------
    check('the earnings date was read', seen.some((u) => u.includes('security_next_earnings')));
    check('the section names the tense', has(body, 'Next earnings'));
    check('a past date would not say "Next"', !has(body, 'Last earnings'));
    // Formatted from the STRING's parts. `new Date('2026-08-26')` is UTC midnight, so a reader west
    // of Greenwich sees the 25th — and an earnings date off by one is a different trading day.
    check('the date is not shifted by a timezone', has(body, '26 Aug 2026'), (body.match(/\d+ \w{3} 2026/) || [])[0] ?? '');
    check('the reporting time is de-hyphenated', has(body, 'after hours'));
    // nasdaq sends `not-supplied` for companies that have not said which side of the bell they
    // report on — measured on live rows. It is an absence wearing a value, and rendering
    // "26 Aug 2026 · not supplied" says nothing while looking like it means something.
    check('an unsupplied reporting time is dropped', !/not\s*supplied/i.test(body));
    check('the consensus is shown with its analyst count', has(body, '2.01') && has(body, '11 analysts'));

    // --- the company profile ---------------------------------------------------
    check('the profile was read', seen.some((u) => u.includes('security_profile')));
    check('the About section renders', has(body, 'About'));
    // 1,595,000 reads as noise; "1.6M employees" is the fact about the company.
    check('the headcount is humanised', has(body, '1.6M employees'), (body.match(/[\d.]+M employees/) || [])[0] ?? '');
    check('the raw headcount is NOT shown', !has(body, '1595000') && !has(body, '1,595,000'));
    // Most US securities return a city and no state or country. A naive join renders "Seattle, , ".
    check('an absent state and country are dropped', has(body, 'Seattle') && !/Seattle,\s*,/.test(body));
    // "1.45" means nothing to most readers; the sentence is the fact it encodes.
    check('beta is explained, not just printed', has(body, 'more volatile than the market'));

    check('the ratio series was read', seen.some((u) => u.includes('security_ratio_series')));
    check('the valuation section renders', has(body, 'Valuation'));
    check('the ratio picker is offered', has(body, 'P/E') && has(body, 'ROE'));
    // A ratio reads as a multiple and a yield as a percent — one shared formatter would print
    // "37.5%" for a P/E, which is the units bug this codebase has already shipped twice.
    check('a multiple is formatted as one', /\d+\.\d+x/.test(body), (body.match(/\d+\.\d+x/) || [])[0] ?? '');
    // The current-vs-average line is the reason the section exists: a P/E of 37 says nothing, a
    // P/E of 37 against a 5Y average of 28 is a statement.
    check('current is compared to the average', /avg\s+\d+\.\d+x/i.test(body));

    // --- dividends, splits and news -------------------------------------------
    check('corporate actions were read', seen.some((u) => u.includes('security_corporate_action')));
    check('the dividends section renders', has(body, 'Dividends'));
    // A per-share amount keeps its cents. `formatMoney` would print "$1" here — the market-cap
    // formatter rounds decimals away below a million, which on a dividend is the whole value.
    check('a dividend keeps its cents', has(body, '$1.21'), (body.match(/\$1[.\d]*/) || [])[0] ?? '');
    check('a dividend is not rendered as a market cap', !/\$1\b(?!\.)/.test(body));
    // A split is a RATIO. Through a currency formatter it would read "$20", a plausible share price.
    check('a split renders as a ratio', has(body, '20-for-1'));
    check('a split is not rendered as money', !has(body, '$20'));

    check('news was read', seen.some((u) => u.includes('security_news')));
    check('the news section renders', has(body, 'In the news'));
    check('the headline renders', has(body, 'Waymo'));
    // The association is the provider's, not ours — the panel must not imply we chose it.
    check('the association is attributed to the provider', has(body, 'not selected by muffin'));
    // Switching range must actually reslice: 1M shows ~30 days, 1Y ~365.
    const before = await page.evaluate(() => document.body.innerText);
    const clicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('div, span')) {
        if (el.textContent?.trim() === '1M' && el.children.length === 0) {
          (el.closest('[role="button"]') ?? el).click();
          return true;
        }
      }
      return false;
    });
    check('the 1M range control exists', clicked);
    await new Promise((r) => setTimeout(r, 1200));
    const after = await page.evaluate(() => document.body.innerText);
    check('switching range changes the chart window', after !== before);
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    if (process.env.SCREENSHOT_STOCK) {
      await page.screenshot({ path: process.env.SCREENSHOT_STOCK, fullPage: true });
      console.log(`  screenshot -> ${process.env.SCREENSHOT_STOCK}`);
    }
    await page.close();
    server.close();
  }
  // --- 8. Sector page reached FROM A COUNTRY filters to that country ----------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nsector page via a country (?countryId=germany)');
    const { page, body, errors, seen } = await openPage(
      browser,
      port,
      '/sector/information-technology?countryId=germany',
      { mockRows: true },
    );

    check(
      'the query is filtered by country',
      seen.some((u) => u.includes('/sector_constituents') && u.includes('country_iso2=eq.DE')),
      seen.find((u) => u.includes('/sector_constituents'))?.split('?')[1]?.slice(0, 90) ?? '(none)',
    );
    // SAP is the German name in the fixture; AAPL/NVDA are US and must be gone.
    check('the German name is listed', has(body, 'SAP'));
    check('US names are NOT listed', !has(body, 'Apple Inc.') && !has(body, 'NVIDIA'));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
    server.close();
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
