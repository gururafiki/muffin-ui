import type { Client } from '@langchain/langgraph-sdk';
import { useStream } from '@langchain/react';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';

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
  // The MOUNT-TIME threadId (NOT the reactive `opts.threadId` or the live
  // `threadId` state) binds the adapter at construction, so the framework's
  // constructor-time `getState()` — which runs before `setThreadId` — reads it
  // (see `makeReopenTransport`). Using the mount-time value is deliberate: it
  // prevents a spurious mid-run re-hydrate when a fresh run's `onThreadId`
  // writes the new id into the URL. Memoized on `[client]` only: `client` is
  // stable, so the transport (and the controller it backs) is built once —
  // hydrate runs once, submit/stream are unaffected.
  //
  // Held in `useState`'s initial value, not a ref: both freeze the first-render
  // value, but a ref is documented as not-for-render and `react-hooks/refs`
  // rightly rejects reading `.current` inside this `useMemo`. State initialisers
  // are the supported way to snapshot a prop at mount and read it during render.
  //
  // `nonce` is what makes `reconnect()` possible: `useStream` keys its
  // StreamController on `[client, assistantId, transport]`, so bumping this
  // object's identity rebuilds the controller — re-hydrate plus a fresh event pump
  // — WITHOUT remounting the React tree. `threadId` is carried alongside so the
  // rebuilt transport binds the LIVE thread rather than the mount-time one (which
  // is `undefined` for the whole life of a fresh run).
  const [reconnectTarget, setReconnectTarget] = useState<{
    nonce: number;
    threadId: string | undefined;
  }>({ nonce: 0, threadId: opts.threadId });
  const transport = useMemo(
    () => makeReopenTransport(client, getSettings(), reconnectTarget.threadId),
    [client, reconnectTarget],
  );

  const stream = useStream<AgentState>({
    transport,
    // The custom-adapter branch types `assistantId` as `never` (no declared
    // subagent union on this untyped adapter), but `useStream` reads it from
    // the raw options object at runtime in both branches
    // (`"assistantId" in options`, use-stream.js), so the cast is safe.
    assistantId: (opts.assistantId || agent.id) as never,
    // The custom-adapter branch would otherwise make useStream build its OWN
    // internal Client (no auth headers) for getHistory / subagent-namespace
    // resolution / runs.cancel(stop) — dropping a signed-in user's Bearer token
    // (stop() -> runs.cancel silently failing, run keeps executing server-side).
    // Pass our already-memoized client (built by makeClient WITH auth headers);
    // useStream uses `asBag.client` when present. MUST be the stable memoized
    // reference — an inline `defaultHeaders: buildAuthHeaders()` object is a new
    // `{}` each render, which sits in useStream's internal-client dep array and
    // would rebuild the client + controller every render, re-running hydrate
    // forever (isThreadLoading never settles → stuck on "Loading").
    client: client as never,
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

  /**
   * Re-hydrate and re-open the event pump after the SDK's own reconnect budget is
   * exhausted, by rebuilding the transport (see `reconnectTarget` above).
   *
   * Deliberately does NOT re-submit. A dropped socket does not mean the run stopped
   * — it almost always keeps executing server-side — and replaying a `POST /runs`
   * that may already have landed would start a duplicate. Reconnect observes; only
   * a 401 (which the server rejected, so it never executed) is safe to replay, and
   * that is handled invisibly by the per-request token refresh.
   */
  const reconnect = () =>
    setReconnectTarget((prev) => ({ nonce: prev.nonce + 1, threadId: threadId ?? prev.threadId }));

  return { stream, threadId, submitRun, resume, reconnect };
}
