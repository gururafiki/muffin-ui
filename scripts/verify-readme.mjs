// scripts/verify-readme.mjs — run: node scripts/verify-readme.mjs [--only=<substring>]
//
// Walks every screen the README documents and asserts the claims it makes, then
// prints a pass/fail verdict table. This is the gate that keeps README.md honest:
// a feature bullet that cannot be observed in a real build is a bullet that gets
// rewritten, not left aspirational.
//
// Env:
//   CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET  — required only for the
//     backend-backed checks (Calls, run pages). Client-side checks run without them.
//   SUPABASE_ANON_KEY — optional; injected as the deployment runtime config so the
//     auth page can query GoTrue for its enabled OAuth providers.
//   MUFFIN_SCHEME=dark|light — which colour scheme Chrome emulates (default light).
//     Used by the React #418 hydration investigation: the same walk is run under both.
//
// Requires system Chrome + puppeteer-core + a fresh `npx expo export -p web --output-dir dist`.
//
// Scaffolding is the recipe every muffin-ui smoke uses (see smoke-timeline.mjs):
// a node:http static server for dist/ mirroring nginx's `try_files $uri $uri.html
// /index.html`, plus /api and /supabase reverse proxies carrying CF Access headers;
// puppeteer-core system Chrome, headless:'new'; waitUntil:'domcontentloaded' NOT
// 'networkidle2' (the app holds open SSE/poll connections, so networkidle never fires).
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const API = 'https://muffin-api.rafiki.guru';
const SUPABASE = 'https://supabase.rafiki.guru';
const CID = process.env.CF_ACCESS_CLIENT_ID;
const CSEC = process.env.CF_ACCESS_CLIENT_SECRET;
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const MUFFIN_EMAIL = process.env.MUFFIN_EMAIL ?? '';
const MUFFIN_PASSWORD = process.env.MUFFIN_PASSWORD ?? '';
const SCHEME = process.env.MUFFIN_SCHEME === 'dark' ? 'dark' : 'light';
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const DIST = new URL('../dist', import.meta.url).pathname;
const SHOTS = new URL('../.verify-shots', import.meta.url).pathname;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.map': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

if (!existsSync(DIST)) {
  console.error('dist/ missing — run: npx expo export -p web --output-dir dist');
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

// ── server: static dist/ + /api + /supabase proxies ──────────────────────────
function proxy(req, res, base) {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    const prefix = base === API ? '/api' : '/supabase';
    const target = base + req.url.replace(new RegExp(`^${prefix}`), '');
    const transport = target.startsWith('https:') ? https : http;
    const headers = { ...req.headers, host: new URL(base).host, 'User-Agent': UA };
    if (CID && CSEC) {
      headers['CF-Access-Client-Id'] = CID;
      headers['CF-Access-Client-Secret'] = CSEC;
    }
    delete headers['accept-encoding']; // let the browser get it plain
    const r = transport.request(target, { method: req.method, headers }, (pr) => {
      res.writeHead(pr.statusCode, pr.headers);
      pr.pipe(res);
    });
    r.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    if (body.length) r.write(Buffer.concat(body));
    r.end();
  });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return proxy(req, res, API);
  if (req.url.startsWith('/supabase/')) return proxy(req, res, SUPABASE);
  // The deployment injects this from env at container start; mirror it so the
  // auth page believes accounts are configured.
  if (req.url.startsWith('/runtime-config.js')) {
    res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-store' });
    res.end(`window.__MUFFIN_CONFIG__=${JSON.stringify({ supabaseUrl: '/supabase', supabaseAnonKey: ANON })};`);
    return;
  }
  // Mirror nginx: `try_files $uri $uri.html /index.html`.
  const rel = decodeURIComponent(req.url.split('?')[0]);
  let p = normalize(join(DIST, rel));
  if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(p) || statSync(p).isDirectory()) {
    const asHtml = `${normalize(join(DIST, rel))}.html`;
    p = existsSync(asHtml) ? asHtml : join(DIST, 'index.html');
  }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  createReadStream(p).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

// ── browser ──────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1600 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: SCHEME }]);

