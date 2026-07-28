/**
 * The single execution-tree model. Pure data — no rendering, no React, so it can be
 * exercised directly by `scripts/exectree-check.ts`.
 *
 * ## Where the tree comes from
 *
 * **LangGraph's own checkpoints** (`run-history.ts`), one namespace at a time, fetched
 * lazily as rows are expanded. There is no capture channel and no bespoke telemetry:
 * a node's children are the `tasks[]` its namespace recorded, and its transcript is
 * that namespace's `values.messages`.
 *
 * `buildExecTree` (`../../features/agent-shared/execution-tree/plan-steps`) assembles a
 * "plan-first hybrid": prefer the agent's registered recipe (`AgentDef.stages`) or a
 * deep agent's `todos`, joined to the real topology so each plan step drills into what
 * actually ran under it. Agents with neither render the topology directly.
 *
 * ## Why this file is so much smaller than it was
 *
 * The previous version reconstructed the tree from the `subagent_tree` capture channel
 * by splitting `|`-joined id paths and *synthesizing* the ancestor levels the backend
 * never captured. That is what produced the "Criterion evaluation > Criterion
 * evaluation" double-nesting: a synthesized ancestor took its label from an id segment
 * while its only real child took the same string from the builder's static agent name.
 *
 * Reading namespaces directly makes that class of bug structurally impossible — every
 * level is a level LangGraph actually recorded, so there is nothing to infer and
 * nothing to collapse.
 */
import type { IconName } from '@/components/icons';
import type { ToolRun } from '@/lib/agent/schemas';

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
  /** `stage` = a registry step or deep-agent todo; `agent` = a graph node that
   * really ran, read from a checkpoint's `tasks[]`. */
  kind: 'stage' | 'agent';
  /** The raw graph node name (`market_analyst`), as opposed to the humanised
   * `label`. Registry stages join on this — never on a parsed id. */
  name?: string;
  /** Structured output already present in streamed `values`, or lifted from the
   * task's own channel writes. */
  output?: unknown;
  outputKind?: OutputKind;
  /** Tool calls this node made, derived from its transcript (`run-history.ts`).
   * Populated only once the node's namespace has been fetched. */
  toolRuns?: ToolRun[];
  /** One-line collapsed summary, e.g. "3 tools · 1 failed". */
  summary?: string;
  /**
   * LangGraph `checkpoint_ns` to read this node's own transcript and children from.
   *
   * Present ONLY for compiled agents/subgraphs added via `add_node`. A plain function
   * node (a single LLM call, a pure reducer) has none — it is genuinely leaf-shaped,
   * and rendering it as a step with no drill-down is honest rather than a gap. See
   * muffin-agent's graph-authoring rule.
   */
  namespace?: string;
  children: ExecNode[];
};

/**
 * Plumbing that surfaces as tasks but is never an execution step a reader cares
 * about: middleware hooks (LangChain compiles each into its own graph node), the
 * graph sentinels, and `model`/`tools` — the two nodes of an agent's internal
 * ReAct loop, which would otherwise render as a meaningless "Model, Tools,
 * Model, Tools…" ladder under every agent. What those nodes actually did is in
 * the transcript, rendered properly as turns and tool calls.
 *
 * Safe to match `tools` by exact name: muffin's deterministic `ToolNode`s are
 * named for what they fetch (`fetch_ohlcv`, `fetch_news`), never `tools`.
 */
const INTERNAL_NODE = /Middleware|^__(start|end)__$/;
const AGENT_LOOP_NODE = /^(model|tools)$/;

export function isInternalNode(name: string): boolean {
  return INTERNAL_NODE.test(name) || AGENT_LOOP_NODE.test(name);
}

/** Title-case a snake/kebab node name for display. */
export function humanise(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : name;
}

/** Depth-first walk, parents before children. */
export function walkTree(
  nodes: ExecNode[],
  visit: (n: ExecNode, depth: number) => void,
  depth = 0,
): void {
  for (const n of nodes) {
    visit(n, depth);
    walkTree(n.children, visit, depth + 1);
  }
}

// ── Plan assembly (stages / todos joined to the real topology) ────────────────

export type StageLike = {
  key: string;
  label: string;
  icon?: IconName;
  node?: string;
  active?: RegExp;
  outputKind?: OutputKind;
};

/**
 * Does a stage own the graph node called `name`? Exact `node` match wins, else the
 * `active` regex.
 *
 * This is the SAME precedence `stageSnaps` uses for status and `childrenForStage`
 * uses for children, so a step's status and its children can never disagree about
 * which nodes are "its own". The tool-run join used to consult `stage.node` alone,
 * so every stage that declares only `active` — all council stages, all four trading
 * analysts — showed zero tool calls by construction.
 */
export function stageMatches(stage: StageLike, name: string): boolean {
  if (stage.node) return name === stage.node;
  return stage.active ? stage.active.test(name) : false;
}

/** The topology nodes belonging to a stage. A `Send` fan-out stage matches many
 * (`criterion_evaluation` × 11), all of which are that stage's children. */
export function childrenForStage(stage: StageLike, topology: ExecNode[]): ExecNode[] {
  return topology.filter((n) => stageMatches(stage, n.name ?? ''));
}
