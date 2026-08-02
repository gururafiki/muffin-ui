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

## ✅ Milestone 11 — Criteria analysis live-render + tool telemetry (2026-07)
Fixes + features off deployed feedback on the Criteria Analysis page:
- **Live-render fix** — a fresh run no longer flashes "Checking for a live run…" and blanks until
  refresh. `agents/[assistantId].tsx` pins the attach gate's `threadId` at mount (a `useState`
  initializer) so the mid-run `router.setParams({ threadId })` from `onThreadId` doesn't re-gate and
  unmount the streaming runner; per-thread hooks (`useSubagentRuns` / `useCall` / `CollectedData`)
  follow the live id from `useAgentStream`. Same fix in `council-screen.tsx`. (See CLAUDE.md
  "Live-render gotcha".)
- **`tool_lessons_mode` knob** — Settings advanced + per-run `advanced` on the criteria_analysis
  registry entry (`read_and_record` / `read_only` / `off`), forwarded as `configurable.tool_lessons_mode`
  (backend `ToolKnowledgeConfiguration`).
- **Tool telemetry UI** — `renderers/tool-runs.tsx`: a per-criterion "Data collection" timeline
  (collapsed) in `criteria-result.tsx` + a run-level `ToolRunsSummary` in the runner (per-tool
  ok/failed/cached counts; tap a tool → its runs with inputs as `JsonBlock`, outputs via
  `parseTimeSeries` → `TimeSeriesChart` when chartable else markdown, errors; a Failures roll-up).
  Reads `state.values.tool_runs` (top-level stage records) + each `criterion_evaluations[i].tool_runs`
  (backend `AgentCaptureMiddleware`; capture is unconditional — the graph opts in by declaring the
  `tool_runs` state channel, no per-run toggle). Deferred: live per-tool row streaming
  (records land when each node finishes; mid-node liveness stays with `messages-tuple`); per-tool
  duration.
- **Post-launch fixes (2026-07-07)** — first prod run surfaced four issues, all fixed:
  (a) `subgraphs: false` for criteria_analysis — the SDK applied stage-subgraph `values` (just
  `{messages}`) onto the main `stream.values`, blanking/replacing the accumulating scorecard
  mid-run (see CLAUDE.md "Subgraph-streaming gotcha"; `trading_decision` has the same latent risk —
  evaluate before enabling rich streaming there); (b) telemetry captured nothing in prod — backend
  gate removed (capture now unconditional), UI toggle dropped; (c) `data_sources` rendered as raw
  JSON chips — now formatted `subagent — data (period)` lines; (d) the sub-agent panel collapsed all
  Send workers into one mislabelled row — `fetchSubagentRuns` now keys by `<node>:<task-id>` and
  labels criterion workers by their criterion.

## ✅ Milestone 12 — Idiomatic LangGraph frontend: protocol-v2 run views (2026-07)
Round-2 feedback on the criteria page (slow+empty sub-agents panel; no live criteria; wrong run
plan; empty telemetry) root-caused to: the 15× `getState(subgraphs)` history walk (~28s/call on
criteria threads — server-side, see umbrella todos), ALL parallel Send workers committing in ONE
superstep (root `values` can never stream criteria incrementally), a stage recipe whose `done`
predicate fired on `merged_criteria` (written BEFORE the fan-out), and prod evaluators making
**zero tool calls** on a free OpenRouter route while fabricating `data_sources` (Langfuse: 0 TOOL
spans; the telemetry UI was correctly showing nothing).

Instead of layering more custom plumbing, the run-view screens moved to the **new
`@langchain/react` `useStream` (Agent Streaming Protocol v2)** — `use-run-stream.ts` +
`run-projections.ts` + `subgraph-detail.tsx`, consuming `subgraphsByNode` discovery (live node
statuses; no regexes, no checkpoint walks — `use-subagent-runs.ts` deleted), the `custom` channel
(backend `criterion_evaluated` events → criteria rows + a monotone `k/N` counter ahead of the
barrier), scoped selectors for expanded live transcripts, and state hydration for history
("events for live, state for history" — completed runs have no replayable stream, verified).
Council arena reworked on discovery + depth-1 persona values folds (`council-live.ts`) — the
`1/13` counter resets (subgraph-values clobber) are gone. Registry stage recipes fixed (real graph
order, `node` hints, `expected` fn) and evaluations flagged by backend truthing render a
**"no live data"** badge. Backend pair: muffin-agent #103 (`_reconcile_data_sources`
anti-hallucination pass, `criterion_evaluated` writer event, prompt data-collection contracts).
ChatScreen stays on the legacy hook (branching parity gap). Verified: tsc + web/iOS exports +
headless smoke on a prod thread (plan order, 11 rows, badges, ZERO `/state/checkpoint` calls).

## ✅ Milestone 13 — Merge "Data gathered" into "Tool execution" (2026-07)
Collapsed the two redundant run-view panels into one. "Tool execution" (`tool-runs.tsx`,
run-exact + history-safe) is kept; the former "Data gathered" (`collected-data.tsx`, full payloads
but a fuzzy ±60s cache-window heuristic) is deleted, its provenance features folded in. New
`lib/agent/tool-cache.tsx` `ToolCacheProvider`/`useToolCache` joins each `tool_run` to its cached
payload by exact `(tool, args_hash)` — the store KEY *is* `get_args_hash(args)`, so it equals the new
backend `tool_runs.args_hash` field (muffin-agent `records.py`) with no client rehashing and no
cross-run bleed. Matched rows show size + `cachedAt` and render the FULL content through the chart /
JSON / markdown pipeline (the capped `output_preview` never parsed as a chart); unmatched rows fall
back to previews. Verified: backend unit test (`args_hash == get_args_hash(args)`), tsc + web export
+ headless boot smoke (runner mounts, ZERO worklet errors). **E2E chart-from-cache deferred to
post-deploy** — requires the backend `args_hash` field live (additive; UI tolerates its absence).
**Deferred:** the `searchItems(['cache'], { limit: 100 })` cap can miss a payload in a very large
global cache → that row degrades to preview; switch to targeted `store.getItem(['cache', tool], hash)`
per unique key if it bites.

**M13 follow-up — panel for every agent (2026-07):** the panel was mounted on the three bespoke
screens (`council-screen`, `calls/[threadId]` history, `chat-screen`) and the backend now surfaces
`tool_runs` for `trading_decision` + `research` (declared the state channel; `researcher_node`
forwards it) — `stock_evaluation` already surfaced it (bare deep agent). ~~**Owed:** the `council`
backend~~ — landed: muffin-agent #109 declared the channel on all 13 persona subgraphs
(State + `<Persona>Output` + `CouncilState`) and #116 extended it to the 4 ReAct specialists;
the council panel populates on runs from 2026-07-12 onward (see M15).

## ✅ Milestone 14 — Hydration skeletons + sub-agent history detail (2026-07)
Two UX bugs reported on the deployed app (criteria thread reopen):
- **No loading feedback:** `GET /threads/{id}/state` takes **28–70s** on the Oracle node
  (checkpoint-read latency, known backend issue), during which the runner showed only the bare
  input form, then everything popped in at once. Now `stream.isThreadLoading` renders skeletons:
  a new `ui/Skeleton` pulsing primitive; the runner's "Loading this run…" card lists the REAL
  registry stage labels (predetermined UI), plus result/panel-shaped blocks; chat gets
  transcript-shaped blocks, council a session placeholder, calls list/detail card skeletons. The
  inputs Collapsible also re-collapses when a result lands (keyed remount — `defaultOpen` is
  initial-only), so the reopened run's output leads.
