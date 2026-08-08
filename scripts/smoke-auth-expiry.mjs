// scripts/smoke-auth-expiry.mjs — run: node scripts/smoke-auth-expiry.mjs
// Env (all required): CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET,
//                     SUPABASE_ANON_KEY, MUFFIN_EMAIL, MUFFIN_PASSWORD
// Requires system Chrome + puppeteer-core, and a built `dist/` (npm run build:web).
//
// Proves the fix for "session expires after inactivity and I have to reload":
//
//   1. Sign in for real through the app's own /auth screen.
//   2. Expire the stored access token in place (rewrite `expires_at` to now),
//      which is what an hour of an idle tab does — without waiting an hour.
//   3. Act, and assert the next API request carries a Bearer that is NOT the
//      expired one. That is the whole bug: `defaultHeaders` was a snapshot frozen
//      into a memoized client, so the refreshed token never reached an open screen.
//   4. Then destroy the REFRESH token too, act again, and assert the app says
//      "your session expired" rather than surfacing a raw 401.
//
// Deliberately asserts on the Authorization HEADER, not just on the absence of a
// 401: reads are open to anonymous callers, so a request that quietly dropped its
// credential would still return 200 and look healthy.
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const API = 'https://muffin-api.rafiki.guru';
const SUPABASE = 'https://supabase.rafiki.guru';
const CID = process.env.CF_ACCESS_CLIENT_ID;
const CSEC = process.env.CF_ACCESS_CLIENT_SECRET;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.MUFFIN_EMAIL;
const PASSWORD = process.env.MUFFIN_PASSWORD;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const DIST = new URL('../dist', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2',
};

for (const [name, value] of Object.entries({
  CF_ACCESS_CLIENT_ID: CID, CF_ACCESS_CLIENT_SECRET: CSEC,
  SUPABASE_ANON_KEY: ANON, MUFFIN_EMAIL: EMAIL, MUFFIN_PASSWORD: PASSWORD,
})) {
  if (!value) { console.error(`set ${name}`); process.exit(2); }
}

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Proxy `/api` and `/supabase` upstream with the Access service token attached. */
function proxy(req, res, prefix, upstream) {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    const target = upstream + req.url.slice(prefix.length);
    const transport = target.startsWith('https:') ? https : http;
    const r = transport.request(
      target,
      {
        method: req.method,
        headers: {
          ...req.headers,
          host: new URL(upstream).host,
          'CF-Access-Client-Id': CID,
          'CF-Access-Client-Secret': CSEC,
          'User-Agent': UA,
        },
      },
      (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); },
    );
    r.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    if (body.length) r.write(Buffer.concat(body));
    r.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxy(req, res, '/api', API);
  if (req.url.startsWith('/supabase/')) return proxy(req, res, '/supabase', SUPABASE);
  // Stand in for the nginx-generated file so the app knows accounts are enabled.
  if (req.url.startsWith('/runtime-config.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(`window.__MUFFIN_CONFIG__=${JSON.stringify({ supabaseUrl: '/supabase', supabaseAnonKey: ANON })};`);
    return;
  }
  let p = normalize(join(DIST, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  createReadStream(p).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();

// React reports hydration error #418 as a `pageerror`, NOT a console error — a
// listener on console alone reports a clean bill of health. Listen to both.
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });

/** Authorization headers seen on `/api` requests, in order. */
const apiAuth = [];
page.on('request', (r) => {
  if (r.url().includes('/api/')) apiAuth.push(r.headers()['authorization'] ?? null);
});

/** Wait until the body text stops growing — persisted zustand stores rehydrate
 *  after mount, so a constant sleep catches a half-painted screen. */
async function settle(timeout = 20000) {
  const start = Date.now();
  let last = -1;
  while (Date.now() - start < timeout) {
    const len = await page.evaluate(() => document.body.innerText.length);
    if (len === last && len > 0) return;
    last = len;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** The app never exposes its supabase client, so find the session slot by SHAPE
 *  rather than guessing supabase-js's `sb-<ref>-auth-token` key format. */
const SESSION_SLOT = `(() => {
  for (const k of Object.keys(localStorage)) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      if (v && typeof v.access_token === 'string' && typeof v.refresh_token === 'string') return k;
    } catch {}
  }
  return null;
})()`;

const bodyText = () => page.evaluate(() => document.body.innerText.toLowerCase());

try {
  console.log('\n## sign in\n');
  await page.goto(`${base}/auth`, { waitUntil: 'domcontentloaded' });
  await settle();

  const fields = await page.$$('input');
  if (fields.length < 2) throw new Error(`expected email+password inputs, found ${fields.length}`);
  await fields[0].type(EMAIL);
  await fields[1].type(PASSWORD);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="button"]')].find((b) =>
      /sign in/i.test(b.innerText ?? ''),
    );
    el?.click();
  });
  await settle();

  const key = await page.evaluate(SESSION_SLOT);
  check('a Supabase session was persisted', key != null, key ?? 'no slot found');
  if (!key) throw new Error('sign-in did not produce a session — check MUFFIN_EMAIL / MUFFIN_PASSWORD');

  const stale = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).access_token, key);

  console.log('\n## an expired access token refreshes in place\n');
  // Exactly what an idle hour does, minus the hour.
  await page.evaluate((k) => {
    const v = JSON.parse(localStorage.getItem(k));
    v.expires_at = Math.floor(Date.now() / 1000) - 1;
    localStorage.setItem(k, JSON.stringify(v));
  }, key);

  apiAuth.length = 0;
  await page.goto(`${base}/calls`, { waitUntil: 'domcontentloaded' });
  await settle();

  const bearers = apiAuth.filter(Boolean);
  check('the reopened screen still sent a credential', bearers.length > 0, `${apiAuth.length} /api requests`);
  check(
    'every /api request carried a REFRESHED token, not the expired one',
    bearers.length > 0 && bearers.every((b) => b !== `Bearer ${stale}`),
    `${bearers.filter((b) => b === `Bearer ${stale}`).length} stale of ${bearers.length}`,
  );
  const refreshed = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).access_token, key);
  check('the stored session was rotated', refreshed !== stale);

  // Everything after this point deliberately breaks auth, so the 400 from the
  // rejected refresh token is EXPECTED. Only errors up to here are unexpected.
  const errorsBeforeSabotage = pageErrors.length;

  console.log('\n## a dead refresh token says so, in words\n');
  await page.evaluate((k) => {
    const v = JSON.parse(localStorage.getItem(k));
    v.expires_at = Math.floor(Date.now() / 1000) - 1;
    v.refresh_token = 'definitely-not-a-valid-refresh-token';
    localStorage.setItem(k, JSON.stringify(v));
  }, key);

  await page.goto(`${base}/agents/council`, { waitUntil: 'domcontentloaded' });
  await settle();
  // Case-insensitive: the design system uppercases labels in RN styles.
  const text = await bodyText();
  check('the run screen explains the expiry', text.includes('session expired'), text.slice(0, 160));
  check('it offers a way back in', text.includes('sign in'));

  console.log('\n## no console/page errors\n');
  // React #418 is pre-existing on this app and is not what this smoke is about; and
  // errors after the sabotage above are the point of the test, not a regression.
  const unexpected = pageErrors
    .slice(0, errorsBeforeSabotage)
    .filter((e) => !/418|Minified React error #418/.test(e));
  check('no unexpected page errors', unexpected.length === 0, unexpected.slice(0, 3).join(' | '));
} catch (err) {
  failures += 1;
  console.error('\nTHREW:', err);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
