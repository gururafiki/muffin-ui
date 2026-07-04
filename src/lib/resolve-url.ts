/**
 * Resolve a configured base URL to an absolute one.
 *
 * SDK clients (LangGraph, Supabase) build requests with `new URL()`, which
 * rejects relative bases. Browser same-origin defaults like `/api` or
 * `/supabase` are therefore resolved against the current origin on web; on
 * native there is no origin, so users configure full URLs in Settings. A
 * trailing slash is stripped so `${base}${path}` never double-slashes.
 */
export function resolveBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return new URL(trimmed || '/', window.location.origin).href.replace(/\/+$/, '');
  }
  return trimmed;
}
