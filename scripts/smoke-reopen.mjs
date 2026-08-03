// scripts/smoke-reopen.mjs — run: node scripts/smoke-reopen.mjs
// Env: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (required).
// Requires system Chrome + puppeteer-core (install ad-hoc: `npm i -D puppeteer-core`).
//
// Reopens a known finished criteria thread and asserts BOTH:
//  - network: the reopen hit GET /threads/{id} (thread.values, the fast path)
//    and NOT GET /threads/{id}/state (the ~27s checkpoint read);
//  - CONTENT: the page actually rendered the run — a real criterion name from
//    the thread's own values shows up in the DOM, and it's not the empty panel.
// The content assertion is deliberate: a network-only check passed while the UI
// was blank (the constructor-time getState read an unbound threadId), so this
// smoke now fails on exactly that empty-panel regression.
import http from 'node:http';
import https from 'node:https';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const API = 'https://muffin-api.rafiki.guru';
const TID = '019f85d6-2cdc-719e-a3f0-d8f01e5b3016';
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
const synthSignal = truth?.values?.synthesis?.signal;
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
// Wait for the hydrated content to actually paint the first criterion name
// (the fast seed resolves ~110ms, but React commit + render follows). Bounded
// so a genuine failure still fails within a few seconds rather than hanging.
// Readiness gate: wait (bounded) for the hydrated criterion name to paint
// before we read the body. On timeout we fall through — the `hasCriterion`
// assertion below then fails, which is the intended signal.
try {
  await page.waitForFunction(
    (name) => (document.body.innerText || '').includes(name),
    { timeout: 8000 },
    criterionName,
  );
} catch { /* content never painted — hasCriterion assertion below will fail */ }
const elapsed = Date.now() - t0;
await page.screenshot({ path: 'smoke-reopen.png', fullPage: true });

const bodyText = await page.evaluate(() => document.body.innerText || '');
const hitValues = reqs.some((u) => u.includes(`/threads/${TID}`) && !u.includes('/state'));
const hitCheckpoint = reqs.some((u) => u.includes(`/threads/${TID}/state`));
const hasCriterion = bodyText.includes(criterionName);
const isEmptyState = /No tool telemetry was recorded for this run/i.test(bodyText);
// Whitelist the known pre-existing React #418 hydration warning (see CLAUDE.md smoke notes).
const realErrors = errors.filter((e) => !/minified react error #418/i.test(e) && /reanimated|worklet/i.test(e));

await browser.close();
server.close();

console.log(`elapsed=${elapsed}ms  hitThreadValues=${hitValues}  hitCheckpoint=${hitCheckpoint}  hasCriterion=${hasCriterion}  isEmptyState=${isEmptyState}  reanimatedErrors=${realErrors.length}`);
console.log(`  (asserted criterion="${criterionName}", synthesis.signal="${synthSignal ?? '(none)'}")`);
if (!hitValues || hitCheckpoint || !hasCriterion || isEmptyState || realErrors.length) {
  console.error('SMOKE FAIL', { hitValues, hitCheckpoint, hasCriterion, isEmptyState, realErrors });
  process.exit(1);
}
console.log('SMOKE PASS');
// See smoke-timeline.mjs: `server.close()` drains rather than severs, and the /api
// proxy's keep-alive sockets to the deployment keep the event loop alive, so a
// PASSING run hangs forever. Only the failure path exited.
process.exit(0);
