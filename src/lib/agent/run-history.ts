/**
 * Reads a past run's execution tree from **LangGraph's own checkpoints** — no bespoke
 * capture channel involved.
 *
 * `POST /threads/{id}/history` returns one snapshot per superstep, each carrying the
 * `tasks[]` that ran in it. Every task has `{id, name, checkpoint:{checkpoint_ns}}`,
 * and passing that `checkpoint_ns` back to `getHistory` returns the child's own
 * supersteps and *its* tasks. So the whole tree is reachable by recursion, and each
 * namespace's `values.messages` is that node's transcript — including its tool calls.
 *
 * Verified against production: namespace `market_analyst:<uuid>` on thread 019f81a0
 * returns 13 messages (1 human / 2 ai / 10 tool) with 10 real tool calls.
 *
 * **Only nodes that are compiled agents/subgraphs added via `add_node` expose a child
 * namespace.** A plain function node (an LLM call, a pure reducer) reports
 * `checkpoint: null` — it is genuinely leaf-shaped, and showing it as a step with no
 * drill-down is honest rather than a gap. See muffin-agent's graph-authoring rule.
 *
 * ## Cost
 *
 * Checkpoint reads are slow and vary per thread (~5.5s on trading, ~28.6s on the
 * 11-worker criteria thread). Hence: fetch a namespace only when its row is expanded,
 * and cache forever for a finished thread.
 */
import type { Client, ThreadState } from '@langchain/langgraph-sdk';

import { humanise, isInternalNode, type ExecNode } from './exec-tree';

/** How many supersteps to pull per namespace. Deep enough for the graphs muffin
 * runs; the tasks we care about appear across the whole window, so this is a real
 * ceiling rather than a page size we paginate through. */
const HISTORY_LIMIT = 40;

export type HistorySnapshot = ThreadState<Record<string, unknown>>;

/** Fetch one namespace's supersteps. `undefined` namespace = the root graph. */
export async function fetchNamespace(
  client: Client,
  threadId: string,
  checkpointNs?: string,
  limit = HISTORY_LIMIT,
): Promise<HistorySnapshot[]> {
  return (await client.threads.getHistory(threadId, {
    limit,
    ...(checkpointNs ? { checkpoint: { checkpoint_ns: checkpointNs } } : {}),
  })) as HistorySnapshot[];
}

/**
 * The child nodes that ran inside one namespace, newest-superstep-last.
 *
 * Tasks repeat across snapshots (a task pending in step N appears again in N+1), so
 * they are de-duplicated by task id. Order follows first appearance walking the
 * history oldest-first, which is execution order.
 */
export function nodesFromSnapshots(snapshots: HistorySnapshot[]): ExecNode[] {
  const seen = new Map<string, ExecNode>();
  // getHistory returns newest-first; execution order is the reverse.
  for (const snap of [...snapshots].reverse()) {
    for (const task of snap.tasks ?? []) {
      if (!task?.id || isInternalNode(task.name ?? '')) continue;
      if (seen.has(task.id)) {
        // A later snapshot may carry the error/result the earlier one lacked.
        const existing = seen.get(task.id);
        if (existing && task.error) existing.status = 'error';
        continue;
      }
      const namespace = task.checkpoint?.checkpoint_ns || undefined;
      seen.set(task.id, {
        id: namespace ?? `${task.name}:${task.id}`,
        label: humanise(task.name ?? 'step'),
        kind: 'agent',
        status: task.error ? 'error' : 'done',
        // Only compiled agents/subgraphs have a namespace to drill into. A plain
        // function node has none — it is a leaf, not a missing branch.
        namespace,
        children: [],
      });
    }
  }
  return [...seen.values()];
}

/** The messages a namespace recorded — its transcript, tool calls included. */
export function messagesFromSnapshots(snapshots: HistorySnapshot[]): unknown[] {
  let best: unknown[] = [];
  for (const snap of snapshots) {
    const msgs = (snap.values as { messages?: unknown })?.messages;
    if (Array.isArray(msgs) && msgs.length > best.length) best = msgs;
  }
  return best;
}

/** The richest `values` a namespace recorded, for rendering its structured output. */
export function latestValues(snapshots: HistorySnapshot[]): Record<string, unknown> {
  // getHistory is newest-first, so the first snapshot with values wins.
  for (const snap of snapshots) {
    if (snap.values && Object.keys(snap.values).length > 0) return snap.values;
  }
  return {};
}

/**
 * Walk the whole tree eagerly, depth-first.
 *
 * Intended for verification and offline analysis — NOT for the UI, where each
 * namespace costs a slow checkpoint read and rows are expanded one at a time.
 */
export async function fetchTreeEagerly(
  client: Client,
  threadId: string,
  maxDepth = 3,
): Promise<ExecNode[]> {
  const descend = async (ns: string | undefined, depth: number): Promise<ExecNode[]> => {
    const nodes = nodesFromSnapshots(await fetchNamespace(client, threadId, ns));
    if (depth >= maxDepth) return nodes;
    for (const node of nodes) {
      if (!node.namespace) continue;
      node.children = await descend(node.namespace, depth + 1);
    }
    return nodes;
  };
  return descend(undefined, 0);
}
