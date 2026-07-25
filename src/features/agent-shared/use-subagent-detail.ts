import { useQuery } from '@tanstack/react-query';

import { makeClient } from '@/lib/agent/client';
import { getSettings } from '@/lib/settings/store';

/** A tree node's heavy detail, lazily fetched from the Store on expand. */
export interface SubagentDetail {
  messages?: unknown[];
  tool_runs?: unknown[];
  output?: unknown;
}

/**
 * Fetches one sub-agent tree node's heavy detail (`messages`/`tool_runs`/`output`)
 * from the `["subagent_detail", <threadId>]` Store namespace, keyed by the tree
 * node id. Only runs when `enabled && threadId` (expanded node with a live
 * thread) — `has_detail` on the node is optimistic, so a miss (`null`) is
 * tolerated rather than treated as an error.
 */
export function useSubagentDetail(threadId: string | undefined, nodeId: string, enabled: boolean) {
  const q = useQuery({
    queryKey: ['subagent-detail', threadId, nodeId],
    enabled: enabled && !!threadId,
    staleTime: Infinity,
    queryFn: async () => {
      const client = makeClient(getSettings());
      const item = await client.store.getItem(['subagent_detail', threadId as string], nodeId);
      return (item?.value ?? null) as SubagentDetail | null;
    },
  });
  return { data: q.data ?? undefined, isPending: q.isPending && enabled };
}
