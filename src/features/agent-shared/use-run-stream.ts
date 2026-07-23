import type { Client } from '@langchain/langgraph-sdk';
import { useStream } from '@langchain/react';
import { useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';

import { makeClient } from '@/lib/agent/client';
import type { AgentDef } from '@/lib/agent/registry';
import type { AgentInput, AgentState } from '@/lib/agent/stream-types';
import { queryClient } from '@/lib/query';
import { buildConfigurable } from '@/lib/settings/configurable';
import { getSettings } from '@/lib/settings/store';

import { makeReopenTransport } from './fast-hydration-transport';

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

  // Custom transport whose hydration read (`getState`) comes from the fast
  // denormalized `thread.values` (~110ms) instead of the checkpoint (~27s on
  // the deployed node). The transport carries `fetch: streamingFetch()`
  // internally — `expo/fetch` on native, browser fetch on web — so SSE still
  // streams on iOS/Android (the protocol-v2 transport uses
  // `options.fetch ?? globalThis.fetch`, not the SDK's fetch-override singleton).
  //
  // The MOUNT-TIME threadId (captured in a ref, NOT the reactive `opts.threadId`
  // or the live `threadId` state) binds the adapter at construction, so the
  // framework's constructor-time `getState()` — which runs before
  // `setThreadId` — reads it (see `makeReopenTransport`). Using the mount-time
  // value is deliberate: it prevents a spurious mid-run re-hydrate when a fresh
  // run's `onThreadId` writes the new id into the URL. Memoized on `[client]`
  // only: `client` is stable, so the transport (and the controller it backs)
  // is built once — hydrate runs once, submit/stream are unaffected.
  const initialThreadIdRef = useRef(opts.threadId);
  const transport = useMemo(
    () => makeReopenTransport(client, getSettings(), initialThreadIdRef.current),
    [client],
  );

  const stream = useStream<AgentState>({
    transport,
    // The custom-adapter branch types `assistantId` as `never` (no declared
    // subagent union on this untyped adapter), but `useStream` reads it from
    // the raw options object at runtime in both branches
    // (`"assistantId" in options`, use-stream.js), so the cast is safe.
    assistantId: (opts.assistantId || agent.id) as never,
    threadId: threadId ?? null,
    messagesKey: 'messages',
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
  const submitRun = (input: AgentInput, o?: { overrides?: Record<string, unknown> }) => {
    void stream.submit(input, { config: runConfig(o?.overrides) });
  };

  /** Resume a human-in-the-loop interrupt with the on-device run config. */
  const resume = (resumeValue: unknown, overrides?: Record<string, unknown>) => {
    void stream.respond(resumeValue, { config: runConfig(overrides) });
  };

  return { stream, threadId, submitRun, resume };
}
