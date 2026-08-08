# Session expiry and stream reconnect — stop needing a page reload

**Date:** 2026-08-08
**Status:** Designed, not implemented.
**Scope:** `muffin-ui` only. No backend change: every seam this uses is an option the LangGraph SDK
and supabase-js already expose.

Reported as: *"when I'm using app if session expires after inactivity I have to reload app/web page
since it doesn't handle well 401/403 from langgraph api"* — `todos.md:152` ("Handle 401 when after
idle browser tab and broken connection").

## Problem

An agent screen left open for more than an hour stops working. Every subsequent action fails, and
the only repair is a full reload of the page or app.

### Root cause: `defaultHeaders` is a snapshot, and the stream client is memoized for the life of the screen

`buildAuthHeaders(settings)` (`lib/settings/configurable.ts:108`) reads the access token **once** and
returns a plain object. Two call sites then freeze that object for the lifetime of the run screen:

| site | what it freezes | why it is memoized |
| --- | --- | --- |
| `features/agent-shared/use-run-stream.ts:48` | `makeClient(getSettings())` in `useMemo(…, [])` | Documented at `use-run-stream.ts:88-93` — a new client identity rebuilds `useStream`'s controller and re-runs `hydrate` forever, so `isThreadLoading` never settles. |
| `features/agent-shared/fast-hydration-transport.ts:55` | `defaultHeaders` on the `HttpAgentServerAdapter` | Memoized on `[client, initialThreadId]` so hydration runs exactly once. |

The deployment issues **one-hour** access tokens (`GOTRUE_JWT_EXP: "3600"`,
`muffin-deployment/stack/docker-compose.yaml:345`). supabase-js *does* refresh them: `isBrowser()`
is `typeof window !== 'undefined' && typeof document !== 'undefined'`, so web registers a
`visibilitychange` handler that recovers and refreshes on tab focus, and native falls into the
non-browser branch where the ticker runs unconditionally. `onAuthStateChange` *does* write the new
token into the zustand store.

None of that reaches the open screen. The memoized client keeps sending the dead token until the
component is destroyed — which is exactly why reloading is the only fix the user found.

The one-off call sites (`agent-calls/threads.ts`, `lib/agent/presets.ts`, `lib/agent/run-graph.ts`,
`run-timeline/use-run-timeline.ts`) each build a fresh client per call, so they *do* pick up the
refreshed token. They still have no 401/403 handling — TanStack's `retry: 1` reissues the same
request and surfaces the same generic error — but they are not the reported failure.

### Second root cause: passing `fetch` silently disables the SDK's reconnect loop

`ProtocolSseTransportAdapter` has a reconnect loop that resubscribes with `since: <last seq>`
(`client/stream/transport/http.js:184-200`) — the mechanism `CLAUDE.md` refers to as "mid-run refresh
replays buffered events". Its budget is set as:

```js
this.maxReconnectAttempts = options.fetch != null ? 0 : options.maxReconnectAttempts ?? 5;
this.idleReconnect       = options.fetch != null ? null : options.idleReconnect ?? "auto";
```

`makeReopenTransport` passes `fetch: streamingFetch()`. On web that returns `undefined`, so
reconnect survives. **On native it returns `expo/fetch`, so the run stream gets zero reconnect
attempts** — one blip kills it permanently, with no error the user can act on.

The two causes compound on web: when an idle tab wakes and the SDK reconnects, the reconnect POST
carries the **stale** token, gets 401, and the stream closes for good.

### Out of scope

- **Cloudflare Access session expiry (24h).** Access returns a 302 to a login page — `text/html`,
  not a 401 — so it fails as a parse error and needs its own detection and copy. That is
  `todos.md:141`, deliberately left for separate work.
- **A manual 401 → refresh → retry layer.** With a per-request fresh token, a 401 means the session
  is genuinely dead and retrying is guaranteed to fail. The retry belongs inside supabase-js, where
  it already is (see `_callRefreshToken` below).

## Design

