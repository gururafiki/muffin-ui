# Reopen latency — hydrate finished runs from `thread.values`, not `getState`

**Date:** 2026-07-23
**Status:** Design — awaiting review
**Scope:** `muffin-ui` (Track 1, shippable) + a `muffin-agent`/`muffin-deployment` investigation (Track 2)

## Problem

Reopening an existing run (Calls tab → a known graph → `/agents/[assistantId]?threadId=…`)
takes tens of seconds to show anything. The runner/council/chat screens hydrate the reopened
thread through `useStream({ threadId })`, whose one-time hydration fetches the thread's state via
`GET /threads/{id}/state` (the LangGraph checkpointer read). On the deployed Oracle node that call
is ~27 s (the M14/M20 notes quote 28–70 s), and the M20 ETA bar exists only to paper over it.

The original hypothesis was that heavy state (persona/sub-agent transcripts embedded in the
checkpoint) bloated the fetch, and the fix would be to slim/split/offload that state and lazily load
detail on demand.

## Key finding (measured, not assumed)

A read-only probe against the deployed API (`https://muffin-api.rafiki.guru`, anonymous reads open
behind Cloudflare Access) on a finished `criteria_analysis` thread
(`019f85d6-2cdc-719e-a3f0-d8f01e5b3016`) overturned that hypothesis:

| Endpoint | Reads | Time (×3) | Payload |
|---|---|---|---|
| `GET /threads/{id}/state` — **getState (checkpoint)** | langgraph-postgres checkpointer | **27.9 / 27.3 / 27.4 s** | 46 KB |
| `GET /threads/{id}` — **threads.get (`thread.values`)** | denormalized JSONB column | **0.12 / 0.11 s** | 46 KB |
| `POST /threads/search` — **thread.values** | denormalized JSONB column | **0.11 / 0.14 s** | 46 KB |
| `POST /threads/search` + `extract` projection | JSONB path projection | **0.07 s** | 2 KB |

Conclusions:

1. **The cost is the endpoint, not the data.** The *same* 46 KB of state values returns ~240×
   faster from the denormalized `thread.values` than from the checkpoint `getState`.
2. **State size is irrelevant here.** Total values were 46 KB; `subagent_runs` was *absent* on this
   run (the data-collection subagents single-shot with no `task` calls). Slimming/splitting/
   offloading state — the entire earlier design — would have saved nothing.
3. **The slowness is a flat per-request cost of the checkpointer path.** `getHistory` returning 8
   checkpoints took 27.6 s — essentially the same 27 s as `getState` reading one. Cost is
   independent of checkpoint count/volume → not checkpoint bloat; points at the langgraph-postgres
   **checkpointer connection/pool/setup path** (cold/slow connection, tiny pool, per-call setup),
   which is separate from the fast threads-table `SELECT` that serves `thread.values`.
4. **Lazy-loading detail is unnecessary for latency.** The whole run loads in ~110 ms via
   `thread.values`; deferring persona/criterion/tool detail on click buys nothing. Dropped from scope.

Discovery is unaffected by the endpoint choice: `stream.subgraphsByNode` is seeded by a separate
lifecycle watcher, not `getState` (`@langchain/langgraph-sdk` `stream/index.js` `startLifecycleWatcher`).

## Design

Two independent tracks. Track 1 is the shippable fix and the subject of this spec; Track 2 is a
scoped backend investigation that gets its own spec once root-caused.

### Track 1 — Client fix (muffin-ui, ships now)

**Goal:** a reopened finished thread hydrates its `values` from the fast `thread.values` path
(~110 ms) instead of the checkpoint `getState` (~27 s), so `stream.isThreadLoading` resolves in
~110 ms and the run renders essentially instantly.

**Where:** `src/features/agent-shared/use-run-stream.ts` — the single stream engine every run
surface (generic runner, council, chat) mounts. One change covers council / criteria_analysis /
trading_decision / research / stock_evaluation / generic runner / chat.

