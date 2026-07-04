import { create } from 'zustand';

import { storage } from '@/lib/storage';

export type LlmProvider = 'openai' | 'anthropic' | 'openrouter';

/** Research effort mode. Empty string = leave the server default unchanged. */
export type ResearchMode = '' | 'speed' | 'balanced' | 'quality';

/**
 * User-owned configuration. Per the "bring your own keys" model, these live
 * on-device only and are injected into each run's `configurable` — never
 * persisted server-side by the client.
 *
 * Field names here are UI-facing (camelCase); `configurable.ts` maps them to the
 * snake_case keys the backend's `BaseConfiguration` subclasses read. The
 * "Advanced configuration" block (everything below `openbbApiKey`) surfaces the
 * model-role / MCP / research / store knobs the agents already honour at
 * runtime — empty means "leave the server default".
 */
export interface Settings {
  /** LangGraph server base URL. Web defaults to the same-origin `/api` proxy. */
  apiUrl: string;
  /** Optional bearer / Cloudflare Access service token for the API. */
  authToken: string;
  /** Stable identity for per-user memory isolation (configurable.user_id). */
  userId: string;
  /** Supabase URL. Web defaults to the same-origin `/supabase` proxy. */
  supabaseUrl: string;
  /** Supabase anon (public) key — enables the Account features when set. */
  supabaseAnonKey: string;
  llmProvider: LlmProvider;
  model: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey: string;
  /** OpenBB personal access token (BYO market-data key). */
  openbbApiKey: string;

  // ── Advanced: model roles (ModelConfiguration) ───────────────────────
  /** Sampling temperature (0–2). */
  temperature: string;
  /** Comma-separated model chain for the orchestrator role (primary, ...fallbacks). */
  orchestratorModels: string;
  /** Comma-separated model chain for the collector role. */
  collectorModels: string;
  /** Comma-separated model chain for the reasoner role. */
  reasonerModels: string;
  /** Cheap/fast model used to summarise tool failures into one-line lessons. */
  summariserModel: string;

  // ── Advanced: MCP servers (McpConfiguration) ─────────────────────────
  openbbMcpUrl: string;
  firecrawlMcpUrl: string;

  // ── Advanced: research (ResearchConfiguration) ───────────────────────
  researchDefaultMode: ResearchMode;
  /** Cosine rerank cutoff for research evidence (0–1). */
  rerankThreshold: string;
  /** Max web-search results per research iteration. */
  maxSearchResults: string;

  // ── Advanced: store access (StoreConfiguration) ──────────────────────
  /** Comma-separated namespace prefixes an agent may access (blank = unrestricted). */
  storeAllowedNamespaces: string;
}

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: process.env.EXPO_PUBLIC_API_URL ?? '/api',
  authToken: '',
  userId: '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '/supabase',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  llmProvider: 'openrouter',
  model: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  openrouterApiKey: '',
  openbbApiKey: '',
  temperature: '',
  orchestratorModels: '',
  collectorModels: '',
  reasonerModels: '',
  summariserModel: '',
  openbbMcpUrl: '',
  firecrawlMcpUrl: '',
  researchDefaultMode: '',
  rerankThreshold: '',
  maxSearchResults: '',
  storeAllowedNamespaces: '',
};

const STORAGE_KEY = 'muffin.settings.v1';

function load(): Settings {
  const raw = storage.getString(STORAGE_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsState extends Settings {
  setMany: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  setMany: (patch) => {
    set(patch);
    const { setMany, reset, ...values } = get();
    storage.set(STORAGE_KEY, JSON.stringify(values));
  },
  reset: () => {
    set(DEFAULT_SETTINGS);
    storage.delete(STORAGE_KEY);
  },
}));

/** Non-reactive snapshot for use outside React (e.g. building a run config). */
export const getSettings = (): Settings => {
  const { setMany, reset, ...values } = useSettings.getState();
  return values;
};
