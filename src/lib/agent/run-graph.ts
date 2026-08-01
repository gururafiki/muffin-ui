/**
 * The **compiled shape** of a graph, read from `GET /assistants/{id}/graph`.
 *
 * History tells you what a run *did*; this tells you what it *will* do. Without it a
 * running graph can only show the steps it has already finished, so the timeline grows
 * from nothing instead of filling in a plan the reader can see from the first second.
 *
 * This is the piece that makes the timeline graph-agnostic. The previous model got its
 * step list from a hand-written `AgentDef.stages` recipe per agent, so an unregistered
 * graph rendered as an unlabelled topology dump. Reading the server's own DAG means a
 * graph added next month is drawn correctly with no UI change.
 *
 * Verified against production (2026-08-01). `criteria_analysis`, no xray:
 *
 * ```
 * nodes  __start__ ticker_classification lift_classification criteria_definition
 *        valuation_methodology merge_criteria criterion_evaluation synthesis __end__
 * edges  lift_classification -> criteria_definition        ← out-degree 2
 *        lift_classification -> valuation_methodology
 *        criteria_definition -> merge_criteria             ← converging again
 *        valuation_methodology -> merge_criteria
 * ```
 *
 * `council` is `__start__ -> 13 personas -> council_judge` with zero conditional edges.
 * `?xray=1` additionally expands subgraph internals (`ticker_classification:model`,
 * `warren_buffett:collect_data`, …) as `:`-joined ids, including the middleware nodes
 * that `isInternalNode` filters on their last segment.
 *
 * ## What this deliberately does NOT claim
 *
 * Static edges cannot tell a genuine fan-out from a branch: `merge_criteria ->
 * criterion_evaluation` is a `Send` fan-out and `classifier -> researcher_{speed,
 * balanced, quality}` is a three-way choice, and BOTH are reported as `conditional`.
 * So this module only supplies **order** and **which steps have not run yet**.
 * Parallelism always comes from runtime supersteps (`lanesFromSnapshots`), which is
 * ground truth rather than inference.
 */
import type { AssistantGraph, Client } from '@langchain/langgraph-sdk';
import { useQuery } from '@tanstack/react-query';

import { makeClient } from '@/lib/agent/client';
import { getSettings } from '@/lib/settings/store';
import { humanise, iconForNode, isInternalNode, type RunNode } from './run-node';

const START = '__start__';

/** One planned step: a graph node, in topological order, not yet tied to a run. */
export type PlanStep = { name: string; label: string; depth: number };

function nodeIds(graph: AssistantGraph): string[] {
  return graph.nodes.map((n) => String(n.id));
}

/**
 * Longest-path depth from `__start__` for every node.
 *
 * Longest path, not shortest: a node that can be reached both directly and through a
 * branch belongs after the branch, or the plan would list it before work it waits on.
 * Conditional back-edges make real graphs cyclic, so relaxation is capped at one pass
 * per node — enough for any DAG, and terminating on the loops.
 */
function depths(graph: AssistantGraph): Map<string, number> {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) {
    const list = out.get(e.source);
    if (list) list.push(e.target);
    else out.set(e.source, [e.target]);
  }

  const depth = new Map<string, number>([[START, 0]]);
  for (let pass = 0; pass < graph.nodes.length + 1; pass += 1) {
    let changed = false;
    for (const [source, targets] of out) {
      const base = depth.get(source);
      if (base == null) continue;
      for (const target of targets) {
        const current = depth.get(target);
        if (current == null || current < base + 1) {
          depth.set(target, base + 1);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return depth;
}

/**
 * The graph's steps in the order they can run, excluding sentinels and middleware.
 *
 * Nodes unreachable from `__start__` (orphans, or targets only of edges the server
 * did not serialise) still appear, sorted last, so nothing silently vanishes.
 */
export function planFromGraph(graph: AssistantGraph | undefined): PlanStep[] {
  if (!graph?.nodes?.length) return [];
  const depth = depths(graph);
  const declared = nodeIds(graph);
  const unreachable = declared.length + 1;

  return declared
    .filter((id) => !isInternalNode(id))
    .map((id, index) => ({
      name: id,
      label: humanise(id.includes(':') ? id.slice(id.lastIndexOf(':') + 1) : id),
      depth: depth.get(id) ?? unreachable,
      index,
    }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(({ name, label, depth: d }) => ({ name, label, depth: d }));
}

/**
 * Planned steps that no lane has claimed yet, as `pending` nodes.
 *
 * `executed` is the set of node names the run has actually reached. Anything the graph
 * declares but the run has not touched is still ahead of it — with one exception: a
 * node already listed in the newest snapshot's `next` is about to run *now*, so it is
 * handed over as `active` instead (the caller decides, via `activeNames`).
 */
export function pendingNodes(
  plan: PlanStep[],
  executed: ReadonlySet<string>,
  activeNames: ReadonlySet<string> = new Set(),
): RunNode[] {
  return plan
    .filter((step) => !executed.has(step.name))
    .map((step) => ({
      id: `pending:${step.name}`,
      name: step.name,
      label: step.label,
      icon: iconForNode(step.name),
      status: activeNames.has(step.name) ? ('active' as const) : ('pending' as const),
      step: -1,
    }));
}

async function fetchGraph(client: Client, graphId: string): Promise<AssistantGraph | null> {
  try {
    return await client.assistants.getGraph(graphId);
  } catch {
    // A preset assistant id, a graph the server no longer serves, or an older
    // langgraph-api: the timeline degrades to executed lanes only. Pending steps
    // disappear; structure, status, timing and drill-down all still work, so this is
    // worth swallowing rather than surfacing as a run-level error.
    return null;
  }
}

/**
 * The compiled graph for an assistant/graph id. Static per deployment, so it is cached
 * for the session and never refetched.
 */
export function useAssistantGraph(graphId: string | undefined) {
  return useQuery({
    queryKey: ['assistant-graph', graphId],
    enabled: !!graphId,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => fetchGraph(makeClient(getSettings()), graphId as string),
  });
}
