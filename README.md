# Muffin UI 🧁

Cross-platform (**Web · iOS · Android**) [Expo](https://expo.dev) +
[Expo Router](https://docs.expo.dev/router/introduction) client for the
[`muffin-agent`](https://github.com/gururafiki/muffin-agent) LangGraph agents.

**Democratise wealth building** — bring your own LLM + OpenBB keys (injected per run,
kept private on-device); the research generated is shared for everyone. Kawaii
blueberry-bakery aesthetic (grape purple, cream, rounded "sticker" cards).

> Deployed at `muffin.<domain>` (behind Cloudflare Access), alongside the legacy chat UI
> at `muffin-chat.<domain>`. See [`ROADMAP.md`](./ROADMAP.md) for milestone history.

---

## Feature tour

The app is a **bottom tab bar** with six tabs — **Globe · Markets · Portfolio · Agents ·
Calls · Settings** — plus stacked detail screens (stock, sector, account, the agent
runner, the auth page). It follows **light/dark** system theme. Every screen below is
described with its actual buttons, toggles, and panels.

### 🌍 Globe (home tab)
Navigate the investable world by geography.
- **Hero** — muffin logo + "The investable world — your lens."
- **Classification switcher** (segmented pills): **MSCI · FTSE · World Bank** — swap the
  country-classification scheme; the map recolours and the blurb updates.
- **Group by** (segmented pills): **Region** vs **Market tier** (Developed/Emerging/
  Frontier) — changes how countries are grouped/coloured.
- **World map** — a stylised tappable SVG map; **tap a country** to select it (tap again
  to deselect).
- **Selected-country card** — appears on tap: the country name, coloured **region / market-
  tier / ETF pills**, an **Open ⟨country⟩** button (drill into the country page) and an
  **Analyse ⟨country⟩** button (launches the Research agent, templated).
- **Group legend** — a tappable list of every region / tier (colour swatch + name + ETF
  ticker); tap to open that group's page.
- **Analyse global macro** — one-tap Research run on the macro backdrop.

### 📊 Markets tab
Sector weights and your multi-asset universe.
- **Sector breakdown** — an interactive **SVG donut** of sector weights (badged "sample").
  **Tap a slice** → shows that sector's icon, weight %, **sub-sector chips**, and an
  **Open ⟨sector⟩** button.
- **Asset universe** — a horizontal **filter-chip** row: **All** + one chip per asset type
  (Equities, ETF, Commodities, Crypto, Bonds, Real estate, Cash, Funds, Derivatives).
- **Drill list** — the filtered instruments, each row showing ticker · name, a
  sector/country/style subtitle, and a coloured **change %**; tap a row to open the stock
  page.

### 💰 Portfolio tab
Your wealth across every wrapper (seeded demo data, editable, saved on-device).
- **Net-worth card** — total net worth in your base currency.
- **Allocation bars** — animated allocation with a **By asset / By account** chip toggle.
- **Accounts** — one card per wrapper (SIPP · ISA · LISA · GIA · Cash · Property ·
  Mortgage · Other) with its value; tap to open the account page (holdings inside).
- **Goals** — goal cards with **animated progress**; **＋ Add goal** creates a new one;
  tap a goal to edit it. (Cloud backup/restore of this data lives in Settings → Account.)

### 🤖 Agents tab
One graph → one screen. Lists the five deployed agents and your saved presets.
- **Agent cards** — **Deep Research**, **Investor Council** (badged "custom UI"),
  **Criteria Analysis**, **Stock Evaluation**, **Trading Decision** — icon, title,
  tagline; tap to open the runner.
- **Saved presets** — named, non-secret configured assistants you saved (see "Save as
  preset" below); tap to run one, or **✕** to delete it. Keys are re-injected from your
  on-device settings at run time; presets never store secrets.

#### The agent runner (generic agents: Research / Criteria / Trading)
- **Input fields** — per agent (e.g. Research: a **Question**; Criteria/Trading: a
  **Ticker** + optional **Focus** / **Narrative**).
- **Advanced options** (collapsible) — per-run `configurable` overrides:
  - *Research* — **Research mode** (speed/balanced/quality chips), **Max search results**.
  - *Council* — **Include specialist signals** (On/Off) — adds 6 deterministic analysts.
  - *Trading* — **Bull/bear debate rounds**, **Risk debate rounds**, **Reflection**
    (On/Off).
- **Run agent** button (→ **Run again** once there's a result; **Stop** while streaming).
- **Save as preset** (collapsible) — name it and store the graph + current advanced options
  as a reusable assistant (secrets stripped).
- **Run progress** — a live **done / doing / next** checklist driven by the agent's stage
  recipe (e.g. Criteria: classify → methodology → define → *evaluate each criterion* →
  merge → synthesise), with sub-rows streaming in (e.g. "3/13 criteria").
- **Result widget** — a tailored renderer (see [Result renderers](#result-renderers)),
  identical whether streaming live or reopened from history.
- **Data gathered** (collapsible) — every provider/tool call the run made (from the tool-
  result cache), success/failure badges, expandable to the raw payload; a **time-series
  chart** draws automatically when a payload is price/indicator data.
- **Sub-agents** — a soft panel of the compiled subgraphs a run delegated to (analysts, the
  bull/bear + risk debate conferences, criteria workers, council members), each an avatar row you
  tap to expand into its own detail (a nested timeline, a debate conversation, or the structured
  output + tool calls a finished run kept).

#### Chat agents (Stock Evaluation)
Deep-agent evaluation runs as a **multi-turn chat**:
- **Hero start screen** — centred composer ("What should we dig into?") + tappable
  **example-prompt chips**.
- **Conversation view** — **Summary / Verbose** toggle; each assistant turn is a minimal,
  expandable **step timeline** (thinking + tool calls, grouped into an orchestrator →
  sub-agent tree) followed by the markdown answer.
- **Message actions** — **copy**, **edit & resend** (branches the thread), **regenerate**,
  and **branch navigation** (‹ 1/2 ›) on assistant turns.
- **Human-in-the-loop** — interrupt cards prompt for approval and resume the run.
- **Composer** — docked input with a send/stop button; a scroll-to-bottom pill appears
  when you scroll up.

#### Council (bespoke screen)
- **Convene the council** — 13 famous-investor **avatars** animate through their stages
  (collecting → scoring → deciding → done); tap a persona to expand its reasoning.
- **Judge** — an animated vote tally, then the judge's deliberation + verdict.

#### Sign-in gate
When accounts are enabled but you're signed out, the Run action is replaced by a
**"Sign in to run agents"** card (→ the [auth page](#-sign-in--sign-up-auth)). Browsing
shared runs stays open to everyone; starting a run needs an account.

### 🕑 Calls tab
Your past agent runs (thread history).
- **Filter chips** — **All** + one per agent that appears, with counts.
- **Thread cards** — agent icon, title, a one-line descriptor of the inputs, relative
  time, and a **status badge** ("running" gently **pulses** while live). Tap to reopen —
  it resumes the exact agent screen (live stream or saved result).

### ⚙️ Settings tab
Bring your own keys — everything stored on-device only.
- **Account** card — signed out: a **Sign in / Create account** button (→ auth page);
  signed in: your email/id, **Back up now** + **Restore** (opt-in cloud sync of portfolio +
  non-secret settings), and **Sign out**.
- **Connection** — **API URL**, **Auth token** (optional bearer/CF service token),
  **User ID** (per-user memory; overridden by sign-in), **Supabase URL**, **Supabase anon
  key** (blank = deployment default).
- **LLM provider** — **openrouter / openai / anthropic** chips, plus an optional **Model**.
- **API keys** — **OpenRouter**, **OpenAI**, **Anthropic**, **OpenBB** (all secure fields,
  on-device only).
- **Advanced configuration** (collapsible) — per-role **model chains** (orchestrator /
  collector / reasoner), **summariser model**, **temperature**; **MCP URLs** (OpenBB /
  Firecrawl); **research** knobs (default mode chips, rerank threshold, max search
  results); **store access** namespaces.
- **Reset to defaults**.

### 🔐 Sign-in / sign-up (auth)
Dedicated `/auth` page (opened from the gate or the Account card):
- Muffin logo + welcome copy.
- **Continue with GitHub** / **Continue with Google** — OAuth buttons (shown only for
  providers the deployment has enabled; auto-detected from GoTrue).
- **Email + password** with a **Sign in ⇄ Create account** toggle.
- Anonymous browsing always works; this page is only reached when you choose to sign in.

### Drill-down detail screens
- **Stock** (`/stock/[ticker]`) — ticker + context badges (asset type, sector, country,
  developed/emerging); cards to launch **Council**, **Criteria Analysis**, or **Stock
  Evaluation** for that ticker (pre-templated).
- **Sector / Country / Region / Group** — **breadcrumb** navigation, a **movers panel**
  (animated best/worst performers, badged sample), sub-sector/stock **drill lists** with
  change %, and an **Analyse** button at every level launching the Research agent.
- **Account** (`/account/[accountId]`) — the wrapper's holdings; add/remove holdings.
- **Goal** (`/goal/[goalId]`) — create/edit a goal with animated progress.

### Result renderers
Headline outputs are rendered by shape (`src/lib/agent/renderers/`):
- **Research** — markdown answer, key findings, tappable sources, confidence badge.
- **Criteria** — weighted per-criterion **score bars**, composite gauge, positives/
  negatives, thesis.
- **Trading** — verdict + **conviction gauge**, analyst reports, the **bull-vs-bear** and
  **risk-debate** conversations (collapsed by default, tap to read every turn), and the trader plan
  (action, entry/stop/take-profit, sizing).
- **Charts** — a lightweight `react-native-svg` **time-series line + volume-bar** chart
  drawn from price-history / indicator tool outputs.
- Plus generic **markdown / JSON / structured-output / step-timeline / to-do** renderers.

---

## Stack
- Expo SDK 56, Expo Router (typed routes), TypeScript (strict), React Compiler on.
- [NativeWind v4](https://www.nativewind.dev/) (Tailwind) + Reanimated; `react-native-svg`
  for the map / donut / charts; Phosphor icons via a semantic `<Icon>` registry.
- [`@langchain/langgraph-sdk`](https://www.npmjs.com/package/@langchain/langgraph-sdk) for
  agents (native streaming via `expo/fetch`), [`@supabase/supabase-js`](https://supabase.com/)
  for optional accounts, [TanStack Query](https://tanstack.com/query) (server state),
  [Zustand](https://github.com/pmndrs/zustand) (client state: settings, wealth, map view,
  auth session), MMKV / localStorage for persistence.

## Develop
```bash
npm install
npx expo start          # press w (web), i (iOS), a (Android)
```
Point the app at a LangGraph server in **Settings → Connection**:
- Local agent: run `langgraph dev` in `muffin-agent`, set API URL to `http://localhost:8123`
  (`http://10.0.2.2:8123` on the Android emulator), enter an LLM key, then run **Deep
  Research** from the Agents tab.
- Web defaults to the same-origin `/api` proxy (nginx → `langgraph-api`); optional accounts
  use the same-origin `/supabase` proxy → Kong.

```bash
npx tsc --noEmit                 # type-check (strict)
npm run lint                     # expo lint
npx expo export -p web           # static web build → dist/
docker build -t muffin-ui .      # web export + nginx (/api + /supabase proxies)
```
There is no test runner; the per-change loop is `tsc` + `expo export` + a headless-browser
smoke test with a screenshot, asserting zero Reanimated/worklet errors.

## Architecture
- **`src/app/`** — file-based routes. `(tabs)/` = Globe/Markets/Portfolio/Agents/Calls/
  Settings; detail routes `agents/[assistantId]`, `stock/[ticker]`, `sector/[…]`,
  `country/[…]`, `region/[…]`, `group/[…]`, `account/[…]`, `goal/[…]`, `calls/[…]`,
  `auth`. `+html.tsx` injects the deployment's runtime config before the bundle.
- **`src/lib/agent/`** — the "one graph → one screen" core: `registry.ts` (agent
  definitions: inputs, `buildInput`, result key/renderer, advanced overrides, stages),
  `client.ts` (SDK client + relative-URL resolution + native streaming shim),
  `presets.ts` (non-secret saved assistants), `renderers/` (pluggable output rendering),
  `overrides.ts` (per-run configurable patches).
- **`src/lib/settings/`** — on-device keys → `config.configurable` (field names mirror
  `muffin-agent`'s `BaseConfiguration` subclasses); `buildConfigurable` /
  `buildPresetConfigurable` / `buildAuthHeaders`.
- **`src/lib/auth/`** — optional Supabase accounts: client, session store; `runtime-config.ts`
  reads the deployment-injected public config.
- **`src/features/`** — self-contained domains: `markets/` (configurable globe +
  classification, sector donut, movers, taxonomy), `wealth/` (portfolio + goals),
  `council/` (13-persona screen), `agent-chat/` (threaded runner + chat + sub-agent trees),
  `agent-calls/` (history), `account/` (auth + cloud backup).
- **`src/components/`** — `ui/` bakery primitives, `icons/` semantic registry,
  `agent-runner.tsx`, `advanced-options.tsx`.

**Adding an agent = one entry in `src/lib/agent/registry.ts`.** Backend changes are shipped
as patches to `muffin-agent` / `muffin-deployment` (this repo's push scope is `muffin-ui`
only). Cross-submodule + deploy picture: the umbrella [`CLAUDE.md`](../CLAUDE.md).
