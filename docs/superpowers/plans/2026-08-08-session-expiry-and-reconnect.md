# Session Expiry and Stream Reconnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent screen left open past the one-hour token expiry keeps working — no page reload — and a dropped run stream reconnects instead of dying silently.

**Architecture:** Two independent root causes, two independent fixes, both using options the SDKs already expose. (1) `buildAuthHeaders` is a snapshot frozen into a memoized client; replaced by an `onRequest` hook that resolves the token per request through `supabase.auth.getSession()`. (2) Passing `fetch` to the SSE transport zeroes its reconnect budget; replaced by `fetchFactory`, which does not trip that guard, plus explicit reconnect options.

**Tech Stack:** Expo SDK 56 / React Native 0.85 / React 19.2, `@langchain/langgraph-sdk` ^1.9.25, `@langchain/react` ^1.0.26, `@supabase/supabase-js` ^2.110.0, zustand ^5, TypeScript strict.

**Spec:** [`docs/superpowers/specs/2026-08-08-session-expiry-and-reconnect-design.md`](../specs/2026-08-08-session-expiry-and-reconnect-design.md)

## Global Constraints

- **There is no test runner.** The verification idiom is an offline script that imports the real modules and asserts with a `check(label, ok, detail)` counter, exactly like `scripts/run-timeline-check.ts`. New offline assertions go in `scripts/auth-check.ts`; browser gates are separate `.mjs` puppeteer scripts.
- **Offline-tested modules must be RN-free.** `scripts/auth-check.ts` runs under `tsx`, not Metro. Use `import type` for anything reaching `react-native`. Verified safe: `lib/settings/configurable.ts`, `zustand`, `@supabase/supabase-js`.
- Scripts use **relative** imports (`../src/...`), matching `run-timeline-check.ts` — not the `@/` alias.
- TS **strict**. Path aliases `@/*` → `src/*` in app code.
- **React Compiler is on** — avoid redundant manual memoization, but the existing `useMemo`s on client/transport are load-bearing and must stay (`use-run-stream.ts:88-93`).
- **Never re-introduce a client rebuild per render** — a new `client` or `transport` identity rebuilds `useStream`'s controller and re-runs `hydrate`.
- Pre-push gate: `npm run check` (= `typecheck` + `lint:all` + `verify:offline`).
- Commit style: imperative subject, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `muffin-ui` is Tier 1 — **`main` requires a PR**; no direct pushes.

---

### Task 1: RN-free header composition + the offline gate

**Files:**
- Create: `src/lib/auth/headers.ts`
- Create: `scripts/auth-check.ts`
- Modify: `src/lib/settings/configurable.ts:108-120`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `composeAuthHeaders(token: string | undefined, settings: Settings): Record<string, string>` — the single place the outbound auth header set is built. Consumed by Task 2 and by `buildAuthHeaders`.

- [ ] **Step 1: Write the failing checks** in `scripts/auth-check.ts`

```ts
import { composeAuthHeaders } from '../src/lib/auth/headers';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

const base = { authToken: '', cfAccessClientId: '', cfAccessClientSecret: '' } as Settings;

check('a token becomes a Bearer header', composeAuthHeaders('t1', base).Authorization === 'Bearer t1');
check('no token emits no Authorization', !('Authorization' in composeAuthHeaders(undefined, base)));
check('a blank token emits no Authorization', !('Authorization' in composeAuthHeaders('   ', base)));
const cf = { ...base, cfAccessClientId: 'id', cfAccessClientSecret: 'sec' };
check('both CF halves are emitted', composeAuthHeaders(undefined, cf)['CF-Access-Client-Id'] === 'id');
check('a lone CF id is not a credential', !('CF-Access-Client-Id' in composeAuthHeaders(undefined, { ...base, cfAccessClientId: 'id' })));
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/auth-check.ts`
Expected: FAIL — `Cannot find module '../src/lib/auth/headers'`

- [ ] **Step 3: Implement `src/lib/auth/headers.ts`**

