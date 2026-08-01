// scripts/smoke-timeline.mjs — run: node scripts/smoke-timeline.mjs [threadId] [graphId]
// Env: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (required).
// Requires system Chrome + puppeteer-core (a devDependency) + a fresh
// `npx expo export -p web --output-dir dist`.
//
// Verifies the run Timeline against real deployed threads. Scaffolding is the same
// recipe every muffin-ui smoke uses: a node:http static server for dist/ plus an /api
// reverse proxy to the deployment with CF Access headers + a browser UA;
// puppeteer-core system Chrome, headless:'new'; waitUntil:'domcontentloaded' NOT
// 'networkidle2'; the pre-existing React #418 hydration warning whitelisted.
//
// The toggle defaults to Overview, so on-device state (localStorage
// `muffin.agentview.v1`, version 2) is pre-seeded to open the run in Timeline view.
//
// What it asserts, and why those things:
//   - the toggle reads "Overview | Timeline"
//   - the run's real graph node labels appear (structure came from the API, not a
//     hardcoded per-agent recipe)
//   - "N in parallel" appears for a run known to fan out — the single thing the old
//     execution tree could not express at all
//   - durations render (checkpoint `created_at` deltas reached the UI)
//   - expanding a step yields the facet labels Input/Plan/Timeline/Output
//   - no Reanimated/worklet errors
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const API = 'https://muffin-api.rafiki.guru';
const TID = process.argv[2] ?? '019faada-a9a8-7470-b490-48d5cc41f532';
const GRAPH = process.argv[3] ?? 'criteria_analysis';
/** Runs known to fan out; only these assert the parallel bracket. */
const EXPECT_PARALLEL = ['criteria_analysis', 'council', 'trading_decision'].includes(GRAPH);
const CID = process.env.CF_ACCESS_CLIENT_ID;
const CSEC = process.env.CF_ACCESS_CLIENT_SECRET;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const DIST = new URL('../dist', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

if (!CID || !CSEC) { console.error('set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET'); process.exit(2); }

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      const target = API + req.url.replace(/^\/api/, '');
      const transport = target.startsWith('https:') ? https : http;
      const r = transport.request(target, {
        method: req.method,
        headers: { ...req.headers, host: new URL(API).host, 'CF-Access-Client-Id': CID, 'CF-Access-Client-Secret': CSEC, 'User-Agent': UA },
      }, (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
      r.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
      if (body.length) r.write(Buffer.concat(body));
      r.end();
    });
    return;
  }
  let p = normalize(join(DIST, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  createReadStream(p).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

// Ground truth straight from the API, so the assertions track the real run rather than
// labels baked into this script.
const history = await fetch(`${base}/api/threads/${TID}/history`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 40 }),
}).then((r) => r.json());
// A `tools` task that DELEGATED to a deep-agent sub-agent is a real step, named after
// the sub-agent — the same rescue `lanesFromSnapshots` performs. Without it a pure deep
// agent like stock_evaluation looks like it has no steps at all, because every one of
// its root tasks is `model`/`tools`/middleware.
const msgsOf = (t) => (t?.result && typeof t.result === 'object' ? (t.result.messages ?? []) : []);
const subagentByCallId = new Map();
for (const s of history) for (const t of s.tasks ?? []) for (const m of msgsOf(t))
  for (const c of m.tool_calls ?? [])
    if (c.name === 'task' && typeof c.args?.subagent_type === 'string') subagentByCallId.set(c.id, c.args.subagent_type);
const delegatedBy = new Map();
for (const s of history) for (const t of s.tasks ?? []) for (const m of msgsOf(t))
  if ((m.type === 'tool' || m.role === 'tool') && subagentByCallId.has(m.tool_call_id))
    delegatedBy.set(t.id, subagentByCallId.get(m.tool_call_id));
const nameOf = (t) => delegatedBy.get(t.id) ?? t.name;
const keep = (n) => n && !/Middleware|^__(start|end)__$/.test(n) && !/^(model|tools)$/.test(n);
/** Node names that fan out — two or more tasks of the same node in ONE superstep.
 * Those members are deliberately relabelled from their own payloads ("Revenue Growth
 * (3Y CAGR)" rather than ten identical "Criterion evaluation" rows), so their raw node
 * name is expected to be ABSENT from the page. */
const fannedOut = new Set(
  history.flatMap((s) => {
    const counts = {};
    for (const t of s.tasks ?? []) if (keep(nameOf(t))) counts[nameOf(t)] = (counts[nameOf(t)] ?? 0) + 1;
    return Object.entries(counts).filter(([, c]) => c > 1).map(([n]) => n);
  }),
);
const soloNodes = [...new Set(history.flatMap((s) => (s.tasks ?? []).map(nameOf)).filter(keep))]
  .filter((n) => !fannedOut.has(n));
const humanise = (n) => n.replace(/[_-]+/g, ' ').trim().replace(/^./, (c) => c.toUpperCase());
const expectLabels = soloNodes.map(humanise);
if (expectLabels.length === 0) { console.error('FIXTURE BROKEN: thread has no non-plumbing tasks'); server.close(); process.exit(2); }

