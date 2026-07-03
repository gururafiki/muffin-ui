# Muffin UI — Roadmap

A cross-platform (Web · iOS · Android) Expo / Expo Router client for the
`muffin-agent` LangGraph agents, growing into a full wealth-management app.
**Brand:** democratise wealth building — bring your own keys (LLM + OpenBB),
share the research. Purple flat-design bakery aesthetic, muffin mascot.

## Principles
- **One graph → one page.** Each agent maps to a screen via a registry
  (`src/lib/agent/registry.ts`). Known graphs can have bespoke screens; the rest
  fall back to the generic runner. Adding an agent = one registry entry.
- **Pluggable rendering.** A renderer registry (`src/lib/agent/renderers/`) turns
  streamed state into UI; custom dashboards/charts are added by registering new
  renderers keyed on node / tool / output schema.
- **Keys stay private.** Settings persist on-device (MMKV / localStorage) and are
  injected into each run's `config.configurable`; never stored server-side.
- **Reuse over custom.** Talk to agents with the official
  `@langchain/langgraph-sdk`.

## Conventions & scope
- **Status:** ✅ done · 🟡 in progress · ⬜ planned. Checklists use `- [ ]`.
- **Repo scope.** Only `muffin-ui` (this app) is in our push scope. **`muffin-agent`**
  (the LangGraph backend) and **`muffin-deployment`** (Swarm/Traefik/Cloudflare) are
  separate repos — backend changes are delivered as **patches** for the owner to apply
  (see `deploy/muffin-deployment.patch` from M1 for the pattern). Tasks are tagged
  **[app]** (in-scope) or **[backend-patch]** accordingly.
- **Backend facts that shape these milestones** (from `muffin-agent`):
  - 5 graphs registered in `langgraph.json`: `stock_evaluation`, `criteria_analysis`,
    `research`, `council`, and `trading_decision` (the last via the config-only async factory
    `trading_decision/graph.py:make_graph`, with integration coverage). All are runnable from the app.
  - Config flows through `config.configurable`, parsed by `BaseConfiguration`
    subclasses (`src/muffin_agent/`): `ModelConfiguration` (model, temperature,
    `llm_provider`, per-provider API keys, `orchestrator_models`/`collector_models`/
    `reasoner_models`, `summariser_model`), `McpConfiguration` (`openbb_mcp_url`,
    `firecrawl_mcp_url`), `MemoryConfiguration` (`user_id`, `memory_debug_user_id`),
    `ResearchConfiguration`, `TradingDecisionConfiguration`, `StoreConfiguration`.
  - Per-agent tool sets are **hardcoded** `_MCP_TOOLS` lists; council reads
    `configurable.include_specialists`. Persistence = LangGraph-managed Postgres
    checkpointer + Store. Auth = `auth.py` (disabled / `MUFFIN_API_TOKEN` bearer /
    Cloudflare Access JWT → `user_id`).
- **Per-milestone verification** (the established loop): `npx tsc --noEmit` +
  `npx expo export -p web`, a headless-browser smoke test of the new flow with a
  screenshot, and assert zero Reanimated/worklet errors. Commit to the working branch.

---

## ✅ Milestone 1 — Foundation + one live agent
Expo SDK 56 + Expo Router (TS strict, web/iOS/Android); purple bakery design system
(NativeWind v4 + primitives + muffin SVG logo); tabs (Globe/Markets/Agents/Settings);
functional Settings (API URL, auth token, LLM provider + keys); LangGraph client with
native streaming via `expo/fetch` + polling fallback; generic agent runner (streamed
timeline + structured output); council stub; deployment Dockerfile + Swarm/Traefik/
Cloudflare wiring (`muffin.*` app, `muffin-chat.*` legacy chat UI).

## ✅ Milestone 2 — Configuration depth (per-user agent customisation)
The full per-user config surface — *everything configurable, keys stay private*:
- **Advanced configuration** in Settings (collapsible): per-role model chains
  (`orchestrator_models`/`collector_models`/`reasoner_models`), `summariser_model`, `temperature`,
  MCP URLs (`openbb_mcp_url`/`firecrawl_mcp_url`), research knobs
  (`research_default_mode`/`rerank_threshold`/`max_search_results`), `store_allowed_namespaces`.
  Persisted on-device and emitted by `buildConfigurable` (`src/lib/settings/`).
- **Per-run overrides** — `AgentDef.advanced` → a shared `AdvancedOptions` block in the generic
  runner *and* the council screen, merged into that run's `configurable`: council
  `include_specialists`, trading-decision debate-round counts + `reflection_enabled`, research
  mode + max results. (`src/lib/agent/overrides.ts`, `src/components/advanced-options.tsx`.)
- **`trading_decision` registered** in the app (`src/lib/agent/registry.ts`) — already a deployed
  graph; the per-run debate/reflection knobs drive it live.
- **Assistant presets** (`src/lib/agent/presets.ts` + Agents tab): save a named, **non-secret**
  configured assistant per graph (`buildPresetConfigurable` strips API keys + `user_id`) and run it
  via the generic runner; keys are re-injected from on-device settings at run time.

