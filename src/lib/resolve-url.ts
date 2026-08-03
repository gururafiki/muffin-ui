/**
 * Resolve a configured base URL to an absolute one.
 *
 * SDK clients (LangGraph, Supabase) build requests with `new URL()`, which
 * rejects relative bases. Browser same-origin defaults like `/api` or
 * `/supabase` are therefore resolved against the current origin on web; on
 * native there is no origin, so users configure full URLs in Settings. A
 * trailing slash is stripped so `${base}${path}` never double-slashes.
 *
 * Two things here are load-bearing on NATIVE, both found by running the app on
 * an Android emulator (the web build never hits either):
 *
 * 1. **The web check is `document`, not `window`.** React Native defines a
 *    global `window`, and the Expo dev client gives it a `location` pointing at
 *    the Metro server — so `typeof window !== 'undefined' && window.location`
 *    was TRUE on native and took the branch meant for browsers. That resolved
 *    a native user's default `/supabase` against `http://<metro-host>:8081`.
 *    React Native has no `document`, so it is the reliable discriminator.
 *
 * 2. **`new URL()` is wrapped.** This runs on every keystroke while a URL is
 *    being typed into Settings, so it sees partial values. `new URL('https:',
 *    'http://…')` throws (the input's scheme differs from the base's, so it is
 *    parsed as absolute and has no host) — an exception thrown during render,
 *    which took the whole app down. Worse, the interrupted edit persisted
 *    `https:` to MMKV, so the app then crashed on every launch with Settings —
 *    the only screen that could repair it — behind the crash. A base we cannot
 *    resolve must degrade to a failed request, never an unmountable app.
 */
export function resolveBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const onWeb = typeof document !== 'undefined' && typeof window !== 'undefined';
  if (onWeb && window.location?.origin) {
    try {
      return new URL(trimmed || '/', window.location.origin).href.replace(/\/+$/, '');
    } catch {
      // Half-typed input (e.g. "https:"). Hand it back untouched — the caller's
      // request will fail cleanly instead of the render throwing.
      return trimmed;
    }
  }
  return trimmed;
}
