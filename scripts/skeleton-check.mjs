// Skeletons must actually occupy space. Blocks the API so the loading state stays on
// screen, then measures it.
//
// WHY: in M28 every skeleton in the app was an invisible zero-height box for weeks — the
// `className` was landing on a Reanimated `Animated.View`, which NativeWind classes do not
// reach, so the bars had no height, no background and no rounding. Nothing failed; the app
// simply showed blank space while loading. Typechecks and lint cannot see it, and neither can
// a human who never happens to look mid-load. This is the guard.
//
//   node scripts/skeleton-check.mjs [surface]        # calls | agents | auth  (default: all)
//
// Requires a fresh `npx expo export -p web --output-dir dist` and system Chrome, like the
// other smoke scripts. Serves `dist/` locally, so no credentials and no deployment needed —
// the API is blocked anyway, which is the entire point.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import puppeteer from 'puppeteer-core';

const DIST = resolve(process.cwd(), 'dist');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

/** Static server for the export, with the SPA fallback the real nginx does. */
function serve() {
  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = (req.url || '/').split('?')[0];

      // Generated at deploy time by `deploy/40-runtime-config.sh`, so it is absent from a
      // static export. Serve an empty stub: without this the SPA fallback below returned
      // index.html for it, the browser parsed HTML as JavaScript, and the page died with
      // "Unexpected token '<'" before any skeleton rendered.
      if (url === '/runtime-config.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end('/* stub */');
      }

      // Only extensionless routes fall back to the SPA shell — an asset that is genuinely
      // missing must 404, exactly as nginx does, rather than quietly become HTML.
      const isAsset = extname(url) !== '';
      const candidates = isAsset
        ? [join(DIST, url)]
        : [join(DIST, url), join(DIST, `${url}.html`), join(DIST, 'index.html')];
      for (const candidate of candidates) {
        try {
          const body = await readFile(candidate);
          if (process.env.DEBUG_SERVE) console.log(`  [200] ${url} -> ${candidate.replace(DIST, '')}`);
          res.writeHead(200, { 'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream' });
          return res.end(body);
        } catch {
          /* try the next candidate */
        }
      }
      if (process.env.DEBUG_SERVE) console.log(`  [404] ${url}`);
      res.writeHead(404).end('not found');
    });
    server.listen(0, () => ok({ server, port: server.address().port }));
  });
}

/**
 * Surfaces whose loading state is reachable in a bare export.
 *
 * `/auth` is deliberately absent: `useEnabledProviders` short-circuits to `[]` when no
 * Supabase anon key is configured, so its query RESOLVES instantly and the skeleton correctly
 * never appears. Asserting on it here would be testing the harness, not the app — check that
 * one against a deployment with accounts enabled.
 */
const SURFACES = {
  calls: '/calls',
  agents: '/agents',
};

const wanted = process.argv[2] ? [process.argv[2]] : Object.keys(SURFACES);
const { server, port } = await serve();
const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

try {
  for (const name of wanted) {
    const path = SURFACES[name];
    if (!path) throw new Error(`unknown surface ${name}`);
    console.log(`\n${name} (${path})`);

    const page = await browser.newPage();
    await page.setViewport({ width: 420, height: 900 });
    // Pin the scheme: headless Chrome defaults to DARK, so the bars come out
    // `night-border` rather than `frosting-200`. Both are accepted below, but pinning keeps
    // the measurement deterministic rather than dependent on the runner's preference.
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    // React reports render errors as `pageerror`, not console — listen to both or a broken
    // page reports a clean bill of health.
    const errors = [];
    page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));

    // Hang every API call so the loading state never resolves. Aborting instead would flip
    // the screens into their ERROR state, which is not what we are measuring.
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const u = r.url();
      const isApi = /\/(threads|assistants|auth\/v1|api)\b/.test(u) && !u.includes(`:${port}/_expo`);
      if (isApi && !u.startsWith(`http://localhost:${port}/`)) return; // never resolves
      if (isApi) return;
      r.continue().catch(() => {});
    });

    await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 6000));

    // The skeleton bars are the pulsing placeholder blocks: the class the primitive puts on
    // its inner View. Measuring rendered geometry, not the presence of markup — a zero-height
    // element is exactly the bug and it is present in the DOM either way.
    const bars = await page.evaluate(() => {
      // The skeleton fill, straight from the palette: frosting-200 (#DCC9EC) in light,
      // night-border (#45396A) in dark. Keep both in step with `theme/colors.ts`.
      const FILLS = new Set(['rgb(220, 201, 236)', 'rgb(69, 57, 106)']);
      const out = [];
      for (const el of document.querySelectorAll('div')) {
        if (FILLS.has(getComputedStyle(el).backgroundColor)) {
          const r = el.getBoundingClientRect();
          out.push({ w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
      return out;
    });

    check('skeleton bars are on screen', bars.length > 0, `${bars.length} bars`);
    if (bars.length > 0) {
      const zero = bars.filter((b) => b.h === 0 || b.w === 0);
      check('every bar has non-zero width AND height', zero.length === 0, `${zero.length} collapsed`);
      const total = bars.reduce((s, b) => s + b.h, 0);
      check('the loading state occupies real space', total > 100, `${total}px of bar height`);
    }
    check('no render errors while loading', errors.length === 0, errors.slice(0, 2).join(' | '));

    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${failures === 0 ? 'SKELETON CHECK PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
