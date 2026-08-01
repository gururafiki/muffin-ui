/**
 * Live status and timing for timeline nodes, from the protocol-v2 discovery maps.
 *
 * Checkpoint history can say what finished and what failed, but never what is running
 * *right now* — a completed task and an in-flight one look identical in a snapshot. The
 * stream knows: `stream.subgraphs` tracks every compiled-subgraph invocation and
 * `stream.subagents` every deep-agent `task` delegation, both with a live
 * `running | complete | error` and real `startedAt` / `completedAt` wall-clock.
 *
 * Two things this fixes that the previous tree could not:
 *
 * 1. **Live status at every depth.** Discovery was matched by *node name* and only ever
 *    applied to top-level registry stages, so a running node three levels down showed as
 *    "done" the moment its checkpoint appeared. Matching on the **namespace** — which is
 *    unique per invocation — carries live status to any depth, and correctly
 *    distinguishes the ten members of a fan-out from each other.
 * 2. **Deep-agent sub-agents at all.** `stream.subagents` was never read anywhere in the
 *    app, so `stock_evaluation` — a pure deep agent, whose entire structure is `task`
 *    delegation — had no live sub-agent visibility whatsoever. Its snapshots carry the
 *    brief (`taskInput`), the parentage (`parentId`, `depth`) and the timing the UI had
 *    otherwise been doing without.
 */
import type { SubagentDiscoverySnapshot, SubgraphDiscoverySnapshot } from '@langchain/langgraph-sdk/stream';
import { useMemo } from 'react';

import { useOptionalRunStream } from '@/lib/agent/stream-context';
import { humanise, type RunNode, type RunStatus } from '@/lib/agent/run-node';

/** Discovery reports a namespace as segments; history joins them with `|`. */
function nsKey(namespace: readonly string[]): string {
  return namespace.join('|');
}

function statusOf(snapshot: { status: 'running' | 'complete' | 'error' }): RunStatus {
  return snapshot.status === 'running' ? 'active' : snapshot.status === 'error' ? 'error' : 'done';
}

function elapsed(snapshot: { startedAt: Date; completedAt: Date | null }): number | undefined {
  const end = snapshot.completedAt?.getTime() ?? Date.now();
  const ms = end - snapshot.startedAt.getTime();
  return ms >= 0 ? ms : undefined;
}

export type LiveOverlay = {
  /** Live status for a node, or `undefined` when the stream knows nothing about it. */
  statusFor: (node: RunNode) => RunStatus | undefined;
  /** Live wall-clock for a node — ticks up while it runs. */
  durationFor: (node: RunNode) => number | undefined;
  /**
   * Deep-agent sub-agents discovered directly beneath a namespace, as timeline nodes.
   *
   * Used only while a run is live: once it settles, the same sub-agents are readable
   * from checkpoints (as `|tools:<id>` namespaces) with their full transcripts, which is
   * strictly more than discovery holds.
   */
  subagentsUnder: (namespace: string | undefined) => RunNode[];
  /** Whether a stream is attached at all (false on the Calls history route). */
  live: boolean;
};

const INERT: LiveOverlay = {
  statusFor: () => undefined,
  durationFor: () => undefined,
  subagentsUnder: () => [],
  live: false,
};

export function useLiveOverlay(busy: boolean): LiveOverlay {
  const stream = useOptionalRunStream();
  // Reading these members outside a selector is intentional: `subgraphs`/`subagents`
  // are plain snapshot maps on the root pump the surface already subscribes to, so this
  // opens no additional connection.
  const subgraphs = stream?.subgraphs as ReadonlyMap<string, SubgraphDiscoverySnapshot> | undefined;
  const subagents = stream?.subagents as ReadonlyMap<string, SubagentDiscoverySnapshot> | undefined;

  return useMemo<LiveOverlay>(() => {
    if (!stream || !busy) return INERT;

    const byNamespace = new Map<string, SubgraphDiscoverySnapshot>();
    for (const snap of subgraphs?.values() ?? []) byNamespace.set(nsKey(snap.namespace), snap);

    const agentList = [...(subagents?.values() ?? [])];

    const find = (node: RunNode) => (node.namespace ? byNamespace.get(node.namespace) : undefined);

    return {
      live: true,
      statusFor: (node) => {
        const snap = find(node);
        if (snap) return statusOf(snap);
        const agent = agentList.find((a) => nsKey(a.namespace) === node.namespace);
        return agent ? statusOf(agent) : undefined;
      },
      durationFor: (node) => {
        const snap = find(node);
        if (snap) return elapsed(snap);
        const agent = agentList.find((a) => nsKey(a.namespace) === node.namespace);
        return agent ? elapsed(agent) : undefined;
      },
      subagentsUnder: (namespace) =>
        agentList
          .filter((a) => {
            const key = nsKey(a.namespace);
            // Direct children only — a grandchild is rendered by ITS parent's card, so
            // matching the whole subtree here would duplicate every nested sub-agent.
            if (!namespace) return a.depth === 0;
            if (!key.startsWith(`${namespace}|`)) return false;
            return !key.slice(namespace.length + 1).includes('|');
          })
          .map((a): RunNode => ({
            id: nsKey(a.namespace),
            name: a.name,
            label: humanise(a.name),
            icon: 'agents',
            status: statusOf(a),
            step: -1,
            durationMs: elapsed(a),
            namespace: nsKey(a.namespace),
            input: a.taskInput,
            output: a.output,
            toolCallId: a.id,
          })),
    };
  }, [stream, busy, subgraphs, subagents]);
}
