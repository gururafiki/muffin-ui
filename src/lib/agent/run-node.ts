/**
 * The run-timeline model. Pure data — no rendering, no React — so it can be
 * exercised directly by `scripts/run-timeline-check.ts`.
 *
 * ## Where a run's shape comes from
 *
 * Entirely from the LangGraph API, never from a per-graph table:
 *
 * - **`POST /threads/{id}/history`** — one snapshot per superstep. `metadata.step`
 *   groups the `tasks[]` that ran together, `created_at` dates each superstep, and
 *   `next` names what runs next. That gives executed structure, timing and pending.
 * - **`GET /assistants/{graph}/graph`** (`run-graph.ts`) — the compiled DAG, so steps
 *   that have not run yet still appear, in order, from the first second of a run.
 * - **`stream.subgraphs` / `stream.subagents`** — live status and wall-clock timing.
 *
 * A graph that ships next month renders correctly with no change here. That is the
 * whole point of the rewrite: the previous model preferred a hand-written
 * `AgentDef.stages` recipe, so an unregistered graph fell back to an unlabelled
 * topology dump.
 *
 * ## Lanes are the unit, not nodes
 *
 * LangGraph executes in supersteps. Everything in one superstep ran **in parallel**;
 * successive supersteps ran **sequentially**. Grouping by `metadata.step` is therefore
 * not a presentational nicety — it is the execution semantics, and it is the one thing
 * the previous model threw away (`nodesFromSnapshots` flattened every snapshot into a
 * single de-duplicated list, so a 10-way fan-out and a 10-step sequence were
 * indistinguishable).
 */
import type { IconName } from '@/components/icons';

export type RunStatus = 'pending' | 'active' | 'done' | 'error';

export type RunNode = {
  /** Stable identity: the namespace when there is one, else `<name>:<task id>`. */
  id: string;
  /** The raw graph node name (`market_analyst`) as LangGraph reports it. */
  name: string;
  /** Display name — `humanise(name)`, or a fan-out worker's own result label. */
  label: string;
  icon?: IconName;
  status: RunStatus;
  /** `metadata.step` of the superstep this ran in. `-1` for not-yet-run nodes. */
  step: number;
  /** Checkpoint `created_at` at entry / of the following superstep. */
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  /**
   * LangGraph `checkpoint_ns` to read this node's own transcript, plan and children.
   *
   * Present ONLY for compiled agents/subgraphs added via `add_node`; a plain function
   * node reports `checkpoint: null` and is genuinely leaf-shaped. Verified on thread
   * `019faada`: `lift_classification` and `merge_criteria` have no namespace, the
   * other six top-level nodes do.
   */
  namespace?: string;
  /**
   * The state channel this node wrote, read from the single key of `task.result`
   * (verified: `criterion_evaluation` → `criterion_evaluations`). This is what
   * dispatches output rendering — a data-driven key, not a guess at the payload's
   * shape and not a per-graph declaration.
   */
  outputChannel?: string;
  output?: unknown;
  /** Sub-agent delegations get their brief from the `task` call's `description`. */
  input?: string;
  /**
   * For a deep-agent sub-agent: the `task` tool call that spawned it.
   *
   * A sub-agent appears TWICE in one namespace — as a `task` tool call in the parent's
   * transcript, and as the tools-node task that actually ran it. Carrying the call id
   * lets the timeline join them exactly (rather than by name and ordinal), so the
   * transcript's "Delegating to…" step becomes the drill-down into that sub-agent's own
   * run instead of a second, disconnected row saying the same thing.
   */
  toolCallId?: string;
};

/**
 * One superstep: everything LangGraph ran concurrently.
 *
 * `durationMs` is the whole lane's wall-clock (the gap to the next snapshot), so for a
 * parallel lane it is the slowest member — which is the honest number, since per-member
 * timing does not exist in history. Live lanes get per-node timing from discovery.
 */
export type Lane = {
  step: number;
  parallel: boolean;
  startedAt?: string;
  durationMs?: number;
  nodes: RunNode[];
};

/**
 * Plumbing that surfaces as a task but is never a step a reader cares about:
 * middleware hooks (LangChain compiles each into its own graph node), the graph
 * sentinels, and `model`/`tools` — the two nodes of an agent's internal ReAct loop,
 * which would otherwise render a meaningless "Model, Tools, Model, Tools…" ladder under
 * every agent. What those nodes did is in the transcript, rendered as turns and tool
 * calls.
 *
 * This is the dominant case, not an edge case: the `ticker_classification` namespace on
 * thread `019faada` has 14 supersteps, of which 11 are middleware or loop nodes.
 *
 * Safe to match `tools` by exact name — muffin's deterministic `ToolNode`s are named for
 * what they fetch (`fetch_ohlcv`, `fetch_news`), never `tools`. A `tools` task that
 * *delegated* to a deep-agent sub-agent is rescued before this filter runs
 * (`run-history.ts`), because that one IS an execution step.
 */
