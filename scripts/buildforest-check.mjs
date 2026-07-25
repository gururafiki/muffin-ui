// scripts/buildforest-check.mjs — run:
//   CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… node scripts/buildforest-check.mjs
//
// Standalone verification for `collectSubagentTree`/`buildForest`
// (src/lib/agent/subagent-tree.ts) against REAL deployed data, since this repo
// has no unit-test runner and `.ts` can't be imported directly by node.
//
// NOTE: the two functions below are a deliberate JS PORT of
// `src/lib/agent/subagent-tree.ts` (minus zod — a plain `typeof id === 'string'`
// guard stands in for `zTreeNode`'s only required field), kept in sync by hand.
// The shipped code is the TS in `src/lib/agent/subagent-tree.ts`; this file
// exists purely so the reconstruction logic can be exercised against a real
// thread's `values` without a build step.
//
// Fetch approach mirrors `scripts/smoke-reopen.mjs`: a plain node:https GET
// straight to the deployed API with CF Access service-token headers + a
// browser UA (no local proxy server needed here — we only need the JSON
// `values`, not to render the app).
import https from 'node:https';

const API = 'https://muffin-api.rafiki.guru';
const TID = '019f98e1-b104-7742-a893-4b1a9a388366';
const CID = process.env.CF_ACCESS_CLIENT_ID;
const CSEC = process.env.CF_ACCESS_CLIENT_SECRET;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

if (!CID || !CSEC) {
  console.error('set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET');
  process.exit(2);
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      u,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Host: u.host,
          'User-Agent': UA,
          'CF-Access-Client-Id': CID,
          'CF-Access-Client-Secret': CSEC,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`GET ${url} -> ${res.statusCode}: ${body.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error(`GET ${url} -> non-JSON body: ${body.slice(0, 500)} (${e.message})`));
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Ported from src/lib/agent/subagent-tree.ts (see file header note above).
// ---------------------------------------------------------------------------

/** Minimal stand-in for `parseArray(zTreeNode, ...)`: keep dicts with a string `id`. */
function parseTreeNodes(dicts) {
  const out = [];
  for (const item of dicts) {
    if (item && typeof item === 'object' && typeof item.id === 'string') out.push(item);
  }
  return out;
}

function collectSubagentTree(values) {
  if (!values) return [];
  const dicts = [];
  const top = values.subagent_tree;
  if (top && typeof top === 'object') dicts.push(...Object.values(top));
  const evals = values.criterion_evaluations;
  if (Array.isArray(evals)) {
    for (const c of evals) {
      const t = c?.subagent_tree;
      if (t && typeof t === 'object') dicts.push(...Object.values(t));
    }
  }
  return parseTreeNodes(dicts);
}

function segName(segment) {
  return segment.split(':', 1)[0] || segment;
}

function buildForest(nodes) {
  const rows = new Map();
  const ensure = (id, synthetic) => {
    let r = rows.get(id);
    if (!r) {
      const segs = id.split('|');
      r = { id, name: segName(segs[segs.length - 1]), kind: 'subgraph', synthetic, children: [] };
      rows.set(id, r);
    }
    return r;
  };
  for (const n of nodes) {
    const r = ensure(n.id, false);
    r.synthetic = false;
    if (n.name) r.name = n.name;
    if (n.kind) r.kind = n.kind;
    r.status = n.status;
    r.tool_summary = n.tool_summary;
    r.has_detail = n.has_detail;
  }
  for (const id of [...rows.keys()]) {
    const segs = id.split('|');
    for (let i = 1; i < segs.length; i++) ensure(segs.slice(0, i).join('|'), true);
  }
  const roots = [];
  for (const r of rows.values()) {
    const segs = r.id.split('|');
    if (segs.length <= 1) {
      roots.push(r);
      continue;
    }
    const parentId = segs.slice(0, -1).join('|');
    (rows.get(parentId) ?? ensure(parentId, true)).children.push(r);
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Check harness
// ---------------------------------------------------------------------------

function printForest(roots) {
  const lines = [];
  const walk = (row, depth) => {
    const marker = row.synthetic ? '(synthetic) ' : '';
    const summary = row.tool_summary
      ? ` tools=${row.tool_summary.count ?? 0}`
      : '';
    lines.push(
      `${'  '.repeat(depth)}- ${row.name} [${row.kind}]${row.status ? ` status=${row.status}` : ''} ${marker}${summary} (id=${row.id})`,
    );
    for (const c of row.children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return lines.join('\n');
}

function flattenIds(roots) {
  const ids = [];
  const walk = (row) => {
    ids.push(row.id);
    for (const c of row.children) walk(c);
  };
  for (const r of roots) walk(r);
  return ids;
}

function countRowsWithChildren(roots) {
  let n = 0;
  const walk = (row) => {
    if (row.children.length > 0) n++;
    for (const c of row.children) walk(c);
  };
  for (const r of roots) walk(r);
  return n;
}

/** Returns the id of a cycle member if the children graph revisits an
 * ancestor along any root-to-leaf path, else null. */
function findCycle(roots) {
  const walk = (row, ancestry) => {
    if (ancestry.has(row.id)) return row.id;
    const next = new Set(ancestry);
    next.add(row.id);
    for (const c of row.children) {
      const hit = walk(c, next);
      if (hit) return hit;
    }
    return null;
  };
  for (const r of roots) {
    const hit = walk(r, new Set());
    if (hit) return hit;
  }
  return null;
}

const thread = await getJson(`${API}/threads/${TID}`);
const values = thread?.values;
if (!values || typeof values !== 'object') {
  console.error('FIXTURE BROKEN: thread has no `values`', thread && Object.keys(thread));
  process.exit(2);
}

const nodes = collectSubagentTree(values);
const forest = buildForest(nodes);

const forestPrint = printForest(forest);
console.log('--- forest ---');
console.log(forestPrint);
console.log('--------------');

const flatIds = flattenIds(forest);
const flatIdSet = new Set(flatIds);
const missingRealIds = nodes.map((n) => n.id).filter((id) => !flatIdSet.has(id));
const rowsWithChildren = countRowsWithChildren(forest);
const cycleId = findCycle(forest);

const checks = {
  nonEmptyForest: forest.length > 0,
  hasNestedRow: rowsWithChildren >= 1,
  noMissingRealIds: missingRealIds.length === 0,
  noCycle: cycleId === null,
};

console.log(
  `realNodes=${nodes.length} topLevelRoots=${forest.length} totalRows=${flatIds.length} rowsWithChildren=${rowsWithChildren} missingRealIds=${missingRealIds.length}`,
);
console.log('checks:', checks);
if (missingRealIds.length) console.error('MISSING IDS:', missingRealIds);
if (cycleId) console.error('CYCLE AT:', cycleId);

const allPass = Object.values(checks).every(Boolean);
if (!allPass) {
  console.error('BUILDFOREST CHECK FAIL');
  process.exit(1);
}
console.log('BUILDFOREST CHECK PASS');
