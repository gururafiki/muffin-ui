// Static server for the `dist/` export, shared by the headless smoke scripts.
//
// Extracted because it existed twice: skeleton-check.mjs and smoke-market.mjs each
// carried a copy, and the path-traversal bug CodeQL flagged (js/path-injection) was
// COPIED from one to the other. One implementation is the actual fix.
//
// Serving rules mirror the real nginx:
//   * extensionless routes fall back to the SPA shell
//   * a genuinely missing ASSET 404s rather than quietly becoming HTML
//   * /runtime-config.js is stubbed — it is generated at deploy time by
//     deploy/40-runtime-config.sh and is absent from a static export. Without the
//     stub the SPA fallback returns index.html for it, the browser parses HTML as
//     JavaScript, and the page dies with "Unexpected token '<'" before rendering.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, posix, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

/**
 * Index every servable file: request path -> absolute path.
 *
 * The request path is then only ever a Map KEY — it never reaches the filesystem.
 * The obvious `join(DIST, req.url)` is a traversal hole (`/../../etc/passwd`
 * resolves outside DIST); a `startsWith(DIST)` guard closes it but is not recognised
 * as a sanitizer, so the CodeQL alert persists. An allowlist removes the taint
 * outright and cannot be got wrong by a later edit.
 */
async function indexDist(root, dir = root, prefix = '') {
  const out = new Map();
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const request = posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of await indexDist(root, join(dir, entry.name), request)) out.set(k, v);
    } else {
      out.set(`/${request}`, join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Serve `dist/` on an ephemeral port.
 *
 * @param {object} [options]
 * @param {string} [options.dist]           directory to serve (default ./dist)
 * @param {() => string} [options.runtimeConfig]  body for /runtime-config.js
 * @param {boolean} [options.debug]         log every request resolution
 * @returns {Promise<{server: import('node:http').Server, port: number}>}
 */
export async function serveDist({ dist, runtimeConfig, debug } = {}) {
  const DIST = resolve(dist ?? process.cwd(), dist ? '.' : 'dist');
  const files = await indexDist(DIST);
  if (files.size === 0) {
    throw new Error(`no files in ${DIST} — run: npx expo export -p web --output-dir dist`);
  }

  return new Promise((ok) => {
    const server = createServer(async (req, res) => {
      const url = (req.url || '/').split('?')[0];

      if (url === '/runtime-config.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end(runtimeConfig ? runtimeConfig() : '/* stub */');
      }

      const isAsset = extname(url) !== '';
      const candidate =
        files.get(url) ??
        (isAsset ? undefined : files.get(`${url}.html`) ?? files.get('/index.html'));

      if (candidate) {
        if (debug) console.log(`  [200] ${url} -> ${candidate.replace(DIST, '')}`);
        const body = await readFile(candidate);
        res.writeHead(200, {
          'content-type': TYPES[extname(candidate)] ?? 'application/octet-stream',
        });
        return res.end(body);
      }
      if (debug) console.log(`  [404] ${url}`);
      res.writeHead(404).end('not found');
    });
    server.listen(0, () => ok({ server, port: server.address().port }));
  });
}