### 1. `onRequest` — a per-request header hook, not a fresher snapshot

Both the classic `Client` and the SSE transport accept a hook that runs **after** the
`defaultHeaders` merge and can therefore override `Authorization`:

```ts
type RequestHook = (url: URL, init: RequestInit) => Promise<RequestInit> | RequestInit;
```

It is applied on every request path — `getState` (`http.js:77`), `request()` which backs SSE open,
commands and reconnect (`http.js:240`), and `BaseClient.fetch` (`client/base.js:97`).

New module **`src/lib/auth/request-hook.ts`**:

```ts
export function authRequestHook(settings: Settings): RequestHook {
  return async (_url, init) => {
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(await liveAuthHeaders(settings))) headers.set(k, v);
    return { ...init, headers };
  };
}
```

(The SDK's own `mergeHeaders` is internal, so the hook composes with the platform `Headers` class.
`set`, not `append`, so a stale `Authorization` from `defaultHeaders` is replaced rather than
duplicated.)

`liveAuthHeaders` awaits `supabase.auth.getSession()` and composes the result through the **same**
`composeAuthHeaders(token, settings)` helper that the existing synchronous `buildAuthHeaders` uses,
so Cloudflare Access service-token headers keep coming from one place and the "single chokepoint"
property `CLAUDE.md` documents is preserved. `buildAuthHeaders` itself is unchanged and still
supplies `defaultHeaders`, which keeps the very first request correct before any await.

**Why `getSession()` and not `refreshSession()`** — read from `@supabase/auth-js`, not assumed:

- It returns the cached token untouched while more than `EXPIRY_MARGIN_MS` (90s) from expiry
  (`GoTrueClient.js:2456`). On the overwhelming majority of requests this is a storage read, not a
  network call. MMKV is synchronous on native; `localStorage` on web.
- Inside the margin it refreshes via `_callRefreshToken`, which **dedupes concurrent callers**
  through a shared `refreshingDeferred` and rate-limits serial callers with a token-keyed
  `lastRefreshFailure` cooldown (`GoTrueClient.js:4054-4080`). N parallel requests cause one
  `/token` call, and an outage cannot produce a refresh storm.
- On failure it distinguishes the two cases for us (`GoTrueClient.js:4160-4173`): if the access
  token is still valid it **preserves** the session (a network blip during proactive refresh); if
  the access token has also expired, the refresh token was the last credential and it calls
  `_removeSession()`, emitting `SIGNED_OUT`.

Wiring is two one-line additions:

| file | change |
| --- | --- |
| `lib/agent/client.ts:16` | add `onRequest: authRequestHook(settings)` |
| `features/agent-shared/fast-hydration-transport.ts` | add `onRequest: authRequestHook(settings)` — folded into the same constructor §3 rewrites, so it is one edit, not two |

Nothing is un-memoized, so the `hydrate`-forever hazard at `use-run-stream.ts:88-93` is untouched.

### 2. Distinguish "expired" from "never signed in"

`onAuthStateChange` already nulls the store on `SIGNED_OUT`, which already flips
`useSignInRequiredToRun()` (`features/account/run-gate.tsx`). What is missing is *why*: `SIGNED_OUT`
fires for both an expiry and a deliberate sign-out.

`lib/auth/store.ts` gains `expired: boolean`, set when `SIGNED_OUT` arrives **without** an
app-initiated sign-out in flight (a module flag set around the `signOut()` call site), cleared on
the next `SIGNED_IN`. `SignInToRunNotice` branches its copy:

| state | heading |
| --- | --- |
| never signed in | "Sign in to run agents" (unchanged) |
| `expired` | "Your session expired" + "Sign in again to keep running agents." |

Chosen over a global banner or a forced route to `/auth`: the inline card reuses a component that
already exists, nothing navigates, and a reopened thread does not pay its hydration read again.

### 3. Give native a reconnect loop

