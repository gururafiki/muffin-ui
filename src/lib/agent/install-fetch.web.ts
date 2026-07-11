/** Browser fetch already supports streaming response bodies — nothing to do. */
export function installStreamingFetch() {}

/**
 * Web: return `undefined` so the protocol-v2 `useStream` transport uses the
 * browser's native (already streaming) `fetch`. Native supplies `expo/fetch`
 * — see install-fetch.native.ts.
 */
export function streamingFetch(): typeof fetch | undefined {
  return undefined;
}