const INTERNAL_NODE = /Middleware|^__(start|end)__$/;
const AGENT_LOOP_NODE = /^(model|tools)$/;

/**
 * `getGraph({xray})` reports nested nodes as `:`-joined paths
 * (`ticker_classification:_InputPromptMiddleware.before_agent`), so the test has to run
 * against the LAST segment. Plain history task names have no separator and are
 * unaffected.
 */
export function isInternalNode(name: string): boolean {
  const leaf = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  return INTERNAL_NODE.test(leaf) || AGENT_LOOP_NODE.test(leaf);
}

/** Title-case a snake/kebab node name for display. */
export function humanise(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : name;
}

/**
 * A decorative icon for a graph node, matched on its name.
 *
 * Generic heuristics, not a per-graph table — the same class of rule as `describeStep`,
 * which is not reused here because it also rewrites the LABEL ("Researching"), right for
 * an opaque middleware node but wrong for a graph node whose real name is the most
 * informative thing there is to show.
 *
 * Returns `undefined` rather than a catch-all: `describeStep` falls back to `sparkle`,
 * which rendered every row of a timeline with an identical glyph — decoration that
 * carries no information reads as noise, and worse, hides the rows where the icon does
 * mean something.
 */
const NODE_ICONS: [RegExp, IconName][] = [
  [/classif|categor|sector/, 'globe'],
  [/criteri|evaluat|scor|rubric/, 'criteria'],
  [/valuat|method|price|dcf/, 'trading'],
  [/research|search|web|crawl/, 'research'],
  [/analy|market|technical/, 'markets'],
  [/debate|council|judge|persona|conference/, 'council'],
  [/risk|guard|warn/, 'warning'],
  [/news|sentiment|social/, 'sparkle'],
  [/portfolio|trade|trader|decision/, 'portfolio'],
  [/synth|summar|merge|aggregat|writer|report/, 'files'],
  [/agent|subagent|task|deleg/, 'agents'],
];

export function iconForNode(name: string): IconName | undefined {
  const key = name.toLowerCase();
  for (const [re, icon] of NODE_ICONS) if (re.test(key)) return icon;
  return undefined;
}

/** Depth-first walk over lanes, parents before children. */
export function walkLanes(lanes: Lane[], visit: (n: RunNode, lane: Lane) => void): void {
  for (const lane of lanes) for (const node of lane.nodes) visit(node, lane);
}

/** `1.2s` / `47s` / `4m 16s` / `16m 32s` — compact, never a bare millisecond count. */
export function formatDuration(ms: number | undefined): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined;
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem ? `${mins}m ${rem}s` : `${mins}m`;
}

/** Milliseconds between two checkpoint timestamps; `undefined` if either is unusable. */
export function durationBetween(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  return b - a;
}

/**
 * A lane's status, folded from its members: any error wins, then any active, then
 * pending-only, else done. Used for the collapsed header of a parallel fan.
 */
export function laneStatus(lane: Lane): RunStatus {
  if (lane.nodes.some((n) => n.status === 'error')) return 'error';
  if (lane.nodes.some((n) => n.status === 'active')) return 'active';
  if (lane.nodes.length > 0 && lane.nodes.every((n) => n.status === 'pending')) return 'pending';
  return 'done';
}

/**
 * Is this node the one that merely produced its parent's output?
 *
 * A graph often ends a subgraph with a small node whose entire job is to write the
 * channel the parent reports — muffin's criterion worker is `evaluate` → `package`,
 * where `package` writes `criterion_evaluations` and nothing else. Rendering its output
 * repeats the parent's card verbatim, so every criterion showed its evaluation twice.
 *
 * Detected from two channel names the API already reported, so there is no per-graph
 * knowledge here: a **leaf** (no namespace of its own — it did not do independent work
 * worth drilling into) writing the **same channel** the parent reports. The row itself
 * is kept, because it is a node LangGraph really executed and its duration is real; only
 * the duplicated payload is suppressed.
 */
export function isPassThrough(node: RunNode, parentOutputChannel: string | undefined): boolean {
  return !node.namespace && !!node.outputChannel && node.outputChannel === parentOutputChannel;
}

/**
 * A plan the agent stopped maintaining.
 *
 * Deep agents keep their plan in `values.todos` via `write_todos`, but nothing forces
 * them to keep it current — on production thread `019faada` the ticker-classification
 * agent wrote four todos at superstep 5 and never called `write_todos` again, so the
 * checkpoint still says "1 of 4" long after the node finished successfully.
 *
 * That is a fact about the agent, not a bug in the page, so the UI reports it rather
 * than hiding it or implying the run stalled. True only once the node has actually
 * finished — a running node with unfinished todos is simply mid-plan.
 */
export function isPlanStale(todos: { status?: string }[], nodeStatus: RunStatus): boolean {
  if (nodeStatus !== 'done' && nodeStatus !== 'error') return false;
  return todos.some((t) => !/^(completed|done)$/i.test((t.status ?? '').trim()));
}
