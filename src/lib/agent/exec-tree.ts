/**
 * The single execution-tree model. Pure data — no rendering, no React, so it can be
 * exercised directly by `scripts/exectree-check.ts`.
 *
 * This replaces the two parallel systems (`subagent-tree.ts`'s `TreeRow` +
 * `execution-tree/types.ts`'s `ExecNode`) and their lossy adapters with one node type
 * that every surface builds and renders.
 *
 * ## Where the tree comes from
 *
 * `buildExecTree` assembles a "plan-first hybrid": prefer the agent's registered
 * recipe (`AgentDef.stages`) or a deep agent's `todos`, joined to the REAL captured
 * topology so each plan step drills into what actually ran under it. Agents with
 * neither fall back to the raw topology.
 *
 * Topology today comes from the backend's `subagent_tree` channel
 * (`buildTopology`); Phase 3 swaps that source for LangGraph's own recursive
 * `/threads/{id}/history` without changing this model.
 *
 * ## Two invariants worth keeping
 *
 * 1. **Parentage comes from splitting the id, never from `parent_id`.** A re-homed
 *    node's `parent_id` can point at an ancestor that was stripped or lives in a
 *    different part of state.
 * 2. **A synthetic node with exactly one child collapses into that child.** Levels
 *    that the backend never captures appear only as id prefixes, and synthesizing
 *    them verbatim is what produced the "Criterion evaluation > Criterion evaluation"
 *    double-nesting: the synthesized ancestor took its label from the `<name>:` id
 *    segment while its only real child took the same string from the builder's static
 *    agent name. Collapsing is safe because a synthetic node has no detail of its own.
 */
import type { IconName } from '@/components/icons';
import { parseArray, zTreeNode, type ToolRun, type TreeNode } from '@/lib/agent/schemas';

export type ExecStatus = 'done' | 'active' | 'pending' | 'error';

/** How a node's `output` should be rendered. Set explicitly by the producer —
 * never inferred from the payload's shape, which is what made "Define the criteria"
 * render as an empty criterion card (every dict parses as a loose criterion). */
export type OutputKind = 'debate' | 'criterion' | 'persona' | 'report' | 'structured';

export type ExecNode = {
  id: string;
  label: string;
  icon?: IconName;
  status?: ExecStatus;
  /** `stage` = a registry step or deep-agent todo; `agent` = a really-captured
   * node; `synthetic` = an uncaptured intermediate level inferred from an id
   * prefix (carries no detail of its own). */
  kind: 'stage' | 'agent' | 'synthetic';
  /** Id to resolve this node's lazily-fetched heavy detail. Undefined for
   * synthetic placeholders — there is no real node to fetch. */
  detailNodeId?: string;
  /** Structured output already present in streamed `values`. */
  output?: unknown;
  outputKind?: OutputKind;
  /** Per-node tool-execution records already present in streamed `values`. */
  toolRuns?: ToolRun[];
  /** One-line collapsed summary, e.g. "3 tools · 1 failed". */
  summary?: string;
  children: ExecNode[];
};

/** The `<name>` half of a `<name>:<uuid>` id segment. */
export function segmentName(segment: string): string {
  return segment.split(':', 1)[0] || segment;
}

/** Middleware hooks compile to their own graph nodes and surface as tasks; they are
 * plumbing, never execution steps a reader cares about. */
const INTERNAL_NODE = /Middleware|^__(start|end)__$/;

export function isInternalNode(name: string): boolean {
  return INTERNAL_NODE.test(name);
}

/** Title-case a snake/kebab node name for display. */
export function humanise(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : name;
}

/**
 * Gather the captured topology: the top-level `subagent_tree` map plus each
 * `criterion_evaluations[i].subagent_tree` (criterion workers re-home their capture
 * under the evaluation rather than the root, so a reader must union both).
 */