`makeReopenTransport` constructs **`ProtocolSseTransportAdapter` directly** instead of
`HttpAgentServerAdapter`. The wrapper forwards only
`{apiUrl, threadId, defaultHeaders, onRequest, fetch, asyncCaller, paths}` and binds `getState`
(`client/stream/transport/agent-server.js:13-34`); it is the sole reason `fetchFactory`,
`maxReconnectAttempts`, `idleReconnect` and `onReconnect` are unreachable. The SSE adapter declares
a public `getState()` with exactly the `AgentServerAdapter["getState"]` signature plus
`setThreadId` / `open` / `send` / `events` / `openEventStream` / `close`, so it satisfies the
transport slot structurally.

The load-bearing change is **`fetchFactory` instead of `fetch`**: `resolveFetch()` checks it first
(`http.js:87-90`) and it does not trip the `options.fetch != null` guard that zeroes the budget.

```ts
fetchFactory: () => withConnectionTracking(streamingFetch() ?? globalThis.fetch),
maxReconnectAttempts: 5,
idleReconnect: 'auto',
onReconnect: ({ attempt }) => setConnection({ status: 'reconnecting', attempt }),
```

`fetchFactory` is used on **both** platforms, not just native — uniform, and it is what lets the
tracking wrapper observe web reconnects too. `streamingFetch()` returns `undefined` on web, so the
`?? globalThis.fetch` fallback is required: `resolveFetch()` returns the factory's value verbatim
and would throw on `undefined`.

Everything the `makeReopenTransport` docblock establishes stays true and must stay true: the adapter
is still constructed already bound to `initialThreadId` (the controller calls `getState()` from its
constructor, before `setThreadId`), and busy/interrupted threads still delegate to the stock
checkpoint `getState` for correct active-thread and interrupt detection.

**Unverified, and deliberately not claimed:** `idleReconnect: 'auto'` arms only once it observes
`: heartbeat` comments in the SSE stream. Whether self-hosted `langgraph-api` emits them is
unconfirmed. It stays dormant if not, so it costs nothing either way, but the half-open-socket case
is not covered until §5 confirms it.

### 4. Surface it — status pill and a Reconnect action

New `src/lib/agent/connection-status.ts`: a zustand store of
`{ status: 'online' | 'reconnecting' | 'lost', attempt: number }`, written from two places —
`onReconnect` sets `reconnecting`, and the `withConnectionTracking` fetch wrapper sets `online` on a
2xx for the stream URL. The wrapper exists because the SDK exposes no on-open callback; wrapping the
fetch we already supply is the least invasive way to observe recovery. The store is reset whenever a
transport is constructed.

`lost` is **derived, not written by the transport**: attempt exhaustion is not observable from
`onReconnect` (it fires *before* each attempt, never after the last one fails). The SDK instead
closes the event queue with the error, which surfaces as `stream.error`. So the run screen computes
`lost = stream.error != null && status === 'reconnecting'` and renders the Reconnect action on that.

- `RunRecap`'s status pill gains a `Reconnecting…` state alongside Running / Loading / Completed.
- `RunErrorCard` gains an optional `onRetry`, rendering a **Reconnect** button once attempts are
  exhausted, with copy stating the run may still be executing server-side — it usually is, since it
  is the client that dropped, not the run.

**Reconnect is a transport-identity bump, not a remount.** `useStream` keys its controller on
`[client, assistantId, transport]` (`@langchain/react/dist/use-stream.js:76-98`), so adding a
`reconnectNonce` to the transport's `useMemo` deps rebuilds the `StreamController` — re-hydrate plus
a fresh event pump — while the React tree and its state survive. The rebuilt transport must bind the
**live** `threadId`, not the frozen mount-time `initialThreadId`, or reconnecting a fresh run would
rehydrate nothing.

### Retry safety

The two failure modes get deliberately different treatment:

| failure | safe to replay the request? | behaviour |
| --- | --- | --- |
| **401** | Yes. The server rejected it, so it never executed. | Silent — the next request carries a fresh token via §1, no user-visible step. |
| **dropped connection** | No. A `POST /runs` may have landed before the socket died. | Reconnect and *observe* (`since: <last seq>`); never re-submit. |