- **"No detail was recorded for this step":** expanding a discovery-seeded stage row (e.g.
  criteria "Classify the stock") showed nothing on a finished thread — `SubgraphDetail` read only
  the live scoped channels (empty: completed runs have no replayable events) and `row.evaluation`
  (criterion workers only), discarding what history DOES hold. Fix: registry `StageDef.output`
  names the stage's values key (criteria classify/define/methodology/synthesis, research stages,
  trading reports); `useSubgraphRows` attaches `row.output` + `row.toolRuns` (run-level
  `tool_runs` filtered by `agent === node`), and `SubgraphDetail` falls back to them (Result via
  `StructuredOutput` + a Tool-calls list that still joins the payload cache). Live channels win
  when present.
Verified: tsc + lint + web export + headless smoke against the real deployed thread through a
local CF-Access proxy — skeleton visible at +0.6s, classify row expands into the full
classification (rationale, confidence, data sources) with zero console errors.
**Deferred:** (a) the 28–70s `/state` + `/threads/{id}/history` latency itself is backend
(langgraph-api checkpoint reads on the A1 node) — the skeletons mitigate, they don't cure;
(b) discovery-seeded stage rows appear only after the *second* slow call (`/history`) returns —
stage rows could be pre-seeded from the registry + values once hydrated; (c) the council arena
skeleton is a simple card, not the full 13-seat arena shape.

## ✅ Milestone 15 — Council arena: specialists as members + structured member detail (2026-07)
Three council-page complaints from the deployed app: specialists only appeared as generic
"sub-agents" rows at the bottom; persona/specialist output looked messy and half empty (plain
text, no sense of what the member did or collected, no step timeline); and no tool-execution
stats. All 19 members (13 personas + 6 optional specialists) emit the same `AnalystSignal` into
`values.persona_signals`, so the fix is metadata + rendering:
- **One member model** (`personas.ts`): `PersonaMeta` gains `kind` + `steps`;
  `COUNCIL_SPECIALISTS` (slugs = backend agent_ids, 6 new `specialist-*` Phosphor icons) +
  `COUNCIL_MEMBERS` + `MEMBER_SLUGS` + `toolRunAgentSlug()` (strips the `_data_collection`
  suffix `tool_runs.agent` carries). Specialist seats join the grid when any specialist shows in
  signals / live fold / discovery, or when a fresh run's `include_specialists` toggle asks for
  them (all-or-nothing flag) — `deriveCouncil` returns `members` and stages over it; `VoteBar`
  takes `seats` (was hardcoded `/ 13`); specialist avatars label their compute stage "Computing…".
- **`MemberDetail`** (new, replaces the two inline cards): icon header + signal/confidence →
  step timeline (per-member `steps`, checked from live stage or settled history) → "Why"
  reasoning as `Markdown` → typed evidence via `StructuredOutput` (collapsible) → "Data
  collected" (`ToolRunList` of the member's own `tool_runs`, cache-joined) → live digest chips →
  `SubgraphDetail` scoped transcript while streaming. Personas and specialists render identically.
- **Sub-agents panel** is now a safety net only (discovered nodes not in `MEMBER_SLUGS`);
  `ToolRunsSummary` gains `emptyMessage` — finished councils that predate capture say
  "re-run to capture" instead of rendering nothing. `useSubgraphRows` tool-run join also accepts
  `<node>_data_collection`.
Verified: tsc + lint + web export + headless smokes through a local CF-Access proxy against three
real deployed threads — a fresh 19-member run (arena + Valuation/Buffett detail incl. 7
cache-joined tool runs; "Tool execution: 58 calls · 6 failed"), the user's original 19-signal
thread, and an old 13-persona thread (no specialist seats, empty-state hint). Zero new console
errors (a pre-existing React #418 hydration mismatch reproduces on the UNMODIFIED deployed site —
see backlog).
**Deferred:** (a) `technicals` + `sentiment` fetch via `cached_invoke`, which bypasses
`AgentCaptureMiddleware` — their detail cards show evidence but never "Data collected" (backend
backlog: capture in `cached_invoke`); (b) React error #418 (SSG hydration mismatch) fires on
every page of the deployed export — pre-existing, needs its own investigation; (c) exact
per-node sub-stage events for specialists (2-node subgraphs reuse the persona stage inference).

## ✅ Milestone 16 — Trading debate detail + collapsed debaters (2026-07)
Four trading_decision-page complaints from the deployed app:
- **Sub-agents rendered as plain text / "Risk debate" sub-agent empty:** the risk-debate sub-agent
  row had no `output` mapping, so expanding it said "No detail was recorded for this step" even
  though `risk_debate_messages` (3 valid turns) was in state; bull/bear had no sub-agent row at all
  because they were plain function nodes, not a discovered subgraph. Paired with **muffin-agent
  #117**, which migrated the Bull/Bear debate onto the `multi_agent` conference framework — so both
  debates are now real conference subgraphs (`investment_debate` / `risk_debate`) that discovery
  surfaces as symmetric sub-agent rows, and the judge/trader stay plain nodes (correctly no rows).
  The registry gains a `detail: 'debate'` renderer id + a widened `StageDef.output` (now a values
  key **or a selector** — the bull/bear stage's output is a selector that reads
  `investment_debate_messages ?? { legacy bull/bear lists }` so pre-migration threads still render);
  `stageOutput(stage, values)` narrows the union in one place (and filters empty `[]`/`{}`).
  `SubgraphDetail` renders `detail: 'debate'` rows as a `DebateView` (conference message list →
  `namedMessageTurns`; legacy lists → `bullBearTurns`), so the risk row now shows its turns and the
  bull/bear row appears + renders on fresh runs.
- **Debaters not collapsed by default:** `DebateView` used to always show the first 2 turns with a
  bespoke "Show N more turns" toggle. It's now a standard `Collapsible` (Card + title + "N turns"
  meta), collapsed by default, revealing every turn on expand — the same pattern as the "Tool
  execution" panel. Debater presentation is derived from the actual turn speakers
  (`debatersForTurns` — fuzzy-matches `bull_researcher` / `bull` / `aggressive_debator` / …), so
  bubbles resolve regardless of conference vs legacy speaker ids.
- **Tool-execution stats:** the panel was already mounted (`agent-runner.tsx`); it now passes an
  `emptyMessage` so a settled trading run with no captured records (threads predating muffin-agent
  #108, 2026-07-12) shows an explanatory card instead of nothing.
- **JSON-as-plain-text sub-agent output:** `AnswerBlock` (conversation timeline) and `MessageBubble`
  now run a whole-body `tryParseJson` and render `JsonBlock` when a model answers with a raw JSON
  blob — mirroring `ToolResult`.
Verified: tsc + lint + web export + headless smoke through a local CF-Access proxy.
**Deferred:** (a) analyst intermediate transcripts are still not persisted backend-side, so a
finished thread's sub-agent "sub-steps" are the `tool_runs` records only (not a full step-by-step
transcript); (b) the risk-debate sub-agent row's inner `DebateView` repeats the row's own title
(minor redundancy — kept to reuse the single debate component); (c) pre-#108 trading threads show
the tool-execution empty-state hint.

## ✅ Milestone 17 — Calls render from `graph_id`, not app-written metadata (2026-07)
Fixes a live regression **and** a latent payload bloat on the Calls tab. Every recent run showed up
as a generic "Agent run": the tab derived its title/icon/filter from an app-written `metadata.agentId`
tag, and the M12b `useStream` migration silently broke that write (a fire-and-forget
`threads.update` in `onThreadId`) — 0 of the threads created after 2026-07-11 carried the tag.
- **Render from the server's own `graph_id`.** `threadAgentId` → `threadGraphId` reads
  `metadata.graph_id`, which LangGraph sets on **every** run and which is identical to the registry
  `id`. So the whole backlog of "Agent run" items resolves retroactively on deploy — no re-runs — and
  new runs need no client-side tag. Unknown/null `graph_id` (a thread that never started a run) still
  falls back to the generic read-only detail.