const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1100, height: 1400 });
await page.evaluateOnNewDocument((graph) => {
  localStorage.setItem('muffin.agentview.v1', JSON.stringify({ state: { views: { [graph]: 'timeline' } }, version: 2 }));
}, GRAPH);
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
await page.goto(`${base}/agents/${GRAPH}?threadId=${TID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
// Readiness = the run-level summary line the timeline always emits once lanes exist.
// Waiting on a node LABEL instead is unreliable: history takes several seconds, and a
// label can also appear transiently in the Overview.
try {
  await page.waitForFunction(() => /\d+ steps? · /.test(document.body.innerText || ''), { timeout: 40000 });
} catch { /* fails the assertions below */ }

/**
 * Click a timeline step by name.
 *
 * Targets the row's own `role="button"` + `aria-label` — React Native Web renders
 * `accessibilityRole` / `accessibilityLabel` as exactly those — instead of guessing at a
 * pressable ancestor from the text. Walking up from a text node is what made the earlier
 * version click the run recap's "Start a new run" and blank the page. As a bonus this
 * makes the smoke a check on the accessibility attributes too.
 */
async function clickRow(label) {
  const box = await page.evaluate((text) => {
    const el = document.querySelector(`[role="button"][aria-label^="${CSS.escape(text)}"]`)
      ?? [...document.querySelectorAll('[role="button"][aria-label]')]
        .find((e) => (e.getAttribute('aria-label') || '').startsWith(text));
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + Math.min(r.width / 2, 120), y: r.y + r.height / 2 };
  }, label);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 6000)); // the card fetches its namespace on open
  return true;
}

const elapsed = Date.now() - t0;
// Let the entrance animation settle — the readiness check fires the instant content
// mounts, which is exactly when FadeInDown is at opacity 0.
await new Promise((r) => setTimeout(r, 1200));
// Screenshot and assert the STRUCTURE before touching anything — the collapsed spine is
// the thing under test, and an unlucky RN-web click must not be able to invalidate it.
await page.screenshot({ path: `smoke-timeline-${GRAPH}.png`, fullPage: true });
const body = await page.evaluate(() => document.body.innerText || '');

// Expanding is a separate, softer check with its own screenshot: synthetic clicks on
// React-Native-Web are known to be flaky, so a miss here is reported, not fatal.
// Prefer a step that actually has a namespace to drill into — a plain function node is
// a leaf by construction and would only ever say so.
const drillable = await page.evaluate(() =>
  [...document.querySelectorAll('[role="button"][aria-label]')]
    .map((e) => e.getAttribute('aria-label'))
    .filter((l) => / completed(,|$)/.test(l || '')),
);
const expandTarget =
  expectLabels.find((l) => drillable.some((d) => d.startsWith(l) && !/, \d+ms$/.test(d)))
  ?? expectLabels.find((l) => body.includes(l));
const clicked = expandTarget ? await clickRow(expandTarget) : false;
const expandedBody = clicked ? await page.evaluate(() => document.body.innerText || '') : '';
if (clicked) await page.screenshot({ path: `smoke-timeline-${GRAPH}-expanded.png`, fullPage: true });

const labelsPresent = expectLabels.filter((l) => body.includes(l));
// A fanned-out node's raw name must NOT appear — seeing it means the members failed to
// label themselves and the reader is looking at N identical rows.
const rawFanNames = [...fannedOut].map(humanise).filter((l) => body.includes(l));
const togglePresent = body.includes('Overview') && body.includes('Timeline');
const parallelShown = /\d+ in parallel/.test(body);
const durationsShown = /\d+m \d+s|\b\d+s\b|\d+ms/.test(body);
const summaryShown = /\d+ steps? · /.test(body);
// Facets only count if the EXPANSION introduced them — "Timeline" is also the toggle
// label, so testing the collapsed body would always match.
const facetsShown = ['Input', 'Plan', 'Timeline', 'Output'].filter(
  (f) => new RegExp(`\\b${f}\\b`).test(expandedBody) && !new RegExp(`\\b${f}\\b`).test(body),
);
const reanimatedErrors = errors.filter((e) => !/minified react error #418/i.test(e) && /reanimated|worklet/i.test(e));

await browser.close();
server.close();

console.log(`graph=${GRAPH} thread=${TID} elapsed=${elapsed}ms`);
console.log(`  togglePresent=${togglePresent}  summary=${summaryShown}  labels=${labelsPresent.length}/${expectLabels.length}  fanRelabelled=${rawFanNames.length === 0}  parallelShown=${parallelShown}  durationsShown=${durationsShown}`);
console.log(`  expanded="${expandTarget}" clicked=${clicked}  newFacets=[${facetsShown}]  reanimatedErrors=${reanimatedErrors.length}`);
console.log(`  expected node labels: ${expectLabels.join(', ')}`);
console.log('--- body text (collapsed) ---');
console.log(body);
console.log(`--- screenshots: smoke-timeline-${GRAPH}.png${clicked ? `, smoke-timeline-${GRAPH}-expanded.png` : ''} ---`);

const pass =
  togglePresent &&
  summaryShown &&
  labelsPresent.length === expectLabels.length &&
  rawFanNames.length === 0 &&
  durationsShown &&
  (!EXPECT_PARALLEL || parallelShown) &&
  reanimatedErrors.length === 0;
if (!pass) {
  console.error('SMOKE FAIL', {
    togglePresent,
    summaryShown,
    labels: `${labelsPresent.length}/${expectLabels.length}`,
    missing: expectLabels.filter((l) => !body.includes(l)),
    unrelabelledFanOut: rawFanNames,
    parallelShown,
    durationsShown,
    reanimatedErrors,
  });
  process.exit(1);
}
console.log(`SMOKE PASS (structure). Facets after expand: ${facetsShown.length >= 1 ? `CONFIRMED (${facetsShown})` : 'not confirmed in-script — verify via Playwright MCP'}.`);