Deferred (need new backend work — see backlog): dynamic config forms from each graph's
`config_schema` (no graph declares one yet), per-agent `ToolSelectionMiddleware` / extra MCP
servers, and the custom deep-agent builder.

## ✅ Milestone 3 — Council showcase
13 investor avatars with personality, live per-persona stages via `streamSubgraphs`
(collecting → scoring → deciding → done), tap-to-expand reasoning, animated vote tally,
judge deliberation + verdict. `src/features/council/`.

## ✅ Milestone 5 — Globe navigation
Stylized tappable SVG world map → region → country → sector → sub-sector → stock, with
breadcrumbs, animated best/worst "movers" panels (sample data, badged) and an "Analyse"
action at every level launching the real `research` agent (templated, auto-started) with
a tailored result renderer. `src/features/markets/`.

## ✅ Milestone 6 — Sector Pie + asset & ticker model
Interactive SVG donut of sector weights (tap → sub-sectors → sector page). Asset/ticker
metadata model (`AssetType`, sector/sub-sector/country/market/style), seeded multi-asset
universe + asset-type filter on Markets; asset context flows to the stock page.

## ✅ Milestone 7 — Wealth management
Portfolio tab: net-worth card, animated allocation (by asset/account), account wrappers
(SIPP/ISA/GIA/Cash/Property/Mortgage) with holdings, goals with animated progress.
Locally-editable seeded portfolio persisted on-device (zustand + storage).
`src/features/wealth/`.

