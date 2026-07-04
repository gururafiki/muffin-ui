import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { resolveBaseUrl } from '@/lib/resolve-url';
import { effectiveSupabase } from '@/lib/runtime-config';
import { getSettings } from '@/lib/settings/store';
import { storage } from '@/lib/storage';

/**
 * Supabase client built from on-device settings. `supabaseUrl` follows the
 * same relative-default trick as the API URL: web defaults to the same-origin
 * `/supabase` nginx proxy (resolved to an absolute URL here — supabase-js
 * requires one); native needs the full `https://supabase.<domain>` in
 * Settings. Auth state persists through the shared KeyValueStore (MMKV /
 * localStorage) so sessions survive restarts on every platform.
 *
 * Returns null when no anon key is configured — the whole account feature is
 * opt-in and the app stays fully usable anonymously.
 */
let cached: { key: string; client: SupabaseClient } | null = null;

export function getSupabase(): SupabaseClient | null {
  const eff = effectiveSupabase(getSettings());
  const url = resolveBaseUrl(eff.supabaseUrl);
  const anonKey = eff.supabaseAnonKey;
  if (!url || !/^https?:\/\//i.test(url) || !anonKey) return null;

  const cacheKey = `${url}|${anonKey}`;
  if (cached?.key === cacheKey) return cached.client;
  const client = createClient(url, anonKey, {
    auth: {
      storage: {
        getItem: (key: string) => storage.getString(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      autoRefreshToken: true,
      persistSession: true,
      // The email flows we use (password + autoconfirm) don't need URL
      // detection; keeping it off avoids web history rewrites on load.
      detectSessionInUrl: false,
    },
  });
  cached = { key: cacheKey, client };
  return client;
}
