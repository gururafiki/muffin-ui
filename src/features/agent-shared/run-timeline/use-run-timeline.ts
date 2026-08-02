/**
 * Lazy, per-namespace access to a run's execution record, read from LangGraph's own
 * checkpoints (`run-history.ts`).
 *
 * **Why lazy.** One namespace = one API round trip, and a criteria run has 27 of them.
 * Walking the tree eagerly would multiply that by the node count for data the reader
 * has not asked to see, so each namespace is fetched only when its card is expanded and
 * cached indefinitely once the thread settles (checkpoints are immutable).
 *
 * Root and child use the SAME hook — the root is simply the namespace-less case. The
 * previous split into `useRunTreeRoot` / `useRunTreeNode` meant the root could never
 * grow the facets (plan, transcript, input) that child nodes had, which is part of why
 * the top level of the old tree was so much thinner than its branches.
 */
import { useQuery } from '@tanstack/react-query';

import { makeClient } from '@/lib/agent/client';
import {
  fetchNamespace,
  inputFromMessages,
  inputStateFromSnapshots,
  lanesFromSnapshots,
  latestValues,
  messagesFromSnapshots,
  pendingFromSnapshots,
  planFromSnapshots,
  toolRunsFromMessages,
  transcriptByStep,
  type PlanSnapshot,
  type TranscriptSlice,
} from '@/lib/agent/run-history';
import type { Lane } from '@/lib/agent/run-node';
import type { ToolRun } from '@/lib/agent/schemas';
import { getSettings } from '@/lib/settings/store';

/** Finished threads are immutable; a busy one should re-read as it progresses. The
 * poll is a floor, not the primary liveness mechanism — an expanded card on a live run
 * also streams its namespace directly (`use-live-node.ts`). */
function cachePolicy(busy: boolean) {
  return busy
    ? { staleTime: 10_000, refetchInterval: 15_000 }
    : { staleTime: Infinity, refetchInterval: false as const };
}

export type RunTimelineDetail = {
  /** Child supersteps — sequential lanes, each holding its parallel members. */
  lanes: Lane[];
  /** The deep-agent plan at each superstep where it changed. Empty for graph nodes. */
  plan: PlanSnapshot[];
  /** The transcript, split by the superstep that produced each slice. */
  transcript: TranscriptSlice[];
  /** The whole transcript, for tool-run reconstruction and fallback rendering. */
  messages: unknown[];
  toolRuns: ToolRun[];
  /** The prompt this node was handed — its first human message. */
  input?: string;
  /** The state this node was invoked with (`__start__`'s writes), for pipeline nodes
   * that have no transcript and therefore no prompt. */
  inputState?: Record<string, unknown>;
  /** Node names LangGraph says run next inside this namespace. */
  pending: string[];
  values: Record<string, unknown>;
};

const EMPTY: RunTimelineDetail = {
  lanes: [],
  plan: [],
  transcript: [],
  messages: [],
  toolRuns: [],
  pending: [],
  values: {},
};

/**
 * One namespace's execution record. Pass `namespace: undefined` for the run root.
 *
 * `enabled` gates the fetch on the card actually being open — that is the whole point
 * of this hook, so a 27-namespace run only ever pays for the branches someone opened.
 *
 * ## Why the result is blanked when disabled
 *
 * A **leaf** node (a plain function node in the graph) has no namespace, so callers
 * naturally pass `undefined` with `enabled: false`. That collapses the query key to the
 * same `'__root__'` the run's own timeline uses — and a disabled `useQuery` still hands
 * back whatever is cached under its key. The root is always cached by then, so every
 * leaf rendered the ENTIRE run inside itself: expanding `package` under a criterion
 * redrew the whole pipeline, ticker classification and all.
 *
 * Blanking here rather than at each call site makes that structurally impossible: a
 * query nobody enabled can never serve another query's data.
 */
export function useRunTimeline(
  threadId: string | undefined,
  namespace: string | undefined,
  enabled: boolean,
  busy = false,
): { data: RunTimelineDetail | undefined; isPending: boolean; isFetching: boolean } {
  const query = useQuery({
    queryKey: ['run-timeline', threadId, namespace ?? '__root__'],
    enabled: enabled && !!threadId,
    ...cachePolicy(busy),
    queryFn: async (): Promise<RunTimelineDetail> => {
      const client = makeClient(getSettings());
      const snaps = await fetchNamespace(client, threadId as string, namespace);
      if (snaps.length === 0) return EMPTY;
      const messages = messagesFromSnapshots(snaps);
      return {
        lanes: lanesFromSnapshots(snaps, namespace, busy),
        plan: planFromSnapshots(snaps),
        transcript: transcriptByStep(snaps),
        messages,
        toolRuns: toolRunsFromMessages(messages, namespace?.split(':')[0]),
        input: inputFromMessages(messages),
        inputState: inputStateFromSnapshots(snaps),
        pending: pendingFromSnapshots(snaps),
        values: latestValues(snaps),
      };
    },
  });

  const on = enabled && !!threadId;
  return {
    data: on ? query.data : undefined,
    // A disabled query reports `isPending` forever (it has no data and never will),
    // which would leave a leaf's card showing skeletons that never resolve.
    isPending: on ? query.isPending : false,
    isFetching: on ? query.isFetching : false,
  };
}
