/**
 * Offline gate for the auth-header / session-expiry / connection-status layer.
 * Imports the REAL modules, so a regression fails here instead of in prod.
 *
 *   npx tsx scripts/auth-check.ts        # offline; no credentials needed
 *
 * ## Why these modules are import-safe under plain `tsx`
 *
 * This runs under Node, not Metro, so platform resolution (`foo.native.ts`) and the
 * React Native runtime do not exist. Everything asserted here is deliberately
 * RN-free: `lib/auth/headers.ts` and `lib/auth/request-hook.ts` take `Settings` as a
 * TYPE-ONLY import, and zustand is plain JS. The production token source
 * (`lib/auth/live-token.ts`) is NOT imported — that is exactly why `authRequestHook`
 * takes its token source as a parameter.
 *
 * End-to-end confirmation in a real browser is `scripts/smoke-auth-expiry.mjs`
 * (needs credentials). There is deliberately NO browser gate for reconnect: it would
 * need a live run to drop a stream mid-flight, which is slow, costs LLM calls and is
 * flaky. The reconnect-budget check at the bottom of this file guards the actual
 * regression instead — that a supplied `fetch` silently zeroes the retry budget.
 */
import { composeAuthHeaders } from '../src/lib/auth/headers';
import { nextExpired } from '../src/lib/auth/expiry';
import { authRequestHook } from '../src/lib/auth/request-hook';
import { makeReopenTransport } from '../src/features/agent-shared/fast-hydration-transport';
import {
  setOnline,
  setReconnecting,
  useConnection,
  withConnectionTracking,
} from '../src/lib/agent/connection-status';
import type { Settings } from '../src/lib/settings/store';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok ' : 'FAIL '} ${label}${detail ? ` — ${detail}` : ''}`);
}

/** Only the three fields `composeAuthHeaders` reads; the rest of Settings is irrelevant. */
const base = {
  authToken: '',
  cfAccessClientId: '',
  cfAccessClientSecret: '',
} as Settings;

