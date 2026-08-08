# Muffin UI 🧁

Cross-platform (**Web · iOS · Android**) [Expo](https://expo.dev) +
[Expo Router](https://docs.expo.dev/router/introduction) client for the
[`muffin-agent`](https://github.com/gururafiki/muffin-agent) LangGraph agents.

**Democratise wealth building** — bring your own LLM + OpenBB keys (injected per run,
kept private on-device); the research generated is shared for everyone. Kawaii
blueberry-bakery aesthetic (grape purple, cream, rounded "sticker" cards).

> Deployed at `muffin.<domain>` (behind Cloudflare Access), alongside the legacy chat UI
> at `muffin-chat.<domain>`. See [`ROADMAP.md`](./ROADMAP.md) for milestone history.

> **This tour is checked, not asserted.** [`scripts/verify-readme.mjs`](./scripts/verify-readme.mjs)
> walks every screen in a headless browser and asserts the bullets below — client-side screens
> offline, run pages against the live deployment, signing in through the real `/auth` form for the
> gated ones. Last run **2026-08-03: 76 pass, 0 fail** (55 client-side + 21 against the deployment). Anything it found that contradicted the
> README has been corrected here rather than left as a promise; known gaps are called out inline.
>
> **Not exercised by the script** (code-verified only, because each needs a *fresh* run rather than
> a reopened one): Stop-mid-stream, the live Run-progress checklist, human-in-the-loop interrupt
> cards, the chat Summary/Verbose toggle, the saved-presets list, and goal/holding editing. Treat
> those bullets as less strongly evidenced than the rest.

---

## Feature tour

The app is a **bottom tab bar** with six tabs — **Globe · Markets · Portfolio · Agents ·
Calls · Settings** — plus stacked detail screens (stock, sector, country, region, group,
account, goal, the agent runner, call detail, `/auth`, `/verify`). It follows **light/dark**
system theme.

Three of the six tabs run entirely on-device with **no backend at all** — see
[Real vs. sample data](#real-vs-sample-data) before reading any number on them as a market
quote.

### 🌍 Globe (home tab)
Navigate the investable world by geography. *Reference data, authored — see the data table.*
- **Hero** — muffin logo + "The investable world — your lens."
- **Classification switcher** (segmented pills): **MSCI · FTSE · World Bank** — swap the
  country-classification scheme; the map recolours and the blurb updates.
- **Group by** (segmented pills): **Region** vs **Market tier** (Developed/Emerging/
  Frontier) — changes how countries are grouped/coloured.
- **World map** — a stylised tappable SVG map (177 country paths); **tap a country** to
  select it (tap again, or the ✕, to deselect).
- **Selected-country card** — the country name, coloured **region / market-tier / ETF
  pills**, and an **Analyse ⟨country⟩** button (launches the Research agent, templated).
  - **Known limitation:** the **Open ⟨country⟩** drill-down button only appears for the
    **19 countries modelled in `taxonomy.ts`**. Tap any of the other ~158 map paths and you
    get the pills and Analyse, but no country page.
- **Group legend** — a tappable list of every region / tier (colour swatch + name + ETF
  ticker); tap to open that group's page.
- **Analyse global macro** — one-tap Research run on the macro backdrop.

### 📊 Markets tab
Sector weights and your multi-asset universe. *Sample performance data — see the data table.*
- **Sector breakdown** — an interactive **SVG donut** of sector weights, badged **SAMPLE**.
  **Tap a slice** → that sector's icon, weight %, **sub-sector chips**, and an
  **Open ⟨sector⟩** button.
- **Asset universe** — a horizontal **filter-chip** row: **All** + one chip per asset type
  (Equities, ETFs, Commodities, Crypto, Bonds, Real Estate, Cash, Mutual Funds, Derivatives).
- **Drill list** — the filtered instruments, each row showing ticker · name, a
  sector/country/style subtitle, and a coloured **change %**; tap a row to open the stock
  page.
  - **Known gap:** unlike the donut, this list is **not badged** — its ~50 change-%
    values are authored sample data presented without a caveat. Tracked in ROADMAP M6.

### 💰 Portfolio tab
Your wealth across every wrapper. *Seeded demo data, editable, saved on-device.*
- **Net-worth card** — total net worth, with assets and liabilities split out.
- **Allocation bars** — animated allocation with a **By asset / By account** chip toggle.
- **Accounts** — one card per wrapper (SIPP · ISA · LISA · GIA · Cash · Property ·
  Mortgage · Other) with its value; tap to open the account page (holdings inside,
  add/remove).
- **Goals** — goal cards with **animated progress**; **＋ Add goal** creates a new one;
  tap a goal to edit it. (Cloud backup/restore lives in Settings → Account.)

### 🤖 Agents tab
One graph → one screen. Lists the five deployed agents and your saved presets.
- **Agent cards** — **Deep Research**, **Investor Council** (badged "CUSTOM UI"),
  **Criteria Analysis**, **Stock Evaluation**, **Trading Decision** — icon, title,
  tagline; tap to open the runner.
- **Saved presets** — named, non-secret configured assistants you saved; tap to run one,
  or **✕** to delete it. Keys are re-injected from your on-device settings at run time;
  presets never store secrets.

#### Sign-in gate (read this before the runner)
When accounts are enabled and you're **signed out**, the agent screen shows **only** a
**"Sign in to run agents"** card. This is not just the Run button — the gate replaces the
**entire input surface**: fields, example chips, Advanced options and Save-as-preset are
all absent until you sign in ([`agent-hero.tsx`](./src/features/agent-shared/agent-hero.tsx)
renders the notice *instead of* its children). Browsing shared runs and reopening history
stay open to everyone.

#### The agent runner (generic agents: Research / Criteria / Trading)
- **Input fields** — per agent (Research: a **Question**; Criteria/Trading: a **Ticker**
  + optional **Focus** / **Narrative**), plus tappable **example chips** on the landing hero.
- **Advanced options** (collapsible) — per-run `configurable` overrides. **All four
  non-chat agents have some:**
  - *Research* — **Research mode** (speed/balanced/quality chips), **Max search results**.
  - *Criteria Analysis* — **Tool lessons** (`read_and_record` / `read_only` / `off`).
  - *Council* — **Include specialist signals** (On/Off) — adds the 6 deterministic analysts.
  - *Trading* — **Bull/bear debate rounds**, **Risk debate rounds**, **Reflection memory**.
- **Run agent** button (→ **Run again** once there's a result; **Stop** while streaming).
- **Save as preset** (collapsible) — name it and store the graph + current advanced options
  as a reusable assistant (secrets stripped).
- **Run recap** — once a thread exists, an identity banner: agent icon + title + tagline, a
  live status pill (pulsing "Running"/"Loading" → "Completed"), the submitted inputs as
  read-only chips, and **Start a new run**.
- **Run progress** — a live **done / doing / next** checklist driven by the agent's stage
  recipe (e.g. Criteria: classify → methodology → define → *evaluate each criterion* →
  merge → synthesise), with sub-rows streaming in (e.g. "3/13 criteria").
- **Result widget** — a tailored renderer (see [Result renderers](#result-renderers)),
  identical whether streaming live or reopened from history.
- **Sub-agents** — a soft panel of the compiled subgraphs a run delegated to (analysts, the
  bull/bear + risk debate conferences, criteria workers, council members), each an avatar row
  you tap to expand into its own detail.

#### Overview ↔ Timeline
Every run page carries a toggle. **Overview** answers *what the run concluded*; **Timeline**
answers *what it did* — and is built entirely from the LangGraph API, so any graph renders
without UI changes. Both views render through the **same cards**, so a payload cannot look
like two different products depending on which tab you're on.

- **Parallel work looks parallel.** Steps that shared a LangGraph superstep are bracketed as
  "N in parallel"; sequential steps run down a single spine. Verified live on real threads
  for `criteria_analysis` (two-way branch + ten-wide criterion fan-out), `council` (all
  members in one bracket) and `trading_decision` (the four analysts).
- **Real durations** per step, from checkpoint timestamps, with a bar drawn against the run's
  longest step — so "16m 32s of a 22m run went to classification" is visible at a glance.
  **Per-tool duration is not available** (messages carry no timing); only per-step.
- **Live status** — running steps pulse, failed ones are flagged, and while a run is in
  flight the steps it hasn't reached yet are listed ahead of it.
- **Every step opens into Input · Plan · Timeline · Output**, recursively: a sub-agent or
  subgraph inside a timeline expands into its own full card. Tool calls (with inputs, outputs,
  errors and a **time-series chart** when the payload is price/indicator data) live on the step
  that made them.

#### Chat agents (Stock Evaluation)
Deep-agent evaluation runs as a **multi-turn chat**:
- **Hero start screen** — centred composer ("What should we dig into?") + tappable
  **example-prompt chips**.
- **Conversation view** — **Summary / Verbose** toggle; each assistant turn is a minimal,
  expandable **step timeline** (thinking + tool calls, grouped into an orchestrator →
  sub-agent tree) followed by the markdown answer.
- **Message actions** — **copy**, on both your messages and the answers.
  - **Not available:** *edit & resend*, *regenerate* and *branch navigation* were dropped in
    M12b — protocol v2 has no equivalent, and nothing wires them today. The `MessageActions`
    props remain optional so they can be restored (tracked in ROADMAP M12 follow-ups).
- **Human-in-the-loop** — interrupt cards prompt for approval and resume the run.
- **Composer** — docked input with a send/stop button; a scroll-to-bottom pill appears
  when you scroll up.

#### Council (bespoke screen)
- **Convene the council** — a **member-unified arena** of **19 seats: 13 famous-investor
  personas + 6 specialists** (Technicals, Sentiment, Fundamentals, Growth, Valuation, News
  Sentiment — the specialists appear when *Include specialist signals* is on). Avatars
  animate through their stages (collecting → scoring → deciding → done); tap any member —
  persona or specialist — to expand its reasoning in the same detail card.
- **Judge** — an animated vote tally, then the judge's deliberation + verdict.

### 🕑 Calls tab
Your past agent runs (thread history), rendered from `metadata.graph_id` — data the
LangGraph server owns, not app-written tags.
- **Filter chips** — **All** + one per agent that appears, with counts.
- **Thread cards** — agent icon, title, a one-line descriptor of the inputs, relative
  time, and a **status badge** ("running" gently **pulses** while live). Tap to reopen —
  it resumes the exact agent screen (live stream or saved result).
- **Pull to refresh** — pulls the latest runs (`searchThreads` is `created_at desc`, so a
  run that just finished lands at the top). Works on the empty and error states too, not
  only when the list already has rows.

### ⚙️ Settings tab
Bring your own keys — everything stored on-device only.
- **Account** card — signed out: a **Sign in / Create account** button (→ `/auth`);
  signed in: your email/id, **Back up now** + **Restore** (opt-in cloud sync of portfolio +
  non-secret settings), and **Sign out**.
- **Connection** — **API URL**, **Auth token** (optional bearer/CF service token),
  **User ID** (per-user memory; overridden by sign-in), **Supabase URL**, **Supabase anon
  key** (blank = deployment default).
- **LLM provider** — **ollama / openrouter / openai / anthropic** chips, plus a
  **"Server default"** option (clears the selection) and an optional **Model**.
  "Server default" sends neither `llm_provider` nor `llm_chain`, so the deployment's own
  fallback chain applies; picking a concrete provider forces single-provider mode.
- **API keys** — **Ollama Cloud**, **OpenRouter**, **OpenAI**, **Anthropic**, **OpenBB**
  (all secure fields, on-device only).
- **Advanced configuration** (collapsible) — per-role **model chains** (orchestrator /
  collector / reasoner), **summariser model**, **temperature**, **Tool lessons**
  (`read_and_record` / `read_only` / `off`); **MCP URLs** (OpenBB / Firecrawl); **research**
  knobs (default mode chips, rerank threshold, max search results); **store access**
  namespaces.
- **Reset to defaults**.

### 🔐 Accounts — `/auth` and `/verify`
Accounts are **optional**; anonymous browsing always works. Sign-in is only needed to
*start* a run.

**`/auth`** — a stepped flow, not a single form:
- Muffin logo + welcome copy.
- **Continue with GitHub** / **Continue with Google** — shown only for providers the
  deployment has enabled, auto-detected from GoTrue's `/auth/v1/settings`. Adding a
  provider's credentials server-side lights up its button with no app change.
- **Email + password** with a **Sign in ⇄ Create account** toggle.
- **6-digit e-mail code** confirmation step after sign-up, with **Resend code** and
  **Use a different e-mail**.
- **Forgot password?** → send a reset link.

**`/verify`** — the handler GoTrue's e-mailed *links* land on (sign-up confirmation, magic
link, e-mail change, password recovery). It exchanges the token client-side via `verifyOtp`;
recovery links then show a **"Set a new password"** step before continuing into the app.

### Drill-down detail screens
- **Stock** (`/stock/[ticker]`) — ticker + context badges (asset type, sector, country,
  developed/emerging); cards to launch **Council**, **Criteria Analysis**, or **Stock
  Evaluation** for that ticker (pre-templated).
- **Sector / Country / Region / Group** — **breadcrumb** navigation, a **movers panel**
  (animated best/worst performers, badged SAMPLE), sub-sector/stock **drill lists** with
  change %, and an **Analyse** button at every level launching the Research agent.
- **Account** (`/account/[accountId]`) — the wrapper's holdings; add/remove holdings.
- **Goal** (`/goal/[goalId]`) — create/edit a goal with animated progress.
- **Call detail** (`/calls/[threadId]`) — a read-only fallback for threads from an
  unknown/legacy agent; known agents reopen into their own screen instead.

### Result renderers
Agent output is rendered in **two layers**, so a graph written next month is legible without
UI changes (`src/lib/agent/renderers/`):

**Layer 1 — the semantic baseline** (`structured.tsx` + `fields.tsx`). Reads *field meaning*,
not just type: a 0..1 `confidence` becomes a **Gauge**, `signal`/`rating` a toned
**SignalPill**, `weight` a **WeightBar**, `*_pct` a **DeltaValue**, `limitations`/`key_risks`
a **CaveatList**, `key_findings`/`catalysts` a **CheckList**, categorical strings a **Badge**,
prose **Markdown**. Fields are **ranked** so the headline leads, and empty fields are dropped
entirely. The rules key on naming conventions and value shapes, never a model registry.

**Layer 2 — hero cards** (`cards.tsx`) for the payloads carrying a run's headline, across 18
registered state channels: `ClassificationCard`, `CriteriaDefinitionCard`, `MethodologyCard`,
`SynthesisCard`, `DecisionTicketCard`, `JudgeCard`, `TradePlanCard`, `OutcomesCard`,
`CouncilVerdictCard`, `StrategyGridCard`, `EvidenceCard`. Dispatch is on the **state channel
a node wrote**, not on payload shape — an unknown channel falls through to the baseline
rather than being mis-rendered.

On top of those: the **Criteria** result (weighted per-criterion score bars, composite gauge,
positives/negatives, thesis), the **Trading** dashboard (verdict + conviction gauge, analyst
reports, the **bull-vs-bear** and **risk-debate** conversations, the trader plan), the
**Research** answer (markdown, key findings, tappable sources, confidence), a lightweight
`react-native-svg` **time-series line + volume-bar chart** for price/indicator tool outputs,
and generic **markdown / JSON / step-timeline / to-do** renderers.

---

## Real vs. sample data

The agent surfaces are real. The market and wealth surfaces are **not connected to any
backend** — they run on authored constants and an on-device store. Live market data needs a
backend screening/discovery graph that does not exist yet (ROADMAP M5).

| Screen / panel | Source | Real? |
|---|---|---|
| Globe map, classification schemes | `features/markets/classification.ts` — MSCI / FTSE / World Bank ISO-3166 membership lists | **Authored reference data** (real-world taxonomy, hand-maintained; no prices involved) |
| Globe country pills, ETF tickers | `features/markets/taxonomy.ts` | Authored |
| Markets → sector donut weights | `taxonomy.ts` `SECTOR_WEIGHTS` | **Sample** — badged in-app |
| Markets → asset universe change % | `taxonomy.ts` `ASSETS` (~50 rows) | **Sample — NOT badged** (known gap) |
| Sector / country / region movers panels | `taxonomy.ts` `changePct` | **Sample** — badged in-app |
| Stock page badges (sector/country/type) | route params from `taxonomy.ts` | Authored |
| Portfolio: accounts, holdings, prices, goals | `features/wealth/portfolio.ts` `DEMO_ACCOUNTS` / `DEMO_GOALS`, seeded into a persisted zustand store | **Seeded demo, editable, on-device.** Prices are static and never refresh |
| Portfolio cloud backup / restore | Supabase `user_backups` (RLS, owner-only) | **Real** — opt-in; API keys and endpoints are stripped on upload *and* restore |
| Agents / runner / Timeline / Overview | LangGraph API — `threads.search`, `POST /threads/{id}/history`, `GET /assistants/{id}/graph`, SSE streaming | **Real** |
| Calls tab | LangGraph `threads.search` + server-set `metadata.graph_id` | **Real** |
| Sign-in, OAuth providers, `/verify` | Supabase GoTrue | **Real** |
| Settings | on-device only (MMKV / localStorage) → each run's `config.configurable` | **Real**, never persisted server-side |

---

## Stack
- Expo SDK 56, Expo Router (typed routes), TypeScript (strict), React Compiler on.
- [NativeWind v4](https://www.nativewind.dev/) (Tailwind) + Reanimated; `react-native-svg`
  for the map / donut / charts; Phosphor icons via a semantic `<Icon>` registry.
- [`@langchain/langgraph-sdk`](https://www.npmjs.com/package/@langchain/langgraph-sdk) +
  [`@langchain/react`](https://www.npmjs.com/package/@langchain/react) `useStream`
  (protocol v2) for agents — native streaming via `expo/fetch`;
  [`@supabase/supabase-js`](https://supabase.com/) for optional accounts,
  [TanStack Query](https://tanstack.com/query) (server state),
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

### Running on Android

`npx expo start` + Expo Go is **not** enough — the app uses native modules Expo Go does not
bundle (`react-native-mmkv`, `expo-crypto`), so Android needs a development build.

One-time toolchain (macOS; none of this ships with the repo):

```bash
brew install openjdk@17                      # RN 0.85 needs JDK 17+ (system Java 8 will not do)
brew install --cask android-commandlinetools
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
yes | sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools" "emulator" \
           "system-images;android-36;google_apis;arm64-v8a"
avdmanager create avd -n muffin -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_7
emulator -avd muffin -gpu host &
npx expo run:android                         # prebuild + Gradle (~10 min cold, ~20 s incremental)
```

`android/` is generated by `expo prebuild` and gitignored — never edit it by hand.

**Native needs absolute URLs and its own Cloudflare credential.** The web build leans on things
native does not have: nginx's same-origin `/api` + `/supabase` proxies, and the browser's
Cloudflare Access SSO cookie. On device, set in **Settings → Connection**:

| Field | Value |
|---|---|
| API URL | `https://muffin-api.<domain>` (a relative `/api` cannot resolve — there is no origin) |
| CF Access client ID / secret | an Access **service token** — without it every request is answered with the Access login page (`302 text/html`), not JSON |
| Supabase URL | `https://supabase.<domain>` (public — Supabase is not behind Access) |

Then sign in under **Settings → Account**: reads are open, but creating a thread / starting a run
needs a Supabase user token.

### Installing on a real phone (sideload)

The build `expo run:android` installs is a **dev build**: it loads its JS from Metro, so it only
works while your laptop is serving it. For a phone that works on its own, build the **release**
variant — the JS bundle is embedded, no Metro, no laptop:

```bash
cd android && ./gradlew assembleRelease     # → app/build/outputs/apk/release/app-release.apk
```

Optionally bake the connection defaults in, so the phone only needs the Cloudflare pair typed by
hand (these three are read as Settings defaults in `lib/settings/store.ts`). Do **not** bake the CF
service-token secret — it would ship a credential inside a file you copy around:

```bash
EXPO_PUBLIC_API_URL=https://muffin-api.<domain> \
EXPO_PUBLIC_SUPABASE_URL=https://supabase.<domain> \
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
  ./gradlew assembleRelease
```

Install it either way:

```bash
adb install -r app/build/outputs/apk/release/app-release.apk   # USB, needs USB debugging on
```

or copy the `.apk` to the phone (Drive/email/USB) and tap it, allowing "install unknown apps" for
whichever app you opened it from. Then set the Cloudflare pair (and anything not baked in) in
**Settings → Connection** and sign in.

**Caveats.** The release variant is signed with the **debug keystore** (`signingConfig
signingConfigs.debug`, the React Native default) — fine for your own sideloading, but it is a
publicly known key, so it is not suitable for Play Store distribution, and `android/` is
`prebuild`-generated so that keystore is not a durable identity: if it is ever regenerated, the next
install may need an uninstall first. For real distribution use `eas build` with a keystore you own.


```bash
npm run check                    # typecheck + lint everything + offline checks (no credentials)
npm run typecheck                # = tsc --noEmit (strict)
npm run lint                     # = expo lint — walks /src, /app, /components ONLY
npm run lint:all                 # = eslint . — the above PLUS scripts/ (Node globals configured)
npm run build:web                # static web build → dist/
docker build -t muffin-ui .      # web export + nginx (/api + /supabase proxies)
```

`npm run check` is the gate to run before pushing: it needs no credentials and no network.
Note that `npm run lint` alone will **not** see the `scripts/` directory — `expo lint` only walks
`/src`, `/app` and `/components` — so use `lint:all` (or `check`) when touching tooling.

### Verification

**There is no test runner.** The per-change loop is `tsc` + `expo export` + a headless-browser
check of the changed flow, asserting zero Reanimated/worklet errors. Eight scripts back that up —
all need a fresh `npx expo export -p web --output-dir dist` and system Chrome, except the first
three:

| Script | Needs credentials? | What it asserts |
|---|---|---|
| `npx tsx scripts/run-timeline-check.ts` | **No** — fully offline | Runs the real timeline modules over synthetic snapshots: errored tasks, unanswered tool calls, summarised transcripts, duration edge cases |
| `npx tsx scripts/auth-check.ts` (`npm run verify:auth`) | **No** — fully offline | The auth-header / session-expiry / connection layer: that the per-request hook overrides a stale `Authorization` (and *deletes* it when signed out), the expired-vs-signed-out truth table, connection-status transitions, and **that the SSE transport keeps a non-zero reconnect budget** |
| `node scripts/smoke-auth-expiry.mjs` | CF Access + Supabase + login | Signs in for real, expires the stored access token in place, and asserts the next request carries a *refreshed* Bearer — then kills the refresh token and asserts the app says "your session expired" instead of surfacing a raw 401 |
| `npx tsx scripts/history-check.ts` | CF Access | The `/history` + `getGraph` contract end-to-end against the deployment, for all five graphs |
| `node scripts/smoke-timeline.mjs [threadId] [graphId]` | CF Access | The Timeline in a browser: parallel brackets, durations, the four facets, and that a leaf node does not redraw the whole run |
| `node scripts/smoke-reopen.mjs` | CF Access | Reopening a finished thread hydrates from `thread.values` |
| `node scripts/verify-readme.mjs [--only=<screen>] [--live]` | Optional (`--live` requires CF Access) | **Walks every feature bullet in this README** and prints a pass/differ/fail table to `.verify-shots/`. Client-side screens need nothing; run pages need CF Access; `MUFFIN_EMAIL`/`MUFFIN_PASSWORD` unlock the sign-in-gated screens. **`--live` drives the deployed site** (`muffin.<domain>`) instead of the local `dist/` — use it to verify a deploy, since a local build of the same commit proves the source is good, not that the right image reached the node |
| `node scripts/hydration-check.mjs` | No | Visits every route in both colour schemes and reports which prerendered HTML was served — the React #418 diagnostic |
| `node scripts/skeleton-check.mjs` (`npm run verify:skeletons`) | No | Hangs the API so loading states stay up, and asserts the skeleton bars have non-zero geometry |

Credentials come from the environment (`CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`,
`SUPABASE_ANON_KEY`, `MUFFIN_EMAIL`, `MUFFIN_PASSWORD`) and are never committed.

**Known issue — React #418 on dynamic routes.** Expo's static export emits per-route
prerenders whose dynamic-route filenames contain literal brackets (`dist/stock/[ticker].html`),
which nginx's `try_files $uri $uri.html /index.html` can never select for a request like
`/stock/AAPL` — so it falls back to `index.html` (the Globe prerender) and React hydrates the
wrong markup. Measured identical in light and dark, so it is **not** colour-scheme related.
Harmless but noisy; tracked in ROADMAP.

## Architecture
- **`src/app/`** — file-based routes. `(tabs)/` = Globe/Markets/Portfolio/Agents/Calls/
  Settings; detail routes `agents/[assistantId]`, `stock/[ticker]`, `sector/[…]`,
  `country/[…]`, `region/[…]`, `group/[…]`, `account/[…]`, `goal/[…]`, `calls/[…]`,
  `auth`, `verify`. `+html.tsx` injects the deployment's runtime config before the bundle.
- **`src/lib/agent/`** — the "one graph → one screen" core: `registry/` (one file per agent:
  inputs, `buildInput`, result key/renderer, advanced overrides, stages), `client.ts` (SDK
  client + relative-URL resolution + native streaming shim), `presets.ts` (non-secret saved
  assistants), `renderers/` (the two-layer output rendering above), `overrides.ts` (per-run
  `configurable` patches), `run-{node,history,graph}.ts` (the API-derived timeline model),
  `schemas.ts` (zod schemas mirroring backend payloads).
- **`src/lib/settings/`** — on-device keys → `config.configurable` (field names mirror
  `muffin-agent`'s `BaseConfiguration` subclasses); `buildConfigurable` /
  `buildPresetConfigurable` / `buildAuthHeaders`.
- **`src/lib/auth/`** — optional Supabase accounts: client, session store; `runtime-config.ts`
  reads the deployment-injected public config.
- **`src/features/`** — self-contained domains: `markets/` (configurable globe +
  classification, sector donut, movers, taxonomy), `wealth/` (portfolio + goals),
  `council/` (the 19-member arena), `agent-shared/` (streaming primitives, run timeline,
  hero/recap), `agent-runner/`, `agent-chat/`, `agent-calls/` (history), `account/` (auth +
  cloud backup).
- **`src/components/`** — `ui/` bakery primitives, `icons/` semantic registry,
  `advanced-options.tsx`.

**Adding an agent = one file in `src/lib/agent/registry/` + a line in its `index.ts`.**
Backend changes are shipped as patches to `muffin-agent` / `muffin-deployment` (this repo's
push scope is `muffin-ui` only). Cross-submodule + deploy picture: the umbrella
[`CLAUDE.md`](../CLAUDE.md).
