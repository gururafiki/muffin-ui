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
- **`registry/`** (a package: `types.ts`, `helpers.ts`, one file per agent, `index.ts` assembling
  `AGENTS`; import path is still `@/lib/agent/registry`) maps a LangGraph `assistant_id` (from
  `muffin-agent/langgraph.json`: `research`, `council`, `criteria_analysis`, `stock_evaluation`,
  `trading_decision`) → the inputs its UI collects, a `buildInput` that shapes those into the run
  `input`, and the `resultKey` carrying the headline output. **Adding an agent = adding one file
  there and listing it in `index.ts`.** A `custom` key opts an agent into a bespoke screen (e.g.
  `council`) instead of the generic runner. An optional `advanced: AdvancedField[]` declares
  **per-run `configurable` overrides** surfaced in the runner's "Advanced options"
  (`src/components/advanced-options.tsx`); `overrides.ts` (`initialOverrides` / `buildOverrides`)
  turns the collected values into a `configurable` patch merged over global settings at run start
  (used by both the generic runner and the council screen).
- **`stream-types.ts` + `schemas.ts` — the typed stream boundary.** `RunStream`
  (= `UseStreamReturn<AgentState>`) is the nameable handle type; helpers/wrappers that only forward
  a stream into selector hooks take the library's erased `AnyStream` — never `unknown`, never
  `as never`. `schemas.ts` holds zod `looseObject` schemas for every backend-owned payload the app
  reads (`ToolRun` / `CriterionEvaluation` / `PersonaSignal` / the `criterion_evaluated` writer
  event) — **they mirror `muffin-agent` state shapes; keep them in sync with the backend** exactly
  like `settings/configurable.ts`. Parse with `parseArray`/`parseOr` (skip malformed members,
  one dev warning per label); the domain types (`ToolRun`, `Criterion`, `PersonaSignal`) derive
  from these schemas and are re-exported from their old homes.
- **`stream-context.tsx`** shares the CURRENT surface's already-configured stream handle
  (`RunStreamProvider` / `useRunStreamContext`) so detail components (`SubgraphDetail`,
  `MemberDetail`) reach it without prop drilling. This is deliberately NOT the library's
  `StreamProvider` (which *creates* a stream from server options — ours wraps the `useRunStream`
  handle with its custom client/fetch/`onThreadId`). It is mounted by `RunSurface` (below).