```ts
import type { Settings } from '@/lib/settings/store';

/**
 * Compose the outbound auth header set from an ALREADY-RESOLVED token.
 *
 * Type-only imports on purpose: this module is imported by `scripts/auth-check.ts`
 * under plain `tsx`, where Metro's platform resolution does not exist and anything
 * reaching `react-native` fails to load.
 */
export function composeAuthHeaders(
  token: string | undefined,
  settings: Settings,
): Record<string, string> {
  const bearer = token?.trim();
  const cfId = settings.cfAccessClientId.trim();
  const cfSecret = settings.cfAccessClientSecret.trim();
  return {
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    ...(cfId && cfSecret
      ? { 'CF-Access-Client-Id': cfId, 'CF-Access-Client-Secret': cfSecret }
      : {}),
  };
}
```

- [ ] **Step 4: Delegate `buildAuthHeaders` to it** (`configurable.ts:108`), keeping its docblock

```ts
export function buildAuthHeaders(settings: Settings): Record<string, string> {
  return composeAuthHeaders(getAuthSession()?.accessToken ?? settings.authToken, settings);
}
```

- [ ] **Step 5: Add the npm script** — `"verify:auth": "tsx scripts/auth-check.ts"`, and extend `check` to `npm run typecheck && npm run lint:all && npm run verify:offline && npm run verify:auth`

- [ ] **Step 6: Run to verify it passes**

Run: `npx tsx scripts/auth-check.ts && npx tsc --noEmit`
Expected: ALL CHECKS PASSED, no type errors

- [ ] **Step 7: Commit** — `refactor: extract composeAuthHeaders and add an offline auth gate`

---

### Task 2: The per-request auth hook

**Files:**
- Create: `src/lib/auth/request-hook.ts`
- Create: `src/lib/auth/live-token.ts`
- Modify: `scripts/auth-check.ts`

**Interfaces:**
- Consumes: `composeAuthHeaders` (Task 1).
- Produces: `authRequestHook(settings: Settings, source: TokenSource): RequestHook` and `liveToken: TokenSource`, where `TokenSource = (settings: Settings) => Promise<string | undefined>` and `RequestHook = (url: URL, init: RequestInit) => Promise<RequestInit>`. Consumed by Tasks 3 and 6.

The token source is an explicit parameter so `request-hook.ts` stays RN-free and offline-testable; `liveToken` (which pulls supabase-js and storage) lives in its own module and is passed in at the two call sites.

- [ ] **Step 1: Write the failing checks** (append to `scripts/auth-check.ts`)

```ts
import { authRequestHook } from '../src/lib/auth/request-hook';

const url = new URL('https://example.test/threads');
const hook = authRequestHook(base, async () => 'fresh');

const out = await hook(url, { headers: { Authorization: 'Bearer stale', 'X-Keep': '1' } });
const h = new Headers(out.headers);
check('the hook overwrites a stale Authorization', h.get('Authorization') === 'Bearer fresh');
check('the hook preserves unrelated headers', h.get('X-Keep') === '1');

const signedOut = await authRequestHook(base, async () => undefined)(url, {
  headers: { Authorization: 'Bearer stale' },
});
check(
  'a signed-out request DELETES the stale Authorization',
  new Headers(signedOut.headers).get('Authorization') === null,
);

const threw = await authRequestHook(base, async () => {
  throw new Error('refresh exploded');
})(url, { headers: {} });
check('a throwing token source degrades to no header', new Headers(threw.headers).get('Authorization') === null);

const method = await hook(url, { method: 'POST', body: '{}' });
check('the hook preserves method and body', method.method === 'POST' && method.body === '{}');
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx scripts/auth-check.ts`
Expected: FAIL — `Cannot find module '../src/lib/auth/request-hook'`

- [ ] **Step 3: Implement `src/lib/auth/request-hook.ts`**