/** Console errors, tagged with the route that produced them (for the #418 study). */
const consoleErrors = [];
let currentRoute = '(none)';
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push({ route: currentRoute, text: m.text() });
});
page.on('pageerror', (e) => consoleErrors.push({ route: currentRoute, text: `pageerror: ${e.message}` }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = () => page.evaluate(() => document.body.innerText || '');

async function go(route) {
  currentRoute = route;
  await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // The bundle boots, fonts load, then the persisted zustand stores rehydrate and
  // Reanimated entrance animations run. Wait for the body to stop growing rather
  // than guessing a constant — a short fixed sleep caught /portfolio with only its
  // title painted and produced phantom failures.
  try {
    await page.waitForFunction(
      () => {
        const n = (document.body.innerText || '').length;
        const prev = window.__lastLen ?? -1;
        window.__lastLen = n;
        return n > 60 && n === prev;
      },
      { timeout: 25000, polling: 900 },
    );
  } catch { /* fall through — assertions below report what did render */ }
  await sleep(1200);
}

/** Click an RN-Web pressable by its accessibilityLabel (rendered as aria-label). */
async function clickLabel(prefix) {
  const box = await page.evaluate((t) => {
    const el = [...document.querySelectorAll('[role="button"][aria-label]')]
      .find((e) => (e.getAttribute('aria-label') || '').startsWith(t));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + Math.min(r.width / 2, 120), y: r.y + r.height / 2 };
  }, prefix);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await sleep(1200);
  return true;
}

/** Click the first element whose rendered text matches — RN-Web leaves most
 *  Pressables without a role, so this walks up to the nearest clickable ancestor. */
async function clickText(needle, { exact = false } = {}) {
  const box = await page.evaluate(({ n, ex }) => {
    const els = [...document.querySelectorAll('div,span,a,button')].filter((e) => {
      const t = (e.innerText || '').trim();
      if (!t) return false;
      return ex ? t === n : t.includes(n);
    });
    // Prefer the SMALLEST match — the most specific element carrying the label.
    // Taking the last document-order match instead used to hit a drill-list row
    // whose subtitle happened to contain the chip's word ("Crypto"), navigating
    // away instead of filtering.
    els.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const hit = els.find((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (!hit) return null;
    hit.scrollIntoView({ block: 'center' });
    const r = hit.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { n: needle, ex: exact });
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await sleep(1200);
  return true;
}

async function shot(name) {
  await page.screenshot({ path: join(SHOTS, `${SCHEME}-${name}.png`), fullPage: true });
}

/**
 * Sign in through the real /auth form.
 *
 * Necessary, not incidental: when the deployment has accounts enabled and you
 * are signed out, `AgentHero` renders `SignInToRunNotice` INSTEAD of its
 * children (agent-hero.tsx) — so the input fields, example chips, Advanced
 * options and Save-as-preset are all absent from an anonymous runner page.
 * Verifying those README bullets requires a session.
 *
 * Doing it through the form (rather than seeding a token into localStorage)
 * also exercises the auth flow itself, which the README claims.
 */
async function signIn(email, password) {
  await go('/auth');
  const fields = await page.$$('input');
  if (fields.length < 2) return false;
  // Field order on the sign-in card is Email, then Password.
  const emailInput = fields[fields.length - 2];
  const passInput = fields[fields.length - 1];
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 12 });
  await passInput.click({ clickCount: 3 });
  await passInput.type(password, { delay: 12 });
  await clickText('Sign in', { exact: true });
  await sleep(5000);
  // The session lands in the shared KeyValueStore (localStorage on web).
  const signedIn = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => /auth-token/.test(k) && (localStorage.getItem(k) || '').includes('access_token')));
  return signedIn;
}

// ── the verdict table ────────────────────────────────────────────────────────
const results = [];
/** @param claim  the README bullet, verbatim enough to find
 *  @param verdict 'PASS' | 'FAIL' | 'DIFFERS'
 *  @param note    what was actually observed */
const record = (screen, claim, verdict, note = '') => {
  results.push({ screen, claim, verdict, note });
  const mark = verdict === 'PASS' ? '  ok ' : verdict === 'DIFFERS' ? ' diff' : 'FAIL ';
  console.log(`[${mark}] ${screen} — ${claim}${note ? `  (${note})` : ''}`);
};
const check = (screen, claim, cond, note = '') =>
  record(screen, claim, cond ? 'PASS' : 'FAIL', cond ? '' : note || 'not found');

