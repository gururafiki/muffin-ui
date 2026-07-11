import { getWealthData, useWealth, type WealthData } from '@/features/wealth/store';
import { getSupabase } from '@/lib/auth/client';
import { getAuthSession } from '@/lib/auth/store';
import { getSettings, useSettings, type Settings } from '@/lib/settings/store';

/**
 * Opt-in cloud backup of the portfolio + a NON-SECRET settings subset to the
 * user's `user_backups` row (RLS: owner-only). Local-first — nothing syncs
 * automatically; the user presses Back up / Restore in Settings → Account.
 *
 * The brand promise is enforced here: API keys, tokens and connection
 * endpoints never leave the device.
 */
const EXCLUDED_SETTINGS = new Set<keyof Settings>([
  'apiUrl',
  'authToken',
  'userId',
  'supabaseUrl',
  'supabaseAnonKey',
  'openaiApiKey',
  'anthropicApiKey',
  'openrouterApiKey',
  'ollamaApiKey',
  'openbbApiKey',
]);

function nonSecretSettings(settings: Settings): Partial<Settings> {
  return Object.fromEntries(
    Object.entries(settings).filter(([k]) => !EXCLUDED_SETTINGS.has(k as keyof Settings)),
  ) as Partial<Settings>;
}

function requireCloud() {
  const supabase = getSupabase();
  const session = getAuthSession();
  if (!supabase || !session) throw new Error('Sign in to use cloud backup.');
  return { supabase, session };
}

export async function backupToCloud(): Promise<void> {
  const { supabase, session } = requireCloud();
  const { error } = await supabase.from('user_backups').upsert({
    user_id: session.userId,
    wealth: getWealthData(),
    settings: nonSecretSettings(getSettings()),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** Restore the cloud snapshot into the local stores. Returns its timestamp. */
export async function restoreFromCloud(): Promise<string> {
  const { supabase, session } = requireCloud();
  const { data, error } = await supabase
    .from('user_backups')
    .select('wealth, settings, updated_at')
    .eq('user_id', session.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('No cloud backup found for this account.');

  if (data.wealth) useWealth.getState().replaceAll(data.wealth as WealthData);
  if (data.settings) {
    // Defence in depth: re-strip in case an older client uploaded more.
    useSettings.getState().setMany(nonSecretSettings(data.settings as Settings));
  }
  return data.updated_at as string;
}
