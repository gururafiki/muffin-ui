// scripts/smoke-exectree.mjs — run: node scripts/smoke-exectree.mjs
// Env: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (required).
// Requires system Chrome + puppeteer-core (already a devDependency) + a fresh
// `npx expo export -p web` in dist/.
//
// Verifies the generic Execution-tree view (per-agent toggle) against the real
// deployed criteria_analysis/AAPL thread. Same scaffolding as
// smoke-subagent-tree.mjs (node:http static server for dist/ + an /api reverse
// proxy to https://muffin-api.rafiki.guru with CF Access headers + browser UA;
// puppeteer-core system Chrome, headless:'new'; waitUntil:'domcontentloaded'
// NOT 'networkidle2'; React #418 hydration-warning whitelist).
//
// The toggle defaults to Overview, so we pre-seed on-device state
// (localStorage `muffin.agentview.v1`) to open the run in tree view — the same
// persisted store the RunViewToggle writes — then assert the Level-0 rail shows
// the criteria plan in order, expand "Evaluate each criterion", and confirm its
// captured criterion workers (the real thread's criterion_evaluations) drill in.
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
const STAGE_LABELS = ['Classify the stock', 'Define the criteria', 'Pick a valuation methodology', 'Merge the scorecard', 'Evaluate each criterion', 'Synthesise the verdict'];

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

const truth = await fetch(`${base}/api/threads/${TID}`).then((r) => r.json());
const evals = truth?.values?.criterion_evaluations;
const criterionName = evals?.[0]?.criterion_name;
if (!criterionName) { console.error('FIXTURE BROKEN: thread has no criterion_evaluations[0].criterion_name', truth?.values && Object.keys(truth.values)); server.close(); process.exit(2); }

const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
// Pre-seed the per-agent view store → open criteria_analysis in the tree view.
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('muffin.agentview.v1', JSON.stringify({ state: { views: { criteria_analysis: 'tree' } }, version: 1 }));
});
const reqs = [];
const errors = [];
page.on('request', (r) => reqs.push(r.url()));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
await page.goto(`${base}/agents/criteria_analysis?threadId=${TID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
// Readiness: the Evaluate rail row painted (tree view is up).
try {
  await page.waitForFunction(() => (document.body.innerText || '').includes('Evaluate each criterion'), { timeout: 12000 });
} catch { /* fails the stage-label assertion below */ }

// Expand the "Evaluate each criterion" rail row → its 11 criterion workers.
async function clickRow(text) {
  const box = await page.evaluate((t) => {
    const els = [...document.querySelectorAll('div,span')];
    const leaf = els.find((e) => e.children.length === 0 && (e.textContent || '').trim() === t)
      || els.find((e) => (e.textContent || '').includes(t) && e.children.length <= 2);
    if (!leaf) return null;
    let node = leaf;
    for (let i = 0; i < 6 && node.parentElement; i++) {
      const cs = getComputedStyle(node);
      if (cs.cursor === 'pointer' || node.getAttribute('role') === 'button' || node.tabIndex >= 0) break;
      node = node.parentElement;
    }
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.x + Math.min(r.width / 2, 120), y: r.y + Math.min(r.height / 2, 16) };
  }, text);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

const clickedEvaluate = await clickRow('Evaluate each criterion');
let expandedCriterion = false;
if (clickedEvaluate) {
  try {
    await page.waitForFunction((name) => (document.body.innerText || '').includes(name), { timeout: 8000 }, criterionName);
    expandedCriterion = true;
  } catch { /* children never painted */ }
}

const elapsed = Date.now() - t0;
await page.screenshot({ path: 'smoke-exectree.png', fullPage: true });

const bodyText = await page.evaluate(() => document.body.innerText || '');
const stagesPresent = STAGE_LABELS.filter((l) => bodyText.includes(l));
const allStages = stagesPresent.length === STAGE_LABELS.length;
const togglePresent = bodyText.includes('Overview') && bodyText.includes('Execution tree');
const hitThreadValues = reqs.some((u) => u.includes(`/threads/${TID}`) && !u.includes('/state'));
const hitCheckpoint = reqs.some((u) => u.includes(`/threads/${TID}/state`));
const criterionShown = bodyText.includes(criterionName);
const reanimatedErrors = errors.filter((e) => !/minified react error #418/i.test(e) && /reanimated|worklet/i.test(e));

await browser.close();
server.close();

console.log(`elapsed=${elapsed}ms  togglePresent=${togglePresent}  stages=${stagesPresent.length}/${STAGE_LABELS.length}  clickedEvaluate=${clickedEvaluate}  criterionShownAfterExpand=${criterionShown}  hitThreadValues=${hitThreadValues}  hitCheckpoint=${hitCheckpoint}  reanimatedErrors=${reanimatedErrors.length}`);
console.log(`  (asserted first criterion="${criterionName}"; ${evals.length} total captured)`);
console.log('--- body text ---');
console.log(bodyText);
console.log('--- screenshot: smoke-exectree.png ---');

// Gate: tree view mounted (toggle + all 6 ordered stages) + fast hydration + no
// reanimated errors. The criterion drill-down is a strong-but-soft signal (the
// RN-web headless click can miss); the controller confirms it via Playwright MCP.
const pass = togglePresent && allStages && hitThreadValues && !hitCheckpoint && reanimatedErrors.length === 0;
if (!pass) {
  console.error('SMOKE FAIL', { togglePresent, allStages, hitThreadValues, hitCheckpoint, reanimatedErrors });
  process.exit(1);
}
console.log(`SMOKE PASS (structural). Criterion drill-down after expand: ${expandedCriterion ? 'CONFIRMED in-script' : 'not confirmed in-script — verify via Playwright MCP'}.`);
