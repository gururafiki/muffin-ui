import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from '@/lib/storage/zustand';

export type LlmProvider = 'openai' | 'anthropic' | 'openrouter' | 'ollama';

/** Research effort mode. Empty string = leave the server default unchanged. */
export type ResearchMode = '' | 'speed' | 'balanced' | 'quality';

/**
 * Tool-lessons policy (ToolKnowledgeConfiguration.tool_lessons_mode). Empty
 * string = leave the server default (`read_and_record`) unchanged.
 */
export type ToolLessonsMode = '' | 'read_and_record' | 'read_only' | 'off';

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
  /**
   * Optional static bearer token for the API's identity layer (`auth.py`).
   * A live Supabase session supersedes it. This is NOT the Cloudflare Access
   * credential — Access is a separate perimeter and wants the header PAIR
   * below, not a bearer.
   */
  authToken: string;
  /**
   * Cloudflare Access service-token id (`…​.access`). Access is the perimeter in
   * front of the deployed API; a browser passes it with an SSO cookie, but a
   * native client has no cookie jar for it, so iOS/Android must send the
   * service-token header pair or every request is bounced at the edge with an
   * Access login page (HTML 302/403) before it ever reaches langgraph-api.
   */
  cfAccessClientId: string;
  /** Cloudflare Access service-token secret. Pairs with `cfAccessClientId`. */
  cfAccessClientSecret: string;
  /** Stable identity for per-user memory isolation (configurable.user_id). */
  userId: string;
  /** Supabase URL. Web defaults to the same-origin `/supabase` proxy. */
  supabaseUrl: string;
  /** Supabase anon (public) key — enables the Account features when set. */
  supabaseAnonKey: string;
  /**
   * LLM provider override. Empty string = use the server's configured
   * `llm_chain` (e.g. the deployment's Ollama→OpenRouter fallback chain).
   * A concrete provider forces single-provider mode with your own key.
   */
  llmProvider: LlmProvider | '';
  model: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  openrouterApiKey: string;
  /** Ollama Cloud API key (native /api/chat, bearer auth). */
  ollamaApiKey: string;
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
  /** How agents use lessons learned from prior tool failures (blank = server default). */
  toolLessonsMode: ToolLessonsMode;

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
  cfAccessClientId: '',
  cfAccessClientSecret: '',
  userId: '',
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '/supabase',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  llmProvider: '',
  model: '',
  openaiApiKey: '',
  anthropicApiKey: '',
  openrouterApiKey: '',
  ollamaApiKey: '',
  openbbApiKey: '',
  temperature: '',
  orchestratorModels: '',
  collectorModels: '',
  reasonerModels: '',
  summariserModel: '',
  toolLessonsMode: '',
  openbbMcpUrl: '',
  firecrawlMcpUrl: '',
  researchDefaultMode: '',
  rerankThreshold: '',
  maxSearchResults: '',
  storeAllowedNamespaces: '',
};

interface SettingsState extends Settings {
  setMany: (patch: Partial<Settings>) => void;
  reset: () => void;
}

/**
 * Persisted via zustand `persist`: `version` + `migrate` guard on-device data
 * across shape changes (the storage adapter wraps pre-middleware bare payloads
 * as version 0), and the 400ms debounce batches the per-keystroke writes the
 * Settings screen produces.
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setMany: (patch) => set(patch),
      reset: () => set(DEFAULT_SETTINGS),
    }),
    {
      name: 'muffin.settings.v1',
      version: 1,
      // v0 (legacy bare payload) has the same field names as v1 — adopt as is;
      // add cases here when a field is renamed/retyped.
      migrate: (persisted) => persisted as Settings,
      storage: persistStorage({ debounceMs: 400 }),
      partialize: ({ setMany, reset, ...values }) => values,
    },
  ),
);

/** Non-reactive snapshot for use outside React (e.g. building a run config). */
export const getSettings = (): Settings => {
  const { setMany, reset, ...values } = useSettings.getState();
  return values;
};