- **`features/agent-calls/threads.ts`** — the Calls tab renders each past run from data the
  **LangGraph server owns**, not app-written tags: `threadGraphId` reads `metadata.graph_id` (set by
  the server on every run, 1:1 with a registry `id`) → title / icon / filter / "reopen into the
  agent's screen". `searchThreads` uses `select` (omit `values` — full thread state is tens of
  KB/thread, so this shrinks the list payload ~100× vs the default that returns `values`) plus
  `extract` (`{ticker: 'values.ticker', …}`) to pull just the descriptor inputs out of persisted
  state. So `use-run-stream` writes **no thread metadata** — the app-tagged `agentId`/`inputs` scheme
  (which the M12b `useStream` migration silently broke, leaving every recent Calls item as a generic
  "Agent run") is gone. Deep-agent runs (free-text prompt, no ticker/query) get no one-liner.
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
    **Sub-agent history detail (M14/M16):** on a finished thread the scoped channels stay empty, so a
    discovered stage row's expanded `SubgraphDetail` falls back to persisted state: the stage's
    structured output via registry `StageDef.output` + the run-level `tool_runs` records whose
    `agent` equals the node name — attached to `SubgraphRow` by `useSubgraphRows`. `StageDef.output`
    is a **values key OR a selector** `(values) => unknown` (for stages whose output spans several
    keys / needs a legacy fallback, e.g. the bull/bear debate); always resolve it via
    `stageOutput(stage, values)` (registry/helpers.ts), never `stage.output` directly — it narrows the union
    and filters empty `[]`/`{}`. `StageDef.detail` (M16) is a bespoke expanded-detail renderer id
    (like `AgentDef.resultRenderer`): `detail: 'debate'` renders the output as a `DebateView`
    conversation. Both trading debates (`investment_debate` / `risk_debate`) are conference
    subgraphs (muffin-agent #117) whose turns live in a non-default messages channel, so the scoped
    transcript is empty even live — they rely on `output` + `detail: 'debate'`. Live scoped channels
    always win when they have data.
    **Hydration skeletons (M14):** `stream.isThreadLoading` (initial `getState` in flight — 28–70s
    on the deployed backend today) drives skeleton panels: the runner shows the registry stage
    labels under "Loading this run…", chat shows transcript-shaped blocks, council a session
    placeholder, calls list/detail card-shaped blocks (`<Skeleton>` primitive in `ui/`).
- **`renderers/`** — pluggable rendering keyed on output shape (messages / structured / research /
  json / timeline). New dashboards/charts are added by registering renderers, not editing call sites.
  `tool-runs.tsx` renders backend `AgentCaptureMiddleware` output: `collectToolRuns(values)` gathers
  top-level `tool_runs` + each `criterion_evaluations[i].tool_runs`, read off the values view so live
  and post-refresh render identically. The shared **`ToolRunsPanel`** (M19 — replaces the former
  `ToolRunList`/`ToolRunsSummary` split, which had drifted apart in styling across four
  near-identical call sites by accident, not design) is one `Card`+`Collapsible` envelope over the
  same `ToolRunRow`s: `mode="flat"` (one row per call — "Tool calls" per subagent, "Data collection"
  per criterion, "Data collected" per council member) or `mode="grouped"` (per-tool ok/failed/cached
  stats — "Tool execution", once per run) is the only difference. Capture is unconditional backend-side — a graph opts
  in by declaring the `tool_runs` state channel. `criteria-result.tsx` badges evaluations whose
  backend truthing flag says no tools ran (`data_collected: false` → "no live data").
  **Cache join (folds in the former "Data gathered" panel):** `tool-runs.tsx` rows expand to the FULL
  gathered payload — `lib/agent/tool-cache.tsx`'s `ToolCacheProvider` (mounted via `RunSurface`)
  fetches the run's provider-call cache (`store.searchItems(['cache'])`, one global query key,
  polls 10s while busy — paused in background via the `focusManager`/`AppState` wiring) and
  exposes `useToolCache()`, an exact `(tool, args_hash) → CachedItem` lookup (the store KEY *is*
  `get_args_hash(args)`, so it equals the backend `tool_runs.args_hash` — no client rehashing, no
  cross-run bleed). A matched row shows size + `cachedAt` in its header and runs the full content
  through the chart / JSON / markdown renderers (the capped `output_preview` never parsed as a chart);
  unmatched rows (errors, non-cacheable tools, `task` delegations, or runs predating `args_hash`) fall
  back to previews. Rows outside the provider (subgraph-detail live view) get no join → preview-only.
  The old `collected-data.tsx` / `CollectedData` panel and its ±60s time-window heuristic were removed.
  Limitation: the `searchItems(['cache'], { limit: 100 })` cap can miss a payload in a very large
  global cache → that row degrades to preview (ROADMAP: switch to targeted `store.getItem` per key).
  **Panel surfaces:** the three live screens (generic runner, council, chat) mount
  **`<RunSurface stream threadId>`** (`features/agent-shared/run-surface.tsx`) — it owns the
  cross-cutting wiring (`ToolCacheProvider` + `RunStreamProvider`), with `RunErrorCard` /
  `HydrationCard` for the shared error/hydration markup; each surface then renders
  `<ToolRunsPanel title="Tool execution" mode="grouped" runs={collectToolRuns(values)} />` where its
  layout wants it.
  `app/calls/[threadId].tsx` (history — no live stream, `busy={false}`, one cache fetch) mounts
  the `ToolCacheProvider` sub-slice directly. The panel populates
  only for graphs that surface `tool_runs` (criteria_analysis / trading_decision / research /
  stock_evaluation / council — the 13 personas since muffin-agent #109, the 4 ReAct specialists
  since #116; `technicals`/`sentiment` fetch via `cached_invoke` which bypasses capture, so they
  never contribute records) — it renders `null` otherwise, except when the caller passes
  `emptyMessage` (council does, for finished runs predating capture). Council records carry
  `agent: "<slug>_data_collection"` — join via `toolRunAgentSlug()` (`features/council/personas.ts`),
  and `useSubgraphRows` accepts the suffixed form too. The council screen itself is member-unified
  (M15): `COUNCIL_MEMBERS` = 13 personas + 6 optional specialists in one arena grid, one
  `MemberDetail` card for both kinds.
  **Stage envelope convention (M19):** every pipeline "stage" body wraps in `Card tone="muted"` +
  `Collapsible` — `ReportSection` (`widgets.tsx`) and the unified `ToolRunsPanel` both follow this;
  `DebateView` keeps its chat-bubble turn styling but takes a `bare` prop to skip its own
  Card/Collapsible when the caller (`DebateDetail`, inside an already-expanded `SubAgentRunRow`)
  already owns the expand/collapse affordance — new stage/detail renderers should follow the same
  pattern rather than reaching for a bare `Collapsible`.

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
`*_api_key` + `user_id`) used when saving an assistant preset. `getSettings()` is a non-reactive
snapshot for use outside React (building a run config). The Settings SCREEN is schema-driven
(`app/(tabs)/settings.tsx`: a `SECTIONS` data table + three small renderers; each field subscribes
to only its own store key).

### Persisted stores — zustand `persist` + `lib/storage/zustand.ts`
The three on-device stores (`lib/settings/store.ts`, `features/wealth/store.ts`,
`features/markets/map-view-store.ts`) all use zustand's `persist` middleware with **`version` +
`migrate`** over the shared `persistStorage()` adapter (`lib/storage/zustand.ts`). The adapter
(a) adopts pre-middleware bare-JSON payloads as `{state, version: 0}` on read so long-time users'
data flows through `migrate` instead of being discarded, and (b) optionally debounces writes
(settings uses 400ms — it persists per keystroke) with a web `beforeunload` flush. **Renaming or
retyping a persisted field REQUIRES a version bump + a `migrate` case** — that's the point.

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
(e.g. an "Analyse" link passing `ticker`/`sector`/`market` + `autostart=1`). It does **not** wrap
`ChatScreen`/`CouncilScreen`/`AgentRunner` in a `Screen` (M19) — each owns its own layout, switching
internally between the centred `AgentHero` (fresh run) and a normal scrolling `Screen` (once a
thread exists), the same way `ChatScreen` already split hero vs. transcript.

