/**
 * Sub-agent tree gather + forest reconstruction, from the backend's captured
 * `subagent_tree` channel (`AgentCaptureMiddleware`).
 *
 * Node `id`s are `|`-joined `<name>:<uuid>` segments (e.g. top-level
 * `ticker_classification:<uuid>`, depth 1, `parent_id="__root__"`; a criterion
 * worker's evaluate step is `criterion_evaluation:<uuid>|evaluate:<uuid>`).
 * Criterion-homed nodes live under `criterion_evaluations[i].subagent_tree`
 * (the same split `collectToolRuns` uses for `tool_runs`) rather than the
 * top-level `subagent_tree` map — mirroring where the backend actually writes
 * them. The intermediate `criterion_evaluation:<uuid>` worker level is never
 * itself captured as a node; it only appears as an id prefix, so `buildForest`
 * synthesizes it as a placeholder row.
 *
 * The tree's TRUE parentage is the id minus its last segment — NOT `parent_id`,
 * which for a re-homed node may point at an ancestor that was stripped or lives
 * in a different part of state. `buildForest` deliberately reconstructs
 * structure from id segments so re-homing can never orphan a node.
 */
import { parseArray, zTreeNode, type TreeNode } from '@/lib/agent/schemas';

export type TreeRow = {
  id: string;
  name: string;
  kind: string;
  status?: string;
  tool_summary?: TreeNode['tool_summary'];
  has_detail?: boolean;
  synthetic: boolean;
  children: TreeRow[];
};

/**
 * Gather the tree channel: the top-level `subagent_tree` map plus every
 * criterion's homed `criterion_evaluations[i].subagent_tree` (the split
 * `collectToolRuns` uses). Reads streamed `values` — identical live and
 * post-refresh; records are validated at this boundary (see schemas.ts).
 */
export function collectSubagentTree(values: Record<string, unknown> | undefined): TreeNode[] {
  if (!values) return [];
  const dicts: unknown[] = [];
  const top = values.subagent_tree;
  if (top && typeof top === 'object') dicts.push(...Object.values(top));
  const evals = values.criterion_evaluations;
  if (Array.isArray(evals)) {
    for (const c of evals) {
      const t = (c as { subagent_tree?: unknown })?.subagent_tree;
      if (t && typeof t === 'object') dicts.push(...Object.values(t));
    }
  }
  return parseArray(zTreeNode, dicts, 'subagent_tree');
}

/** The `<name>` of a `<name>:<uuid>` id segment. */
function segName(segment: string): string {
  return segment.split(':', 1)[0] || segment;
}

/**
 * Reconstruct the forest, synthesizing intermediate ancestor nodes that were
 * never captured (they appear only as id prefixes) and tolerating dangling
 * parents (an ancestor prefix is synthesized on demand, never dropped).
 */
export function buildForest(nodes: TreeNode[]): TreeRow[] {
  const rows = new Map<string, TreeRow>();
  const ensure = (id: string, synthetic: boolean): TreeRow => {
    let r = rows.get(id);
    if (!r) {
      const segs = id.split('|');
      r = { id, name: segName(segs[segs.length - 1]), kind: 'subgraph', synthetic, children: [] };
      rows.set(id, r);
    }
    return r;
  };
  // Real nodes first (so their fields win over a synthetic placeholder).
  for (const n of nodes) {
    const r = ensure(n.id, false);
    r.synthetic = false;
    if (n.name) r.name = n.name;
    if (n.kind) r.kind = n.kind;
    r.status = n.status;
    r.tool_summary = n.tool_summary;
    r.has_detail = n.has_detail;
  }
  // Synthesize every ancestor prefix.
  for (const id of [...rows.keys()]) {
    const segs = id.split('|');
    for (let i = 1; i < segs.length; i++) ensure(segs.slice(0, i).join('|'), true);
  }
  // Wire parent -> children by the id-minus-last-segment (NOT parent_id, which
  // may point at a stripped/rehomed ancestor); roots = single-segment ids.
  const roots: TreeRow[] = [];
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