- **No more thread-metadata writes.** The `agentId`/`inputs` write and its `inputsRef`/`submitRun`
  `inputs` plumbing are deleted. The Calls descriptor ("AAPL · Is the moat durable?") and council
  input-restore now read the raw inputs from **persisted state**, not a tag.
- **~100× lighter list payload.** `searchThreads` adds `select: [thread_id, created_at, updated_at,
  status, metadata]` (omitting `values` — the search default returns full thread state, tens of
  KB/thread; measured 2086 KB → 16 KB across 50 threads) and `extract: {ticker, query, narrative}`
  (langgraph-api ≥0.11 pulls those keys out of state server-side into a compact `extracted` field).
  Rendering rides entirely on `graph_id` + protocol-v2 discovery + persisted state.
Verified: tsc + web export + headless Calls smoke through a CF-Access proxy against the deployed
backend (existing `graph_id`-tagged threads render correct titles/icons/filters + reopen).
**Deferred:** deep-agent (`stock_evaluation`) runs have a free-text prompt, not a ticker/query, so
they show no descriptor one-liner (title is self-descriptive); `extract` path indexing
(`values.messages[0].content`) didn't reliably yield a short prompt to use instead.

## ✅ Milestone 18 — Top-shape refactor: structure, typed stream boundary, persistence, perf (2026-07)
A whole-codebase health pass driven by an audit against the repo's own skills
(`composition-patterns`, `react-best-practices`, `react-native-skills`, `web-design-guidelines`).
No feature changes — six phases of consolidation:
- **Dead code + deps:** deleted the orphaned pre-M12b cluster (`lib/agent/types.ts`,
  `renderers/timeline-item.tsx`, unused council/steps exports, fixtures); uninstalled `@expo/ui`,
  `expo-device`, `expo-glass-effect`, `expo-image`, `expo-symbols` (`@langchain/core` stays — a
  required peerDependency).
- **Typed stream boundary:** `lib/agent/stream-types.ts` (`RunStream` = `UseStreamReturn<AgentState>`,
  re-exported `AnyStream`) killed all nine `as never` casts; `lib/agent/schemas.ts` (**zod**, new dep)
  validates the backend-owned payloads (ToolRun / CriterionEvaluation / PersonaSignal / the
  `criterion_evaluated` event) at every boundary — loose schemas + skip-and-dev-warn, so drift
  degrades one row, never a panel. `ToolRun`/`Criterion`/`PersonaSignal` types now derive from the
  schemas (single source).
- **Structure:** new `features/agent-shared/` owns the streaming primitives every surface shares
  (`use-run-stream`, `run-projections`, `run-progress`, `subgraph-detail`, the split conversation
  cluster, `run-surface`). The 616-line `conversation.tsx` split into pure fold logic
  (`conversation-turns.ts`), bubbles, panels, and the recursive timeline cluster; `Conversation`
  accepts `BaseMessage` instances directly (SDK `toMessageDict` coercion) and memoizes `buildTurns`.
  **`RunSurface`** (+ `RunErrorCard`/`HydrationCard` + a typed `RunStreamProvider` context) replaced
  the 4× hand-rolled ToolCacheProvider/error/skeleton scaffolding; `SubgraphDetail`/`MemberDetail`
  read the stream from context instead of a drilled `unknown` prop. `agent-runner` moved out of
  `components/` into `features/agent-runner/` split four ways; `registry.ts` became a `registry/`
  package (one file per agent — adding an agent = adding one file); Settings is schema-driven
  (`SECTIONS` data + three renderers, per-field store subscriptions).
- **Persistence:** all three on-device stores (settings / wealth / map-view) moved to zustand
  `persist` with `version` + `migrate`; `lib/storage/zustand.ts` adopts pre-middleware bare payloads
  as `{state, version: 0}` (existing users lose nothing — smoke-verified) and debounces the
  settings writes 400ms (was a full JSON write per keystroke).
- **Perf:** bar fills animate `scaleX` (off the layout pass; VoteBar keeps `width` intentionally —
  documented); Calls tab virtualized with **@shopify/flash-list** (new dep; empty/loading states
  render outside the list — its web `ListEmptyComponent` doesn't update in place, smoke-verified);
  one global `['tool-cache']` query key (fetch ignores thread); TanStack `focusManager` wired to
  `AppState` so the 10s poll pauses in background; Portfolio uses `useShallow` selectors.
- **Polish:** tailwind `ink` ramp (`DEFAULT/muted/soft/faint`) replaced every arbitrary
  `text-[#hex]`; chart palettes + map fills centralised in `theme/colors.ts`; a11y roles/labels on
  all icon-only pressables; auth `LinkText` is a real focusable button; `titleCase` deduped into
  `lib/format.ts` (was 6 copies); tab icons built once at module scope.
Verified: tsc + eslint clean per phase; web export; **20/20 headless smoke checks** (every tab +
runner/council/chat surfaces, legacy-payload migration, debounced persistence surviving reload,
FlashList data path with 20 stubbed threads, zero Reanimated/worklet errors).

## ✅ Milestone 19 — Standardized input blocks, joyful landing hero, subagent-panel polish (2026-07)
A batch of user feedback on the trading_decision call page (and the same patterns on
research/criteria_analysis/council). Paired with a `muffin-agent` backend fix.
- **Shared landing hero.** `features/agent-shared/agent-hero.tsx` generalises `ChatScreen`'s
  animated, centred hero (icon, title, tagline, staggered fade-in) to any input shape — a chat
  composer or a `Field` list + Run button. `AgentRunner` and `CouncilScreen` now render it for a
  genuinely fresh run instead of a plain, unanimated `Collapsible` form (`AgentRunner`) or a
  static "sticker" card (`CouncilScreen`); `ChatScreen`'s own hero is a thin wrapper over the same
  component. Registry gains `AgentDef.exampleConfigs` (structured field values, vs. `examples`'
  freeform chat strings) — authored for trading_decision/research/criteria_analysis/council.
  **Deliberately did not add a parallel `inputMode` flag** — the hero branches on the existing
  `agent.chat` boolean, which was already in lockstep with it; a second flag would just be a second
  source of truth.
- **Read-only recap replaces the always-editable form.** The old `RunInputForm` pre-filled a fully
  editable form from the reopened run's saved state (`values = {...savedInputs, ...edits}`) even
  though none of these graphs support real follow-up — it just looked like live amendment. Deleted;
  `AgentRunner`/`CouncilScreen` now hold a pre-submit-only `draft`, and once a thread exists, render
  `agent-shared/run-recap.tsx` (read-only labelled values) with an explicit "Start a new run" button
  (`router.push` with no `threadId` — mounts a fresh screen instance, same idiom as the Calls tab)
  instead of amending in place. Real interrupt-based follow-up (today only `stock_evaluation`'s chat
  graph has it) is **out of scope** — this milestone only fixes the misleading editable-recap UI.
- **Stage/debate envelope consistency.** `ReportSection` (bare `Collapsible`) now wraps in
  `Card tone="muted"`, matching `DebateView`'s existing envelope — one container convention for
  every pipeline stage. The debate turn bubbles were extracted into a standalone `DebateTurns`
  component (`DebateView` = `Card`+`Collapsible` over `DebateTurns`); `DebateDetail` renders
  `DebateTurns` directly instead of nesting a second, already-expanded collapsible inside the
  sub-agent row's own collapsible (explicit variant rather than a boolean `bare` prop, per
  `composition-patterns`).
