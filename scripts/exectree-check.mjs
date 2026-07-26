// scripts/exectree-check.mjs — run:
//   CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… node scripts/exectree-check.mjs
//
// Standalone verification for `buildExecTree`/`treeRowToExecNode`
// (src/features/agent-shared/execution-tree/plan-steps.ts) against REAL
// deployed data, since this repo has no unit-test runner and `.ts` can't be
// imported directly by node.
//
// NOTE: everything below is a deliberate JS PORT of the shipped TS — plan-
// steps.ts itself, its `resolveStages`/`stageSnaps` dependency
// (run-progress.tsx), `stageOutput`/`isEmpty`/`has` (registry/helpers.ts),
// `buildForest`/`collectSubagentTree` (subagent-tree.ts, copied verbatim from
// scripts/buildforest-check.mjs), `collectToolRuns` (renderers/tool-runs.tsx),
// and `titleCase` (lib/format.ts) — plus a hand-copied literal of the
// criteria_analysis `stages` recipe (registry/criteria-analysis.ts) since that
// file also can't be imported directly. The shipped code is the TS; this file
// exists purely so the assembly logic can be exercised against a real thread's
// `values` without a build step. Keep in sync by hand.
//
// Fetch approach mirrors scripts/buildforest-check.mjs: a plain node:https GET
// straight to the deployed API with CF Access service-token headers.
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
// Ported from src/lib/agent/subagent-tree.ts (verbatim copy from
// scripts/buildforest-check.mjs — see its header note).
// ---------------------------------------------------------------------------

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
// Ported from src/lib/agent/registry/helpers.ts
// ---------------------------------------------------------------------------

function isEmpty(v) {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.values(v).every(isEmpty);
  return false;
}

const has = (values, key) => !isEmpty(values[key]);

function stageOutput(stage, values) {
  if (stage.output == null || values == null) return undefined;
  const raw = typeof stage.output === 'function' ? stage.output(values) : values[stage.output];
  return isEmpty(raw) ? undefined : raw;
}

// ---------------------------------------------------------------------------
// Ported from src/features/agent-shared/run-progress.tsx (resolveStages /
// stageSnaps) — byNode is always undefined here (no live subgraph discovery
// against a finished thread's plain `values`), so `stageSnaps` always returns
// `[]` and `resolveStages` falls back to each stage's `done(values)`, which is
// exactly the historical-render path a finished thread takes in the app too.
// ---------------------------------------------------------------------------

function stageSnaps(_stage, byNode) {
  return byNode ? [] : [];
}

