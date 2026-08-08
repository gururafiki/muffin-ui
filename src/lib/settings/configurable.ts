import { composeAuthHeaders } from '@/lib/auth/headers';
import { getAuthSession } from '@/lib/auth/store';

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
  const cfg: Record<string, unknown> = {};

  // A concrete provider is a single-provider override: send it AND clear the
  // server's `llm_chain` so the override actually wins (the chain otherwise
  // supersedes llm_provider for every role). Empty = leave the server default.
  if (settings.llmProvider) {
    cfg.llm_provider = settings.llmProvider;
    cfg.llm_chain = [];
  }

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

  // Signed-in Supabase users get their verified UUID as the memory identity;
  // the manually-configured userId remains the anonymous/local fallback.
  put('user_id', getAuthSession()?.userId ?? settings.userId);
  put('model', settings.model);
  put('openai_api_key', settings.openaiApiKey);
  put('anthropic_api_key', settings.anthropicApiKey);
  put('openrouter_api_key', settings.openrouterApiKey);
  put('ollama_api_key', settings.ollamaApiKey);
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
  put('tool_lessons_mode', settings.toolLessonsMode);
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

/**
 * Auth headers for the LangGraph API. There are TWO independent layers and
 * they are not interchangeable:
 *
 * 1. **Identity** (`Authorization: Bearer …`) — the agent's `auth.py`. A live
 *    Supabase session wins; the static `authToken` is the fallback.
 * 2. **Perimeter** (`CF-Access-Client-*`) — Cloudflare Access, in front of the
 *    whole deployment. The web build never needs it (the browser carries an
 *    Access SSO cookie and nginx proxies same-origin), but a native client has
 *    no such cookie, so iOS/Android must send the service-token pair or every
 *    request is bounced at the edge before reaching the API.
 *
 * Both are emitted together when configured — passing Access does not
 * authenticate you to the agent, and a user token does not get you past Access.
 *
 * This is the single chokepoint for outbound API headers: `makeClient`,
 * `makeReopenTransport` and (through the memoized client) `useRunStream` all
 * read it, so a credential added here reaches every request path. The header
 * composition itself lives in `lib/auth/headers.ts`, shared with the per-request
 * hook so the two can never disagree.
 *
 * NOTE this is the SYNCHRONOUS snapshot that seeds `defaultHeaders`, and it is only
 * as fresh as the last `onAuthStateChange` — not good enough on its own, because
 * both the run-stream client and the hydration transport are memoized for the life
 * of the screen, so a snapshot taken at mount was still being sent an hour later
 * with an expired token. The per-request refresh that fixes that is
 * `authRequestHook` (`lib/auth/request-hook.ts`), wired as `onRequest` at the same
 * two call sites; this snapshot only has to make the first request correct.
 */
export function buildAuthHeaders(settings: Settings): Record<string, string> {
  return composeAuthHeaders(getAuthSession()?.accessToken ?? settings.authToken, settings);
}
