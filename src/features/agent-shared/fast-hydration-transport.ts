import {
  type AgentServerAdapter,
  type Client,
  HttpAgentServerAdapter,
} from '@langchain/langgraph-sdk';

import { streamingFetch } from '@/lib/agent/install-fetch';
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
 * Interrupted/busy threads: `thread.values` is a fine seed; the live event
 * subscription refines it, so interrupts still arrive over the stream.
 */
export function makeReopenTransport(
  client: Client,
  settings: Settings,
  initialThreadId: string | undefined,
): AgentServerAdapter {
  const adapter = new HttpAgentServerAdapter({
    apiUrl: resolveBaseUrl(settings.apiUrl),
    defaultHeaders: buildAuthHeaders(settings),
    fetch: streamingFetch(),
    // The fix: bound at construction, so `getState()` (called from the
    // controller constructor, before `setThreadId`) sees the reopened thread.
    threadId: initialThreadId,
  });

  adapter.getState = (async () => {
    const threadId = adapter.threadId;
    if (!threadId) return null;
    const thread = await client.threads.get(threadId);
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