function resolveStages(stages, values, busy, byNode) {
  const rows = stages.map((stage) => {
    const snaps = stageSnaps(stage, byNode);
    const running = busy && snaps.some((s) => s.status === 'running');
    const doneByState = stage.done(values);
    const doneBySnaps = snaps.length > 0 && snaps.every((s) => s.status !== 'running');
    const expectedRaw = typeof stage.expected === 'function' ? stage.expected(values) : stage.expected;
    return {
      stage,
      status: running ? 'active' : doneByState || doneBySnaps ? 'done' : 'pending',
      childrenRows: stage.children ? stage.children(values) : [],
      expected: expectedRaw ?? (snaps.length > 0 ? snaps.length : undefined),
    };
  });
  if (busy && !rows.some((r) => r.status === 'active')) {
    const activeIdx = rows.findIndex((r) => r.status !== 'done');
    if (activeIdx >= 0) rows[activeIdx].status = 'active';
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Ported from src/lib/agent/renderers/tool-runs.tsx (collectToolRuns)
// ---------------------------------------------------------------------------

function collectToolRuns(values) {
  if (!values || typeof values !== 'object') return [];
  const top = Array.isArray(values.tool_runs) ? values.tool_runs : [];
  const perCriterion = Array.isArray(values.criterion_evaluations)
    ? values.criterion_evaluations.flatMap((e) => (Array.isArray(e?.tool_runs) ? e.tool_runs : []))
    : [];
  return [...top, ...perCriterion];
}

// ---------------------------------------------------------------------------
// Ported from src/lib/format.ts (titleCase)
// ---------------------------------------------------------------------------

const titleCase = (s) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Ported from src/features/agent-shared/execution-tree/plan-steps.ts
// ---------------------------------------------------------------------------

function treeRowToExecNode(row) {
  const ts = row.tool_summary;
  const summary =
    ts && (ts.count ?? 0) > 0
      ? `${ts.count} tool${ts.count === 1 ? '' : 's'}${ts.failed ? ` · ${ts.failed} failed` : ''}`
      : undefined;
  return {
    id: row.id,
    label: titleCase(row.name),
    status: row.status === 'error' ? 'error' : 'done',
    kind: row.synthetic ? 'synthetic' : 'agent',
    detailNodeId: row.synthetic ? undefined : row.id,
    summary,
    children: row.children.map(treeRowToExecNode),
  };
}

function childrenForStage(stage, rootsByName) {
  if (stage.node) return rootsByName.get(stage.node) ?? [];
  if (!stage.active) return [];
  const out = [];
  for (const [name, roots] of rootsByName) if (stage.active.test(name)) out.push(...roots);
  return out;
}

// Mirror of plan-steps.ts `criterionChildren`: the criteria fan-out stage
// builds one NAMED node per `criterion_evaluations[i]` (not the raw forest's
// indistinguishable "criterion_evaluation" roots), with the evaluation as eager
// output and the flattened worker node as `detailNodeId`.
function criterionChildren(values) {
  const raw = values.criterion_evaluations;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry, i) => {
    const forest = buildForest(collectSubagentTree({ criterion_evaluations: [entry] }));
    const worker = forest.flatMap((r) => (r.synthetic && r.children.length ? r.children : [r]))[0];
    return {
      id: `criterion:${i}`,
      label: entry?.criterion_name ?? `Criterion ${i + 1}`,
      kind: 'agent',
      status: 'done',
      output: entry,
      detailNodeId: worker && !worker.synthetic ? worker.id : undefined,
      toolRuns: Array.isArray(entry?.tool_runs) ? entry.tool_runs : undefined,
      summary: entry?.signal ? String(entry.signal) : undefined,
      children: (worker?.children ?? []).map(treeRowToExecNode),
    };
  });
}

function buildExecTree(stages, values, busy, byNode) {
  const forest = buildForest(collectSubagentTree(values));
  const rootsByName = new Map();
  for (const root of forest) {
    const name = root.id.split(':')[0];
    const bucket = rootsByName.get(name);
    if (bucket) bucket.push(root);
    else rootsByName.set(name, [root]);
  }

  const toolRunsAll = collectToolRuns(values);
  return resolveStages(stages, values, busy, byNode).map((row) => {
    const { stage } = row;
    const toolRuns = stage.node
      ? toolRunsAll.filter((r) => r.agent === stage.node || r.agent === `${stage.node}_data_collection`)
      : [];
    const children =
      (stage.node === 'criterion_evaluation' ? criterionChildren(values) : undefined) ??
      childrenForStage(stage, rootsByName).map(treeRowToExecNode);
    return {
      id: `stage:${stage.key}`,
      label: stage.label,
      kind: 'stage',
      status: row.status,
      output: stageOutput(stage, values),
      toolRuns: toolRuns.length > 0 ? toolRuns : undefined,
      children,
    };
  });
}

// ---------------------------------------------------------------------------
// Hand-copied literal of src/lib/agent/registry/criteria-analysis.ts `stages`
// (only the fields buildExecTree/resolveStages actually read).
// ---------------------------------------------------------------------------

