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
- **M12 follow-ups:**
  - **Migrate ChatScreen to `@langchain/react`** once message branching / edit-fork / regenerate
    lands upstream (the only reason the legacy `use-agent-stream.ts` + `use-active-run.ts` gate
    survive) — then delete both and the `registry.subgraphs` flag.
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
