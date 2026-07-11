// Hermes lacks a full WHATWG URL implementation; supabase-js (auth/postgrest)
// builds URLs internally, so install the standard polyfill on native.
import 'react-native-url-polyfill/auto';

import { fetch as expoFetch } from 'expo/fetch';
import { overrideFetchImplementation } from '@langchain/langgraph-sdk';

/**
 * React Native's built-in `fetch` cannot stream a response body, which the
 * LangGraph SDK relies on for SSE. `expo/fetch` is a spec-compliant,
 * streaming-capable fetch — inject it as the SDK's transport on native.
 * Web is a no-op (browser fetch already streams). See install-fetch.ts.
 *
 * This global override covers the classic `Client` REST/stream calls (they
 * read it via `_getFetchImplementation()`). The protocol-v2 `useStream`
 * transport does NOT consult that global — it takes an explicit `fetch`
 * option — so `streamingFetch()` below is passed to it directly.
 */
let installed = false;
export function installStreamingFetch() {
  if (installed) return;
  overrideFetchImplementation(expoFetch);
  installed = true;
}

/**
 * The streaming-capable fetch to hand the protocol-v2 `useStream` transport
 * (`AgentServerOptions.fetch`), which uses `options.fetch ?? globalThis.fetch`
 * and never the override singleton. Native = `expo/fetch`; web returns
 * `undefined` so the browser's native streaming fetch is used.
 */
export function streamingFetch(): typeof fetch | undefined {
  return expoFetch as unknown as typeof fetch;
}
