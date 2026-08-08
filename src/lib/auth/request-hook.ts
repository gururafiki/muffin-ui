import type { Settings } from '@/lib/settings/store';

import { composeAuthHeaders } from './headers';

/**
 * Resolves the freshest access token for one request. Injected rather than imported
 * so this module stays free of supabase-js and the storage layer, which is what lets
 * `scripts/auth-check.ts` exercise it offline. Production passes `liveToken`
 * (`lib/auth/live-token.ts`).
 */
export type TokenSource = (settings: Settings) => Promise<string | undefined>;

/**
 * Structurally identical to the SDK's `RequestHook` (classic `Client`) and
 * `ProtocolRequestHook` (SSE transport) — declared locally so this module does not
 * pull the SDK in for a type alias.
 */
export type RequestHook = (url: URL, init: RequestInit) => Promise<RequestInit>;

/**
 * Resolve auth headers at REQUEST time rather than at client-construction time.
 *
 * `defaultHeaders` is a snapshot, and both the run-stream client and the hydration
 * transport are memoized for the life of the screen (deliberately — a new client
 * identity rebuilds `useStream`'s controller and re-runs `hydrate` forever, see
 * `use-run-stream.ts`). So a token refreshed in the background never reached an open
 * run, and the screen 401'd until the page was reloaded. That was the whole bug.
 *
 * The SDK applies this hook AFTER the `defaultHeaders` merge on every request path —
 * `getState`, SSE open, commands, **reconnect**, and `BaseClient.fetch` — which makes
 * it the correct last-mile seam, and means the SSE reconnect after an idle tab wakes
 * now carries a live token instead of the dead one that used to close the stream.
 *
 * A failing source must not take the request down with it: reads are open to
 * anonymous callers, so we drop to unauthenticated and let the server decide rather
 * than throwing from inside the transport.
 */
export function authRequestHook(settings: Settings, source: TokenSource): RequestHook {
  return async (_url, init) => {
    let token: string | undefined;
    try {
      token = await source(settings);
    } catch {
      token = undefined;
    }
    const headers = new Headers(init.headers);
    const next = composeAuthHeaders(token, settings);
    // DELETE first when there is no token: `composeAuthHeaders` simply omits the key,
    // so without this the dead credential seeded into `defaultHeaders` would outlive
    // the session it came from and keep being sent after sign-out.
    if (!next.Authorization) headers.delete('Authorization');
    // `set`, not `append` — a stale Authorization must be replaced, not duplicated.
    for (const [key, value] of Object.entries(next)) headers.set(key, value);
    return { ...init, headers };
  };
}