```ts
import type { Settings } from '@/lib/settings/store';

import { composeAuthHeaders } from './headers';

/** Resolves the freshest access token for a request. Injected so this module stays RN-free. */
export type TokenSource = (settings: Settings) => Promise<string | undefined>;

/** Mirrors the SDK's `RequestHook` / `ProtocolRequestHook` (identical signatures). */
export type RequestHook = (url: URL, init: RequestInit) => Promise<RequestInit>;

/**
 * Resolve auth headers at REQUEST time rather than at client-construction time.
 *
 * `defaultHeaders` is a snapshot, and both the run-stream client and the hydration
 * transport are memoized for the life of the screen — so a refreshed token never
 * reached an open run, and the screen 401'd until the page was reloaded. The SDK
 * applies this hook AFTER the `defaultHeaders` merge on every request path
 * (`getState`, SSE open, commands, reconnect, and `BaseClient.fetch`), which is
 * exactly the last-mile seam that fixes it.
 *
 * A failing source must not take the request down with it: we drop to unauthenticated
 * (reads are open) and let the server decide, rather than throwing inside the transport.
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
    // `set`, not `append`, so a stale Authorization from `defaultHeaders` is replaced
    // rather than duplicated — and DELETE it when there is no token, or the snapshot's
    // dead credential would outlive the session it came from.
    if (!next.Authorization) headers.delete('Authorization');
    for (const [key, value] of Object.entries(next)) headers.set(key, value);
    return { ...init, headers };
  };
}
```

- [ ] **Step 4: Implement `src/lib/auth/live-token.ts`**

```ts
import type { Settings } from '@/lib/settings/store';

import { getSupabase } from './client';
import type { TokenSource } from './request-hook';

/**
 * The production token source: supabase-js `getSession()`.
 *
 * Deliberately NOT `refreshSession()`. `getSession()` returns the cached token while
 * more than EXPIRY_MARGIN_MS (90s) from expiry — a storage read, not a network call —
 * and only inside that margin does it refresh, deduping concurrent callers through a
 * shared `refreshingDeferred` and rate-limiting serial retries with a token-keyed
 * failure cooldown. It also distinguishes a network blip (session preserved) from a
 * dead refresh token (session removed, `SIGNED_OUT` emitted).
 */
export const liveToken: TokenSource = async (settings: Settings) => {
  const manual = settings.authToken.trim() || undefined;
  const supabase = getSupabase();
  if (!supabase) return manual;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? manual;
};
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsx scripts/auth-check.ts && npx tsc --noEmit`
Expected: ALL CHECKS PASSED

- [ ] **Step 6: Commit** — `feat: resolve the access token per request instead of per client`

---

### Task 3: Wire the hook into the REST client

**Files:**
- Modify: `src/lib/agent/client.ts`

**Interfaces:**
- Consumes: `authRequestHook`, `liveToken` (Task 2).

This covers `threads.ts`, `presets.ts`, `run-graph.ts`, `use-run-timeline.ts` and the client `useStream` uses for `getHistory` / `runs.cancel`.

- [ ] **Step 1: Add `onRequest`**

```ts
  return new Client({
    apiUrl: resolveBaseUrl(settings.apiUrl),
    defaultHeaders: buildAuthHeaders(settings),
    // Per-request token refresh. `defaultHeaders` above still seeds the first
    // request; this replaces the Authorization on every request thereafter, so a
    // client memoized for the life of a screen can never ship an expired token.
    onRequest: authRequestHook(settings, liveToken),
  });
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint:all`
Expected: clean

- [ ] **Step 3: Commit** — `feat: refresh the token on every REST request`

---

### Task 4: Distinguish an expired session from a signed-out one

**Files:**
- Create: `src/lib/auth/expiry.ts`
- Modify: `src/lib/auth/store.ts`
- Modify: `src/features/account/run-gate.tsx`
- Modify: `src/features/account/account-card.tsx`
- Modify: `scripts/auth-check.ts`

**Interfaces:**
- Produces: `nextExpired(prev, event, next, intentional): boolean`; `useAuth` state gains `expired: boolean`; `beginIntentionalSignOut(): void`.

- [ ] **Step 1: Write the failing checks**

```ts
import { nextExpired } from '../src/lib/auth/expiry';

const signedIn = { session: { accessToken: 'a', userId: 'u' }, expired: false };
check('an unexpected SIGNED_OUT from a live session is an expiry',
  nextExpired(signedIn, 'SIGNED_OUT', null, false) === true);
check('a deliberate sign-out is NOT an expiry',
  nextExpired(signedIn, 'SIGNED_OUT', null, true) === false);
check('SIGNED_OUT with no prior session is not an expiry',
  nextExpired({ session: null, expired: false }, 'SIGNED_OUT', null, false) === false);
check('signing back in clears the flag',
  nextExpired({ session: null, expired: true }, 'SIGNED_IN', { accessToken: 'b', userId: 'u' }, false) === false);
check('a token refresh leaves the flag alone',
  nextExpired(signedIn, 'TOKEN_REFRESHED', { accessToken: 'c', userId: 'u' }, false) === false);
```

