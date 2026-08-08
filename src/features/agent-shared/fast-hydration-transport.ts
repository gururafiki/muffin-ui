import {
  type AgentServerAdapter,
  type Client,
  ProtocolSseTransportAdapter,
} from '@langchain/langgraph-sdk';

import {
  setOnline,
  setReconnecting,
  withConnectionTracking,
} from '@/lib/agent/connection-status';
import { streamingFetch } from '@/lib/agent/install-fetch';
import { liveToken } from '@/lib/auth/live-token';
import { authRequestHook } from '@/lib/auth/request-hook';
import { resolveBaseUrl } from '@/lib/resolve-url';
import { buildAuthHeaders } from '@/lib/settings/configurable';
import type { Settings } from '@/lib/settings/store';

/**
 * A LangGraph stream transport whose one-time hydration read (`getState`)
 * comes from the denormalized `thread.values` (`GET /threads/{id}`, ~110ms)
 * instead of the checkpoint (`GET /threads/{id}/state`, ~27s on the deployed
 * Oracle node — see the reopen-latency spec). Identical values, ~240x faster
 * reopen. ONLY the hydration read is redirected: live streaming, submit, and
 * resume still flow through the wrapped SSE adapter unchanged.
 *
 * CRITICAL: the adapter must be constructed already BOUND to the thread it
 * hydrates (`threadId: initialThreadId`). The framework calls `getState()`
 * from the `StreamController` constructor (`controller.js` — `hydrate()` runs
 * synchronously at construction), which is BEFORE `client.threads.stream()`
 * ever calls `transport.setThreadId()`. For the built-in adapter the SDK
 * re-injects `options.threadId` at construction so its `getState` works; for a
 * custom adapter it does NOT, so we bind it here. Constructing unbound makes
 * the constructor-time `getState()` read an empty `adapter.threadId` and seed
 * nothing (the reopened thread renders an empty panel).
 *
 * A fresh run passes `undefined` (nothing to hydrate): the controller skips
 * `hydrate()` entirely while `threadId` is null, and after the first `submit()`
 * the framework's `setThreadId` updates `adapter.threadId` for streaming. When
 * `onThreadId` then re-renders with the new id the controller does call
 * `hydrate()` again, but the SDK short-circuits it for threads it just created
 * (`StreamController` tracks them in `#selfCreatedThreadIds`), so our `getState`
 * override is never invoked mid-run and the stock SSE submit/stream path is
 * untouched.
 *
 * Busy/interrupted threads: the fast shape below (`next: []`, `tasks: []`, no
 * `status`/`interrupts`) reads as IDLE to `StreamController` — it decides
 * whether to open the live event pump + lifecycle watcher, and whether to
 * keep HITL interrupts, from exactly those fields. So those two statuses
 * delegate to the stock checkpoint `getState` (captured below before we
 * override it) — slower (~27s), but correct active-thread + interrupt
 * detection. Only idle/error reopens (the reopen-of-a-finished-run case this
 * optimisation targets) take the fast `thread.values` path.
 *
 * ## Why `ProtocolSseTransportAdapter` and not `HttpAgentServerAdapter`
 *
 * The `HttpAgentServerAdapter` wrapper forwards only
 * `{apiUrl, threadId, defaultHeaders, onRequest, fetch, asyncCaller, paths}` to the
 * SSE transport it delegates to, and binds `getState`. That makes
 * `fetchFactory` / `maxReconnectAttempts` / `idleReconnect` / `onReconnect`
 * unreachable — which mattered a great deal, because the SSE transport DISABLES its
 * own reconnect loop when a `fetch` is supplied:
 *
 *     this.maxReconnectAttempts = options.fetch != null ? 0 : options.maxReconnectAttempts ?? 5;
 *     this.idleReconnect       = options.fetch != null ? null : options.idleReconnect ?? "auto";
 *
 * `streamingFetch()` returns `undefined` on web but `expo/fetch` on native, so
 * NATIVE run streams had zero reconnect attempts: one dropped connection killed the
 * stream permanently. Constructing the SSE adapter directly (it is exported, and
 * declares a public `getState()` with exactly the `AgentServerAdapter["getState"]`
 * signature) lets us pass `fetchFactory` instead — `resolveFetch()` checks it first
 * and it does not trip that guard — and set the reconnect options explicitly.
 */
export function makeReopenTransport(
  client: Client,
  settings: Settings,
  initialThreadId: string | undefined,
): AgentServerAdapter {
  const adapter = new ProtocolSseTransportAdapter({
    apiUrl: resolveBaseUrl(settings.apiUrl),
    defaultHeaders: buildAuthHeaders(settings),
    // Per-request token refresh. Critically this also covers the SSE RECONNECT:
    // when an idle tab wakes and the transport re-subscribes, that request used to
    // carry the token snapshot from mount, get a 401, and close the stream for good.
    onRequest: authRequestHook(settings, liveToken),
    // `fetchFactory`, NOT `fetch` — see the docblock above. `streamingFetch()` is
    // `undefined` on web, and the factory's return value is used verbatim, so the
    // `globalThis.fetch` fallback is required.
    fetchFactory: () => withConnectionTracking(streamingFetch() ?? globalThis.fetch),
    maxReconnectAttempts: 5,
    idleReconnect: 'auto',
    onReconnect: ({ attempt }) => setReconnecting(attempt),
    // The fix: bound at construction, so `getState()` (called from the
    // controller constructor, before `setThreadId`) sees the reopened thread.
    threadId: initialThreadId,
  });
  // A freshly-built transport is by definition not mid-reconnect; without this a
  // manual Reconnect would rebuild the transport and leave the pill stuck.
  setOnline();

  // The stock SSE checkpoint read (GET /threads/{id}/state). Correct but ~27s
  // on the deployed node — used only for threads that must hydrate as ACTIVE.
  const stockGetState = adapter.getState?.bind(adapter);

  adapter.getState = (async () => {
    const threadId = adapter.threadId;
    if (!threadId) return null;
    const thread = await client.threads.get(threadId);
    // A busy/interrupted thread must be detected as ACTIVE by the controller
    // so it opens the live event pump + lifecycle watcher and preserves
    // interrupts. The fast values-only shape (next:[], tasks:[]) reads as
    // idle and would freeze a live reopen or drop a HITL interrupt — so
    // delegate those to the real checkpoint getState. Only idle/error take
    // the fast thread.values path.
    if ((thread.status === 'busy' || thread.status === 'interrupted') && stockGetState) {
      return stockGetState();
    }
    return {
      values: thread.values,
      metadata: thread.metadata,
      next: [],
      tasks: [],
      checkpoint: null,
      parent_checkpoint: null,
    };
  }) as typeof adapter.getState;

  return adapter;
}
