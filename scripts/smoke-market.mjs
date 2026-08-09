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
const INSTRUMENTS = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    sector_id: 'information-technology',
    provider_sector: 'Technology',
    industry: 'Consumer Electronics',
    country: 'United States',
    market_cap: 4572794322944,
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

async function openPage(browser, port, path, { mockRows }) {
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
    if (u.includes('/supabase/rest/v1/instruments')) {
      seen.push(u);
      // The sector page filters by sector_id; the Markets tab and the stock page
      // read the whole universe.
      const single = /symbol=eq\.([A-Z.]+)/.exec(u)?.[1];
      const all = [...INSTRUMENTS, ...NON_EQUITY];
      const body = !mockRows
        ? []
        : single
          ? all.filter((i) => i.symbol === single)
          : u.includes('sector_id=eq.')
            ? INSTRUMENTS
            : all;
      return r.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(body),
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
    check('the sector panel still renders', has(body, 'Sector performance'));
    check('a sector name is shown', has(body, 'Information Technology'));
    check('the numbers are badged "sample"', has(body, 'sample'));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await page.close();
    server.close();
  }

  // --- 2. Supabase serving rows: live numbers, no sample badge ------------------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nlive rows from market.performance');
    const { page, body, errors, seen } = await openPage(browser, port, '/country/united-states', { mockRows: true });

    const perfRequests = seen.filter((u) => u.includes('/performance'));
    check('market.performance was queried', perfRequests.length > 0, `${perfRequests.length} request(s)`);
    check(
      'the query is scoped to sector + a period',
      perfRequests.some((u) => u.includes('scope=eq.sector') && /period=eq\./.test(u)),
      // Report the matching request, not seen[0] — `seen` also holds the
      // classification reads, so seen[0] printed a misleading URL here.
      perfRequests[0]?.split('?')[1] ?? '(none)',
    );
    // Fed as the string "34.1100": without z.coerce this row would vanish and the
    // panel would silently show 18.9 (the authored Information Technology value).
    check('a quoted numeric still rendered', has(body, '34.1'), 'expected +34.1%');
    check('the authored value is NOT shown', !has(body, '18.9%'));
    check('the "sample" badge is gone', !has(body, 'sample'));
    check('provenance is shown instead', has(body, 'finviz'));

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
    // 11.11 -> "+11.1%", 12.22 -> "+12.2%": the 1y figures must be gone entirely.
    check(
      'the displayed numbers changed',
      has(after, '11.1') && has(after, '12.2') && !has(after, '34.1'),
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

    check('market.instruments was queried', seen.some((u) => u.includes('/instruments')));
    check('instrument performance was queried', seen.some((u) => u.includes('scope=eq.instrument')));
    // The provider's real industries replace the authored slugs.
    check('real sub-sectors are shown', has(body, 'Consumer Electronics') && has(body, 'Semiconductors'));
    check('the authored slugs are gone', !has(body, 'software-saas') && !has(body, 'software saas'));
    check('the country/industry subtitle renders', has(body, 'Germany'));
    // AAPL 17.77 -> "+17.8%", SAP -8.88 -> "-8.9%".
    check('live instrument returns rendered', has(body, '17.8') && has(body, '8.9'));
    // NVDA has an instruments row but NO performance row: it must show no number
    // rather than the authored +41.3%.
    check('an instrument with no performance row shows no number', !has(body, '41.3'));
    check('provenance is shown', has(body, 'yfinance'));
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    if (process.env.SCREENSHOT_SECTOR) {
      await page.screenshot({ path: process.env.SCREENSHOT_SECTOR, fullPage: true });
      console.log(`  screenshot -> ${process.env.SCREENSHOT_SECTOR}`);
    }

    await page.close();
    server.close();
  }
  // --- 6. Markets tab: the asset universe is server-backed and BADGED ----------
  {
    const { server, port } = await serve({ supabase: true });
    console.log('\nmarkets tab (asset universe)');
    const { page, body, errors, seen } = await openPage(browser, port, '/markets', { mockRows: true });

    check('the universe was read', seen.some((u) => u.includes('/instruments')));
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
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));

    if (process.env.SCREENSHOT_STOCK) {
      await page.screenshot({ path: process.env.SCREENSHOT_STOCK, fullPage: true });
      console.log(`  screenshot -> ${process.env.SCREENSHOT_STOCK}`);
    }
    await page.close();
    server.close();
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