- [ ] **Step 2: Run to verify it fails** — `npx tsx scripts/auth-check.ts` → module not found

- [ ] **Step 3: Implement `src/lib/auth/expiry.ts`**

```ts
import type { AuthSession } from './store';

/**
 * Whether the session ended because it EXPIRED rather than because the user asked
 * to leave. supabase-js emits `SIGNED_OUT` for both, so the only distinguishing
 * signal is whether the app initiated it.
 */
export function nextExpired(
  prev: { session: AuthSession | null; expired: boolean },
  event: string,
  next: AuthSession | null,
  intentional: boolean,
): boolean {
  if (next) return false;
  if (event === 'SIGNED_OUT') return !intentional && prev.session != null;
  return prev.expired;
}
```

- [ ] **Step 4: Wire it into `store.ts`**

Add `expired: boolean` to `AuthState` (initial `false`), and:

```ts
let intentional = false;

/** Call immediately before `supabase.auth.signOut()` so the resulting
 *  `SIGNED_OUT` is not reported to the user as an expiry. */
export function beginIntentionalSignOut(): void {
  intentional = true;
}

  supabase.auth.onAuthStateChange((event, session) => {
    const next = toAuthSession(session);
    const prev = useAuth.getState();
    const expired = nextExpired(prev, event, next, intentional);
    if (event === 'SIGNED_OUT') intentional = false;
    useAuth.setState({ session: next, expired });
  });
```

`reinitAuth` resets `expired: false` alongside `session`/`ready`.

- [ ] **Step 5: Branch the copy** in `run-gate.tsx`

```tsx
export function SignInToRunNotice() {
  const router = useRouter();
  const expired = useAuth((s) => s.expired);
  return (
    <Card tone="outline" className="gap-2">
      <Text variant="heading" className="text-base">
        {expired ? 'Your session expired' : 'Sign in to run agents'}
      </Text>
      <Text variant="muted">
        {expired
          ? 'You were signed out after a period of inactivity. Sign in again to keep running agents — nothing on this page is lost.'
          : 'Browsing shared runs is open to everyone, but starting a new one needs an account. Your API keys stay on this device.'}
      </Text>
      <Button title={expired ? 'Sign in again' : 'Sign in / Create account'} onPress={() => router.push('/auth')} />
    </Card>
  );
}
```

- [ ] **Step 6: Mark the deliberate sign-out** in `account-card.tsx` — call `beginIntentionalSignOut()` on the line before `supabase.auth.signOut()`.

- [ ] **Step 7: Verify** — `npx tsx scripts/auth-check.ts && npx tsc --noEmit && npm run lint:all`

- [ ] **Step 8: Commit** — `feat: tell an expired session apart from a deliberate sign-out`

---

### Task 5: Connection-status store and the tracking fetch

**Files:**
- Create: `src/lib/agent/connection-status.ts`
- Modify: `scripts/auth-check.ts`

**Interfaces:**
- Produces: `useConnection` (zustand, `{ status: 'online' | 'reconnecting'; attempt: number }`), `setReconnecting(attempt)`, `setOnline()`, `withConnectionTracking(inner: typeof fetch): typeof fetch`.

`lost` is deliberately **not** a store state: attempt exhaustion is not observable (`onReconnect` fires *before* each attempt, never after the last one fails). The run screen derives it from `stream.error != null && status === 'reconnecting'`.

- [ ] **Step 1: Write the failing checks**

```ts
import { useConnection, setReconnecting, setOnline, withConnectionTracking } from '../src/lib/agent/connection-status';

setOnline();
check('starts online', useConnection.getState().status === 'online');
setReconnecting(2);
check('onReconnect marks reconnecting', useConnection.getState().status === 'reconnecting');
check('the attempt number is kept', useConnection.getState().attempt === 2);

const okFetch = withConnectionTracking(async () => new Response('{}', { status: 200 }));
await okFetch('https://example.test/stream');
check('a 2xx response clears back to online', useConnection.getState().status === 'online');

setReconnecting(1);
const badFetch = withConnectionTracking(async () => new Response('nope', { status: 503 }));
await badFetch('https://example.test/stream');
check('a non-2xx response does NOT clear reconnecting', useConnection.getState().status === 'reconnecting');

setReconnecting(1);
const throwing = withConnectionTracking(async () => { throw new Error('offline'); });
let propagated = false;
try { await throwing('https://example.test/stream'); } catch { propagated = true; }
check('a network throw still propagates to the SDK reconnect loop', propagated);
check('a network throw leaves reconnecting in place', useConnection.getState().status === 'reconnecting');
```

