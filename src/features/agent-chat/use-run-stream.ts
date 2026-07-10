import type { Client } from '@langchain/langgraph-sdk';
import { useStream } from '@langchain/react';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';

import { makeClient } from '@/lib/agent/client';
import type { AgentDef } from '@/lib/agent/registry';
import { queryClient } from '@/lib/query';
import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';

export type AgentState = { messages?: unknown[] } & Record<string, unknown>;

/**
 * Protocol-v2 engine for the run-view screens (generic runner + council) —
 * the idiomatic successor of `useAgentStream` built on `@langchain/react`.
 *
 * What the new stack gives us over the legacy `runs.stream` hook:
 * - `subgraphsByNode` — compiled-agent nodes (criteria stages / Send workers,
 *   council personas, trading analysts) are DISCOVERED from lifecycle events
 *   with live `pending/running/complete/error` statuses. No node-name regexes,
 *   no checkpoint walking.
 * - root-only `values` — subgraph state never clobbers the scorecard (the M11
 *   `subgraphs: false` workaround is obsolete on this stack).
 * - `custom` channel — `get_stream_writer()` events (per-criterion progress)
 *   arrive as first-class events, consumed via `useChannel`.
 * - hydration — a completed thread renders through the SAME projections from
 *   one `getState` (+ history-seeded discovery); a live thread's subscription
 *   replays buffered events on reconnect. No `useAttachStorage` machinery.
 *
 * ChatScreen intentionally stays on the legacy hook: message branching /
 * edit-fork / regenerate have no protocol-v2 equivalent yet (see CLAUDE.md).
 */
export function useRunStream(
  agent: AgentDef,
  opts: {
    assistantId?: string;
    threadId?: string;
  },
) {
  const router = useRouter();
  const client: Client = useMemo(() => makeClient(getSettings()), []);
  const [threadId, setThreadId] = useState<string | undefined>(opts.threadId);
  const inputsRef = useRef<Record<string, string> | undefined>(undefined);

  const stream = useStream<AgentState>({
    client,
    assistantId: opts.assistantId || agent.id,
    threadId: threadId ?? null,
    messagesKey: 'messages',
    onThreadId: (id: string) => {
      setThreadId(id);
      router.setParams({ threadId: id });
      client.threads
        .update(id, { metadata: { agentId: agent.id, ...(inputsRef.current ? { inputs: inputsRef.current } : {}) } })
        .catch(() => {});
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  /** Start (or continue) a run with a shaped graph `input`. */
  const submitRun = (
    input: Record<string, unknown>,
    o?: {
      overrides?: Record<string, unknown>;
      /** Raw field values to tag onto the thread for the Calls descriptor. */
      inputs?: Record<string, string>;
    },
  ) => {
    if (o?.inputs) inputsRef.current = o.inputs;
    void stream.submit(input as never, {
      config: { configurable: { ...buildConfigurable(getSettings()), ...(o?.overrides ?? {}) } },
    });
  };

  return { stream, threadId, submitRun };
}