- **Unified tool-run display.** "Tool calls" (per-subagent), "Tool execution" (per-run, grouped
  with ok/failed/cached stats), "Data collection" (per-criterion), "Data collected" (per-member)
  were four near-identical, accidentally-diverged components over the same `ToolRunRow`. Replaced
  with one `ToolRunsPanel` (`mode: 'flat' | 'grouped'`) — same Card+Collapsible envelope everywhere,
  same rows, different scope/grouping only.
- **Subagent panel polish.** A terminal structured-output tool call (name is PascalCase — the
  Pydantic schema name — vs. every real tool's snake_case, a reliable agent-agnostic discriminator)
  now renders immediately via `StructuredOutput` instead of a raw `JsonBlock` dump, both eliminating
  the "plain JSON, then re-renders nicely" flash (live scoped messages vs. persisted `row.output`
  racing) and giving the subagent's final answer a distinct "Final result" step instead of an
  anonymous flat tool call. Added a pulsing `Skeleton` for the genuinely indeterminate
  `SubgraphDetail` loading window. Subagent input (`HumanBubble`) now renders through `Markdown`
  instead of plain `Text`. The backend's structured-output retry nudge (an injected `HumanMessage`)
  no longer renders as a fake user turn — it's detected via its `additional_kwargs` marker and shown
  as a muted "System: retry nudge" step.
- **Backend companion (`muffin-agent`):** `ToolResultCacheMiddleware`/`ToolKnowledgeMiddleware` were
  silently reconstructing `ToolMessage`s without forwarding `status`, so a failed tool call (e.g.
  `ToolRetryMiddleware`'s exhausted-retry message, which doesn't start with the literal word
  "error") could get cached and displayed as a success. Fixed by checking `status` first
  (authoritative) rather than relying solely on the `is_error_content()` string-prefix heuristic,
  and explicitly setting `status="error"` on every constructed error message. `messages.tsx`'s raw
  tool-message badge now also reads `status` (previously always neutral).
Verified: `pytest`/`ruff`/`mypy` (backend, new status-propagation tests); tsc + eslint + web export
clean; headless smoke of all four field-based agents' fresh hero (identity block, fields, Advanced
options, example chips filling the draft and enabling Run, Save-as-preset) plus the unchanged
stock_evaluation chat hero. **Deferred:** verifying `RunRecap`/subagent-panel/tool-status-badge
rendering against real backend data needs a running `langgraph dev` stack or the deployed
backend — not exercised live in this pass; do a quick manual pass after deploying.

## ✅ Milestone 20 — Run-page identity banner + hydration ETA bar (2026-07)
Two run-page complaints: the top "inputs to the agent" block looked plain/joyless, and the
28–70s reopen load gave no sense of how long it would take.
- **Identity banner replaces the plain recap.** `agent-shared/run-recap.tsx` (shared by the
  generic runner *and* council) was a flat `outline` card — title, uppercase input rows, buttons.
  Reworked into an identity banner that reuses the fresh-run hero's language for continuity: the
  agent's icon tile + title + `tagline`, a live **status pill** (pulsing amber "Running"/"Loading"
  → calm leaf-green "Completed"), and the submitted inputs as soft `rounded-crumb` chips, faded in
  on mount (`FadeInDown`). `useReducedMotion` drops the entrance + pulse. Both call sites now pass
  `loading={stream.isThreadLoading}` so the pill reads "Loading" during reopen hydration instead of
  a premature "Completed".
- **Honest hydration ETA bar.** The reopen `getState` reports no percent-complete (opaque
  checkpoint read; see M14), so `useEstimatedProgress` (new, `agent-shared/`) turns *elapsed time*
  into an eased 0→~0.95 value that decelerates toward a ~45s estimate and holds near the top until
  the state actually lands — never a false 100% — plus a friendly "~Ns left" → "Almost there…"
  label. Rendered by a new `ui/ProgressBar` primitive (determinate; `scaleX` + `transformOrigin`
  off the layout pass — same idiom as the wealth bars) inside the shared `HydrationCard`, so the
  generic runner **and** council reopen-loads get it for free. Scope was deliberately reopen-only
  (not fresh-run warm-up).
- Verified: tsc + eslint + web export clean; headless smoke of a reopened `research` thread through
  a local dist server + stubbed `/api` state fetch — the **Completed** banner (icon/title/tagline,
  green pill, `QUESTION` input chip) and, with a delayed state fetch, the **Loading** pill + eased
  bar reading "~33s left" over the real registry stage labels; only the pre-existing React #418
  SSG-hydration error, zero Reanimated/worklet errors.
- **Deferred / follow-up:** the ETA estimate is a fixed 45s constant — learning it from recent
  on-device load durations (per-agent, since checkpoint size drives the read time) would tighten it;
  noted, not built. The 28–70s latency itself remains a backend concern (langgraph-api checkpoint
  reads on the A1 node) — the bar sets expectations, it doesn't cure the wait.

## ✅ Milestone 21 — Reopen latency: hydrate from `thread.values`, not checkpoint `getState` (2026-07)
- [x] Reopen latency: hydrate finished runs from `thread.values` not the checkpoint
  `getState` (~240x faster reopen; `fast-hydration-transport.ts`). [app]
- [ ] Backend: langgraph-postgres `getState`/`getHistory` (checkpointer) is a flat
  ~27s regardless of state size (getState 1 ckpt ≈ getHistory 8 ckpts). Not
  checkpoint bloat — points at checkpointer connection/pool/setup. Fixing it also
  speeds live runs + resume. [backend-patch] — see docs/backend-notes/2026-07-23-getstate-latency.md

## ✅ Milestone 22 — Recursive sub-agent tree, Phase 2 (2026-07)
The flat sub-agents panel (`useSubgraphRows`, discovery-only — one level of compiled-subgraph
invocations, see the `muffin-ui-subagents-panel-discovery` memory) never showed the deeper
execution structure a sub-agent can itself contain. Consumes the muffin-agent
`AgentCaptureMiddleware` **`subagent_tree`** channel (the actual captured execution topology, at
whatever depth the agents really nested — not registry-seeded, per the same "reflect reality"
directive as the earlier discovery fix):
- **Data layer** (`lib/agent/subagent-tree.ts`) — `collectSubagentTree(values)` gathers the
  top-level `subagent_tree` map plus each criterion's homed `criterion_evaluations[i].subagent_tree`;
  `buildForest(nodes)` reconstructs the tree from `<name>:<uuid>` id segments (parentage from the
  id, deliberately never `parent_id`, which a re-homed node's `parent_id` can point away from) and
  synthesizes any never-captured intermediate ancestor as a placeholder row.
- **Lazy detail** (`agent-shared/use-subagent-detail.ts`) — `useSubagentDetail` fetches one node's
  heavy `messages`/`tool_runs`/`output` payload from the `["subagent_detail", threadId]` Store
  namespace only when that row is expanded, keeping `thread.values` light.
- **Recursive UI** (`agent-shared/subagent-tree.tsx` + `node-detail.tsx`) — `SubagentTree` reuses
  the existing `SubagentActivity`/`SubAgentRunRow` row look for every level (no bespoke tree
  widget); recursion falls out of a row's `renderDetail` nesting a child `SubagentActivity`.
- **Mounted everywhere, additively** — the generic runner, calls history (incl. a per-criterion
  subtree), and council all render `<SubagentTree>` in place of the flat panel only when its forest
  is non-empty, else the pre-existing flat panel/fallback renders exactly as before. Criteria's
  renderer (`renderers/criteria-result.tsx`) takes a `renderTree` render-prop instead of a plain
  prop to dodge a `renderers`-barrel require cycle `SubagentTree` would otherwise reintroduce
  (same pattern the file already uses for `Conversation`).
- Verified: `tsc` clean, `expo export -p web` clean, headless smoke against a real deployed
  criteria thread (structural assertions: hydrated content, hit `thread.values` not the checkpoint
  `getState`, zero Reanimated errors) plus an interactive drill-down via the Playwright MCP.
- **Note:** today's evaluators single-shot, so validated real trees are shallow (2 levels:
  `criterion_evaluation` → `evaluate`) — the reconstruction itself has no depth cap and will
  render deeper as agents nest more.

