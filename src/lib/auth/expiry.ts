import type { AuthSession } from './store';

/**
 * Whether the session ended because it EXPIRED rather than because the user asked to
 * leave.
 *
 * supabase-js emits `SIGNED_OUT` for both cases — an explicit `signOut()` and the
 * `_removeSession()` it performs when a refresh token is rejected and the access
 * token has also expired. The only distinguishing signal available to us is whether
 * the app initiated it, which `beginIntentionalSignOut()` records.
 *
 * Pure and RN-free so `scripts/auth-check.ts` can pin the truth table offline.
 */
export function nextExpired(
  prev: { session: AuthSession | null; expired: boolean },
  event: string,
  next: AuthSession | null,
  intentional: boolean,
): boolean {
  // Any live session clears it, whatever the event was.
  if (next) return false;
  // `SIGNED_OUT` is emitted ONLY from `_removeSession()`, which by definition means a
  // stored session was removed — an explicit `signOut()`, or a refresh token that was
  // rejected while the access token had also expired. A browser that never had a
  // session gets `INITIAL_SESSION`, not this. So the event alone is sufficient
  // evidence, and it must NOT be additionally gated on `prev.session != null`:
  // on a page RELOAD the store starts empty and the death is discovered during
  // `initAuth`, which is the single most common way a user meets this (they come
  // back to an idle tab and reload). Gating on the previous state silently reduced
  // that case to the first-run "sign in to run agents" copy.
  if (event === 'SIGNED_OUT') return !intentional;
  return prev.expired;
}