export function collectTopology(values: Record<string, unknown> | undefined): TreeNode[] {
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

function toolSummary(node: TreeNode): string | undefined {
  const ts = node.tool_summary;
  const count = ts?.count ?? 0;
  if (!count) return undefined;
  const failed = ts?.failed ? ` · ${ts.failed} failed` : '';
  return `${count} tool${count === 1 ? '' : 's'}${failed}`;
}

/**
 * Reconstruct the execution forest from captured nodes, synthesizing uncaptured
 * ancestor levels and then collapsing the redundant ones.
 */
export function buildTopology(nodes: TreeNode[]): ExecNode[] {
  const rows = new Map<string, ExecNode>();

  const ensure = (id: string, synthetic: boolean): ExecNode => {
    let r = rows.get(id);
    if (!r) {
      const segs = id.split('|');
      r = {
        id,
        label: humanise(segmentName(segs[segs.length - 1])),
        kind: synthetic ? 'synthetic' : 'agent',
        children: [],
      };
      rows.set(id, r);
    }
    return r;
  };

  // Real nodes first so their fields win over any placeholder.
  for (const n of nodes) {
    if (isInternalNode(n.name ?? '')) continue;
    const r = ensure(n.id, false);
    r.kind = 'agent';
    // The backend `name` is the builder's static agent label — usually far more
    // informative than the node position (`equity_price` vs `tools`), so prefer it.
    if (n.name) r.label = humanise(n.name);
    r.status = n.status === 'error' ? 'error' : 'done';
    r.summary = toolSummary(n);
    r.detailNodeId = n.has_detail === false ? undefined : n.id;
  }

  // Synthesize every ancestor prefix so no node is ever orphaned.
  for (const id of [...rows.keys()]) {
    const segs = id.split('|');
    for (let i = 1; i < segs.length; i++) ensure(segs.slice(0, i).join('|'), true);
  }

  // Wire parent -> children by id-minus-last-segment; roots are single-segment ids.
  const roots: ExecNode[] = [];
  for (const r of rows.values()) {
    const segs = r.id.split('|');
    if (segs.length <= 1) {
      roots.push(r);
      continue;
    }
    const parentId = segs.slice(0, -1).join('|');
    (rows.get(parentId) ?? ensure(parentId, true)).children.push(r);
  }
  return collapseRedundant(roots);
}

/**
 * Collapse synthetic wrappers that add a level without adding information.
 *
 * A synthetic node exists only because an id prefix implied it; it has no detail, no
 * output and no tool runs. When it has exactly one child, that child IS the step —
 * showing both is the double-nesting bug.
 */
export function collapseRedundant(nodes: ExecNode[]): ExecNode[] {
  return nodes.map((n) => {
    const children = collapseRedundant(n.children);
    if (n.kind === 'synthetic' && children.length === 1) return children[0];
    return { ...n, children };
  });
}

/** Depth-first walk, parents before children. */
export function walkTree(nodes: ExecNode[], visit: (n: ExecNode, depth: number) => void, depth = 0): void {
  for (const n of nodes) {
    visit(n, depth);
    walkTree(n.children, visit, depth + 1);
  }
}

// ── Plan assembly (stages / todos joined to the captured topology) ────────────

/** Roots belonging to a stage. Exact `node` match wins, else the `active` regex —
 * the SAME precedence `stageSnaps` uses for status and `childrenForStage` uses for
 * children, so a step's status, its children and its tool calls can never disagree
 * about which nodes are "its own". Previously the tool-run join used `node` only,
 * so every stage that declares just `active` (all council stages, all four trading
 * analysts) showed zero tool calls by construction. */
export function stageMatches(stage: StageLike, name: string): boolean {
  if (stage.node) return name === stage.node;
  return stage.active ? stage.active.test(name) : false;
}

export type StageLike = {
  key: string;
  label: string;
  icon?: IconName;
  node?: string;
  active?: RegExp;
  outputKind?: OutputKind;
};

/** Tool runs belonging to a stage, matched on the record's `agent` field.
 * Council records carry `<slug>_data_collection`, so the bare slug is tried too. */
export function toolRunsForStage(stage: StageLike, runs: ToolRun[]): ToolRun[] {
  return runs.filter((r) => {
    const agent = r.agent ?? '';
    if (!agent) return false;
    return stageMatches(stage, agent) || stageMatches(stage, agent.replace(/_data_collection$/, ''));
  });
}

/** Group forest roots by their leading segment name — a Send fan-out stage has many
 * roots sharing one name (`criterion_evaluation:<u1>`, `<u2>`, …). */
export function rootsByName(forest: ExecNode[]): Map<string, ExecNode[]> {
  const byName = new Map<string, ExecNode[]>();
  for (const root of forest) {
    const name = segmentName(root.id.split('|')[0]);
    const bucket = byName.get(name);
    if (bucket) bucket.push(root);
    else byName.set(name, [root]);
  }
  return byName;
}

export function childrenForStage(stage: StageLike, byName: Map<string, ExecNode[]>): ExecNode[] {
  const out: ExecNode[] = [];
  for (const [name, roots] of byName) if (stageMatches(stage, name)) out.push(...roots);
  return out;
}