## ✅ Milestone 23 — Generic "Execution tree" view (per-agent toggle) (2026-07)
A single generic drill-down view for **every** agent, offered beside today's bespoke Overview via a
persisted per-agent toggle (default Overview). The run's plan is a vertical rail at the root; any node
expands, at the same level of detail, into its real captured sub-agent topology — to any depth.
Built almost entirely by re-composing the M22 primitives:
- **Plan model** (`features/agent-shared/execution-tree/plan-steps.ts` + `types.ts`) — `buildExecTree`
  assembles a shared `ExecNode[]` ("plan-first hybrid"): graph agents use the registry `stages`
  (`resolveStages`), deep agents use the `todos` plan, both joined to the `buildForest` topology by
  matching a stage's `node`/`active` to a forest root's leading id segment; agents with neither fall
  back to the raw forest. The criteria **fan-out** stage is special-cased to build one **named** node
  per `criterion_evaluations[i]` (the raw forest would render 11 indistinguishable "Criterion
  Evaluation" rows) with the evaluation as eager `output` (the criterion card renders with no Store
  fetch) and the worker node as its lazy transcript source.
- **Pluggable renderers** (`lib/agent/renderers/output-registry.tsx` + `tool-registry.tsx`) — two
  string-keyed maps added beside the existing `RESULT_RENDERERS` axis: `renderNodeOutput` (output
  shape → component: criterion card / persona verdict / debate / default `StructuredOutput`; unwraps a
  `{ evaluation }` wrapper) and `renderToolOutput` (**new tool-name axis**: price/OHLCV/indicator →
  `TimeSeriesChart`, default = the existing shape heuristic). `renderToolOutput` is wired into the
  existing `ToolRunRow`, so every tool panel app-wide gains per-tool pluggability and the duplicated
  chart/json/markdown heuristic collapses to one place.
- **Recursive UI** (`features/agent-shared/execution-tree/execution-tree.tsx`) — `ExecutionTree` +
  the mutually-recursive `TreeNodeRow`/`NodeFacets` (one file, hoisted `function` decls, like
  `conversation.tsx`). Each node's expanded body shows the same four facets — Result
  (`renderNodeOutput`), Steps (`Conversation` over the Store transcript), Sub-agents (child
  `TreeNodeRow`s — the recursion), Tool-calls (`ToolRunsPanel`) — lazily fetching heavy detail via
  `useSubagentDetail` only on expand. Empty facets are omitted.
- **Toggle** (`components/ui/segmented.tsx` promoted from the Globe screen + `agent-view-store.ts` +
  `run-view-toggle.tsx`) — a persisted per-agent `Overview | Execution tree` control, mounted
  additively on all four surfaces (runner, council, chat, calls history); the tree branch replaces the
  Overview body, never removes it. Old runs (no `subagent_tree`) render the empty-state and keep
  working.
- Verified: `tsc` clean, `expo export -p web` clean (require-cycle exercised once real screens import
  `ExecutionTree`), `scripts/smoke-exectree.mjs` structural gate against the real deployed criteria
  thread (toggle + 6 ordered stages + fast `thread.values` hydration + zero Reanimated errors), plus
  an interactive Playwright-MCP drill-down: Evaluate → 11 named criterion rows (with signals) → a
  criterion card (POSITIVE, conviction, reasoning) → toggle persists and flips back to an unchanged
  Overview.
- **Follow-ups:** the criterion node still nests a redundant single "Criterion Evaluation" worker
  child (harmless; its transcript could fold into the parent); a full connecting rail line + elapsed
  timers are cosmetic polish; trees stay as shallow as agents actually nest (same M22 note).

