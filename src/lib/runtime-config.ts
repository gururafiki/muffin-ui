/**
 * Deployment-injected runtime config (web).
 *
 * The nginx image serves `/runtime-config.js` (written from env at container
 * start — see `deploy/40-runtime-config.sh`), loaded before the app bundle via
 * `src/app/+html.tsx`. This keeps the built image deployment-independent while
 * still shipping the deployment's **public** Supabase URL + anon key, so the
 * app knows accounts are enabled without every user pasting a key in Settings.
 *
 * On native (and in dev, where the file 404s) the global is absent and every
 * field falls back to empty — callers then use the Settings value / defaults.
 */
export interface RuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
}

interface RuntimeConfigGlobal {
  __MUFFIN_CONFIG__?: Partial<RuntimeConfig>;
}

export function getRuntimeConfig(): RuntimeConfig {
  const g = (globalThis as unknown as RuntimeConfigGlobal).__MUFFIN_CONFIG__;
  return {
    supabaseUrl: typeof g?.supabaseUrl === 'string' ? g.supabaseUrl : '',
    supabaseAnonKey: typeof g?.supabaseAnonKey === 'string' ? g.supabaseAnonKey : '',
  };
}

/** Effective Supabase config: explicit Settings override wins, else the
 * deployment default, else the same-origin `/supabase` proxy. */
export function effectiveSupabase(settings: {
  supabaseUrl: string;
  supabaseAnonKey: string;
}): RuntimeConfig {
  const rc = getRuntimeConfig();
  return {
    supabaseUrl: settings.supabaseUrl.trim() || rc.supabaseUrl || '/supabase',
    supabaseAnonKey: settings.supabaseAnonKey.trim() || rc.supabaseAnonKey,
  };
}
