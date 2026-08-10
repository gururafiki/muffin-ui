import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { getSupabase } from './client';
import { nextExpired } from './expiry';

/** The slice of the Supabase session the rest of the app consumes. */
export interface AuthSession {
  accessToken: string;
  userId: string;
  email?: string;
  /**
   * True when Supabase says this user is an admin.
   *
   * Read from `app_metadata`, NOT `user_metadata`: a user can edit their own `user_metadata`
   * through the normal auth API, so a role kept there is self-assignable and worth nothing.
   * `app_metadata` is writable only with the service key.
   *
   * This flag decides what the UI OFFERS, never what it is allowed to do — `market-refresh`
   * checks the same claim server-side on the verified token. A client-side boolean is a
   * convenience, not a permission.
   */
  isAdmin: boolean;
}

interface AuthState {
  session: AuthSession | null;
  /** True once the initial getSession() resolved (avoids signed-out flicker). */
  ready: boolean;
  /**
   * The session ended because it EXPIRED, not because the user signed out — so the
   * UI can say "your session expired" instead of the first-run "sign in to run
   * agents". See `expiry.ts` for how the two are told apart.
   */
  expired: boolean;
}

export const useAuth = create<AuthState>(() => ({
  session: null,
  ready: false,
  expired: false,
}));

/**
 * Set for the duration of an app-initiated `signOut()`. supabase-js emits the same
 * `SIGNED_OUT` event whether the user asked to leave or the refresh token was
 * rejected, so this flag is the only thing that distinguishes them.
 */
let intentionalSignOut = false;

/** Call immediately before `supabase.auth.signOut()`. */
export function beginIntentionalSignOut(): void {
  intentionalSignOut = true;
}

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session?.access_token || !session.user?.id) return null;
  const app = session.user.app_metadata as Record<string, unknown> | undefined;
  const roles = app?.roles;
  return {
    accessToken: session.access_token,
    userId: session.user.id,
    email: session.user.email ?? undefined,
    isAdmin: app?.role === 'admin' || (Array.isArray(roles) && roles.includes('admin')),
  };
}

let initialized = false;

/**
 * Start tracking the Supabase session (idempotent; called from the root
 * layout). supabase-js auto-refreshes tokens and emits onAuthStateChange —
 * the zustand store mirrors it so non-React call sites (`buildAuthHeaders`,
 * `buildConfigurable`) can read the live token synchronously.
 */
export function initAuth(): void {
  if (initialized) return;
  initialized = true;
  const supabase = getSupabase();
  if (!supabase) {
    useAuth.setState({ ready: true });
    return;
  }
  supabase.auth
    .getSession()
    .then(({ data }) => useAuth.setState({ session: toAuthSession(data.session), ready: true }))
    .catch(() => useAuth.setState({ ready: true }));
  supabase.auth.onAuthStateChange((event, session) => {
    const next = toAuthSession(session);
    const expired = nextExpired(useAuth.getState(), event, next, intentionalSignOut);
    // One-shot: the flag only covers the SIGNED_OUT it was set for.
    if (event === 'SIGNED_OUT') intentionalSignOut = false;
    useAuth.setState({ session: next, expired });
  });
}

/** Re-init after the Supabase URL / anon key settings change. */
export function reinitAuth(): void {
  initialized = false;
  useAuth.setState({ session: null, ready: false, expired: false });
  initAuth();
}

/** Non-reactive snapshot for use outside React. */
export const getAuthSession = (): AuthSession | null => useAuth.getState().session;
