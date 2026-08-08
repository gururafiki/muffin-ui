import type { Settings } from '@/lib/settings/store';

import { getSupabase } from './client';
import type { TokenSource } from './request-hook';

/**
 * The production token source: supabase-js `getSession()`.
 *
 * Deliberately NOT `refreshSession()`, and deliberately not the zustand mirror
 * (`getAuthSession()`) — that mirror is only as fresh as the last
 * `onAuthStateChange`, which is exactly what a memoized client was already missing.
 *
 * `getSession()` is the right primitive because of three behaviours in auth-js:
 *
 * - it returns the cached token untouched while more than `EXPIRY_MARGIN_MS` (90s)
 *   from expiry, so the common case is a storage read, not a network call;
 * - inside that margin it refreshes through `_callRefreshToken`, which dedupes
 *   concurrent callers via a shared `refreshingDeferred` and rate-limits serial
 *   callers with a token-keyed failure cooldown — N parallel requests cause one
 *   `/token` call, and an outage cannot produce a refresh storm;
 * - on failure it distinguishes a network blip (access token still valid → session
 *   PRESERVED) from a dead refresh token (→ `_removeSession()` + `SIGNED_OUT`), which
 *   is the signal `lib/auth/expiry.ts` turns into the "your session expired" copy.
 *
 * Falls back to the manually-configured `authToken` setting when Supabase accounts
 * are not configured at all (local dev against an auth-disabled backend).
 */
export const liveToken: TokenSource = async (settings: Settings) => {
  const manual = settings.authToken.trim() || undefined;
  const supabase = getSupabase();
  if (!supabase) return manual;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? manual;
};