**Mechanism.** `@langchain/react` `useStream` hydrates by calling the transport adapter's
`getState()` (default: the SSE adapter's own `GET /threads/{id}/state`). Two viable ways to redirect
that to `thread.values`:

- **Path B (preferred) — custom adapter.** Construct an `HttpAgentServerAdapter`
  (`{ apiUrl, fetch, defaultHeaders }`, all already produced by `makeClient`/`resolveApiUrl`/
  `streamingFetch`), override its bound `getState()` to return `{ values }` (plus `metadata` /
  `interrupts`) from `client.threads.get(threadId)`, and pass it via the `CustomAdapterOptions`
  branch (`transport: adapter`). Keeps `isThreadLoading` fast → **no per-surface loading-gate
  changes**. Cost: the custom-adapter branch forbids `client`/`fetch`/`assistantId` props, so submit/
  `assistantId` wiring must be reproduced on the adapter — the one risk to validate.
- **Path A (fallback) — `initialValues`.** Add a `useQuery(['thread-values', threadId], () =>
  client.threads.get(threadId))` and pass its `.values` as `useStream`'s `initialValues` for an
  instant paint. Simpler and lower-risk, but the built-in adapter's slow `getState` still runs in
  the background (~27 s) and `stream.isThreadLoading` stays true until it lands — so the per-surface
  skeleton gates must switch to a "have we got seed values?" signal instead of `isThreadLoading`.

**First implementation step is a short spike** to confirm Path B's submit/`assistantId` wiring on
this `@langchain/react` version; fall back to Path A if it fights us.

**Status-awareness.** `thread.values` is the final state for `idle`/`error` threads and a fine seed
for `busy`/`interrupted` ones (live events refine it; interrupts ride on the `Thread` object). So a
single uniform override is safe; no per-status branching required for correctness.

**Side effects.**
- The M20 hydration ETA bar (`use-estimated-progress.ts` + `HydrationCard`) becomes vestigial for
  finished reopens. Keep it only for the residual slow path (if any remains for busy/live
  hydration); otherwise simplify. Decide during implementation once Path A/B is chosen.
- Verify the sub-agents panel discovered rows still populate on a finished reopen (lifecycle watcher
  is independent of the values source, but confirm empirically).

**Out of scope (dropped):** channel splitting, Store offload, `extract` projection, `/history`
lazy fetch, and any per-detail lazy loading. The finding makes all of them unnecessary.

### Track 2 — Backend investigation (muffin-agent / muffin-deployment, separate spec)

Not a committed fix here — a root-cause track for *why* the langgraph-postgres checkpointer read is
a flat ~27 s regardless of data. First diagnostics:

- langgraph-api checkpointer **connection-pool config** (size, min/max, lifetime) and DB connection
  latency from the node; whether a per-call `setup()`/migration check runs.
- Time the checkpointer `aget_tuple` directly (log instrumentation) and compare against a raw `psql`
  query for the same checkpoint rows.
- langgraph-postgres image version + known checkpointer perf issues; node CPU/IO/memory under load
  (the stack runs ~14 services on a single Always-Free ARM node).

Value beyond Track 1: fixing it also speeds **live runs and resume** (every `getState` caller), which
the client fix does not touch. Lands as its own roadmap item + spec once root-caused.

## Verification

The established muffin-ui loop:

1. `npx tsc --noEmit` + `npx expo export -p web`.
2. Headless-browser smoke of a criteria_analysis reopen against the deployed (or local) API:
   assert the run content is visible in < ~1 s, zero Reanimated/worklet errors, capture a screenshot.
3. Re-run the read-only probe to confirm the reopen path no longer calls the checkpoint `getState`
   (and that `thread.values` is what hydrates).

## Documentation updates (final implementation step)

- `muffin-ui/CLAUDE.md` — update the "Live vs history doctrine" note: a finished reopen now hydrates
  `values` from `thread.values` (fast), not `getState` (checkpoint); note the ETA bar's reduced role.
- `muffin-ui/ROADMAP.md` — the Track 1 fix + the Track 2 backend-perf investigation item.
- `muffin-agent` / `muffin-deployment` docs — capture the getState-latency finding + the Track 2
  investigation item (delivered per the backend-patch convention).
- Save a project memory for the durable, non-obvious finding: **on the deployed backend,
  `getState`/`getHistory` (checkpointer) are a flat ~27 s while `threads.get`/`threads.search`
  (`thread.values`) return the same data in ~110 ms — reopen latency is the endpoint, not state
  size.**

## Open questions / risks

- **Path B submit wiring** — the custom-adapter branch's handling of `assistantId` and the run
  submit path on this `@langchain/react` version. Resolved by the spike; Path A is the fallback.
- **Busy/interrupted reopen** — confirm a mid-run reopen still replays buffered live events after we
  seed from `thread.values` (expected: yes — event subscription is independent of the getState seed).
- **ETA bar removal** — only remove/scope it once the residual slow path (if any) is known.
