/**
 * Lazy, per-namespace access to a past run's execution tree, read from LangGraph's own
 * checkpoints (`run-history.ts`) rather than the `subagent_tree` capture channel.
 *
 * **Why lazy.** A checkpoint read is slow and varies per thread — measured against
 * production: trading root 4.9s, the 11-worker criteria root 26.9s. Eagerly walking a
 * tree would multiply that by the node count. So each namespace is fetched only when
 * its row is expanded, and cached indefinitely for a finished thread (checkpoints are
 * immutable once the run settles).
 *
 * `useRunTreeRoot` gives the top-level plan; `useRunTreeNode` gives one node's own
 * children plus its transcript. A node with no `namespace` is a leaf — a plain
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
} from '@/lib/agent/run-history';
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
 * One node's own children + transcript. Pass `enabled` false until the row is
 * actually expanded — that is the whole point of this hook.
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
      return {
        children: nodesFromSnapshots(snaps),
        messages: messagesFromSnapshots(snaps),
        values: latestValues(snaps),
      };
    },
  });
}