- [ ] **Step 2: Run to verify it fails** — module not found

- [ ] **Step 3: Implement `src/lib/agent/connection-status.ts`**

```ts
import { create } from 'zustand';

/**
 * Live connection state for the run stream.
 *
 * Written from two places, because the SDK exposes no on-open callback: the
 * transport's `onReconnect` marks `reconnecting` before each retry, and the fetch
 * wrapper below marks `online` again as soon as a request actually succeeds.
 *
 * There is deliberately no `lost` state here — attempt exhaustion is not observable
 * (`onReconnect` fires BEFORE each attempt, never after the last one fails). The SDK
 * closes the event queue with the error instead, so the run screen derives "lost"
 * from `stream.error` plus this status.
 */
interface ConnectionState {
  status: 'online' | 'reconnecting';
  attempt: number;
}

export const useConnection = create<ConnectionState>(() => ({ status: 'online', attempt: 0 }));

export const setReconnecting = (attempt: number): void =>
  useConnection.setState({ status: 'reconnecting', attempt });

export const setOnline = (): void => useConnection.setState({ status: 'online', attempt: 0 });

/**
 * Wrap the fetch handed to the SSE transport so a successful response clears the
 * reconnecting state. Errors are re-thrown untouched — the SDK's reconnect loop is
 * driven by them, so swallowing one would strand the stream.
 */
export function withConnectionTracking(inner: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await inner(input, init);
    if (response.ok) setOnline();
    return response;
  }) as typeof fetch;
}
```

- [ ] **Step 4: Verify** — `npx tsx scripts/auth-check.ts && npx tsc --noEmit`

- [ ] **Step 5: Commit** — `feat: track run-stream connection status`

---

### Task 6: Swap the transport so reconnect actually exists

**Files:**
- Modify: `src/features/agent-shared/fast-hydration-transport.ts`

**Interfaces:**
- Consumes: `authRequestHook`/`liveToken` (Task 2), `withConnectionTracking`/`setReconnecting`/`setOnline` (Task 5).
- Produces: `makeReopenTransport` keeps its existing signature.

`HttpAgentServerAdapter` forwards only `{apiUrl, threadId, defaultHeaders, onRequest, fetch, asyncCaller, paths}`, which is why `fetchFactory` / `maxReconnectAttempts` / `idleReconnect` / `onReconnect` are unreachable through it. `ProtocolSseTransportAdapter` (also exported) accepts all of them and declares a public `getState()` with exactly the `AgentServerAdapter["getState"]` signature.

- [ ] **Step 1: Replace the constructor**

```ts
  const adapter = new ProtocolSseTransportAdapter({
    apiUrl: resolveBaseUrl(settings.apiUrl),
    defaultHeaders: buildAuthHeaders(settings),
    onRequest: authRequestHook(settings, liveToken),
    // `fetchFactory`, NOT `fetch`. The transport zeroes its own reconnect budget
    // when `options.fetch != null` (`maxReconnectAttempts = options.fetch != null ? 0 : 5`),
    // so passing expo/fetch directly left native run streams with NO reconnect at
    // all. `resolveFetch()` checks the factory first and does not trip that guard.
    // `streamingFetch()` is undefined on web, hence the globalThis fallback — the
    // factory's return value is used verbatim.
    fetchFactory: () => withConnectionTracking(streamingFetch() ?? globalThis.fetch),
    maxReconnectAttempts: 5,
    idleReconnect: 'auto',
    onReconnect: ({ attempt }) => setReconnecting(attempt),
    threadId: initialThreadId,
  });
  setOnline();
```

Keep the entire existing docblock (the constructor-time `getState()` binding rationale is unchanged and still load-bearing) and the existing `getState` override verbatim, including the busy/interrupted delegation.