const CRITERIA_STAGES = [
  {
    key: 'classify',
    label: 'Classify the stock',
    node: 'ticker_classification',
    done: (v) => has(v, 'classification'),
    active: /classif/i,
    output: 'classification',
  },
  {
    key: 'define',
    label: 'Define the criteria',
    node: 'criteria_definition',
    done: (v) => has(v, 'criteria_definition'),
    active: /criteria_definition|define/i,
    output: 'criteria_definition',
  },
  {
    key: 'methodology',
    label: 'Pick a valuation methodology',
    node: 'valuation_methodology',
    done: (v) => has(v, 'valuation_methodology'),
    active: /valuation|methodolog/i,
    output: 'valuation_methodology',
  },
  {
    key: 'merge',
    label: 'Merge the scorecard',
    done: (v) => has(v, 'merged_criteria'),
    active: /merge/i,
  },
  {
    key: 'evaluate',
    label: 'Evaluate each criterion',
    node: 'criterion_evaluation',
    done: (v) => {
      if (has(v, 'synthesis')) return true;
      const merged = v.merged_criteria;
      const evals = v.criterion_evaluations;
      return !!merged?.length && (evals?.length ?? 0) >= merged.length;
    },
    active: /criterion|evaluat/i,
    expected: (v) => v.merged_criteria?.length,
    children: (v) => {
      const evals = v.criterion_evaluations ?? [];
      return evals.map((c, i) => ({
        key: c.criterion_name ?? String(i),
        label: c.criterion_name ?? `Criterion ${i + 1}`,
        done: true,
      }));
    },
  },
  {
    key: 'synthesis',
    label: 'Synthesise the verdict',
    node: 'synthesis',
    done: (v) => has(v, 'synthesis'),
    active: /synth/i,
    output: 'synthesis',
  },
];

// ---------------------------------------------------------------------------
// Check harness
// ---------------------------------------------------------------------------

function flattenIds(nodes) {
  const ids = [];
  const walk = (n) => {
    ids.push(n.id);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return ids;
}

const thread = await getJson(`${API}/threads/${TID}`);
const values = thread?.values;
if (!values || typeof values !== 'object') {
  console.error('FIXTURE BROKEN: thread has no `values`', thread && Object.keys(thread));
  process.exit(2);
}

const tree = buildExecTree(CRITERIA_STAGES, values, false, undefined);

console.log('--- stage labels (in order) ---');
for (const n of tree) console.log(`- ${n.label} (status=${n.status}, children=${n.children.length})`);
console.log('-------------------------------');

const labels = tree.map((n) => n.label);
const expectedSubstrings = ['Classif', 'Defin', /Methodolog|Valuation/i, 'Merge', 'Evaluat', 'Synth'];
const labelsMatch = expectedSubstrings.every((expected, i) => {
  const label = labels[i] ?? '';
  return expected instanceof RegExp ? expected.test(label) : label.includes(expected);
});

const evaluateNode = tree.find((n) => n.id === 'stage:evaluate');
const evalChildren = evaluateNode?.children ?? [];
const evaluateChildCount = evalChildren.length;
// The fan-out children are now NAMED per criterion (criterionChildren), not the
// raw forest's indistinguishable "Criterion Evaluation" roots.
const childLabels = evalChildren.map((c) => c.label);
const allNamed = childLabels.length > 0 && childLabels.every((l) => l && l !== 'Criterion Evaluation');

// Each named criterion node points `detailNodeId` at its real captured
// `criterion_evaluation:<uuid>|evaluate:<uuid>` worker; that set must cover
// every captured evaluate leaf (nothing orphaned by the fan-out join).
const realNodes = collectSubagentTree(values);
const evaluateLeafIds = realNodes
  .map((n) => n.id)
  .filter((id) => /^criterion_evaluation:[^|]+\|evaluate:[^|]+$/.test(id));
const detailIds = new Set(evalChildren.map((c) => c.detailNodeId).filter(Boolean));
const missingLeafIds = evaluateLeafIds.filter((id) => !detailIds.has(id));

const checks = {
  sixStageNodes: tree.length === 6,
  stageLabelsInOrder: labelsMatch,
  evaluateHas11NamedChildren: evaluateChildCount === 11 && allNamed,
  allEvaluateLeafIdsPresent: missingLeafIds.length === 0 && evaluateLeafIds.length > 0,
};

console.log('--- evaluate children (named) ---');
for (const c of evalChildren) console.log(`- ${c.label} (signal=${c.summary}, detail=${c.detailNodeId ? 'yes' : 'no'})`);
console.log(
  `stageCount=${tree.length} evaluateChildCount=${evaluateChildCount} evaluateLeafIds=${evaluateLeafIds.length} missingLeafIds=${missingLeafIds.length}`,
);
console.log('checks:', checks);
if (missingLeafIds.length) console.error('MISSING LEAF IDS:', missingLeafIds);

const allPass = Object.values(checks).every(Boolean);
if (!allPass) {
  console.error('EXECTREE CHECK FAIL');
  process.exit(1);
}
console.log('EXECTREE CHECK PASS');