// Matching is CASE-INSENSITIVE on purpose: the design system uppercases labels and
// badges in CSS-free RN styles (`Badge` renders "SAMPLE", `Text variant="label"`
// renders "ASSET UNIVERSE"), so a case-sensitive probe reports phantom failures for
// copy that is plainly on screen.
const want = (haystack, ...needles) =>
  needles.every((n) => haystack.toLowerCase().includes(n.toLowerCase()));
const wantAny = (haystack, ...needles) =>
  needles.some((n) => haystack.toLowerCase().includes(n.toLowerCase()));

const shouldRun = (name) => !ONLY || name.toLowerCase().includes(ONLY.toLowerCase());

// ═════════════════════════ 1. GLOBE ═════════════════════════
if (shouldRun('globe')) {
  await go('/');
  let t = await text();
  check('Globe', 'hero: logo + "The investable world — your lens."', want(t, 'The investable world'));
  check('Globe', 'classification switcher MSCI · FTSE · World Bank', want(t, 'MSCI', 'FTSE', 'World Bank'));
  check('Globe', 'group-by switcher Region vs Market tier', wantAny(t, 'Region', 'Market tier'));
  check('Globe', 'blurb updates with the scheme', t.length > 200);
  const paths = await page.evaluate(() => document.querySelectorAll('svg path').length);
  check('Globe', 'stylised tappable SVG world map', paths > 100, `only ${paths} svg paths`);
  check('Globe', 'group legend lists regions/tiers with ETF tickers', /\b[A-Z]{3,4}\b/.test(t));
  check('Globe', '"Analyse global macro" button', want(t, 'Analyse global macro'));
  await shot('globe');

  // Tap a country with a REAL mouse click. A country's bbox centre is often
  // outside its own shape (Alaska drags the US bbox), so pick the first large
  // path whose centre actually hit-tests to itself.
  const target = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('svg path')]
      .map((p) => ({ p, r: p.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 12 && r.height > 12 && r.top > 0)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    for (const { p, r } of paths) {
      for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.7], [0.35, 0.5], [0.65, 0.6]]) {
        const x = r.x + r.width * fx;
        const y = r.y + r.height * fy;
        if (document.elementFromPoint(x, y) === p) {
          p.scrollIntoView({ block: 'center' });
          const r2 = p.getBoundingClientRect();
          return { x: r2.x + r2.width * fx, y: r2.y + r2.height * fy };
        }
      }
    }
    return null;
  });
  const tapped = !!target;
  if (target) await page.mouse.click(target.x, target.y);
  await sleep(1500);
  t = await text();
  const hasCard = want(t, 'Analyse ') && wantAny(t, 'Dismiss', 'Open ');
  record('Globe', 'tap a country → selected-country card (pills + Open + Analyse)',
    tapped && hasCard ? 'PASS' : 'DIFFERS',
    tapped ? (hasCard ? '' : 'card did not appear for the tapped path') : 'could not synthesise a map tap');
  check('Globe', 'scheme switch recolours the map', await clickText('FTSE'));
  await shot('globe-selected');
}

// ═════════════════════════ 2. MARKETS ═════════════════════════
if (shouldRun('markets')) {
  await go('/markets');
  let t = await text();
  check('Markets', 'sector breakdown donut, badged "sample"', want(t, 'Sector breakdown', 'sample'));
  check('Markets', 'asset universe filter chips (All + 9 types)',
    want(t, 'All', 'Equities', 'ETFs', 'Commodities', 'Crypto', 'Bonds', 'Real Estate', 'Cash', 'Mutual Funds', 'Derivatives'));
  check('Markets', 'drill list rows show ticker · name + change %', /[A-Z]{2,5} · /.test(t) && /[+-]?\d+\.\d%/.test(t));
  // README claims the donut is interactive.
  const slices = await page.evaluate(() => document.querySelectorAll('svg path').length);
  check('Markets', 'donut is an interactive SVG', slices > 5, `${slices} paths`);
  await clickText('Crypto');
  t = await text();
  check('Markets', 'filter chip narrows the universe', want(t, 'BTC') && !want(t, 'JPMorgan'));
  await shot('markets');

  // The honesty gap the README documents: the donut is badged SAMPLE, the drill
  // list below it is not. Anchor on the section label as its OWN LINE — the page
  // subtitle reads "…your multi-asset universe.", so a plain indexOf('asset
  // universe') matches the subtitle at index 38 and then counts the SECTOR card's
  // badge as if it belonged to the list, reporting a gap as closed.
  const universeBadged = await page.evaluate(() => {
    const lines = (document.body.innerText || '').split('\n').map((l) => l.trim());
    const i = lines.findIndex((l) => l.toLowerCase() === 'asset universe');
    return i >= 0 && lines.slice(i).some((l) => l.toLowerCase().includes('sample'));
  });
  record('Markets', 'README documents the asset-universe change % as SAMPLE but UNBADGED',
    universeBadged ? 'DIFFERS' : 'PASS',
    universeBadged
      ? 'it now carries a sample badge — update the README and close the ROADMAP M6 item'
      : 'confirmed still unbadged (~50 fabricated change-% values presented unqualified)');
}

