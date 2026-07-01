import { useQuery } from '@tanstack/react-query';

import { makeClient } from '@/lib/agent/client';
import { getSettings } from '@/lib/settings/store';
import type { SubagentRun, SubagentRuns } from './conversation';

/** How many `getState(subgraphs)` calls we'll make while walking history. */
const MAX_STATE_CALLS = 15;

type LooseState = {
  checkpoint?: unknown;
  tasks?: {
    name?: string;
    checkpoint?: { checkpoint_ns?: string };
    state?: { checkpoint?: { checkpoint_ns?: string }; values?: Record<string, unknown> };
  }[];
};

function firstHuman(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const m of messages) {
    if (m && (m.type === 'human' || m.role === 'human')) {
      return typeof m.content === 'string' ? m.content : undefined;
    }
  }
  return undefined;
}

/** Turn one native sub-agent subgraph state into a rich SubagentRun, preferring
 * its captured transcript (`subagent_runs`) over its trimmed final `messages`. */
function toRun(name: string, values: Record<string, unknown>): SubagentRun | undefined {
  const captured = values.subagent_runs as SubagentRuns | undefined;
  if (captured && Object.keys(captured).length) {
    // Pick the richest captured record (the sub-agent's own transcript).
    const best = Object.values(captured).sort(
      (a, b) => (b.messages?.length ?? 0) - (a.messages?.length ?? 0),
    )[0];
    if (best?.messages && best.messages.length > 1) {
      return { name, description: best.description ?? firstHuman(best.messages), messages: best.messages };
    }
  }
  // Fallback: only surface if there's real multi-step internal work — a lone
  // final message just duplicates the report the result widget already shows.
  const messages = values.messages;
  if (Array.isArray(messages) && messages.length > 1) {
    return { name, description: firstHuman(messages), messages: messages as SubagentRun['messages'] };
  }
  return undefined;
}

/**
 * Retrieve the internal timelines of an agent's native sub-agents (graph nodes
 * that persist under checkpoint namespaces — trading analysts, council personas).
 * Walks the parent checkpoint history and pulls each sub-agent's subgraph state
 * via `getState(subgraphs)`, deduped by sub-agent, keeping the richest.
 */
export async function fetchSubagentRuns(threadId: string): Promise<SubagentRun[]> {
  const client = makeClient(getSettings());
  const history = (await client.threads.getHistory(threadId, { limit: 200 })) as unknown as LooseState[];

  const byName = new Map<string, SubagentRun>();
  let calls = 0;
  for (const snap of history) {
    const hasNs = (snap.tasks ?? []).some((t) => t.checkpoint?.checkpoint_ns);
    if (!hasNs || calls >= MAX_STATE_CALLS) continue;
    calls++;
    const full = (await client.threads.getState(threadId, snap.checkpoint as never, {
      subgraphs: true,
    })) as unknown as LooseState;
    for (const t of full.tasks ?? []) {
      const values = t.state?.values;
      if (!values) continue;
      const ns = (t.state?.checkpoint?.checkpoint_ns || t.checkpoint?.checkpoint_ns || t.name || '').split(':')[0];
      const name = ns || t.name || 'sub-agent';
      const run = toRun(name, values);
      if (run && (run.messages?.length ?? 0) > (byName.get(name)?.messages?.length ?? 0)) {
        byName.set(name, run);
      }
    }
  }
  return [...byName.values()];
}

/** React-query hook for an agent's native sub-agent internal timelines. */
export function useSubagentRuns(threadId: string | undefined) {
  return useQuery({
    queryKey: ['subagent-runs', threadId],
    queryFn: () => fetchSubagentRuns(threadId as string),
    enabled: !!threadId,
    staleTime: 60_000,
  });
}
