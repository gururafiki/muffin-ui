import type { Client } from '@langchain/langgraph-sdk';
import { useStream } from '@langchain/react';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

import { makeClient } from '@/lib/agent/client';
import { streamingFetch } from '@/lib/agent/install-fetch';
import type { AgentDef } from '@/lib/agent/registry';
import { queryClient } from '@/lib/query';
import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';

export type AgentState = { messages?: unknown[] } & Record<string, unknown>;

/**
 * Protocol-v2 stream engine for every agent screen (generic runner, council,
 * and ChatScreen) — the idiomatic replacement for the retired `useAgentStream`,
 * built on `@langchain/react`.
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
 * This is the single stream engine for BOTH the run-view screens and the
 * conversational ChatScreen. The chat-only extras it needs — token-streamed
 * `stream.messages`, interrupts + `resume()`, and optimistic message echo —
 * are all native to `@langchain/react` (optimistic input is built in, so no
 * `optimisticValues` plumbing). The features it does NOT provide are message
 * branching / edit-fork / regenerate; ChatScreen accepts that (see CLAUDE.md).
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

  const stream = useStream<AgentState>({
    client,
    assistantId: opts.assistantId || agent.id,
    threadId: threadId ?? null,
    messagesKey: 'messages',
    // The protocol-v2 SSE transport uses `options.fetch ?? globalThis.fetch`
    // and ignores the SDK's fetch-override singleton, so native must pass its
    // streaming fetch (expo/fetch) here or SSE won't stream on iOS/Android.
    fetch: streamingFetch(),
    onThreadId: (id: string) => {
      // No thread metadata is written here: the Calls tab renders from the
      // server's own `metadata.graph_id` + `extract`ed inputs (see
      // `agent-calls/threads.ts`), so a fresh thread is fully recognisable
      // without a client-side tag.
      setThreadId(id);
      router.setParams({ threadId: id });
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
  });

  const runConfig = (overrides?: Record<string, unknown>) => ({
    configurable: { ...buildConfigurable(getSettings()), ...(overrides ?? {}) },
  });

  /** Start (or continue) a run with a shaped graph `input`. */
  const submitRun = (
    input: Record<string, unknown>,
    o?: { overrides?: Record<string, unknown> },
  ) => {
    void stream.submit(input as never, { config: runConfig(o?.overrides) });
  };

  /** Resume a human-in-the-loop interrupt with the on-device run config. */
  const resume = (resumeValue: unknown, overrides?: Record<string, unknown>) => {
    void stream.respond(resumeValue, { config: runConfig(overrides) });
  };

  return { stream, threadId, submitRun, resume };
}
