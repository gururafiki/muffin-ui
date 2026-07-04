import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

import { getSupabase } from './client';

/** The slice of the Supabase session the rest of the app consumes. */
export interface AuthSession {
  accessToken: string;
  userId: string;
  email?: string;
}

interface AuthState {
  session: AuthSession | null;
  /** True once the initial getSession() resolved (avoids signed-out flicker). */
  ready: boolean;
}

export const useAuth = create<AuthState>(() => ({ session: null, ready: false }));

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session?.access_token || !session.user?.id) return null;
  return {
    accessToken: session.access_token,
    userId: session.user.id,
    email: session.user.email ?? undefined,
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
  supabase.auth.onAuthStateChange((_event, session) => {
    useAuth.setState({ session: toAuthSession(session) });
  });
}

/** Re-init after the Supabase URL / anon key settings change. */
export function reinitAuth(): void {
  initialized = false;
  useAuth.setState({ session: null, ready: false });
  initAuth();
}

/** Non-reactive snapshot for use outside React. */
export const getAuthSession = (): AuthSession | null => useAuth.getState().session;