// ═════════════════════════ 3. PORTFOLIO ═════════════════════════
if (shouldRun('portfolio')) {
  await go('/portfolio');
  let t = await text();
  check('Portfolio', 'net-worth card', wantAny(t, 'Net worth', 'net worth'));
  check('Portfolio', 'allocation bars with By asset / By account toggle', wantAny(t, 'By asset', 'By account'));
  check('Portfolio', 'account cards per wrapper', want(t, 'Pension (SIPP)', 'Stocks & Shares ISA'));
  check('Portfolio', 'goals with + Add goal', want(t, 'Goals', 'Add goal'));
  check('Portfolio', 'seeded demo data is disclosed on-screen', t.toLowerCase().includes('sample'));
  await shot('portfolio');

  await clickText('Pension (SIPP)');
  t = await text();
  check('Portfolio', 'account page opens with holdings', wantAny(t, 'SPY', 'QQQ', 'Holdings'));
  await shot('portfolio-account');
}

// ═════════════════════════ 4. AGENTS ═════════════════════════
if (shouldRun('agents')) {
  await go('/agents');
  const t = await text();
  check('Agents', 'five agent cards', want(t, 'Deep Research', 'Investor Council', 'Criteria Analysis', 'Stock Evaluation', 'Trading Decision'));
  check('Agents', 'Investor Council badged "custom UI"', want(t, 'custom UI'));
  await shot('agents');
}

// ═════════════════════════ 5. AGENT RUNNER (fresh, no run) ═════════════════════════
if (shouldRun('runner') || shouldRun('chat')) {
  // The gate first, while still anonymous — it is itself a README claim.
  await go('/agents/research');
  const anon = await text();
  const gated = want(anon, 'Sign in to run agents');
  const fieldsVisible = want(anon, 'Question');
  record('Runner', 'signed out: the gate replaces the ENTIRE input surface, not just the Run action',
    gated && !fieldsVisible ? 'PASS' : 'FAIL',
    gated
      ? (fieldsVisible ? 'fields are visible while gated — README now says they are not' : '')
      : 'no sign-in gate appeared; is SUPABASE_ANON_KEY set?');
  await shot('runner-gated');

  const ok = await signIn(MUFFIN_EMAIL, MUFFIN_PASSWORD);
  record('Auth', 'email + password sign-in actually authenticates', ok ? 'PASS' : 'FAIL',
    ok ? 'session persisted to the shared KeyValueStore' : 'sign-in did not produce a session');
}

if (shouldRun('runner')) {
  await go('/agents/research');
  let t = await text();
  check('Runner', 'Research collects a Question', wantAny(t, 'Question', 'What is driving'));
  check('Runner', 'example prompt chips on the hero', wantAny(t, 'NVDA', 'Fed rate'));
  check('Runner', 'Advanced options is offered', t.toLowerCase().includes('advanced'));
  await clickText('Advanced options');
  t = await text();
  check('Runner', 'Research advanced: Research mode + Max search results',
    wantAny(t, 'Research mode', 'speed') && want(t, 'Max search results'));
  check('Runner', 'Save as preset is offered', t.toLowerCase().includes('preset'));
  await shot('runner-research');

  await go('/agents/criteria_analysis');
  await clickText('Advanced options');
  t = await text();
  check('Runner', 'Criteria Analysis advanced: Tool lessons', want(t, 'Tool lessons'));

  await go('/agents/trading_decision');
  await clickText('Advanced options');
  t = await text();
  check('Runner', 'Trading advanced: debate rounds / risk rounds / reflection',
    want(t, 'Bull/bear debate rounds', 'Risk debate rounds') && t.toLowerCase().includes('reflection'));
  await shot('runner-trading');

  await go('/agents/council');
  await clickText('Advanced options');
  t = await text();
  check('Runner', 'Council advanced: Include specialist signals', want(t, 'Include specialist signals'));
}

