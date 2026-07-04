import type { Provider } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { openAuthSessionAsync } from 'expo-web-browser';
import { Platform } from 'react-native';

import type { IconName } from '@/components/icons';
import { getSupabase } from '@/lib/auth/client';
import { resolveBaseUrl } from '@/lib/resolve-url';
import { effectiveSupabase } from '@/lib/runtime-config';
import { getSettings } from '@/lib/settings/store';

/** OAuth providers the app can render a button for (icon + label). GoTrue
 * decides which are actually enabled — see `useEnabledProviders`. */
export const OAUTH_PROVIDERS: { id: Provider; label: string; icon: IconName }[] = [
  { id: 'github', label: 'Continue with GitHub', icon: 'github' },
  { id: 'google', label: 'Continue with Google', icon: 'google' },
];

/**
 * Providers enabled on the self-hosted GoTrue, from its public
 * `/auth/v1/settings` endpoint (`{ external: { github: true, … } }`). The app
 * shows a button only for providers that are both known here and enabled
 * server-side, so adding a provider's credentials to the deployment lights up
 * its button with no app change.
 */
export function useEnabledProviders() {
  return useQuery({
    queryKey: ['auth-providers'],
    queryFn: async () => {
      const eff = effectiveSupabase(getSettings());
      const url = resolveBaseUrl(eff.supabaseUrl);
      if (!url || !eff.supabaseAnonKey) return [];
      const res = await fetch(`${url}/auth/v1/settings`, {
        headers: { apikey: eff.supabaseAnonKey },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { external?: Record<string, boolean> };
      const external = data.external ?? {};
      return OAUTH_PROVIDERS.filter((p) => external[p.id]);
    },
    staleTime: 5 * 60_000,
  });
}

/** The URL the provider redirects back to after auth. Web returns to the app
 * origin; native uses the app's deep-link scheme. */
function redirectTo(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return Linking.createURL('/');
}

/**
 * Start an OAuth sign-in. On web this navigates the page to the provider and
 * returns; the session is picked up on redirect back (detectSessionInUrl). On
 * native it opens an in-app auth session and exchanges the returned code.
 */
export async function signInWithProvider(provider: Provider): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Accounts are not configured.');

  if (Platform.OS === 'web') {
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: redirectTo() },
    });
    if (error) throw new Error(error.message);
    return;
  }

  // Native: get the provider URL without auto-redirecting, open it in the
  // system auth session, then exchange the returned ?code= for a session.
  const redirect = redirectTo();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: redirect, skipBrowserRedirect: true },
  });
  if (error) throw new Error(error.message);
  if (!data?.url) throw new Error('Could not start the sign-in flow.');

  const result = await openAuthSessionAsync(data.url, redirect);
  if (result.type !== 'success') return; // user dismissed
  const code = new URL(result.url).searchParams.get('code');
  if (!code) throw new Error('No authorization code returned.');
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw new Error(exchangeError.message);
}