### Features — `src/features/`
- **`agent-shared/`** — the streaming primitives EVERY run surface uses: `use-run-stream.ts`,
  `run-projections.ts`, `run-progress.tsx`, `subgraph-detail.tsx`, `run-surface.tsx`, and the
  transcript cluster (`conversation.tsx` — the mutually-recursive Conversation/StepTimeline pair;
  `conversation-turns.ts` — pure fold logic + types, `coerceMessages` accepts `BaseMessage`
  instances via the SDK's `toMessageDict`; `message-bubbles.tsx`; `subagent-activity.tsx`). Also
  (M19) **`agent-hero.tsx`** — the shared animated "fresh run" landing screen (identity block +
  caller-supplied composer/fields + example chips), generalised from `ChatScreen`'s original hero —
  and **`run-recap.tsx`** — the read-only, post-submit recap of a run's inputs (`agent.inputs` →
  labelled values + a "Start a new run" button), replacing the deleted `agent-runner/run-input-form.tsx`
  for every agent that doesn't support real follow-up. Council / agent-runner / calls import from
  here — never sideways from `agent-chat`.
- **`agent-chat/`** — just the conversational feature now: `chat-screen.tsx` + `interrupt.tsx`.
- **`agent-runner/`** — the generic single-shot run screen, decomposed: `agent-runner.tsx`
  (orchestration — renders `agent-shared/agent-hero.tsx` for a fresh run, `agent-shared/run-recap.tsx`
  once a thread exists), `save-preset-card.tsx` (self-contained mutation, fresh-run only),
  `run-results.tsx` (result renderers + hydration skeleton).
- **`council/`** — bespoke 13-persona screen (arena, member detail, live persona fold).
- **`markets/`** — the configurable globe (`classification.ts` defines MSCI/FTSE/World-Bank
  schemes × region/tier lenses as ISO-3166 lists, rendered onto an SVG `world-map`).
- **`wealth/`** — portfolio + goals (persisted store seeded with demo data).

### Design system — `src/components/`
- **`ui/`** — bakery primitives styled with NativeWind v4 `className` (incl. `Skeleton`, the
  pulsing loading placeholder used by the hydration/loading states).
- **Design tokens** live in `tailwind.config.js` (the `frosting`/`blueberry`/`butter`/`leaf`
  palette, the **`ink` text ramp** — `ink`/`ink-muted`/`ink-soft`/`ink-faint` for body → muted →
  done/disabled → placeholder text on light; never inline an arbitrary `text-[#hex]` —
  `crumb`/`muffin`/`bun` radii, Baloo2/Nunito font families — note **font weight is baked
  into the family name** since native ignores `fontWeight`). **`src/theme/colors.ts` mirrors this
  palette** for APIs that need raw color values (navigation theme, status bar, SVG fills, charts) —
  **keep the two in sync** — and is the single home for the categorical chart palettes
  (`chartColors.allocation` / `.sector`) and the world-map light fills (`mapColors`).
- **`icons/`** — `<Icon name="…" />` + `registry.ts` mapping semantic names → Phosphor `*Icon`
  components (duotone default). Call sites never import Phosphor directly, so a glyph can be swapped
  for a custom doodle SVG by editing the registry. SVGs import as React components via
  `react-native-svg-transformer` (configured in `metro.config.js`).

### State management
TanStack Query (server state; `lib/query.ts` also wires `focusManager` to `AppState` on native so
interval refetches pause in background) · Zustand (client state: settings, wealth, map view — see
the persisted-stores section above) · MMKV / localStorage (persistence). Long lists virtualize with
`@shopify/flash-list` — but render loading/error/empty states OUTSIDE the list in the plain scroll
layout: its web `ListEmptyComponent` does not update in place (verified in the M18 smoke test).

## Agent skills
`.agents/skills/<name>/` holds real, git-tracked `SKILL.md` content; `.claude/skills/<name>` is a
relative symlink to it (`../../.agents/skills/<name>`) — that's what Claude Code actually reads.
This repo owns the React Native / UI skills (canonical home, so it's self-sufficient standalone):
`react-native-skills` (perf/architecture rules for RN & Expo), `web-design-guidelines` (fetches and
audits against Vercel's Web Interface Guidelines), `react-best-practices` (React/Next.js performance),
`composition-patterns` (compound components, avoiding boolean-prop sprawl). The same four are
mirrored at `muffin-umbrella/.agents+.claude/skills` since Claude Code is always opened with the
umbrella as root — see the umbrella `CLAUDE.md` for the full convention. Add a new skill here first,
then copy it into the umbrella.

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