- [ ] **Step 2: Verify the substitution typechecks**

Run: `npx tsc --noEmit`
Expected: clean — if `ProtocolSseTransportAdapter` does not satisfy `AgentServerAdapter` structurally, STOP and report rather than casting.

- [ ] **Step 3: Verify the bundle builds** — `npx expo export -p web`

- [ ] **Step 4: Commit** — `fix: give the run stream a reconnect loop on native`

---

### Task 7: A Reconnect action on the stream

**Files:**
- Modify: `src/features/agent-shared/use-run-stream.ts:49-75`

**Interfaces:**
- Produces: `useRunStream` returns `reconnect: () => void` alongside `{ stream, threadId, submitRun, resume }`.

`useStream` keys its controller on `[client, assistantId, transport]`, so a new transport identity rebuilds the `StreamController` — re-hydrate plus a fresh event pump — without remounting the React tree. The rebuilt transport must bind the **live** thread id, not the frozen mount-time one.

- [ ] **Step 1: Replace `initialThreadId` with a reconnect target**

```ts
  // Freezes the MOUNT-TIME threadId exactly as the old `initialThreadId` did (the
  // controller calls getState() from its constructor, before setThreadId), while
  // giving `reconnect()` a way to rebuild the transport bound to the LIVE thread.
  // Bumping this object's identity is the supported way to force a fresh
  // StreamController: useStream keys it on [client, assistantId, transport].
  const [reconnectTarget, setReconnectTarget] = useState<{
    nonce: number;
    threadId: string | undefined;
  }>({ nonce: 0, threadId: opts.threadId });

  const transport = useMemo(
    () => makeReopenTransport(client, getSettings(), reconnectTarget.threadId),
    [client, reconnectTarget],
  );
```

- [ ] **Step 2: Add the action** (an event handler, so reading `threadId` state here is correct)

```ts
  /**
   * Rebuild the transport to re-hydrate and re-open the event pump after the SDK's
   * own reconnect budget is exhausted. Never re-submits: a dropped socket does not
   * mean the run stopped, and replaying a POST could start a duplicate.
   */
  const reconnect = () =>
    setReconnectTarget((prev) => ({ nonce: prev.nonce + 1, threadId: threadId ?? prev.threadId }));
```

- [ ] **Step 3: Return it** — `return { stream, threadId, submitRun, resume, reconnect };`

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npm run lint:all`

- [ ] **Step 5: Commit** — `feat: expose a reconnect action on the run stream`

---

### Task 8: Surface it — pill and button

**Files:**
- Modify: `src/features/agent-shared/run-recap.tsx`
- Modify: `src/features/agent-shared/run-surface.tsx:38-46`
- Modify: `src/features/agent-runner/agent-runner.tsx`
- Modify: `src/features/council/council-screen.tsx`
- Modify: `src/features/agent-chat/chat-screen.tsx`

**Interfaces:**
- Consumes: `useConnection` (Task 5), `reconnect` (Task 7).
- Produces: `RunRecap` gains `reconnecting?: boolean`; `RunErrorCard` gains `onRetry?: () => void`.

- [ ] **Step 1: `RunRecap`** — extend `RunState` with `'reconnecting'`, add the `reconnecting?: boolean` prop, and place it in the precedence chain **above** `busy` (a reconnecting run is still busy, and the more specific state should win):

```ts
const state: RunState = reconnecting ? 'reconnecting' : busy ? 'running' : loading ? 'loading' : failed ? 'error' : 'done';
```

In `StatusPill`, reuse the butter pulsing branch so the dot keeps animating, labelling it `Reconnecting…`:

```tsx
      <Text className="font-heading text-xs text-butter-600">
        {state === 'running' ? 'Running' : state === 'reconnecting' ? 'Reconnecting…' : 'Loading'}
      </Text>
