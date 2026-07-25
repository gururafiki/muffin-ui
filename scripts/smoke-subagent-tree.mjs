// scripts/smoke-subagent-tree.mjs — run: node scripts/smoke-subagent-tree.mjs
// Env: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (required).
// Requires system Chrome + puppeteer-core (already a devDependency).
//
// Adapted from scripts/smoke-reopen.mjs — same scaffolding (a node:http static
// server serving dist/ + an /api reverse-proxy to https://muffin-api.rafiki.guru
// via node:https with CF Access headers + a browser UA; puppeteer-core launching
// system Chrome with channel:'chrome', headless:'new'; waitUntil:'domcontentloaded'
// NOT 'networkidle2' because the app opens a persistent lifecycle-watcher SSE on
// reopen; a bounded waitForFunction as the real readiness gate; a React #418
// hydration-warning whitelist), retargeted at the Phase-2 recursive sub-agent
// tree (see CLAUDE.md "Panel surfaces" / subagent-tree section).
//
// Thread `019f98e1-...` is a post-deploy criteria_analysis/AAPL run. Its captured
// `subagent_tree` is only 2 levels deep (criterion_evaluation -> evaluate) because
// today's evaluators single-shot — trees render as deep as the agent actually
// nested, they are not artificially flattened. Driving nested taps in RN-web
// headlessly (no stable testID/role selectors on SubAgentRunRow yet) is brittle,
// so this script does NOT click-expand programmatically. It hydrates the page,
// prints the rendered body text + a full-page screenshot for manual/controller
// confirmation, and gates pass/fail on the structural assertions below only.
// The controller drives the actual interactive drill-down (tap a criterion ->
// tap its evaluate child) separately via the Playwright MCP.
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const API = 'https://muffin-api.rafiki.guru';
const TID = '019f98e1-b104-7742-a893-4b1a9a388366';
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
      // `API` is https:// — node:http's request() only speaks http:, so
      // dispatch through node:https for the actual upstream call.
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

// Ground truth: pull the thread's real values through the same proxy the app
// uses, so the content assertion checks against actual server data (not a
// hard-coded string that could rot).
const truth = await fetch(`${base}/api/threads/${TID}`).then((r) => r.json());
const criterionName = truth?.values?.criterion_evaluations?.[0]?.criterion_name;
if (!criterionName) { console.error('FIXTURE BROKEN: thread has no criterion_evaluations[0].criterion_name', truth?.values && Object.keys(truth.values)); server.close(); process.exit(2); }

const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const reqs = [];
const errors = [];
page.on('request', (r) => reqs.push(r.url()));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
// `domcontentloaded`, NOT `networkidle2`: the app opens a persistent
// lifecycle-watcher SSE (`/stream/events`) on reopen, so the network never goes
// idle and `networkidle2` hangs. The bounded `waitForFunction` below is the real
// readiness gate (waits for the hydrated criterion name to paint).
await page.goto(`${base}/agents/criteria_analysis?threadId=${TID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction(
    (name) => (document.body.innerText || '').includes(name),
    { timeout: 8000 },
    criterionName,
  );
} catch { /* content never painted — hasCriterionName assertion below will fail */ }
const elapsed = Date.now() - t0;
await page.screenshot({ path: 'smoke-subagent-tree.png', fullPage: true });

const bodyText = await page.evaluate(() => document.body.innerText || '');
const hitThreadValues = reqs.some((u) => u.includes(`/threads/${TID}`) && !u.includes('/state'));
const hitCheckpoint = reqs.some((u) => u.includes(`/threads/${TID}/state`));
const hasCriterionName = bodyText.includes(criterionName);
// Whitelist the known pre-existing React #418 hydration warning (see CLAUDE.md smoke notes).
const reanimatedErrors = errors.filter((e) => !/minified react error #418/i.test(e) && /reanimated|worklet/i.test(e));

await browser.close();
server.close();

console.log(`elapsed=${elapsed}ms  hasCriterionName=${hasCriterionName}  hitThreadValues=${hitThreadValues}  hitCheckpoint=${hitCheckpoint}  reanimatedErrors=${reanimatedErrors.length}`);
console.log(`  (asserted criterion="${criterionName}")`);
console.log('--- body text (for manual drill-down confirmation) ---');
console.log(bodyText);
console.log('--- screenshot: smoke-subagent-tree.png ---');

const pass = hasCriterionName && hitThreadValues && !hitCheckpoint && reanimatedErrors.length === 0;
if (!pass) {
  console.error('SMOKE FAIL', { hasCriterionName, hitThreadValues, hitCheckpoint, reanimatedErrors });
  process.exit(1);
}
console.log('SMOKE PASS (structural). Interactive drill-down (expand criterion -> expand evaluate child -> NodeDetail loads) is driven separately via the Playwright MCP.');
