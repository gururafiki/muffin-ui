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
npm run check                       # typecheck + lint:all + offline checks — the pre-push gate
npm run typecheck                   # = tsc --noEmit (TS strict)
npm run lint                        # = expo lint (ESLint flat config, eslint-config-expo)
npm run lint:all                    # = eslint . — ALSO covers scripts/ (see below)
npm run build:web                   # static web build → dist/
docker build -t muffin-ui .         # web export + nginx /api proxy (built arm64 in CI)
```

**`npm run lint` does not lint `scripts/`.** `expo lint` only walks `/src`, `/app` and
`/components`, so the verification tooling was completely unlinted until M28. `eslint.config.js`
now has a `scripts/**` block declaring **Node globals** (without them every script reports
`Buffer is not defined`) and disabling `import/no-named-as-default-member` (a false positive —
puppeteer-core's default export really does have `.launch`). Use `lint:all` when touching tooling.

**There is no test runner** (no `pytest`/`jest`). The established per-change verification loop is:
`npx tsc --noEmit` + `npx expo export -p web` + a headless-browser smoke test of the changed flow
with a screenshot, asserting zero Reanimated/worklet errors. See `ROADMAP.md` for milestone history.

Six scripts back that up (full table in `README.md` → Develop → Verification):
`run-timeline-check.ts` (offline) · `history-check.ts` · `smoke-timeline.mjs` · `smoke-reopen.mjs` ·
**`verify-readme.mjs`** (walks every README feature bullet, prints a pass/differ/fail table) ·
`hydration-check.mjs` (the React #418 diagnostic). Credentials come from the environment
(`CF_ACCESS_CLIENT_ID`/`_SECRET`, `SUPABASE_ANON_KEY`, `MUFFIN_EMAIL`/`MUFFIN_PASSWORD`) and are
never committed.

`verify-readme.mjs --live` drives the **deployed** site rather than the local `dist/` (CF Access
service-token headers set via `page.setExtraHTTPHeaders`, since Access checks every request). Use it
to verify a deploy — a local build of the same commit proves the source is good, not that the right
image reached the node. **Do not verify a deploy by comparing bundle hashes**: the Dockerfile
exports with `EXPO_PUBLIC_API_URL=/api` set, so a local `expo export` legitimately produces a
different hash. Check *behaviour* instead (e.g. after M28, a run page making **zero**
`store/items/search` requests is proof the new bundle is live).

**Three traps these scripts encode, learned the hard way (M28):**
- **React reports #418 as a `pageerror`, not a `console` error.** A listener on `console` alone
  reports zero hydration errors and looks like a clean bill of health. Listen to both.
- **Assert on text CASE-INSENSITIVELY.** The design system uppercases labels and badges in RN
  styles (`Badge` renders "SAMPLE", `Text variant="label"` renders "ASSET UNIVERSE"), so a
  case-sensitive probe fails on copy that is plainly on screen. Likewise, wait for the body text to
  stop growing rather than sleeping a constant — persisted zustand stores rehydrate after mount, and
  a short sleep catches `/portfolio` with only its title painted.

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
    replay). On load a finished thread now hydrates its `values` from the denormalized
    `thread.values` (`GET /threads/{id}`, ~110ms) via a custom stream transport
    (`fast-hydration-transport.ts`) — NOT the checkpoint `getState`
    (`GET /threads/{id}/state`), which is a flat ~27s on the deployed Oracle node
    regardless of state size (measured; see docs/backend-notes/2026-07-23-getstate-latency.md).
    Only the one-time hydration read is redirected; live streaming/submit/resume are
    unchanged. Consequence: the M20 hydration ETA bar (`use-estimated-progress.ts` +
    `HydrationCard`) now resolves in ~110ms for finished reopens, so it only ever
    flashes — kept for the residual busy/live-hydration case. So the backend
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
    **Hydration skeletons (M14):** `stream.isThreadLoading` (initial hydration read in flight)
    drives skeleton panels: the runner shows the registry stage labels under "Loading this run…",
    chat shows transcript-shaped blocks, council a session placeholder, calls list/detail card-shaped
    blocks (`<Skeleton>` primitive in `ui/`). Since M21 a finished-thread reopen hydrates from
    `thread.values` (~110ms, see the Live vs history doctrine above), so these skeletons now only
    flash on reopen; the 28–70s wait remains only for the busy/live-hydration `getState` path.
- **`renderers/`** — pluggable rendering, in **two layers**. New dashboards/charts are added by
  registering renderers, not editing call sites. Two registries, both keyed on something the API
  actually tells us: `renderNodeOutput` on the **state channel** a node wrote (see the run-timeline
  notes below), and `renderToolOutput` on the **tool name**.
  - **Layer 1 — the semantic baseline (`structured.tsx` + `fields.tsx`).** Reads FIELD MEANING, not
    just type: a 0..1 `confidence` is a `Gauge`, `signal`/`rating` a toned `SignalPill`, `weight` a
    `WeightBar`, `*_pct` a `DeltaValue`, `limitations`/`key_risks` a `CaveatList`,
    `key_findings`/`catalysts` a `CheckList`, categorical strings a `Badge`, prose `Markdown`.
    Fields are **ranked** so the headline leads, and **empty fields are dropped entirely** (the old
    renderer printed "SUB SECTOR" with a blank under it). The rules key on naming conventions and
    value shapes, never on a model registry, so a graph written next month is legible for free.
  - **Layer 2 — hero cards (`cards.tsx`)** for the payloads that carry a run's headline:
    `ClassificationCard`, `CriteriaDefinitionCard`, `MethodologyCard`, `SynthesisCard`,
    `DecisionTicketCard`, `JudgeCard`, `TradePlanCard`, `OutcomesCard`, `CouncilVerdictCard`,
    `StrategyGridCard`, `EvidenceCard`. They are built from the same `fields.tsx` presenters, so the
    two layers cannot drift into looking like different products.
  - **Every card returns `null` when the payload does not match**, and `CHANNEL_RENDERERS` calls
    cards as **plain functions** (`ClassificationCard({ value })`), never as `<Card />`. That is
    load-bearing: `renderNodeOutput` chains on `if (view) return view`, and a JSX *element* is
    always truthy — an element whose component returned `null` would end the chain and render
    nothing. Safe because no card calls a hook in its own body; `Markdown`/`Collapsible` are child
    elements it merely constructs. `criteria-result.tsx` badges evaluations whose backend
  truthing flag says no tools ran (`data_collected: false` → "no live data").
  **`ToolRunsPanel`** (M19) is one `Card`+`Collapsible` envelope over `ToolRunRow`s, mounted per
  timeline node ("Tool calls"). Runs are reconstructed from the node's transcript
  (`toolRunsFromMessages`), so **nothing here needs the Store**: `output_preview` carries the full
  tool result, and `additional_kwargs.cache` rides on the `ToolMessage` for the `cached` badge.
  M25 removed both the `useToolCache()` size/age join (a muffin-specific side-read, plus a 100-item
  query per surface) and the `mode="grouped"` run-wide roll-up (shipped unmounted since M24 —
  rebuilding it would mean eagerly walking every namespace).
  **`lib/agent/tool-cache.tsx` is DELETED (M28).** M25 removed the *consumer* but left the
  *producer*: `ToolCacheProvider` stayed mounted by `RunSurface` and the calls detail page and kept
  running `store.searchItems(['cache'], {limit:100})` — re-polled every 10s while busy — into a
  context nothing read. `safeParse` (its one live export) moved to `lib/agent/schemas.ts`.
  **Lesson: removing a context's only reader leaves its provider silently paying for the query —
  check both ends.**
  **Panel surfaces:** the three live screens (generic runner, council, chat) mount
  **`<RunSurface stream>`** (`features/agent-shared/run-surface.tsx`) — it owns the cross-cutting
  wiring (`RunStreamProvider`), with `RunErrorCard` /
  `HydrationCard` for the shared error/hydration markup. `app/calls/[threadId].tsx` (history — no
  live stream) has no `RunStreamProvider` at all, which is why anything wanting live
  data asks for it through `useOptionalRunStream()` and degrades to checkpoint history.
  `useSubgraphRows` accepts the council's suffixed `agent: "<slug>_data_collection"` form.
  (The `toolRunAgentSlug()` helper that used to join those records was deleted in M28 with the rest
  of the capture-channel residue — nothing had called it since M24.)
  The council screen itself is member-unified
  (M15): `COUNCIL_MEMBERS` = 13 personas + 6 optional specialists in one arena grid, one
  `MemberDetail` card for both kinds — **19 seats, not 13**; the README said 13 for three
  milestones.
  **Stage envelope convention (M19):** every pipeline "stage" body wraps in `Card tone="muted"` +
  `Collapsible` — `ReportSection` (`widgets.tsx`) and the unified `ToolRunsPanel` both follow this;
  `DebateView` keeps its chat-bubble turn styling but takes a `bare` prop to skip its own
  Card/Collapsible when the caller (`DebateDetail`, inside an already-expanded `SubAgentRunRow`)
  already owns the expand/collapse affordance — new stage/detail renderers should follow the same
  pattern rather than reaching for a bare `Collapsible`.
  **The run timeline (M25, 2026-08-01 — replaces the M22–M24 execution tree).**
  `features/agent-shared/run-timeline/` + `lib/agent/{run-node,run-history,run-graph}.ts`. One
  recursive component behind the per-agent toggle, deriving its ENTIRE structure from the LangGraph
  API so any graph — the five registered today or one written next month — renders correctly with
  no UI change.
  - **Structure is API-derived, never a per-graph table.** Three sources compose:
    `POST /threads/{id}/history` (what ran, in which superstep, how long, what's next),
    `GET /assistants/{id}/graph` (the compiled DAG → steps not yet reached), and
    `stream.subgraphs` / `stream.subagents` (live status + wall-clock). The previous builder
    preferred a hand-written `AgentDef.stages` recipe per agent, so an unregistered graph rendered
    as an unlabelled topology dump. **`AgentDef.stages` still drives the Overview's `RunProgress`
    and the result renderers — the timeline just ignores it.** (`StageDef.outputKind` was deleted;
    it existed only for the old tree's output dispatch.)
  - **Supersteps are the unit: `Lane[]`, not a flat node list.** Everything sharing a
    `metadata.step` ran **in parallel**; successive steps ran **sequentially**. The old model
    flattened supersteps away, so a 10-way fan-out and a 10-step sequence rendered identically.
    Verified on prod thread `019faada` (criteria/AMZN): lanes `0:1 1:1 2:2∥ 3:1 4:10∥ 5:1` —
    `criteria_definition ∥ valuation_methodology`, then a 10-wide `Send` fan-out. Trading
    `019f81a0` gives `1:4∥` (the four analysts); council `019f901f` gives one **19-wide** lane.
    A sequential lane renders on the spine (`SpineRow`); a parallel one renders as a bracketed
    `ParallelFan` with an "N in parallel" header — deliberately a *different shape*, so the
    distinction survives a glance.
  - **Timing comes from checkpoint `created_at` deltas.** Consecutive snapshot timestamps give each
    superstep's wall-clock (`019faada`: ticker_classification 16m32s, the parallel pair 46s, the ten
    workers 4m17s, synthesis 43s). `DurationBar` draws each against the run's longest step,
    square-rooted so a 7ms step is still visible. **Per-TOOL duration remains unavailable** — messages
    carry no timing, and adding it would need a backend change this deliberately does without. A
    fan's members share one lane wall-clock, so their identical durations are suppressed on the rows
    and shown once on the header.
  - **`pending` and `active` exist at last.** History alone cannot tell "finished" from "still
    running", so `lanesFromSnapshots(snaps, ns, busy)` marks only the NEWEST superstep active, and
    `next` (never read before) names what runs now. Steps the DAG declares but the run hasn't
    reached render as pending — **only while busy**: on a finished thread a node that never ran was a
    branch not taken, not work still to come.
  - **Four facets per node: Input · Plan · Timeline · Output.** `RunCardBody` recurses — anything in
    a Timeline that is itself an agent or subgraph expands the same way. Input is the namespace's
    first human message (or a sub-agent's `task` brief), rendered as **markdown once expanded** and
    as a clamped plain `Text` while collapsed (`Markdown` returns a `Fragment`, so it cannot take
    `numberOfLines` — hence the two modes), and dropped from the transcript below it so a
    2,000-character system prompt doesn't render twice. Plan is `values.todos`.
  - **Loading is per facet, not all-or-nothing.** A card shows whatever it already has (a fan-out
    member carries its `output` from the parent's `task.result`) and holds a labelled
    `FacetSkeleton` in place for each facet still being fetched — the old single skeleton was gated
    on knowing *nothing*, so those cards rendered instantly and then silently grew. `NodeRow` also
    swaps its chevron for a spinner while its namespace is in flight, reading the SAME query key as
    the body so TanStack Query dedupes it to one request.
    **`Skeleton` puts its `className` on an inner plain `View`** — NativeWind classes do not reach a
    Reanimated `Animated.View` (the caveat `agent-hero.tsx` documents), so the primitive used to
    render a class-less box: no height, no background. Verified in the browser, where the bars
    carried no class attribute and their container measured 6px, i.e. the flex gaps alone. **Every
    skeleton in the app was invisible**, not just the timeline's.
  - **A node's Input comes from `__start__` when it has no transcript.** LangGraph's `__start__` task
    writes exactly the channels the caller handed down, so its `result` IS the node's input
    (`inputStateFromSnapshots`). A criterion worker therefore shows the criterion definition and the
    upstream classification it was asked to score against — data that was being discarded because
    `__start__` is filtered from the lanes as plumbing. Generic: every LangGraph subgraph has one.
    A prompt-bearing node still prefers its first human message, rendered as **markdown, always**,
    clipped to a fixed height with an SVG fade rather than swapped for raw source (`Markdown` returns
    a `Fragment` and cannot take `numberOfLines`, which is what the old plain-text clamp worked
    around at the cost of showing unformatted markdown until expanded).
  - **A terminal pass-through node does not repeat its parent's output** (`isPassThrough`). Graphs
    often end a subgraph with a small node whose only job is to write the channel the parent
    reports — muffin's criterion worker is `evaluate` → `package`, and `package` writes
    `criterion_evaluations` and nothing else, so every criterion rendered its card twice. Detected
    from two channel names the API already reported (a **leaf** writing the **same channel** as its
    parent, via `TimelineCtx.parentOutputChannel`), so there is no per-graph knowledge. The row and
    its duration stay; only the duplicated payload is replaced by a one-liner.
  - **A plan the agent abandoned is reported, not hidden** (`isPlanStale`). Deep agents keep their
    plan in `values.todos` but nothing forces them to keep it current — on prod thread `019faada`
    the ticker-classification agent wrote four todos at superstep 5 and never called `write_todos`
    again, so the checkpoint still reads "1 of 4" long after the node finished. When a **finished**
    node still has unfinished todos the header says when the plan was last written instead of a
    progress fraction that reads like a stalled run. (The agent-side fix is a muffin-agent item.)
  - **Two kinds of node, because there are two kinds of node.** A pipeline/graph node has no
    `messages` channel at all (muffin-agent's graph-authoring rule keeps parent state off
    `AgentState`), so its timeline IS its child supersteps. An agent node HAS a transcript, and its
    children are `task` delegations that also appear in it as tool calls — so the transcript is the
    timeline and each delegation expands into that sub-agent's own card, joined exactly by `task`
    tool-call id (`RunNode.toolCallId`). Rendering both would say everything twice.
  - **`stream.subagents` is now read** (it never was). That is a live, recursive deep-agent
    sub-agent tree with `taskInput`, `parentId`, `depth`, status and real timestamps —
    `stock_evaluation`, a pure deep agent, previously had zero live sub-agent visibility.
    `use-live-overlay.ts` matches discovery on the **namespace**, not the node name, so live status
    reaches any depth and tells the ten members of a fan-out apart.
  - **Transcripts come from the namespace's own `values.messages`.** They briefly came from
    `tasks[].result.messages` instead, because every DEEP agent reported an empty channel while its
    tasks had demonstrably run model turns and tool calls. That was an **upstream bug**, not a fact
    about deep agents: `_prepare_state_snapshot` hydrated channels with `self.checkpointer` alone,
    but a subgraph from `get_subgraphs()` is compiled without one (the parent supplies it via
    `CONFIG_KEY_CHECKPOINTER`), so `DeltaChannel`s — which is what an agent's `messages` is, while a
    plain agent's is a `BinaryOperatorAggregate` — had no saver to replay their ancestor writes and
    silently came back empty. Diagnosed and fixed in
    [langchain-ai/langgraph#8470](https://github.com/langchain-ai/langgraph/issues/8470); muffin-agent
    pins a fork until it ships. Verified on prod thread `019fa546`: `ticker_classification` 0 → 23,
    `criteria_definition` 0 → 35, `valuation_methodology` 0 → 40, `synthesis` (plain) 5 → 5.
    The reconstruction was **removed rather than kept as a fallback** — it would mask a regression if
    that pin were dropped too early, and one authoritative source beats silently picking between two.
  - **A `tools` task that DELEGATED becomes a named sub-agent row.** A ToolNode task reports
    `checkpoint: null`, but the sub-agent it spawned checkpoints under `<parent>|tools:<task id>` —
    so the namespace is *derived*, not read. Pairing the `task` call (whose `args.subagent_type`
    names the target) with its `ToolMessage` turns an anonymous "Tools" step into a named, drillable
    row. Verified on prod thread `019fa546`: "Define the criteria" yields Discovery screening /
    Economy macro / ETF index / Equity fundamentals / Data validation, whose namespaces match the
    five `|tools:` namespaces in the database exactly. Only readable because muffin-agent pins the
    deepagents fork (see above).
  - **`model` and non-delegating `tools` are filtered from the tree.** They are the two nodes of an agent's internal
    ReAct loop and would otherwise render a "Model, Tools, Model, Tools…" ladder under every agent.
    What they did is in the transcript, rendered as turns and tool calls. Matching `tools` by exact
    name is safe: muffin's deterministic `ToolNode`s are named for what they fetch (`fetch_ohlcv`).
  - **deepagents `task` sub-agents ARE drillable — via a fork pin.** `POST /history` on
    `<parent>|tools:<uuid>` returned **400 "Subgraph … not found"**: namespace resolution only knows
    `add_node`-registered subgraphs, and a `task` sub-agent runs inside a *tool*. This is upstream's
    **documented, intentional** limitation ([View subgraph state](https://docs.langchain.com/oss/python/langgraph/use-subgraphs#view-subgraph-state):
    *"does not work when a subgraph is called inside a tool function … e.g. the subagents pattern"*),
    reported as a bug in deepagents#2629 and closed as not-supported. muffin-agent pins a fork that
    declares the subagent graphs on the tools node (deepagents#5136 / #5132), so these namespaces now
    resolve — verified on prod thread `019fa546`: two `|tools:` namespaces returned 40 snapshots with
    53 and 42 messages. **That pin may never be upstreamed**; if it is ever dropped, these become
    unreadable again and the tree must go back to treating them as leaves.
  - **The tree comes from LangGraph's own checkpoints — there is no capture channel.**
    `lib/agent/run-history.ts`: `POST /threads/{id}/history` returns one snapshot per superstep, each
    carrying the `tasks[]` that ran in it; every task has `{id, name, result, checkpoint:{checkpoint_ns}}`,
    and passing that namespace back to `getHistory` yields the child's supersteps and *its* tasks.
    A namespace's `values.messages` is that node's transcript, tool calls included (verified on prod
    thread `019f81a0`: `market_analyst:<uuid>` → 13 messages, 10 tool calls).
    **A node is drillable iff it is a compiled agent/subgraph added via `add_node`** — a plain
    function node reports `checkpoint: null` and is genuinely a leaf, so the UI says so rather than
    offering an empty drill-down. Internal nodes (`*Middleware*`, `__start__`/`__end__`) are
    filtered: LangGraph compiles each middleware hook into its own node and surfaces it as a task.
  - **A disabled `useRunTimeline` returns NOTHING — deliberately.** A leaf node has no namespace, so
    callers pass `undefined` with `enabled: false`, which collapses the query key to the same
    `'__root__'` the run's own timeline uses. A disabled `useQuery` still hands back whatever is
    cached under its key, and the root is always cached by then — so **every plain function node
    rendered the entire run inside itself** (expanding `package` under a criterion redrew the whole
    pipeline). The hook now blanks `data`/`isPending`/`isFetching` when it was not enabled, which
    makes the collision structurally impossible rather than fixing it per call site.
    `scripts/smoke-timeline.mjs` guards it: it expands a node the API reports with
    `checkpoint: null` and fails if another top-level step's label then appears twice.
  - **Everything below the root is lazy.** `useRunTimeline(threadId, namespace, enabled, busy)`
    (`run-timeline/use-run-timeline.ts`) reads one namespace per expanded card, cached forever once
    the thread settles. A criteria run has 27 namespaces; walking them eagerly would cost 27 round
    trips for data nobody asked to see. Root and child use the SAME hook (root = the namespace-less
    case) — the old `useRunTreeRoot`/`useRunTreeNode` split meant the root could never grow the
    facets its children had, which is why the top level was so much thinner than its branches.
  - **Why the double-nesting bug is now structurally impossible.** The old builder read the
    `subagent_tree` channel, split `|`-joined `<name>:<uuid>` ids, and *synthesized* the ancestor
    levels the backend never captured — a synthesized "Criterion evaluation" wrapping a real child
    that took the same label from the builder's static agent name. Reading namespaces directly means
    every level is one LangGraph actually recorded: nothing to infer, nothing to collapse. All of
    `collectTopology` / `buildTopology` / `collapseRedundant` / `segmentName` are **deleted**.
  - **Tool calls are read from the transcript**, not from a parallel record: `toolRunsFromMessages`
    pairs each `AIMessage.tool_calls` entry with its `ToolMessage` by `tool_call_id`. A call with no
    reply is kept as `pending` (a cancelled run must not silently lose it). There is deliberately
    **no run-wide tool roll-up** any more — a tool call belongs to the node that made it, and
    rebuilding a flat summary would mean walking every namespace eagerly.
  - **Fan-out members name themselves from `task.result`.** Ten criteria workers are all the same
    graph node, so the raw topology gives ten identical labels. Each task's `result` carries the
    channels it wrote (`taskWrite`), so the criterion's name is available from the PARENT history
    without fetching each worker. Deliberately **not** index-paired against the parent's aggregated
    channel: parallel `Send` workers complete out of order and labels would drift onto wrong rows.
    **`relabelFanOut` applies this ONLY to same-node members of one superstep** — run against every
    node it renamed `merge_criteria` to "Revenue Growth (3Y CAGR)", the first criterion in the list
    it merely collected (caught on `019faada` before the guard existed).
  - **Output rendering dispatches on the STATE CHANNEL**, not on the payload's shape and not on a
    per-graph declaration. A task's `result` keys ARE the channels it wrote (verified:
    `criterion_evaluation → criterion_evaluations`, `synthesis → synthesis`), and a channel name is
    exactly as specific as the payload it names. `CHANNEL_RENDERERS` in `renderers/output-registry.tsx`
    maps `criterion_evaluations` / `persona_signals` / the two debate channels to bespoke cards; an
    unknown channel from a future graph falls through to `StructuredOutput` rather than being
    mis-rendered. (`metadata.writes` looks like the right source but comes back **empty** over the
    API — read `task.result` keys instead.) Shape sniffing is only a last resort behind a strict
    discriminator: the loose zod schemas accept *any* dict, which is how the stage named "Define the
    criteria" once rendered as an empty criterion card and dropped its payload.
  - **Overview vs Timeline is a deliberate split.** Overview answers *what the run concluded*
    (headline result, criterion cards, the council arena); the Timeline answers *what the run did*.
    The persisted toggle (`agent-view-store.ts`) renamed `'tree'` → `'timeline'` at **version 2**
    with a migration — retyping a persisted field requires one, or an existing user restores a value
    matching no `Segmented` option and sees an unselected toggle.
  - **Tool calls need NOTHING but the transcript.** `ToolRunRow` no longer joins the LangGraph Store
    for a payload's size and age (`useToolCache` by `args_hash`): that was a muffin-specific
    side-read a graph-agnostic timeline has no business depending on, it cost a 100-item query per
    surface, and `output_preview` already carries the full result. `ToolRunsPanel`'s dead
    `mode="grouped"` roll-up (shipped unmounted since M24) is deleted with it. **M28 finished the
    job**: the whole `tool-cache.tsx` module is gone, because the provider was still mounted and
    still issuing that query even after the join was removed.
  - **Verification.** `scripts/run-timeline-check.ts` (`npx tsx`, offline, no credentials) imports
    the REAL modules over synthetic snapshots — the shape is fixed by `langgraph_api/state.py`'s
    `state_snapshot_to_thread_state` and the SDK's `ThreadTask`, which keeps it runnable offline and
    lets it cover cases a captured fixture can't hold (an errored task, an unanswered tool call, a
    transcript rewritten by summarisation). `scripts/history-check.ts` asserts the same end-to-end
    against the deployment, including `getGraph` for all five graphs.
    `scripts/smoke-timeline.mjs [threadId] [graphId]` is the browser gate; it clicks rows via their
    `role="button"` + `aria-label` (which RN-Web renders from `accessibilityRole`/`accessibilityLabel`)
    rather than walking up from a text node — the latter used to hit "Start a new run" and blank the
    page. All three need `CF_ACCESS_CLIENT_ID` / `_SECRET` except the first.

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
  `runs.stream` works on iOS/Android, **plus the `globalThis.crypto` polyfill from `expo-crypto`**
  (see Native below); web/fallback are no-ops.
- `src/hooks/use-color-scheme.*` — **retained despite having zero importers.** Every real call site
  imports `useColorScheme` straight from `react-native` (14 of them). The `.web.ts` variant holds a
  static-render hydration guard (return `'light'` until hydrated), which looked like the fix for the
  app's React #418 warning. **M28 measured it and the hypothesis is disproved** — #418 counts are
  identical in light and dark on all 18 routes (`scripts/hydration-check.mjs`), so the 14 call sites
  were deliberately NOT rerouted through it. Kept as the documented Expo idiom in case per-route
  prerendering ever changes; delete it if that never happens.

**Rendered text is BOUNDED — and bounding means slicing the STRING, not the box
(`lib/agent/bound-text.ts`, M30).** `Markdown` and `JsonBlock` both cap what they parse at
`BOUND` (12 KB) and offer an incremental "Show more"; nothing a graph legitimately produces
comes close, so only pathological payloads are affected. Rules:

- **A `maxHeight` + `overflow: hidden` clamp is NOT a memory fix.** The old `InputBlock`
  clamp rendered the full markdown and clipped it visually — every element still parsed, still
  laid out. Same reason a fixed-height container with a skeleton buys nothing here.
- **The cost is in the NATIVE heap, and overrunning it is not catchable.** Measured on one
  trading run: 277 MB of a 412 MB process was native heap (Dalvik was 13 MB against a 192 MB
  cap, so the Java ceiling is irrelevant). Every markdown element becomes a shadow node + Yoga
  node + native text layout. A failed native allocation calls `abort()` — the app closes
  instantly to the home screen with no dialog and no JS error, which is what a user reports as
  "it crashed".
- **`JsonBlock` is the sharper edge**: it puts the whole payload in ONE `<Text>` inside a
  horizontal `ScrollView`, so it never wraps and lays out as a single enormous line.
- Bound by DEFAULT, at the renderer, not per call site. The three ad-hoc caps this replaced
  (`cap()` in tool-registry, an inline cap in `conversation.tsx`, the `InputBlock` height
  clamp) guarded 3 of ~33 `<Markdown>` sites, and the debate turns that took a Pixel 10 Pro
  down were not among them. Pass `bound={false}` only for authored copy you control.
- What triggered it: a backend defect produced three ~200 KB debate turns of newline noise
  (`risk_debate_messages` 753 KB over 15 turns, vs 26 KB for bull/bear). Guarded offline in
  `scripts/run-timeline-check.ts`.

**Spine geometry — anchor rows, never centre them (`components/ui/spine.tsx`, M29).** A timeline
row's marker is positioned against the row's **first line**, so the row must anchor that line:
`NodeRow` is `items-start`, not `items-center`. Centred, the label slides down as a row gains
ornaments — a `running` `Badge` is ~26px against a 16px text line — while the marker stays put, so
the spine drifts off its own labels (measured: 3px on a plain row, 8px on a badge row). The marker
box (`ROW_FIRST_LINE`), the `ParallelFan` diamond box (`FAN_FIRST_LINE`) and the rail are all
**derived** from that first-line height plus `StatusDot`'s diameter — if you change one, the rail
follows. Don't reintroduce independent magic offsets; three hand-rolled copies of this line already
had to be merged once.

**Hero vs run view — `agent-shared/run-phase.ts` → `showsLandingHero` (M29).** Whether a run screen
shows its landing composer or the run view is ONE shared predicate because it used to be inlined in
both `AgentRunner` and `CouncilScreen`, and both were wrong the same way: they tested the
**mount-time `threadId` prop** (`undefined` for the whole life of a fresh run) and never the live id
`onThreadId` sets on submit. The moment a submitted run ended without output — **errored, Stopped,
or an empty `resultKey`** — every guard went false and the screen fell back to the composer, hiding
the `<RunErrorCard>` rendered just below it. A run that exists must never be able to render as
"no run yet": add new conditions to that predicate, not inline at a call site. Its companion is
`RunRecap`'s `failed` prop — without it a failed run drew a green "Completed" pill above its own
error card.

### Native (Android/iOS) — what the web build never exercises
First real device run was **M29 (2026-08-03)**, on an Android emulator against the deployed API.
Setup runbook: README → Develop → Running on Android. `android/`+`ios/` are `expo prebuild` output
and gitignored. **Expo Go cannot host this app** (`react-native-mmkv`, `expo-crypto`) — dev build only.

Four rules learned the hard way; all four passed `tsc`, `expo export` and every headless-web script:

- **`typeof window !== 'undefined'` is NOT a web check.** React Native defines a global `window`, and
  the Expo dev client gives it a `location` pointing at Metro. Use **`typeof document !== 'undefined'`**
  (RN has no `document`) — or `Platform.OS === 'web'` where importing `react-native` is acceptable.
  `resolve-url.ts` took the "web-only" branch on native for exactly this reason.
- **Never let `new URL()` run unguarded on user input.** Settings persists per keystroke, so URL
  fields are parsed half-typed; `new URL('https:', 'http://…')` throws. A throw during render on
  native takes the whole app down, and because the bad value is already in MMKV it then **crashes on
  every launch** — with Settings, the only repair path, behind the crash. Anything reading a
  user-supplied URL during render must degrade, not throw.
- **Hermes has no `crypto`.** The LangGraph SDK calls `crypto.randomUUID()` to mint a thread id on
  submit, so every new run failed with `ReferenceError: Property 'crypto' doesn't exist` — visible
  only as an unhandled promise rejection, i.e. a Run button that appears dead. Polyfilled in
  `install-fetch.native.ts`. (`structuredClone` was flagged as the next likely gap and **checked —
  it is not one**: the SDK calls it unguarded in its message-assembly paths, but RN 0.85 ships it at
  `react-native/src/private/webapis/structuredClone/`. Verify before polyfilling anything else.)
- **Native carries no Cloudflare Access cookie.** Web rides the browser's Access SSO cookie and
  nginx's same-origin `/api` + `/supabase` proxies; native has neither, so Settings needs absolute
  URLs and the `CF-Access-Client-Id`/`-Secret` service-token pair (`cfAccessClientId` /
  `cfAccessClientSecret`). Missing them returns the Access **login page** — `302 text/html`, not a
  JSON error, so it fails silently. All outbound API headers come from the single chokepoint
  `buildAuthHeaders` (`settings/configurable.ts`), used by `makeClient`, `makeReopenTransport` and
  the memoized client `useRunStream` receives — add a credential there and it reaches every path.

**`EXCLUDED_SETTINGS` in `features/account/backup.ts` is a DENYLIST** — a new settings field is
uploaded to Supabase cloud backup unless it is named there. Add every secret/endpoint field to it.

**There is no automated native verification.** All six verification scripts are headless-web; the
M29 findings all came from driving the emulator by hand (`adb` + `uiautomator dump`). Four traps
when doing that:
- `uiautomator` reports the **unobscured** layout, so a field under the soft keyboard still dumps at
  a plausible y and tapping it hits the IME instead (disable the soft keyboard with
  `settings put secure show_ime_with_hard_keyboard 0` + `ime disable …`, or use `KEYCODE_TAB`).
- An **empty** RN `TextInput` dumps with `text` equal to its placeholder (the Android *hint*), so a
  placeholder reads as a filled field. Compare `text` against `hint` before believing it.
- **The dump goes stale.** It repeatedly reported the previous screen while the app had already
  navigated — twice sending this investigation down a wrong path. A **screenshot is authoritative**;
  confirm any surprising dump with one before concluding anything. `enabled=false` on an RN
  `Pressable` is likewise unreliable — a visibly active button dumps as DISABLED.
- Give the AVD **≥3 GB** (`emulator -memory 3072`). At 2 GB a long session degrades until the app
  takes minutes to paint and `uiautomator` starts getting OOM-killed (exit 137), which looks exactly
  like an app hang.

### Theming — two mechanisms, and a deleted third
1. **NativeWind `dark:` variants** — the palette lives in `tailwind.config.js`. Dominant path.
2. **`useColorScheme()` from `react-native`** → raw values from `src/theme/colors.ts`
   (`theme.dark`/`theme.light`, `palette`, `mapColors`, `chartColors`) for APIs that cannot take a
   className: Stack `screenOptions`, `StatusBar`, SVG fills, charts. `app.json` sets
   `userInterfaceStyle: "automatic"`.

`src/constants/theme.ts` + `src/hooks/use-theme.ts` were the `create-expo-app` template's OWN
theming (a `Colors` object of plain black/white/greys, plus `Fonts`/`Spacing`/`BottomTabInset`).
They participated in neither path — `use-theme.ts` was the only importer of `constants/theme.ts`,
and nothing imported `use-theme.ts` — so both were **deleted in M28**. Don't reintroduce a second
palette: `tailwind.config.js` and `theme/colors.ts` are the pair, and they must stay in sync.

### Routing — `src/app/` (Expo Router, typed routes, React Compiler on)
File-based routes. `(tabs)/` = Globe (`index`), Markets, Portfolio, Agents, **Calls**, Settings.
Detail routes: `agents/[assistantId]`, `stock/[ticker]`, `sector/[sectorId]`, `country/[countryId]`,
`region/[regionId]`, `group/[groupId]`, `account/[accountId]`, `goal/[goalId]`,
`calls/[threadId]`, `auth`, `verify`. The root `_layout`
loads fonts (Baloo2 + Nunito), wraps `QueryClientProvider` / `GestureHandlerRootView` /
`SafeAreaProvider`. `agents/[assistantId]` seeds the runner from field-shaped deep-link params
(e.g. an "Analyse" link passing `ticker`/`sector`/`market` + `autostart=1`). It does **not** wrap
`ChatScreen`/`CouncilScreen`/`AgentRunner` in a `Screen` (M19) — each owns its own layout, switching
internally between the centred `AgentHero` (fresh run) and a normal scrolling `Screen` (once a
thread exists), the same way `ChatScreen` already split hero vs. transcript.

### Features — `src/features/`
- **`agent-shared/`** — the streaming primitives EVERY run surface uses: `use-run-stream.ts`,
  `run-projections.ts`, `run-progress.tsx`, `subgraph-detail.tsx`, `run-surface.tsx`,
  `run-phase.ts`, `use-estimated-progress.ts`, and the
  transcript cluster (`conversation.tsx` — the mutually-recursive Conversation/StepTimeline pair;
  `conversation-turns.ts` — pure fold logic + types, `coerceMessages` accepts `BaseMessage`
  instances via the SDK's `toMessageDict`; `message-bubbles.tsx`; `subagent-activity.tsx`). Also
  (M19) **`agent-hero.tsx`** — the shared animated "fresh run" landing screen (identity block +
  caller-supplied composer/fields + example chips), generalised from `ChatScreen`'s original hero —
  and **`run-recap.tsx`** — the run-page **identity banner** (M20): the agent's icon tile + title +
  `tagline`, a live status pill (pulsing "Running"/"Loading" → green "Completed"), the submitted
  inputs as read-only chips, and a "Start a new run" button (it's a recap, not a form — none of the
  non-chat graphs support real follow-up). Callers pass `loading={stream.isThreadLoading}` so the
  pill distinguishes reopen-hydration from a finished run. **`use-estimated-progress.ts`** (M20) is
  the *honest* ETA heuristic for the opaque 28–70s reopen `getState` (no server percent-complete):
  elapsed time → an eased 0→~0.95 value that holds near the top until the state lands + a "~Ns left"
  label; the shared `HydrationCard` (in `run-surface.tsx`) renders it as a `ui/ProgressBar`.
  Council / agent-runner / calls import from here — never sideways from `agent-chat`.
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
  pulsing loading placeholder used by the hydration/loading states, and `ProgressBar`, the
  determinate `scaleX`+`transformOrigin` bar used by the hydration ETA — off the layout pass, same
  idiom as the wealth bars).
- **Design tokens** live in `tailwind.config.js` (the `frosting`/`blueberry`/`butter`/`leaf`
  palette, the **`ink` text ramp** — `ink`/`ink-muted`/`ink-soft`/`ink-faint` for body → muted →
  done/disabled → placeholder text on light; never inline an arbitrary `text-[#hex]` —
  `crumb`/`muffin`/`bun` radii, Baloo2/Nunito font families — note **font weight is baked
  into the family name** since native ignores `fontWeight`). **`src/theme/colors.ts` mirrors this
  palette** for APIs that need raw color values (navigation theme, status bar, SVG fills, charts) —
  **keep the two in sync** — and is the single home for the categorical chart palettes
  (`chartColors.allocation` / `.sector`) and the world-map light fills (`mapColors`).
- **App icons are GENERATED, never hand-cut** (`scripts/generate-icons.mjs`, M29). Every launcher
  icon was still `create-expo-app`'s blue chevron — on Android, iOS and the web favicon — while the
  real mascot lived only in `ui/logo.tsx`. That script renders the mascot (headless Chrome +
  puppeteer-core, the pair the smoke tests already use) into `android-icon-foreground`,
  `android-icon-monochrome` (Android 13+ themed icons — alpha only, so it is a fused silhouette, not
  the coloured mark), `icon.png`, `favicon.png` and `splash-icon.png`. The Android background is the
  flat `adaptiveIcon.backgroundColor` (`#5A3C77`), not a PNG. **Its SVG mirrors `ui/logo.tsx` and
  cannot import it** (that component is `react-native-svg`, which does not render in a browser) — so
  a change to the mascot means changing both, then re-running the script and `expo prebuild`.
  Artwork is sized to Android's 66/108 safe zone; anything larger gets clipped by a launcher mask.
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
