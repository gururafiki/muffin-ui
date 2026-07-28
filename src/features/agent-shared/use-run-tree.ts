/**
 * Lazy, per-namespace access to a run's execution tree, read from LangGraph's own
 * checkpoints (`run-history.ts`) rather than a capture channel.
 *
 * **Why lazy.** One namespace = one API round trip, and a criteria run has 27 of them.
 * Walking the tree eagerly would multiply that by the node count for data the reader
 * has not asked to see, so each namespace is fetched only when its row is expanded and
 * cached indefinitely once the thread settles (checkpoints are immutable).
 *
 * `useRunTreeRoot` gives the top-level steps; `useRunTreeNode` gives one node's own
 * children, transcript and tool calls. A node with no `namespace` is a leaf — a plain
 * function node in the graph — and neither hook fires for it.
 */
import { useQuery } from '@tanstack/react-query';

import { makeClient } from '@/lib/agent/client';
import type { ExecNode } from '@/lib/agent/exec-tree';
import {
  fetchNamespace,
  latestValues,
  messagesFromSnapshots,
  nodesFromSnapshots,
  toolRunsFromMessages,
} from '@/lib/agent/run-history';
import type { ToolRun } from '@/lib/agent/schemas';
import { getSettings } from '@/lib/settings/store';

/** Finished threads are immutable; a busy one should re-read as it progresses. */
function cachePolicy(busy: boolean) {
  return busy
    ? { staleTime: 10_000, refetchInterval: 15_000 }
    : { staleTime: Infinity, refetchInterval: false as const };
}

export type RunTreeNodeDetail = {
  children: ExecNode[];
  messages: unknown[];
  toolRuns: ToolRun[];
  values: Record<string, unknown>;
};

/** The run's top-level execution steps. */
export function useRunTreeRoot(threadId: string | undefined, busy: boolean) {
  return useQuery({
    queryKey: ['run-tree', threadId, '__root__'],
    enabled: !!threadId,
    ...cachePolicy(busy),
    queryFn: async (): Promise<ExecNode[]> => {
      const client = makeClient(getSettings());
      return nodesFromSnapshots(await fetchNamespace(client, threadId as string));
    },
  });
}

/**
 * One node's own children, transcript and tool calls. Pass `enabled` false until the
 * row is actually expanded — that is the whole point of this hook.
 */
export function useRunTreeNode(
  threadId: string | undefined,
  namespace: string | undefined,
  enabled: boolean,
  busy = false,
) {
  return useQuery({
    queryKey: ['run-tree', threadId, namespace],
    enabled: enabled && !!threadId && !!namespace,
    ...cachePolicy(busy),
    queryFn: async (): Promise<RunTreeNodeDetail> => {
      const client = makeClient(getSettings());
      const snaps = await fetchNamespace(client, threadId as string, namespace);
      const messages = messagesFromSnapshots(snaps);
      return {
        children: nodesFromSnapshots(snaps, namespace),
        messages,
        toolRuns: toolRunsFromMessages(messages, namespace?.split(':')[0]),
        values: latestValues(snaps),
      };
    },
  });
}