async function main(): Promise<void> {
  console.log('\n## composeAuthHeaders\n');
  {
    check('a token becomes a Bearer header', composeAuthHeaders('t1', base).Authorization === 'Bearer t1');
    check('a token is trimmed', composeAuthHeaders('  t2  ', base).Authorization === 'Bearer t2');
    check('no token emits no Authorization', !('Authorization' in composeAuthHeaders(undefined, base)));
    check('a blank token emits no Authorization', !('Authorization' in composeAuthHeaders('   ', base)));

    const cf = { ...base, cfAccessClientId: 'id', cfAccessClientSecret: 'sec' };
    const both = composeAuthHeaders(undefined, cf);
    check(
      'both CF halves are emitted together',
      both['CF-Access-Client-Id'] === 'id' && both['CF-Access-Client-Secret'] === 'sec',
    );
    // A lone id is not a credential — it would just look like a malformed request
    // at the edge, which is harder to diagnose than sending nothing.
    check(
      'a lone CF id is not a credential',
      !('CF-Access-Client-Id' in composeAuthHeaders(undefined, { ...base, cfAccessClientId: 'id' })),
    );
    check(
      'a lone CF secret is not a credential',
      !('CF-Access-Client-Secret' in composeAuthHeaders(undefined, { ...base, cfAccessClientSecret: 's' })),
    );
  }

  console.log('\n## authRequestHook\n');
  {
    const url = new URL('https://example.test/threads');
    const hook = authRequestHook(base, async () => 'fresh');

    const out = await hook(url, { headers: { Authorization: 'Bearer stale', 'X-Keep': '1' } });
    const h = new Headers(out.headers);
    // The whole point: `defaultHeaders` is a snapshot taken at client construction,
    // so the hook has to WIN over whatever it seeded.
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
    check(
      'a throwing token source degrades to no header rather than killing the request',
      new Headers(threw.headers).get('Authorization') === null,
    );

    const method = await hook(url, { method: 'POST', body: '{}' });
    check('the hook preserves method and body', method.method === 'POST' && method.body === '{}');

    const cfHook = authRequestHook({ ...base, cfAccessClientId: 'id', cfAccessClientSecret: 'sec' }, async () => 't');
    const cfOut = new Headers((await cfHook(url, { headers: {} })).headers);
    check('the hook also emits CF Access headers', cfOut.get('CF-Access-Client-Id') === 'id');
  }

  console.log('\n## nextExpired\n');
  {
    const session = { accessToken: 'a', userId: 'u' };
    const signedIn = { session, expired: false };
    check(
      'an unexpected SIGNED_OUT from a live session is an expiry',
      nextExpired(signedIn, 'SIGNED_OUT', null, false) === true,
    );
    check(
      'a deliberate sign-out is NOT an expiry',
      nextExpired(signedIn, 'SIGNED_OUT', null, true) === false,
    );
    // Reload-after-idle: the store starts EMPTY and supabase discovers the dead
    // session during initAuth. Gating this on a previous session (as an earlier cut
    // did) reduced the most common real path back to the first-run copy.
    check(
      'SIGNED_OUT during a cold start still counts as an expiry',
      nextExpired({ session: null, expired: false }, 'SIGNED_OUT', null, false) === true,
    );
    // A browser that never had a session gets INITIAL_SESSION, never SIGNED_OUT.
    check(
      'a first-ever visit is not an expiry',
      nextExpired({ session: null, expired: false }, 'INITIAL_SESSION', null, false) === false,
    );
    check(
      'signing back in clears the flag',
      nextExpired({ session: null, expired: true }, 'SIGNED_IN', session, false) === false,
    );
    check(
      'a token refresh leaves the flag alone',
      nextExpired(signedIn, 'TOKEN_REFRESHED', session, false) === false,
    );
    check(
      'an unrelated event preserves a set flag',
      nextExpired({ session: null, expired: true }, 'INITIAL_SESSION', null, false) === true,
    );
  }

  console.log('\n## connection status\n');
  {
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
    check(
      'a non-2xx response does NOT clear reconnecting',
      useConnection.getState().status === 'reconnecting',
    );

    // The SDK's reconnect loop is driven by the throw — swallowing it would strand
    // the stream in `reconnecting` with nothing left to retry it.
    setReconnecting(1);
    const throwing = withConnectionTracking(async () => {
      throw new Error('offline');
    });
    let propagated = false;
    try {
      await throwing('https://example.test/stream');
    } catch {
      propagated = true;
    }
    check('a network throw still propagates to the SDK reconnect loop', propagated);
    check('a network throw leaves reconnecting in place', useConnection.getState().status === 'reconnecting');
    setOnline();
  }

  console.log('\n## the SSE transport keeps its reconnect budget\n');
  {
    // The trap this guards: `ProtocolSseTransportAdapter` ZEROES its own reconnect
    // loop when a `fetch` is supplied —
    //   maxReconnectAttempts = options.fetch != null ? 0 : options.maxReconnectAttempts ?? 5
    // — and `streamingFetch()` returns expo/fetch on native. Passing `fetch` (which
    // `HttpAgentServerAdapter` forced, since it forwards no reconnect options) left
    // native run streams unable to reconnect at all: one blip killed the stream.
    // Reading these back off the constructed adapter is the only way to assert the
    // budget survived; they are TS-private, not `#private`, so they exist at runtime.
    const settings = {
      apiUrl: 'https://example.test',
      authToken: '',
      cfAccessClientId: '',
      cfAccessClientSecret: '',
    } as Settings;
    const adapter = makeReopenTransport({} as never, settings, 'thread-1') as unknown as {
      maxReconnectAttempts: number;
      idleReconnect: unknown;
      threadId: string;
    };
    check(
      'reconnect attempts are NOT zeroed by supplying a fetch',
      adapter.maxReconnectAttempts === 5,
      `got ${adapter.maxReconnectAttempts}`,
    );
    check(
      'idle reconnect stays armed',
      adapter.idleReconnect === 'auto',
      `got ${JSON.stringify(adapter.idleReconnect)}`,
    );
    // Load-bearing: the controller calls getState() from its constructor, before
    // setThreadId, so an unbound adapter hydrates nothing and the panel renders empty.
    check('the adapter is bound to its thread at construction', adapter.threadId === 'thread-1');
    setOnline();
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