## Accepted trade-offs

- **A manual reconnect of a *busy* thread pays the stock checkpoint `getState` (~27s).**
  `makeReopenTransport` delegates busy/interrupted threads to it on purpose — the fast
  `thread.values` shape reads as idle and would freeze a live reopen or drop a HITL interrupt.
  Making that path fast is separate work. → ROADMAP.
- **Cloudflare Access expiry still produces a poor error** (`todos.md:141`). → ROADMAP.
- **`getSession()` on every request** adds a storage read (and a lock acquisition on web) per call.
  Measured cost is expected to be negligible against a network round trip; §5 checks it rather than
  assuming.

## Verification

There is no test runner in this repo, so this follows the established loop plus two new scripts.

| check | what it proves |
| --- | --- |
| `npx tsc --noEmit` | Types, including the `ProtocolSseTransportAdapter` → `AgentServerAdapter` substitution. |
| `npx expo export -p web` | The bundle still builds. |
| **`scripts/smoke-auth-expiry.mjs`** (new) | Sign in via the GoTrue password grant, rewrite `expires_at` in the persisted supabase session to now, then act: the request must **succeed** (proving the refresh fired through `onRequest`) rather than 401. Then invalidate the refresh token and assert the "Your session expired" copy appears instead of a raw error. Deterministic — no waiting an hour. |
| **`scripts/smoke-reconnect.mjs`** (new) | CDP request-interception fails the stream route mid-run; assert the `Reconnecting…` pill, restore the route, assert recovery **and that no duplicate run was submitted**. |
| SSE heartbeat probe | Read a live stream against the deployment and record whether `: heartbeat` comments appear, settling the §3 `idleReconnect` caveat one way or the other. |
| `getSession()` overhead probe | Time N sequential timeline reads with and without the hook; record the delta. |

Both new scripts join the README verification table and take credentials from the environment
(`CF_ACCESS_CLIENT_ID` / `_SECRET`, `SUPABASE_ANON_KEY`, `MUFFIN_EMAIL` / `MUFFIN_PASSWORD`), never
from committed files. Per `CLAUDE.md`: listen to **both** `pageerror` and `console`, and assert text
case-insensitively.

## Documentation to update

1. `muffin-ui/README.md` — auth section and the verification-script table.
2. `muffin-ui/CLAUDE.md` — four lessons: `defaultHeaders` is a snapshot and a memoized client
   freezes it; passing `fetch` silently zeroes the SSE reconnect budget (use `fetchFactory`);
   `onRequest` is the per-request auth chokepoint; `getSession()` semantics (margin, dedupe,
   preserve-vs-remove).
3. `muffin-ui/ROADMAP.md` — the milestone, plus the two deferred items above.
4. `muffin-umbrella/todos.md` — tick line 152; leave line 141 (Cloudflare Access) open.

## Rejected alternatives

- **Un-memoize the client so it rebuilds when the token changes.** Rebuilds `useStream`'s
  controller on every token refresh, re-running `hydrate` — the exact failure `use-run-stream.ts`
  already documents and works around.
- **Subscribe the transport to `onAuthStateChange` and mutate `defaultHeaders` in place.** Reaches
  into a private field, and races: a request prepared before the refresh still ships the old token.
  `onRequest` resolves the token at the last possible moment by construction.
- **A custom `fetch` wrapper that injects headers.** Equivalent for the transport, but the classic
  `Client` routes REST through its own `AsyncCaller`, so it would need a second mechanism anyway —
  and `onRequest` is the supported seam on both.
- **Detect 401 in a response interceptor, refresh, retry once.** Redundant once the token is fresh
  per request, and it duplicates dedupe and cooldown logic that supabase-js already implements
  correctly.
- **Global banner or forced navigation to `/auth` on expiry.** Rejected in favour of the inline
  card: no new banner primitive is needed, nothing navigates, and no hydration read is repeated.