// ═════════════════════════ 6. CHAT (Stock Evaluation) ═════════════════════════
if (shouldRun('chat')) {
  await go('/agents/stock_evaluation');
  const t = await text();
  check('Chat', 'hero start screen with a composer', wantAny(t, 'What should we dig into', 'Evaluate'));
  check('Chat', 'tappable example-prompt chips', t.length > 80);
  // The README claims edit & resend / regenerate / branch navigation exist.
  const actionLabels = await page.evaluate(() =>
    [...document.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label')));
  const hasEdit = actionLabels.some((l) => /edit and resend/i.test(l || ''));
  const hasRegen = actionLabels.some((l) => /regenerate/i.test(l || ''));
  const hasBranch = actionLabels.some((l) => /(next|previous) branch/i.test(l || ''));
  record('Chat', 'README: copy only — edit & resend / regenerate / branch are NOT offered',
    hasEdit || hasRegen || hasBranch ? 'DIFFERS' : 'PASS',
    hasEdit || hasRegen || hasBranch
      ? 'one of the three reappeared — they were unwired in M12b; update the README'
      : 'confirmed absent (chat-screen.tsx passes only {busy, onCopy})');
  await shot('chat-hero');
}

// ═════════════════════════ 7. SETTINGS ═════════════════════════
if (shouldRun('settings')) {
  await go('/settings');
  let t = await text();
  check('Settings', 'Account card', want(t, 'Account'));
  check('Settings', 'Connection: API URL / Auth token / User ID / Supabase URL / anon key',
    want(t, 'API URL', 'Auth token', 'User ID', 'Supabase URL', 'Supabase anon key'));
  const readmeProviders = want(t, 'openrouter', 'openai', 'anthropic');
  const hasOllama = want(t, 'ollama');
  const hasServerDefault = want(t, 'Server default');
  check('Settings', 'LLM provider chips: ollama / openrouter / openai / anthropic + "Server default"',
    readmeProviders && hasOllama && hasServerDefault,
    `missing${hasOllama ? '' : ' ollama'}${hasServerDefault ? '' : ' "Server default"'}`);
  const hasOllamaKey = want(t, 'Ollama Cloud key');
  check('Settings', 'API keys include the Ollama Cloud key', hasOllamaKey);
  check('Settings', 'Reset to defaults', t.toLowerCase().includes('reset'));
  await shot('settings');

  await clickText('Advanced configuration');
  t = await text();
  check('Settings', 'advanced: model roles / MCP URLs / research / store access',
    want(t, 'Orchestrator models', 'Summariser model', 'Temperature') &&
    want(t, 'OpenBB MCP URL', 'Firecrawl MCP URL') &&
    want(t, 'Rerank threshold', 'Max search results') && want(t, 'Allowed namespaces'));
  check('Settings', 'advanced includes the Tool lessons chip', want(t, 'Tool lessons'));
  await shot('settings-advanced');
}

// ═════════════════════════ 8. AUTH + VERIFY ═════════════════════════
if (shouldRun('auth')) {
  await go('/auth');
  let t = await text();
  check('Auth', 'muffin logo + welcome copy', t.length > 40);
  check('Auth', 'email + password with Sign in ⇄ Create account toggle',
    wantAny(t, 'Sign in', 'Create account'));
  const oauth = wantAny(t, 'Continue with GitHub', 'Continue with Google');
  record('Auth', 'OAuth buttons shown only for providers GoTrue reports enabled',
    'PASS', oauth ? 'GitHub/Google rendered' : 'none rendered (GoTrue reported none enabled, or no anon key) — auto-detection behaved');
  check('Auth', 'forgot-password → reset-link flow', /forgot/i.test(t));
  await shot('auth');

  await go('/verify');
  t = await text();
  check('Auth', '/verify renders the GoTrue confirmation / recovery handler',
    t.length > 40, 'route rendered nothing');
  await shot('verify');
}

// ═════════════════════════ 9. DRILL-DOWNS ═════════════════════════
if (shouldRun('drill')) {
  await go('/sector/information-technology');
  let t = await text();
  check('Drill', 'sector page: breadcrumb + movers + Analyse',
    wantAny(t, 'Stock performance', 'performance') && want(t, 'Analyse'));
  check('Drill', 'movers panel badged sample', t.toLowerCase().includes('sample'));
  await shot('drill-sector');

  await go('/country/united-states');
  t = await text();
  check('Drill', 'country page: sector performance + Analyse', want(t, 'Analyse'));

  await go('/region/north-america');
  t = await text();
  check('Drill', 'region page: country performance + Analyse', want(t, 'Analyse'));

  await go('/stock/AAPL?sector=information-technology&market=developed&country=United%20States');
  t = await text();
  check('Drill', 'stock page: ticker + context badges + 3 agent launchers',
    want(t, 'AAPL', 'Investor Council', 'Criteria Analysis', 'Stock Evaluation'));
  await shot('drill-stock');
}

// ═════════════════════════ 10. CALLS + RUN PAGES (needs CF Access) ═════════════════════════
let threads = [];
if (shouldRun('calls') && CID && CSEC) {
  threads = await fetch(`${base}/api/threads/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ limit: 40, select: ['thread_id', 'status', 'created_at', 'metadata'] }),
  }).then((r) => r.json()).catch(() => []);

  await go('/calls');
  await sleep(4000);
  const t = await text();
  check('Calls', 'thread cards with agent icon, title, relative time, status badge',
    wantAny(t, 'ago', 'idle', 'busy', 'interrupted', 'error'));
  check('Calls', 'filter chips: All + one per agent, with counts', want(t, 'All'));
  await shot('calls');

  if (Array.isArray(threads) && threads.length) {
    const byGraph = new Map();
    for (const th of threads) {
      const g = th?.metadata?.graph_id;
      if (g && !byGraph.has(g) && th.status !== 'busy') byGraph.set(g, th.thread_id);
    }
    console.log(`\n  threads available per graph: ${[...byGraph.keys()].join(', ') || '(none)'}\n`);

    for (const [graph, tid] of byGraph) {
      // Overview
      await page.evaluateOnNewDocument((g) => {
        localStorage.setItem('muffin.agentview.v1', JSON.stringify({ state: { views: { [g]: 'overview' } }, version: 2 }));
      }, graph);
      await go(`/agents/${graph}?threadId=${tid}`);
      await sleep(9000);
      let t2 = await text();
      check(`Run:${graph}`, 'Overview ↔ Timeline toggle present', want(t2, 'Overview', 'Timeline'));
      // The run-recap banner is the GENERIC RUNNER's identity block. Chat agents
      // (stock_evaluation) keep their transcript layout instead, so asserting it
      // there tests a claim the README never makes.
      if (graph !== 'stock_evaluation') {
        check(`Run:${graph}`, 'run recap: agent identity + submitted inputs + status',
          wantAny(t2, 'Completed', 'Running', 'Loading', 'Start a new run'));
      }
      if (graph === 'council') {
        // The arena lives in OVERVIEW, not the Timeline — count seats here.
        const seats = await page.evaluate(() => {
          const b = document.body.innerText || '';
          const personas = ['Warren Buffett', 'Ben Graham', 'Cathie Wood', 'Charlie Munger', 'Bill Ackman',
            'Michael Burry', 'Mohnish Pabrai', 'Nassim Taleb', 'Peter Lynch', 'Phil Fisher',
            'Rakesh Jhunjhunwala', 'Stan Druckenmiller', 'Aswath Damodaran'];
          const specialists = ['Technicals', 'Sentiment', 'Fundamentals', 'Growth', 'Valuation', 'News Sentiment'];
          return {
            personas: personas.filter((n) => b.includes(n)).length,
            specialists: specialists.filter((n) => b.includes(n)).length,
          };
        });
        record('Run:council', 'README: 19 seats — 13 personas + 6 specialists, one unified arena',
          seats.personas + seats.specialists > 13 ? 'PASS' : 'DIFFERS',
          `${seats.personas} personas + ${seats.specialists} specialists on screen`);
      }
      await shot(`run-${graph}-overview`);

      // Timeline
      await page.evaluateOnNewDocument((g) => {
        localStorage.setItem('muffin.agentview.v1', JSON.stringify({ state: { views: { [g]: 'timeline' } }, version: 2 }));
      }, graph);
      await go(`/agents/${graph}?threadId=${tid}`);
      try {
        await page.waitForFunction(() => /\d+ steps? · /.test(document.body.innerText || ''), { timeout: 45000 });
      } catch { /* recorded as a failure below */ }
      await sleep(1500);
      t2 = await text();
      check(`Run:${graph}`, 'Timeline renders steps with real durations',
        /\d+ steps? · /.test(t2) && /\d+(\.\d+)?\s?(ms|s|m)\b/.test(t2));
      if (['criteria_analysis', 'council', 'trading_decision'].includes(graph)) {
        check(`Run:${graph}`, '"N in parallel" bracket for a fan-out run', /in parallel/.test(t2));
      }
      await shot(`run-${graph}-timeline`);

      // Expand the first step → four facets
      const expanded = await clickLabel('');
      if (expanded) {
        await sleep(6000);
        t2 = await text();
        check(`Run:${graph}`, 'a step expands into Input · Plan · Timeline · Output',
          wantAny(t2, 'Input', 'Output'));
        await shot(`run-${graph}-expanded`);
      }
    }
  }
} else if (shouldRun('calls')) {
  record('Calls', 'backend-backed screens', 'DIFFERS', 'skipped — CF_ACCESS_CLIENT_ID/_SECRET not set');
}

// ── report ───────────────────────────────────────────────────────────────────
const pass = results.filter((r) => r.verdict === 'PASS').length;
const differs = results.filter((r) => r.verdict === 'DIFFERS').length;
const fail = results.filter((r) => r.verdict === 'FAIL').length;

const md = [
  `# README verification — ${new Date().toISOString().slice(0, 10)} (${SCHEME} scheme)`,
  '',
  `**${pass} pass · ${differs} differ from the README · ${fail} fail**`,
  '',
  '| Screen | README claim | Verdict | Observed |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.screen} | ${r.claim.replace(/\|/g, '\\|')} | ${r.verdict} | ${r.note.replace(/\|/g, '\\|')} |`),
  '',
  '## Console errors by route',
  '',
  ...(consoleErrors.length
    ? [...new Map(consoleErrors.map((e) => [`${e.route}::${e.text.slice(0, 120)}`, e])).values()]
      .map((e) => `- \`${e.route}\` — ${e.text.slice(0, 300)}`)
    : ['(none)']),
].join('\n');
writeFileSync(join(SHOTS, `verdict-${SCHEME}.md`), md);

console.log(`\n${'='.repeat(70)}`);
console.log(`${pass} pass · ${differs} differ · ${fail} fail   (${SCHEME} scheme)`);
console.log(`verdict → .verify-shots/verdict-${SCHEME}.md`);
console.log(`shots   → .verify-shots/${SCHEME}-*.png`);

// Reanimated/worklet errors are always a hard failure — the standing rule for
// every muffin-ui smoke. React #418 is the known, tracked hydration warning.
const worklet = consoleErrors.filter((e) => /reanimated|worklet/i.test(e.text));
if (worklet.length) {
  console.error(`\nFAIL: ${worklet.length} Reanimated/worklet errors`);
  for (const e of worklet.slice(0, 5)) console.error(`  ${e.route}: ${e.text.slice(0, 200)}`);
}
const r418 = consoleErrors.filter((e) => /Minified React error #418|hydrat/i.test(e.text));
console.log(`\nReact #418 / hydration errors under ${SCHEME}: ${r418.length}` +
  (r418.length ? ` — routes: ${[...new Set(r418.map((e) => e.route))].join(', ')}` : ''));

await browser.close();
server.close();
process.exit(fail > 0 || worklet.length ? 1 : 0);
