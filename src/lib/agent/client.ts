import { Client } from '@langchain/langgraph-sdk';

import { liveToken } from '@/lib/auth/live-token';
import { authRequestHook } from '@/lib/auth/request-hook';
import { resolveBaseUrl } from '@/lib/resolve-url';
import { buildAuthHeaders } from '@/lib/settings/configurable';
import type { Settings } from '@/lib/settings/store';
import { installStreamingFetch } from './install-fetch';

/**
 * Build a LangGraph SDK client from the user's settings. The streaming-fetch
 * shim is installed once (native only) so `runs.stream` works on iOS/Android.
 */
export function makeClient(settings: Settings): Client {
  installStreamingFetch();
  return new Client({
    apiUrl: resolveBaseUrl(settings.apiUrl),
    defaultHeaders: buildAuthHeaders(settings),
    // Per-request token refresh, applied by the SDK AFTER the `defaultHeaders`
    // merge. Without it a client memoized for the life of a screen keeps sending
    // the token it was built with — which expires after an hour and 401s every
    // request until the page is reloaded.
    onRequest: authRequestHook(settings, liveToken),
  });
}
