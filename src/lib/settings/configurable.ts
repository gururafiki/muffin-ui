import type { Settings } from './store';

/**
 * Map user settings → LangGraph `config.configurable`.
 *
 * Field names mirror muffin-agent's `ModelConfiguration` / `McpConfiguration`
 * (src/muffin_agent/model_config.py, mcp_config.py), which read these straight
 * out of `configurable`. Only non-empty values are forwarded so we never clobber
 * a server default with a blank string.
 */
export function buildConfigurable(settings: Settings): Record<string, unknown> {
  const cfg: Record<string, unknown> = { llm_provider: settings.llmProvider };

  const put = (key: string, value: string) => {
    if (value && value.trim()) cfg[key] = value.trim();
  };
  /** Emit a parsed number, but only when the input is a finite value. */
  const putNum = (key: string, value: string) => {
    const s = value.trim();
    if (!s) return;
    const n = Number(s);
    if (Number.isFinite(n)) cfg[key] = n;
  };
  /** Emit a comma-separated list as a trimmed, non-empty string array. */
  const putList = (key: string, value: string) => {
    const items = value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (items.length) cfg[key] = items;
  };

  put('user_id', settings.userId);
  put('model', settings.model);
  put('openai_api_key', settings.openaiApiKey);
  put('anthropic_api_key', settings.anthropicApiKey);
  put('openrouter_api_key', settings.openrouterApiKey);
  // OpenBB BYO key — forwarded for when the backend wires per-user market-data
  // auth (M2). Harmless if the server ignores unknown configurable keys.
  put('openbb_api_key', settings.openbbApiKey);

  // Advanced knobs — names mirror the backend BaseConfiguration subclasses
  // (ModelConfiguration / McpConfiguration / ResearchConfiguration /
  // StoreConfiguration). Only non-empty values are forwarded.
  putNum('temperature', settings.temperature);
  putList('orchestrator_models', settings.orchestratorModels);
  putList('collector_models', settings.collectorModels);
  putList('reasoner_models', settings.reasonerModels);
  put('summariser_model', settings.summariserModel);
  put('openbb_mcp_url', settings.openbbMcpUrl);
  put('firecrawl_mcp_url', settings.firecrawlMcpUrl);
  put('research_default_mode', settings.researchDefaultMode);
  putNum('rerank_threshold', settings.rerankThreshold);
  putNum('max_search_results', settings.maxSearchResults);
  putList('store_allowed_namespaces', settings.storeAllowedNamespaces);

  return cfg;
}

/** Configurable keys that must never be written to a server-side assistant. */
const isSecretConfigKey = (key: string): boolean =>
  key.endsWith('_api_key') || key === 'user_id';

/**
 * Non-secret subset of `configurable`, for saving as a server-side assistant
 * preset. Strips API keys + `user_id` so the brand promise ("keys stay
 * private") holds — keys are re-injected from on-device settings at run time.
 */
export function buildPresetConfigurable(settings: Settings): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(buildConfigurable(settings)).filter(([k]) => !isSecretConfigKey(k)),
  );
}

/** Auth header for the LangGraph API, if a token is configured. */
export function buildAuthHeaders(settings: Settings): Record<string, string> {
  return settings.authToken.trim()
    ? { Authorization: `Bearer ${settings.authToken.trim()}` }
    : {};
}
