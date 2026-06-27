import { Client } from '@langchain/langgraph-sdk';

import { buildAuthHeaders } from '@/lib/settings/configurable';
import type { Settings } from '@/lib/settings/store';
import { installStreamingFetch } from './install-fetch';

/**
 * Resolve the configured API URL to an absolute base.
 *
 * The LangGraph SDK builds every request as `new URL(`${apiUrl}${path}`)`,
 * which requires an absolute URL. Browser `fetch` accepts a relative
 * same-origin `/api`, but `new URL("/api/…")` throws "Failed to construct
 * 'URL': Invalid URL" — so a relative apiUrl must be resolved against the
 * current origin on web. (On native there is no origin; the user configures a
 * full URL in Settings.) A trailing slash is stripped so `${apiUrl}${path}`
 * never produces a double slash.
 */
export function resolveApiUrl(apiUrl: string): string {
  const trimmed = apiUrl.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(trimmed || '/', window.location.origin).href.replace(/\/+$/, '');
  }
  return trimmed;
}

/**
 * Build a LangGraph SDK client from the user's settings. The streaming-fetch
 * shim is installed once (native only) so `runs.stream` works on iOS/Android.
 */
export function makeClient(settings: Settings): Client {
  installStreamingFetch();
  return new Client({
    apiUrl: resolveApiUrl(settings.apiUrl),
    defaultHeaders: buildAuthHeaders(settings),
  });
}