```

- [ ] **Step 2: `RunErrorCard`** — add the retry affordance

```tsx
export function RunErrorCard({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (error == null) return null;
  return (
    <Card tone="outline" className="gap-2">
      <Badge label="error" tone="bearish" />
      <Text variant="muted">{error instanceof Error ? error.message : String(error)}</Text>
      {onRetry ? (
        <View className="flex-row">
          <Button title="Reconnect" variant="secondary" size="sm" onPress={onRetry} />
        </View>
      ) : null}
    </Card>
  );
}
```

Add `Button` to the `@/components/ui` import.

- [ ] **Step 3: Wire the three screens.** In each, pull `reconnect` from `useRunStream`, read the status, and pass both through:

```tsx
const connection = useConnection((s) => s.status);
const reconnecting = connection === 'reconnecting';
…
<RunRecap … busy={busy} reconnecting={reconnecting} />
<RunErrorCard error={stream.error} onRetry={reconnect} />
```

`chat-screen.tsx` has no `RunRecap`; it gets the `RunErrorCard` change only.

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npm run lint:all && npx expo export -p web`

- [ ] **Step 5: Commit** — `feat: show reconnecting state and a reconnect action`

---

### Task 9: Browser gates

**Files:**
- Create: `scripts/smoke-auth-expiry.mjs`
- Create: `scripts/smoke-reconnect.mjs`

Both follow `scripts/smoke-reopen.mjs`: ESM `puppeteer-core`, serve `dist/`, proxy `/api` with CF Access headers from the environment, listen to **both** `pageerror` and `console`, assert text **case-insensitively**, wait for the body text to stop growing rather than sleeping a constant.

- [ ] **Step 1: `smoke-auth-expiry.mjs`** — sign in via the GoTrue password grant, then in the page rewrite `expires_at` in the persisted supabase session to `Math.floor(Date.now()/1000)`, then act. Assert: the request **succeeds** (the refresh fired through `onRequest`) and no 401 appears in the network log. Then replace `refresh_token` with garbage, force another action, and assert the page shows `your session expired` rather than a raw error.

- [ ] **Step 2: `smoke-reconnect.mjs`** — start a run, use request interception to fail `**/stream/events`, assert the `reconnecting` pill appears, lift the interception, assert recovery, and assert exactly one `POST` to `/runs` across the whole session (no duplicate submit).

- [ ] **Step 3: Run both against a local `dist/`** with `CF_ACCESS_CLIENT_ID` / `_SECRET` / `SUPABASE_ANON_KEY` / `MUFFIN_EMAIL` / `MUFFIN_PASSWORD` from the environment. Credentials are never committed.

- [ ] **Step 4: Commit** — `test: browser gates for session expiry and stream reconnect`

---

### Task 10: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `ROADMAP.md`, `../todos.md`

- [ ] **Step 1: `README.md`** — the auth section and the verification-script table (`verify:auth`, the two new smoke scripts).

- [ ] **Step 2: `CLAUDE.md`** — four lessons: `defaultHeaders` is a snapshot and a memoized client freezes it; passing `fetch` to the SSE transport silently zeroes the reconnect budget (use `fetchFactory`); `onRequest` is the per-request auth chokepoint on both `Client` and the transport; `getSession()` semantics (90s margin, dedupe, preserve-vs-remove on failure).

- [ ] **Step 3: `ROADMAP.md`** — the milestone, plus the two deferred items: **Cloudflare Access expiry** (still a poor error) and **a manual reconnect of a busy thread pays the ~27s checkpoint `getState`**.

- [ ] **Step 4: `../todos.md`** — tick line 152; leave line 141 open.

- [ ] **Step 5: Commit** — `docs: session expiry and reconnect`

---

## Self-Review

**Spec coverage:** §1 `onRequest` → Tasks 1–3, 6. §2 expired-vs-signed-out → Task 4. §3 native reconnect → Task 6. §4 pill/Reconnect + transport-identity bump → Tasks 5, 7, 8. §5 verification → Tasks 1, 9 (heartbeat and overhead probes fold into Task 9's run). §6 docs → Task 10. Retry-safety table → enforced by Task 7's "never re-submits" and Task 9 Step 2's single-POST assertion.

**Placeholder scan:** No TBD/TODO; every code step carries real code.

**Type consistency:** `composeAuthHeaders(token, settings)` (Task 1) is called with the same argument order in Tasks 2 and 4. `TokenSource`/`RequestHook` (Task 2) are the types used in Tasks 3 and 6. `setReconnecting(attempt)`/`setOnline()` (Task 5) match Task 6's `onReconnect` destructure. `reconnect` (Task 7) matches `onRetry` (Task 8).
