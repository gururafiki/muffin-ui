# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## ⚠️ Expo SDK 56 — read the versioned docs first

Expo's APIs change between SDKs. **Before writing any Expo/React Native code, read the
exact versioned docs at https://docs.expo.dev/versions/v56.0.0/** — do not rely on memory of
older SDKs. This pins React 19.2, React Native 0.85, Expo Router ~56, NativeWind v4.

## What this is

Cross-platform (**Web · iOS · Android**) [Expo](https://expo.dev) + Expo Router client for the
`muffin-agent` LangGraph agents. Brand: *democratise wealth building* — **bring your own keys**
(LLM + OpenBB), injected per run and kept on-device; the research generated is reused for everyone.
Kawaii blueberry-bakery aesthetic.

This repo is a **git submodule of the `muffin` umbrella** and ships as an **arm64** nginx image
serving the static Expo web export at `muffin.<domain>`, with `/api` reverse-proxied to the
LangGraph backend. The cross-submodule deploy picture lives in the umbrella `CLAUDE.md`
(`../CLAUDE.md`); **only `muffin-ui` is in this repo's push scope** — backend changes are delivered
as patches to `muffin-agent` / `muffin-deployment` (see `deploy/muffin-deployment.patch`), never
direct edits.

## Commands

```bash
npm install
npx expo start                      # press w (web), i (iOS), a (Android)
npm run lint                        # = expo lint (ESLint flat config, eslint-config-expo)
npx tsc --noEmit                    # type-check (TS strict)
npx expo export -p web --output-dir dist   # static web build → dist/
docker build -t muffin-ui .         # web export + nginx /api proxy (built arm64 in CI)
```

**There is no test runner** (no `pytest`/`jest`). The established per-change verification loop is:
`npx tsc --noEmit` + `npx expo export -p web` + a headless-browser smoke test of the changed flow
with a screenshot, asserting zero Reanimated/worklet errors. See `ROADMAP.md` for milestone history.

Point the app at a LangGraph server in **Settings**. Local backend: run `langgraph dev` in
`muffin-agent`, set API URL to `http://localhost:8123` (`http://10.0.2.2:8123` on the Android
emulator), enter an LLM key. Web defaults to the same-origin `/api` proxy (`EXPO_PUBLIC_API_URL`).

## Architecture

### Agent layer — `src/lib/agent/` (the core integration)
The whole app is organised around **"one graph → one screen"**:
- **`registry.ts`** maps a LangGraph `assistant_id` (from `muffin-agent/langgraph.json`:
  `research`, `council`, `criteria_analysis`, `stock_evaluation`, `trading_decision`) → the inputs
  its UI collects, a `buildInput` that shapes those into the run `input`, and the `resultKey`
  carrying the headline output. **Adding an agent = adding one entry here.** A `custom` key opts an
  agent into a bespoke screen (e.g. `council`) instead of the generic runner. An optional
  `advanced: AdvancedField[]` declares **per-run `configurable` overrides** surfaced in the runner's
  "Advanced options" (`src/components/advanced-options.tsx`); `overrides.ts` (`initialOverrides` /
  `buildOverrides`) turns the collected values into a `configurable` patch merged over global
  settings at run start (used by both the generic runner and the council screen).
- **`presets.ts`** wraps the SDK `assistants.search/create/delete` to save named, **non-secret**
  configured assistants per graph (Agents tab). Presets store only the allowlisted `configurable`
  from `buildPresetConfigurable` — never API keys / `user_id`; those are re-injected from on-device
  settings when the preset runs (the generic runner accepts an `assistantId` to target a preset).
- **`client.ts`** builds the `@langchain/langgraph-sdk` `Client`. `resolveApiUrl` resolves a
  relative `/api` to an absolute URL on web (the SDK builds every request with `new URL()`, which
  rejects relative bases).
- **One stream stack — `@langchain/react` `useStream` (protocol v2), via `use-run-stream.ts`.**
  ALL agent screens (generic runner, council, calls detail, AND ChatScreen) run on it; the legacy
  `@langchain/langgraph-sdk/react` hook + its `use-active-run.ts` attach gate were retired in M12b.
  `useRunStream` is the single engine: `submitRun` (run-view input or a chat `{messages:[human]}`),
  `resume` (HITL via `stream.respond`), and the raw `stream` (token-streamed `messages`, `interrupt`,
  `subgraphsByNode`, …). **Accepted regression:** message branching / edit-fork / regenerate have no
  protocol-v2 equivalent, so ChatScreen no longer offers them (`MessageActions` edit/regenerate/branch
  are optional and hidden when absent). Everything else is equal-or-better: token streaming, built-in
  optimistic message echo (no `optimisticValues` plumbing), interrupts + atomic resume.
  - **Native fetch (critical):** the protocol-v2 SSE transport uses `options.fetch ?? globalThis.fetch`
    and does NOT consult the SDK's `overrideFetchImplementation` singleton (which the classic `Client`
    REST calls do). So `use-run-stream` passes `fetch: streamingFetch()` — `expo/fetch` on native
    (`install-fetch.native.ts`), `undefined` on web — or SSE won't stream on iOS/Android.
  - Server endpoints (`POST /threads/{id}/stream/events` + `/commands`) are served by langgraph-api
    ≥0.10; channels: `values/updates/messages/tools/lifecycle/input/tasks` + `custom`.
  - Root `values` is root-namespace only — **subgraph-values clobbering cannot happen** (the reason
    the old `registry.subgraphs` flag existed; it's gone). `stream.subgraphsByNode` auto-discovers
    compiled-agent node invocations (criteria stages/Send workers, council personas, trading analysts)
    with live `running/complete/error` statuses — drives `RunProgress` (registry `StageDef.node`) and
    the sub-agents panel (`useSubgraphRows`). Plain-function nodes (merge_criteria) are never
    discovered — their stages rely on `done(values)`. Deep agents (stock_evaluation) have no compiled
    subgraphs, so `RunProgress` shows their `todos` plan + a "Now:" label from the freshest running
    discovery node (or "Working…").
  - The root pump is ONE subscription (channels values/checkpoints/lifecycle/input/messages/tools,
    namespace prefix `[]`, **depth 1**). `useChannel(stream, ['custom'])` opens one extra ref-counted
    subscription (replay on) — that's where the backend's `criterion_evaluated` writer events arrive;
    `run-projections.ts` folds them into the values view so criteria stream in ahead of the superstep
    barrier. Depth-2 events (a persona's inner nodes) do NOT reach the root pump — council infers
    persona sub-stages from its depth-1 values events instead (`council-live.ts`, `replay:false`
    taps the root bus without a new connection). Scoped selectors (`useMessages(stream, target)`)
    open one subscription per namespace — mount them lazily (expanded rows only), never one-per-seat.
  - **Live vs history doctrine: events for live, state for history.** Completed runs have NO
    replayable event stream (transient Redis buffer — verified; there is no durable event log to
    replay). On load a finished thread makes only `GET /threads/{id}/state` (+ thread metadata + the
    store cache search) — no event re-subscription, no `/state/checkpoint` walk. So the backend
    capture channels (`subagent_runs`, `tool_runs`) are the **history substrate** — live rendering
    uses the native channels, historical rendering reads persisted state. Removing them would lose all
    historical sub-step detail. (`tool_runs` is compact; `subagent_runs` full transcripts are the
    heavy one and the candidate to slim once the checkpoint-read latency is fixed — reconstructing
    from checkpoints trades write-bloat for the slow read.) Mid-run refresh replays buffered events
    (seq/`since`).
- **`renderers/`** — pluggable rendering keyed on output shape (messages / structured / research /
  json / timeline). New dashboards/charts are added by registering renderers, not editing call sites.
  `tool-runs.tsx` renders backend `AgentCaptureMiddleware` output: `collectToolRuns(values)` gathers
  top-level `tool_runs` + each `criterion_evaluations[i].tool_runs`; `ToolRunList` (collapsed rows →
  args/output/error) and `ToolRunsSummary` (per-tool ok/failed/cached counts) read the values view,
  so live and post-refresh render identically. Capture is unconditional backend-side — a graph opts
  in by declaring the `tool_runs` state channel. `criteria-result.tsx` badges evaluations whose
  backend truthing flag says no tools ran (`data_collected: false` → "no live data").

### Auth (optional accounts) — `src/lib/auth/` + `src/features/account/`
Supabase (self-hosted, part of the muffin stack) provides **optional** user accounts —
anonymous use always works. `lib/auth/client.ts` builds the supabase-js client from Settings
(`supabaseUrl` defaults to the same-origin `/supabase` nginx proxy — resolved absolute via
`lib/resolve-url.ts`, the same trick as `/api`; `supabaseAnonKey` enables the feature; storage
adapter = the shared `KeyValueStore`). `lib/auth/store.ts` mirrors the session into zustand via
`onAuthStateChange` (initialised from the root layout) so non-React call sites read it
synchronously: `buildAuthHeaders` prefers the live access token (the backend's `auth.py` verifies
it as a Supabase user JWT) and `buildConfigurable` sets `user_id` from the verified UUID.
`features/account/` has the Settings Account card (email+password sign-in/up) and the opt-in
cloud backup (`backup.ts`: portfolio + NON-SECRET settings subset → RLS'd `user_backups`;
API keys / tokens / endpoints are stripped on upload AND restore). Native pulls
`react-native-url-polyfill` (in `install-fetch.native.ts`) for supabase-js.

### Settings → `config.configurable` — `src/lib/settings/`
On-device keys are injected into each run's `config.configurable`, never persisted server-side.
**`configurable.ts` field names mirror `muffin-agent`'s `BaseConfiguration` subclasses
(`ModelConfiguration` / `McpConfiguration` / `ResearchConfiguration` / `StoreConfiguration` /
`ToolKnowledgeConfiguration`: `llm_provider`, `model`, `openai_api_key`, `ollama_api_key`,
`user_id`, `orchestrator_models`, `temperature`, `openbb_mcp_url`, `research_default_mode`,
`tool_lessons_mode` (`read_and_record` / `read_only` / `off`), `store_allowed_namespaces`, …) —
keep them in sync with the backend.** **LLM provider selection:** `settings.llmProvider === ''`
("Server default") sends NEITHER `llm_provider` nor `llm_chain`, so the deployment's configured
`llm_chain` (e.g. Ollama Cloud → OpenRouter fallback) applies. Picking a concrete provider
(`ollama` / `openrouter` / `openai` / `anthropic`) sends `llm_provider` AND `llm_chain: []` — the
empty chain is required to override the server chain into single-provider mode (the backend's
`llm_chain`, when non-empty, supersedes `llm_provider` for every role). `buildConfigurable` only emits non-empty values (with `putNum` / `putList` for
numeric / comma-list knobs); the "Advanced configuration" Settings section feeds these. The agents
read every key at runtime via `from_runnable_config`, so a knob takes effect as soon as the UI
sends it — no backend change needed. `buildPresetConfigurable` is the no-secrets subset (strips
`*_api_key` + `user_id`) used when saving an assistant preset. `store.ts` is a Zustand store
persisted via the storage abstraction; `getSettings()` is a non-reactive snapshot for use outside
React (building a run config).

### Platform-split files (Metro convention)
`foo.web.ts` / `foo.native.ts` / `foo.ts` — Metro picks the web or native variant, `.ts` is the
fallback for TypeScript resolution and unexpected platforms. Used by:
- `src/lib/storage/` — `localStorage` (web) / MMKV (native) / in-memory (fallback) behind one
  `KeyValueStore` interface.
- `src/lib/agent/install-fetch.*` — native installs the `expo/fetch` streaming shim so
  `runs.stream` works on iOS/Android; web/fallback are no-ops.
- `src/hooks/use-color-scheme.*`.

### Routing — `src/app/` (Expo Router, typed routes, React Compiler on)
File-based routes. `(tabs)/` = Globe (`index`), Markets, Portfolio, Agents, Settings. Detail routes:
`agents/[assistantId]`, `stock/[ticker]`, `sector/[sectorId]`, `country/[countryId]`,
`region/[regionId]`, `group/[groupId]`, `account/[accountId]`, `goal/[goalId]`. The root `_layout`
loads fonts (Baloo2 + Nunito), wraps `QueryClientProvider` / `GestureHandlerRootView` /
`SafeAreaProvider`. `agents/[assistantId]` seeds the runner from field-shaped deep-link params
(e.g. an "Analyse" link passing `ticker`/`sector`/`market` + `autostart=1`).

### Features — `src/features/`
Self-contained domains: **`council/`** (bespoke 13-persona screen, `streamSubgraphs` per-persona
stages), **`markets/`** (the configurable globe — `classification.ts` defines MSCI/FTSE/World-Bank
schemes × region/tier lenses as ISO-3166 lists, rendered onto an SVG `world-map`), **`wealth/`**
(portfolio + goals, Zustand store seeded with demo data, persisted on-device).

### Design system — `src/components/`
- **`ui/`** — bakery primitives styled with NativeWind v4 `className`.
- **Design tokens** live in `tailwind.config.js` (the `frosting`/`blueberry`/`butter`/`leaf`
  palette, `crumb`/`muffin`/`bun` radii, Baloo2/Nunito font families — note **font weight is baked
  into the family name** since native ignores `fontWeight`). **`src/theme/colors.ts` mirrors this
  palette** for APIs that need raw color values (navigation theme, status bar, SVG fills, charts) —
  **keep the two in sync.**
- **`icons/`** — `<Icon name="…" />` + `registry.ts` mapping semantic names → Phosphor `*Icon`
  components (duotone default). Call sites never import Phosphor directly, so a glyph can be swapped
  for a custom doodle SVG by editing the registry. SVGs import as React components via
  `react-native-svg-transformer` (configured in `metro.config.js`).

### State management
TanStack Query (server state) · Zustand (client state: settings, wealth, map view) · MMKV /
localStorage (persistence).

## Conventions
- TS **strict**; path aliases `@/*` → `src/*`, `@/assets/*` → `assets/*`.
- **React Compiler is enabled** (`app.json` `experiments.reactCompiler`) — avoid redundant manual memoization.
- License **GPLv3**; all published images are **arm64** (the Oracle node is aarch64).
- CI (`.github/workflows/build.yml`) builds + pushes `ghcr.io/gururafiki/muffin-ui:latest` on push
  to `main` (ignoring `**/*.md`). The Dockerfile does `npx expo export` → nginx serving `dist/` with
  `/api/` proxied to `langgraph-api:8000` (`deploy/nginx.conf`: SSE buffering off, passes the
  `Cf-Access-Jwt-Assertion` header through to the agent auth hook).

## Collaboration Preferences

These rules govern how Claude approaches planning, implementation, and communication in this project.

1. **Deep planning first** — Always do deep planning and trade-off evaluation before writing any code. Explore the solution space thoroughly before committing to an approach.

2. **Prefer out-of-the-box solutions** — Before implementing custom logic, research available library features by reading internet documentation and/or library source code. Consider alternative options even if they are not an exact match to the ask. Surface interesting options proactively.

3. **Propose options, don't decide** — When facing a design decision or when multiple approaches exist, present the options and ask for a decision rather than picking one unilaterally. Ask questions before writing substantial code if no existing library/utility has been found — the user may be able to provide documentation pointers.

4. **Explicit approval before implementation** — Always ask for explicit approval before starting implementation. Never exit plan mode unless the user explicitly says to exit or switch mode.

5. **Keep documentation up to date** — After every implementation, update README.md, docs/, roadmap.md, and any other relevant docs as applicable. Add VSCode launch configurations where reasonable. Always include documentation updates as the last step of implementation plans. When trade-offs or tech debt are accepted, document the limitations and add action items to roadmap.

6. **Memorize lessons in CLAUDE.md** — If the user shares information that will be useful in future sessions (e.g. future roadmap tasks, corrections, disagreements, repeating feedback patterns, new constraints), record it in CLAUDE.md. When in plan mode, include the CLAUDE.md memory update as an explicit plan step.