## ✅ Milestone 24 — Execution tree reads LangGraph's checkpoints, not a capture channel (2026-07-27)
M22/M23 consumed `AgentCaptureMiddleware`'s `subagent_tree` channel + a `["subagent_detail",
threadId]` Store offload. Both are **deleted**, backend included (muffin-agent #132): LangGraph
already persists the whole execution record. `POST /threads/{id}/history` returns one snapshot per
superstep with the `tasks[]` that ran in it; each task carries
`{id, name, result, checkpoint:{checkpoint_ns}}`, and recursing on that namespace yields the child's
supersteps, its tasks, and its `values.messages` — the transcript with its tool calls (verified on
prod thread `019f81a0`: `market_analyst:<uuid>` → 13 messages, 10 tool calls).
- **Reader** (`lib/agent/run-history.ts`) — `fetchNamespace` / `nodesFromSnapshots` /
  `messagesFromSnapshots` / `toolRunsFromMessages` / `taskWrite`. **A node is drillable iff it is a
  compiled agent/subgraph added via `add_node`**; a plain function node reports `checkpoint: null`
  and is genuinely a leaf, which the UI now says out loud instead of showing an empty panel.
- **Lazy by design** (`agent-shared/use-run-tree.ts`) — root topology once per thread, one namespace
  per expanded row, cached forever once the thread settles. A criteria run has 27 namespaces.
- **The double-nesting bug is now structurally impossible.** The old builder split `|`-joined ids and
  *synthesized* the ancestor levels the backend never captured — a synthesized "Criterion evaluation"
  wrapping a real child that took the same label from the builder's static agent name. Every level is
  now one LangGraph actually recorded, so `collectTopology` / `buildTopology` / `collapseRedundant` /
  `segmentName` are all gone. This also closes M23's "redundant single worker child" follow-up.
- **Tool calls come from the transcript** — `AIMessage.tool_calls` paired with its `ToolMessage` by
  `tool_call_id`; a call with no reply is kept as `pending` rather than dropped, so a cancelled run
  doesn't silently lose it.
- **Fan-out rows are named from `task.result`** (the channels a task wrote), so the 11 identical
  `criterion_evaluation` nodes get their names from the ROOT history with no extra fetch.
  Deliberately *not* index-paired against `values.criterion_evaluations` — parallel `Send` workers
  complete out of order, so the labels would drift onto the wrong rows.
- **Two deliberate removals.** (a) No run-wide "Tool execution" roll-up: a tool call belongs to the
  node that made it, and a flat run-wide summary would mean walking every namespace eagerly.
  (b) Overview vs Tree split cleanly — Overview answers what the run *concluded*, the Tree answers
  what it *did*; criterion cards keep scores and evidence and lose their tool panel.
- **Latency was ours, not LangGraph's.** History reads took 27.3s on criteria / 4.1s on trading.
  Root cause: LangGraph Platform rebuilds a factory-registered graph on *every* API request, and each
  agent factory opened a fresh MCP session to list tools — **23 round trips to build
  `criteria_analysis`, 4 for `trading_decision`, ~1.1s each**. Caching tool discovery (muffin-agent
  #131) cuts a build to one round trip. An earlier "upstream `langgraph-api` N+1" diagnosis was wrong
  and the drafted issue was never filed.
- **Verification** — `scripts/exectree-check.ts` rewritten around the history shape (fixed by
  `langgraph_api/state.py` + the SDK's `ThreadTask`), 26 checks; `scripts/history-check.ts` confirms
  end-to-end against the deployment. Backend guards the structural invariant in
  `tests/integration/test_graph_observability.py`.
- **Follow-ups:** per-tool **duration** is not recoverable from a transcript (messages carry no
  timing) — see the muffin-agent roadmap; the council drill-down is only as deep as agents actually
  nest, and today's evaluators still single-shot with zero tool calls (an agent-quality item, not a
  UI one).


## ✅ Milestone 25 — The run Timeline: graph-agnostic, parallel-aware, four facets per node (2026-08-01)
M24 made the tree read LangGraph's checkpoints, but it still got its *plan* from a hand-written
`AgentDef.stages` recipe per agent, flattened every superstep into one list, showed no timing, and
could never render a node as running or pending. The rewrite
(`features/agent-shared/run-timeline/` + `lib/agent/{run-node,run-graph}.ts`) is **UI-only, LangGraph
API only** — no muffin-agent change, no per-graph logic, no Store side-reads — so a graph registered
next month renders correctly with no UI change.

- **Structure is API-derived.** `GET /assistants/{id}/graph` supplies the compiled DAG (steps not yet
  reached, in topological order); `POST /threads/{id}/history` supplies what ran; `stream.subgraphs` /
  `stream.subagents` supply live status and wall-clock. `AgentDef.stages` survives for the Overview's
  `RunProgress` and the result renderers only; `StageDef.outputKind` is deleted.
- **Supersteps became the unit — `Lane[]`, not a flat list.** Tasks sharing a `metadata.step` ran in
  parallel; successive steps ran sequentially. Verified on prod: criteria `019faada` →
  `0:1 1:1 2:2∥ 3:1 4:10∥ 5:1`; trading `019f81a0` → a 4-wide analyst lane; council `019f901f` → one
  **19-wide** lane; deep-agent `019f9e96` → a 9-wide sub-agent fan. Sequential steps sit on a spine,
  parallel ones in a bracketed `ParallelFan` — a deliberately different shape.
- **Timing at last**, from consecutive checkpoint `created_at` (criteria/AMZN: ticker_classification
  16m32s of a 22m18s run). `DurationBar` is relative-to-longest and square-rooted, not a time axis:
  history has one timestamp per superstep, so a Gantt would draw ten identical bars for a fan-out and
  imply precision that does not exist.
- **`pending` / `active` exist.** `next` (never read before) names what runs now; DAG steps the run
  hasn't reached render pending **while busy only** — on a finished thread an unrun node was a branch
  not taken, not work still to come.
- **Four facets per node — Input · Plan · Timeline · Output — recursively.** A pipeline node's
  timeline is its child supersteps; an agent node's is its transcript, with each `task` delegation
  expanding into that sub-agent's own card (joined by tool-call id, so the delegation and the
  sub-agent are one row, not two). Plan updates render as the resulting checklist, since a
  `write_todos` call's arguments *are* the new plan.
- **`stream.subagents` is now read** — it never was, anywhere. Live, recursive deep-agent sub-agents
  with `taskInput`, `parentId`, `depth` and real timestamps; `stock_evaluation` had no live
  sub-agent visibility at all before. Discovery is matched on **namespace**, not node name, so live
  status reaches any depth and tells fan-out members apart.
- **Output rendering dispatches on the state channel** (`task.result` keys — `metadata.writes` comes
  back empty over the API), so custom cards stay reachable while an unknown channel falls through to
  `StructuredOutput` instead of being mis-rendered.
- **Removed:** `exec-tree.ts`, `execution-tree/`, `subagent-tree.tsx`, `node-detail.tsx`,
  `use-run-tree.ts`, `zTreeNode`, `fetchTreeEagerly`, `ToolRunsPanel mode="grouped"`, and the
  `useToolCache()` size/age join on tool rows. Toggle renamed `tree` → `timeline`
  (`agent-view-store` **version 2** + migration).
- **Bug caught in verification:** label-from-payload must apply ONLY to fan-out members — run against
  every node it renamed `merge_criteria` to "Revenue Growth (3Y CAGR)", the first criterion in the
  list it merely collected. `relabelFanOut` now guards it, with a regression assertion.
- **Verification:** `scripts/run-timeline-check.ts` (90 offline structural checks),
  `scripts/history-check.ts` (live, incl. `getGraph` for all five graphs),
  `scripts/smoke-timeline.mjs [thread] [graph]` (browser; clicks by `role`/`aria-label`).
- **Follow-ups:** per-**tool** duration is still unavailable (messages carry no timing — it would need
  a backend change, deliberately out of scope); the Overview's `RunProgress` / `SubagentActivity`
  panels still use the registry recipe and were left untouched; long timelines are unvirtualized.


## ✅ Milestone 26 — Timeline polish: per-facet loading, no duplicate output, honest plans (2026-08-01)
Review of a fresh run turned up five defects. Two were **facts about the data, not UI bugs** — those
are now reported honestly rather than papered over.

- **Per-facet loading.** The card used to show one skeleton, gated on knowing *nothing* — but a
  fan-out member already carries its `output` from the parent's `task.result`, so the guard was
  false, the card rendered instantly and then silently grew seconds later. Each facet now holds a
  labelled `FacetSkeleton` in its final place, and `NodeRow` swaps its chevron for a spinner while
  its namespace is in flight (same TanStack query key as the body, so it costs no extra request).
  The root skeleton gained a "Reading this run…" line — an unlabelled skeleton read as an empty run.
- **Input prompts render as markdown** once expanded; collapsed they stay a clamped plain `Text`,
  because `Markdown` returns a `Fragment` and cannot take `numberOfLines`. (The old code's comment
  claimed markdown; the code did not do it.)
- **No more duplicate criterion card** (`isPassThrough`). The criterion worker subgraph is
  `evaluate` → `package`, and `package`'s only write is `criterion_evaluations` — the payload the
  criterion row already shows, so every criterion rendered twice. A **leaf** writing the **same
  channel** as its parent (`TimelineCtx.parentOutputChannel`) is a terminal pass-through: the row and
  its duration stay, the repeated card becomes a one-liner. Derived from two channel names the API
  reported — no per-graph knowledge.
- **Stale plans are labelled, not hidden** (`isPlanStale`). On prod thread `019faada` the
  ticker-classification agent wrote four todos at superstep 5 and **never called `write_todos`
  again**, so the checkpoint still says "1 of 4" long after the node succeeded. A finished node with
  unfinished todos now says when the plan was last written instead of showing a progress fraction
  that reads like a stalled run.
- **The criterion card is the Overview's `CriterionDetails`** — evidence checklist, data-source
  chips, sub-criteria tone dots, limitations, "no live data" warning, folded raw reasoning. The lean
  duplicate it replaced was justified by a require cycle that **does not exist**:
  `criteria-result.tsx`'s only `@/features` import is an erased `import type`, nothing under
  `renderers/` imports the timeline, and `output-registry.tsx` already imports three siblings
  directly. The comment even pointed at a "renderers barrel note" that has never existed
  (`git log -S cycle` on the barrel returns nothing). One component per payload type now, shared by
  both views, so they cannot drift apart again.
- **Motion:** card bodies fade out as well as in (collapse used to snap), lanes stagger in as the
  spine draws downward (capped at 8), the rail below a running step breathes, and the run summary
  counts up on a settled run. All gated on `useReducedMotion`. Reanimated **layout transitions** were
  deliberately avoided — unreliable on RN-Web, and this repo's gate is a headless browser.
- **Two bugs found in review of the above, fixed in the same milestone:**
  - **Every leaf node rendered the whole run inside itself.** A plain function node has no
    namespace, so `useRunTimeline` was called with `undefined` + `enabled: false` — collapsing the
    query key to the same `'__root__'` the run timeline uses. A disabled `useQuery` still returns
    cached data for its key, and the root is always cached, so expanding `package`, `merge_criteria`,
    the trading judge/trader or the council judge redrew the entire pipeline. Present since M25 and
    missed because the earlier smokes only ever expanded nodes that DO have namespaces. The hook now
    blanks its result when it was not enabled; `smoke-timeline.mjs` expands a `checkpoint: null` node
    and fails if a sibling label then appears twice (verified to fail with the bug reintroduced).
  - **`Skeleton` rendered nothing at all — app-wide.** It passed its `className` to a Reanimated
    `Animated.View`, which NativeWind classes do not reach (the caveat `agent-hero.tsx` documents),
    so every skeleton in the app was a class-less, zero-height, transparent box. Confirmed in the
    browser: the bars carried no class attribute and their container measured 6px — the flex gaps
    alone. The `className` now goes on an inner plain `View` and the `Animated.View` carries only the
    animated opacity. Bars measure 14px with a real fill. This also un-breaks the hydration, calls
    and sub-agent skeletons, which had been invisible since they were written. The Plan skeleton was
    dropped: only deep agents have a plan, so holding space for one promises what most nodes never show.
  - **A node's Input now comes from `__start__` when it has no transcript.** LangGraph's `__start__`
    task writes exactly the channels the caller handed down, so its `result` IS the node's input —
    it was being discarded because `__start__` is filtered from the lanes as plumbing. A criterion
    worker now shows the criterion definition (name, target range, weight, assessment guidance, data
    requirements) and the upstream classification it was scoring against, instead of only its verdict.
  - **Input prompts render as markdown always**, clipped to a fixed height with an SVG fade and a
    "Show full prompt" toggle. Previously they showed raw markdown source until expanded, because
    `Markdown` returns a `Fragment` and cannot take `numberOfLines`; clipping the *rendered* output
    sidesteps that and formats headings/tables/code from the first glance.
- **Follow-up for muffin-agent:** deep agents do not maintain their `todos`. `TodoListMiddleware`
  gives them `write_todos` but nothing in the prompts requires marking items complete, so a plan is
  written once and abandoned. The UI now says so; the agent-side fix belongs in muffin-agent.


## ✅ Milestone 27 — Structured outputs get a design: semantic baseline + hero cards (2026-08-02)
Every agent payload rendered as a stack of `LABEL` / value rows — a classification, a portfolio
decision and a criterion definition all looked like the same database dump, `confidence` printed as
the text "0.9", and null fields printed their label above a blank. Two layers replace it, after an
inventory of all ~20 structured outputs across the five graphs.

- **Layer 1 — the semantic baseline** (`renderers/structured.tsx` + `fields.tsx`). Reads FIELD
  MEANING, not just type: a 0..1 `confidence` is a `Gauge`, `signal`/`rating` a toned `SignalPill`,
  `weight` a `WeightBar`, `*_pct` a `DeltaValue`, `limitations`/`key_risks` a `CaveatList`,
  `key_findings`/`catalysts` a `CheckList`, categorical strings a `Badge`, prose `Markdown`. Fields
  are **ranked** so the headline leads, and **empty fields are dropped entirely**. The rules key on
  naming conventions and value shapes, never a model registry, so a graph written next month is
  legible for free — the same principle the timeline's structure follows.
- **Layer 2 — hero cards** (`renderers/cards.tsx`) for the payloads carrying a run's headline:
  `ClassificationCard`, `CriteriaDefinitionCard`, `MethodologyCard`, `SynthesisCard`,
  `DecisionTicketCard`, `JudgeCard`, `TradePlanCard`, `OutcomesCard`, `CouncilVerdictCard` (with a
  proportional vote-breakdown bar), `StrategyGridCard` (a specialist's `{signal, confidence,
  metrics}` strategies as comparable tiles instead of three levels of JSON), `EvidenceCard`.
  18 channels are now registered, up from 5.
- **The null-fallthrough contract.** Every card returns `null` when the payload does not match, and
  `CHANNEL_RENDERERS` calls cards as **plain functions** rather than as JSX elements — a JSX element
  is always truthy, so `if (view) return view` would end the chain on a card that rendered nothing.
  Safe because no card calls a hook in its own body.
- **Two bugs caught in visual review:** `composite_score` 0.075 rendered as "8" (a 0–1 ratio printed
  as if out of 10) — now a percentage, with a guard for graphs using other units. And `time_horizon`
  came back as a full sentence on a real decision, which a `Badge` cannot wrap, pushing the card off
  screen — long values now render as their own labelled block, in both the cards and the baseline.
- **The Overview now renders through the same cards** (same milestone), removing the last
  duplication between the two run views — and fixing drift each renderer had accumulated:
  `CriteriaResult` read `synth.summary ?? synth.thesis`, **neither of which exists** on
  `CriteriaAnalysisSynthesis` (it is `thesis_paragraph`), so its headline summary was always blank
  and `key_positives` / `key_negatives` / `divergences` / `weighted_breakdown` never rendered;
  `TradingResult` collapsed three payloads into one `Verdict` and dropped the price target, stop,
  horizon, sizing, accepted risks, the judge's cases/catalysts/checklist and the trader's levels;
  `JudgePanel` showed the vote breakdown as a nested dump; `ResearchResult` discarded
  `missing_information` entirely. Each renderer keeps only what is genuinely Overview-specific —
  the criterion list with its transcript injection, the analyst reports, the debates, the judge's
  deliberating shimmer.


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

## ✅ Milestone 8 — Supabase auth (self-hosted) + cloud backup

**As built.** Real user accounts on a **self-hosted Supabase** running inside the Swarm
stack (the Oracle node had 17 GiB headroom — measured before deciding): Postgres 17,
GoTrue, PostgREST, Realtime, Storage(+imgproxy), Edge Functions, Kong (public gateway at
`supabase.<domain>`), Studio (admin, behind Cloudflare Access). The LangGraph
checkpointer/store migrated to a dedicated `langgraph` database inside Supabase's
Postgres (`use_supabase_db` flag + runbook in muffin-deployment; `langgraph-postgres`
retired after cutover). **aegra was evaluated and deferred** — staying on managed
`langgraph-api`; Cloudflare Access stays in front of the app (opening up is an
M9/launch decision).

- **App** (`src/lib/auth/`, `src/features/account/`): supabase-js client built from
  on-device settings (web defaults to the same-origin `/supabase` nginx proxy, same
  trick as `/api`; anon key in Settings), zustand session store fed by
  `onAuthStateChange`, Account card in Settings (email+password sign-in/up — GoTrue
  auto-confirms until SMTP secrets are set). `buildAuthHeaders` prefers the live
  session token; `buildConfigurable` sets `user_id` from the verified Supabase UUID.
  Anonymous use still fully works.
- **Cloud backup (opt-in)**: Back up / Restore buttons sync the portfolio + a
  **non-secret** settings subset to `user_backups` (RLS owner-only) — API keys,
  tokens and endpoints never leave the device (`src/features/account/backup.ts`).
- **Backend** (muffin-agent #89): `auth.py` mode 4 verifies GoTrue HS256 user tokens
  (`aud=authenticated`; anon/service keys rejected) and `@auth.on.threads` stamps +
  filters `metadata.owner`, so the Calls tab is per-user.
- **Deployment** (muffin-deployment): the full Supabase compose block, key
  generation (`stack/supabase/generate-keys.sh`), idempotent app migrations
  (`user_backups`, `research_shares` — the latter ready for the deferred library),
  Traefik/Cloudflare routing, optional SMTP env (Cloudflare Email Service documented).

**Deferred to backlog:** the **shared research library** UI (browse/share/re-open
public research — the `research_shares` table + RLS already exist server-side);
auto-sync backup; backend post-run research persistence; more OAuth providers
(GitHub + Google shipped — see the M8 backlog for the rest + their costs).

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
- **M20 follow-up:**
  - **Adaptive hydration estimate** — `useEstimatedProgress` uses a fixed 45s constant; persist
    recent reopen durations on-device (per-agent, since checkpoint size drives the read time) and
    feed the rolling estimate in, so the ETA tightens per user/graph instead of one global guess.
- **M18 follow-ups:**
  - **Transcript windowing** — `Conversation` renders every turn; very long runs deserve a
    "show earlier turns" expander (buildTurns is memoized, but the render itself is unbounded).
  - **Targeted tool-cache reads** — `searchItems(['cache'], {limit: 100})` can miss payloads in a
    very large global cache; switch the join to per-key `store.getItem` (pre-existing item, restated).
  - **World-map per-path memoization** — 177 SVG paths re-render on every selection change; a
    memoized Path row would limit it to the fill-changed ones.
  - **Drill-list virtualization** — `markets/drill-list.tsx` (~40 rows) still `.map()`s in a
    ScrollView; FlashList is now a dependency if it ever grows.
  - **Grandfathered `useMemo`s** — a handful predate the React Compiler convention and are
    redundant-but-harmless; strip opportunistically when touching those files (keep the
    load-bearing mount-time snapshot in `use-run-stream.ts`).
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
- **M4 ([backend-patch]):** richer chart types (candlesticks, multi-axis — `victory-native` if the
  SVG chart outgrows itself). ~~Custom-event structured progress~~ — per-criterion events shipped
  (M12/muffin-agent #103); subgraph discovery covers stage structure.
- **Ollama Cloud provider + server-default chain (done, 2026-07):** added `ollama` to the LLM
  provider selector + an "Ollama Cloud key" field, and a **"Server default"** provider option
  (`llmProvider === ''`) that sends no `llm_provider`/`llm_chain` so the deployment's configured
  `llm_chain` (Ollama Cloud primary → OpenRouter fallback) applies. Picking a concrete provider
  sends `llm_provider` + `llm_chain: []` to force single-provider mode. `ollamaApiKey` added to the
  backup strip-list (keys stay private). **Deferred:** a per-user structured `llm_chain` editor
  (multi-row provider/model/rps) — server `LLM_CHAIN` is the fallback-chain source today; the UI
  only does server-default or single-provider override.
- **M12b (done, 2026-07):** migrated ChatScreen onto the protocol-v2 `useRunStream` too — one stream
  stack for the whole app; deleted the legacy `use-agent-stream.ts` + `use-active-run.ts` attach gate
  and the `registry.subgraphs` flag. Accepted the message branching / edit-fork / regenerate
  regression (no protocol-v2 equivalent; `MessageActions` makes them optional). Also fixed the native
  streaming path: the v2 SSE transport ignores the SDK's `overrideFetchImplementation` global, so
  `useRunStream` now passes `fetch: streamingFetch()` (expo/fetch on native). **Still owed: a real
  iOS/Android device/simulator test of streaming** — verification so far is web + type/bundle only.
- **M12 follow-ups:**
  - **Message branching / edit / regenerate** — re-add if `@langchain/react` exposes a
    message→checkpoint metadata + branch-select API (today only `submit(forkFrom)` / `state.fork` /
    `state.listCheckpoints` exist; rebuilding branch navigation on those is possible but non-trivial).
  - **Persona sub-stage fidelity:** the root pump is depth-1, so persona INNER-node lifecycle
    (collect→compute→verdict) is inferred from persona values events (`council-live.ts`). A
    backend stage-level custom event (muffin-agent roadmap) would make it exact; alternatively a
    depth-2 lifecycle projection if the SDK exposes depth control.
  - **Live per-run tool feed:** scoped `useToolCalls` renders per-worker tool calls in expanded
    rows; a run-level LIVE union (across namespaces) needs either a depth-aware tools projection
    or backend events — today the run-level summary grows as evaluations land (their `tool_runs`).
  - **Pre-existing hydration warning:** React #418 (HTML hydration mismatch) fires on prod today on
    call-detail routes (expo-router static export served as SPA fallback) — harmless but noisy;
    investigate per-route HTML serving in `deploy/nginx.conf` vs `web.output: single`.
  - **Sandbox/file browser** (deepagents frontend docs pattern): muffin runs OpenSandbox — a
    thread-scoped file tree + diff viewer for `execute_python` / offloaded tool outputs would give
    the run pages an IDE-like data pane. Needs a small backend file-listing endpoint.
- **M8 [app]:** **shared research library** (browse/share/re-open public research; the
  `research_shares` table + RLS are already deployed — this is app-side work: a share
  action on completed research runs + a library screen rendering via `research-result`);
  opt-in auto-sync for the cloud backup (today it's manual Back up / Restore); backend
  post-run research persistence (a middleware/hook that writes outputs to `research_shares`).
- **M8 [Supabase stack — muffin-deployment]:** the self-hosted stack ships auth / REST /
  Realtime / Storage(+imgproxy) / Edge Functions / Studio, but several pieces are omitted
  or unwired:
  - **`supabase-db` backups** — automated `pg_dump` cron (the volume now holds auth + app
    data *and* all LangGraph checkpoints; single copy = data-loss risk). *Highest priority.*
  - **Storage** — deployed (local-file backend) but no buckets or `storage.objects` RLS
    policies; needed for avatars / research-PDF exports.
  - **Realtime** — deployed but no tables in the `supabase_realtime` publication and the
    app subscribes to nothing; needed for a live-updating shared library / cross-device sync.
  - **Edge Functions** — only the upstream `main` router; no actual functions (largely
    redundant with `langgraph-api`).
  - **Supavisor** (connection pooler) and **Analytics/Logflare + Vector** (Studio Logs tab)
    — omitted from the compose; fine at single-node scale, revisit if connection counts grow.
  - **Auth methods** — email/password + **GitHub + Google OAuth** shipped (dedicated `/auth`
    page with a full stepped flow: 6-digit e-mail-code confirmation, a `/verify` route that
    handles the GoTrue confirmation/recovery **link** client-side via `verifyOtp`, "resend
    code", and forgot-password → set-new-password). Remaining GoTrue providers (each = a few `GOTRUE_EXTERNAL_*` env lines + an
    `oauth.ts` metadata entry; the app auto-shows any that GoTrue reports enabled). **Cost**
    is the provider's, not Supabase's — GoTrue itself is free for all of these:
    - **Free** (just register an OAuth app): GitLab, Bitbucket, Discord, Slack, Spotify,
      Twitch, LinkedIn, Notion, Figma, Kakao, Zoom, Microsoft/Azure (basic Entra).
    - **Free but extra setup**: **Facebook** (Meta app + business/app review before it works
      for non-test users); **SAML SSO** (free in GoTrue, but you need an IdP).
    - **Paid / account cost**: **Apple** (Apple Developer Program, $99/yr — and required by
      the App Store if iOS ships other social logins); **Twitter/X** (paid X API tier, ~$100/mo
      Basic); **WorkOS** (enterprise-SSO SaaS, free tier then paid).
    - **Usage-metered**: **phone/SMS OTP** — pay-per-message via Twilio / MessageBird / Vonage
      (not free); also needs `GOTRUE_SMS_*` config.
    - **MFA/TOTP** — free GoTrue env flags (`GOTRUE_MFA_*`), app UI work to enrol/verify.
  - **Keys** — legacy HS256 `anon`/`service_role`; migrate to the new opaque `sb_` keys only
    if independent key rotation is needed (requires asymmetric keypair + Kong translation).
  Done in M8: Supabase JWT auth + optional sign-in, per-user threads (read-shared,
  create-authenticated), verified `user_id` derived server-side, DB cutover to Supabase,
  cloud backup, Resend SMTP (real confirmation e-mails).
- **M5:** live market data (needs a backend screening/discovery graph) for the movers panels;
  richer sub-sector pages (markdown styling for `research-result` shipped with M10).
- **M6:** futures/options/MMF instruments; addressable-market tags; real holdings/weights;
  filter the universe by style/country.
- **M7:** multi-currency / FX; cash-flow budgeting; live prices / broker sync; create
  accounts from scratch; tax / contribution-limit logic.