## ✅ Milestone 10 — Threaded runs, calls history & agent UX (unplanned)
Landed via PRs #5–#8 while M4 was pending, and became the architecture M4 ships on.
Every run is now thread-scoped on one streaming chat screen (`src/features/agent-chat/`,
SDK `useStream`: URL-carried `threadId` + `reconnectOnMount`, so refresh/reopen keeps
streaming and live vs. from-history render identically). A run reads as a minimal
expandable step timeline grouped into an orchestrator → sub-agent tree with nested
transcripts (`use-subagent-runs.ts`; backend pair: `subagent_runs` capture,
muffin-agent #86/#88), plus HITL interrupt cards, message branching/edit/regenerate,
a Calls tab of past threads with per-agent descriptors + filters
(`src/features/agent-calls/`), composer prefill, a "Data gathered" panel from the
tool-result cache (`collected-data.tsx`), a result-widget library
(`renderers/widgets.tsx`), a reusable debate transcript
(`src/features/multi-agent/debate.tsx`) and full markdown rendering. Backend
(muffin-agent #85–#88): sub-agent transcript capture, Langfuse tracing, auto-CD
deploy dispatch on image push.

## ✅ Milestone 4 — Custom agent dashboards + rich renderers
Shipped on the M10 architecture rather than the generic-runner extension originally
sketched. Criteria-analysis breakdown (`renderers/criteria-result.tsx`: weighted
per-criterion score bars, composite score, positives/negatives, thesis) and
trading-decision dashboard (`renderers/trading-result.tsx`: verdict + conviction,
analyst reports, bull-vs-bear and risk-debate transcripts, trader plan) hang off
`AgentDef.resultRenderer`. The sub-graph execution view became M10's
orchestrator → sub-agent tree (no separate `useGraphTree`); tool calls render as
expandable cards with failure badges plus the "Data gathered" summary;
the stock-evaluation timeline reads as a narrative (`lib/agent/steps.ts` humanises
deep-agent/middleware nodes). Completed last: **token-level streaming**
(`messages-tuple` stream mode in `use-agent-stream.ts` — answers render
token-by-token) and **charts** — a `react-native-svg` time-series line + volume-bar
chart (`renderers/chart.tsx`) drawn whenever a tool output parses as a time series
(`renderers/chart-data.ts`: OpenBB price-history/indicator shapes; fixture at
`renderers/__fixtures__/price-history.json`), in both the step timeline and the
Data-gathered panel.

---

## ⬜ Milestone 8 — Supabase auth + shared-research backend

**Goal.** Add real user accounts and deliver the brand's social half — *collected data &
research outputs are reused by everyone, while keys stay private*. App-side auth is in
scope; agent persistence/auth changes are backend patches. Evaluate **aegra** (a
Supabase/Postgres-friendly LangGraph-protocol server) vs. the current managed
`langgraph-api` as part of this milestone.

**[app] — auth & cloud sync**
- [ ] Add `supabase-js`; an **Auth screen** (email + OAuth) and a session store; gate the
      app or keep anonymous use with optional login.
- [ ] Send the Supabase access token as the API `Authorization: Bearer` (already supported
      via `settings.authToken` → client `defaultHeaders`) and set `configurable.user_id`
      from the Supabase user for per-user memory isolation.
- [ ] **Cloud backup (opt-in):** sync the local portfolio/goals/settings
      (`src/features/wealth/store.ts`, `src/lib/settings/store.ts`) to per-user Supabase
      tables with RLS — local-first, never storing API keys server-side.
- [ ] **Shared research library:** browse research outputs others have produced (Supabase
      table) and re-open them — the "reuse research" promise; surface on the Agents/Research
      area.
- [ ] Verification: login works on web + native; a run carries the Supabase `user_id`;
      (stretch) a shared research item from one account is visible to another.

**[backend-patch] — `muffin-agent` + `muffin-deployment`**
- [ ] `auth.py`: add a **Supabase JWT verification** mode (verify via Supabase JWKS / JWT
      secret; map `sub`/`email` → `user_id`), keeping the bearer/Cloudflare modes.
- [ ] **DB migration:** point `DATABASE_URI` at Supabase Postgres and run the LangGraph
      migrations; verify the checkpointer + Store work (it is Postgres, so likely a
      connection-string swap). **OR** adopt **aegra** and document the trade-off.
- [ ] **Persist collected data / research** to Supabase shared tables via a post-run hook /
      middleware with RLS, so outputs are reusable; ensure no API keys are ever written.
- [ ] `muffin-deployment`: add Supabase env/secrets; decide hosted vs self-hosted Supabase;
      update `stack/docker-compose.yaml` + Terraform; (optional) drop `langgraph-postgres`
      if fully on Supabase.

**Dependencies:** none hard, but pairs with M9 productionisation. **Acceptance:** Supabase
login drives `user_id` end-to-end; per-user memory works; shared research is readable
across accounts; keys remain on-device only.

---

## ⬜ Milestone 9 — Productionisation & launch

**Goal.** Make it shippable: own repo + CI image, store builds, monitoring, tests,
performance, monetisation, and final brand assets.

**[app/infra]**
- [x] **Extract `muffin-ui`** into its own `gururafiki/muffin-ui` repo and re-add it as an
      umbrella submodule; activate the dormant arm64 GHCR image build
      (`.github/workflows/build.yml`). *Done — and pushes to `main` now dispatch an
      auto-deploy to `muffin-deployment` after the image push.*
- [ ] **EAS:** `eas.json` (development/preview/production profiles), credentials/signing,
      `eas build` + `eas submit` (App Store / Play), and **EAS Update** OTA channels.
- [ ] **Sentry** (`@sentry/react-native`): wrap the app, upload sourcemaps in EAS, capture
      run/render errors (incl. the agent-stream error paths).
- [ ] **Testing:** `react-native-testing-library` unit tests for the renderers, the
      `taxonomy`/`wealth` helpers and `use-agent-run`/`use-council-run` event parsing;
      **Maestro** E2E flows (drill-down, run an agent, add a holding, create a goal); run in
      CI.
- [ ] **Performance:** FlashList for long lists (asset universe, holdings, run timeline),
      Expo Image for remote images, memoisation; Reanimated `react-compiler` audit.
- [ ] **Polish UX:** Zeego context menus (long-press actions on holdings/agents),
      consistent loading/empty/error states, offline handling, accessibility (labels,
      contrast, dynamic type), i18n scaffold.
- [ ] **Monetisation:** RevenueCat scaffolding + a paywall for premium features, keeping the
      BYO-keys core free.
- [ ] **Brand:** replace the placeholder muffin SVG with a final illustrated mascot; finalise
      app icon, splash, and store assets.
- [ ] **Security review** of the diff (`/security-review`): confirm keys never leave the
      device except as the user's own `configurable`; no secrets in logs/artifacts.

**Acceptance:** signed builds in TestFlight/Play internal track; CI green (lint, types,
unit, image build); Sentry receiving events; Maestro suite passing; OTA updates working.

---

## Cross-cutting backlog (from completed milestones)
- **M1:** real illustrated muffin mascot (the rest of the M1 backlog — token streaming, repo
  extraction — has shipped).
- **M2 (deferred backend work):** declare `config_schema` on each graph so the app can render
  **dynamic config forms** via `client.assistants.getSchemas` (none declare one today — static
  knobs are the fallback); per-agent `ToolSelectionMiddleware` (or `configurable["{agent}_tools"]`)
  to narrow the hardcoded `_MCP_TOOLS` lists at runtime; extend `McpConfiguration` for per-agent
  user MCP servers; the custom deep-agent builder (JSON spec → factory graph + builder screen).
- **M3:** persona-vs-persona debate transcript in the council screen (the reusable
  `multi-agent/debate.tsx` exists and drives the trading dashboard — wire it up); circular
  arena layout with connection lines.
- **M4 ([backend-patch]):** emit structured progress via `stream_mode: "custom"` (e.g. explicit
  data-collection success/failure events) for higher-fidelity UI; richer chart types
  (candlesticks, multi-axis — `victory-native` if the SVG chart outgrows itself).
- **M5:** live market data (needs a backend screening/discovery graph) for the movers panels;
  richer sub-sector pages (markdown styling for `research-result` shipped with M10).
- **M6:** futures/options/MMF instruments; addressable-market tags; real holdings/weights;
  filter the universe by style/country.
- **M7:** multi-currency / FX; cash-flow budgeting; live prices / broker sync; create
  accounts from scratch; tax / contribution-limit logic.
