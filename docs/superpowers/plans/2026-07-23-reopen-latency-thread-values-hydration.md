# Reopen-latency: hydrate finished runs from `thread.values` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reopening a finished run paint in ~110 ms instead of ~27 s by hydrating `useStream` from the denormalized `thread.values` (`GET /threads/{id}`) instead of the checkpoint (`GET /threads/{id}/state`).

**Architecture:** One new helper builds a LangGraph stream transport (a wrapped `HttpAgentServerAdapter`) whose `getState()` reads `client.threads.get(threadId).values` instead of the checkpoint. `useRunStream` passes it to `useStream` via the custom-adapter branch. Live streaming, submit, and resume are untouched — only the one-time hydration read is redirected. One change covers every reopen surface (council / criteria_analysis / trading_decision / research / stock_evaluation / generic runner / chat).

**Tech Stack:** Expo SDK 56 / React 19 / TypeScript strict; `@langchain/langgraph-sdk` 1.9.25 (`HttpAgentServerAdapter`, `Client`); `@langchain/react` `useStream`. No unit-test runner — verification is `npx tsc --noEmit` + `npx expo export -p web` + a headless-browser smoke (script provided in Task 1).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-23-reopen-latency-thread-values-hydration-design.md`. This plan is **Track 1 only** (the client fix). Track 2 (backend checkpointer-latency investigation) is a separate spec — this plan only records the finding for the owner.
- **TypeScript strict**; path aliases `@/*` → `src/*`. React Compiler is on — avoid redundant manual memoization.
- **Read the Expo SDK 56 docs** (`https://docs.expo.dev/versions/v56.0.0/`) before any Expo/RN code — but this change is pure TS/SDK glue, no RN APIs.
- **Only `muffin-ui` is in push scope.** Backend changes ship as patches — Task 2 writes the Track-2 finding to a doc, it does not touch the backend.
- **Verification loop (established):** `npx tsc --noEmit` + `npx expo export -p web` + a headless smoke of the changed flow with a screenshot, asserting zero Reanimated/worklet errors. Commit to the working branch (`reopen-latency-thread-values-hydration`, already created).
- **Deployed API for smoke:** `https://muffin-api.rafiki.guru`; anonymous reads are open behind Cloudflare Access using the service-token headers `CF-Access-Client-Id` / `CF-Access-Client-Secret` **plus a browser `User-Agent`** (the default urllib/curl UA is bounced with CF error 1010). Known finished criteria thread: `019f85d6-2cdc-719e-a3f0-d8f01e5b3016`.

---

## File Structure

- **Create** `src/features/agent-shared/fast-hydration-transport.ts` — one responsibility: build a stream transport whose `getState()` reads `thread.values`. ~30 lines. Keeps the mechanism out of `use-run-stream.ts`.
- **Modify** `src/features/agent-shared/use-run-stream.ts` — swap the `useStream` `{ client, fetch }` (agent-server branch) for `{ transport }` (custom-adapter branch), keeping the same `client` instance for the transport's `threads.get`.
- **Create** `scripts/smoke-reopen.mjs` — a self-contained dist-serving `/api` proxy + puppeteer-core driver that reopens the known finished thread and asserts the network path + timing. Verification artifact; committed.
- **Modify** `CLAUDE.md`, `ROADMAP.md` (docs) and add `docs/backend-notes/2026-07-23-getstate-latency.md` (Track-2 finding for the owner).

---

## Task 1: Fast-hydration transport + wire into `useRunStream`

**Files:**
- Create: `src/features/agent-shared/fast-hydration-transport.ts`
- Modify: `src/features/agent-shared/use-run-stream.ts` (the `client` memo + the `useStream({...})` call, ~lines 47–72)
- Create: `scripts/smoke-reopen.mjs`

**Interfaces:**
- Consumes: `Client` from `@langchain/langgraph-sdk`; `resolveBaseUrl` (`@/lib/resolve-url`); `buildAuthHeaders` (`@/lib/settings/configurable`); `Settings` (`@/lib/settings/store`); `streamingFetch` (`@/lib/agent/install-fetch`).
- Produces: `makeReopenTransport(client: Client, settings: Settings): AgentServerAdapter` — a transport for `useStream`'s `transport` option.

- [ ] **Step 1: Create the transport helper**

Create `src/features/agent-shared/fast-hydration-transport.ts`:

```ts
import {
  type AgentServerAdapter,
  type Client,
  HttpAgentServerAdapter,
} from '@langchain/langgraph-sdk';

import { streamingFetch } from '@/lib/agent/install-fetch';
import { resolveBaseUrl } from '@/lib/resolve-url';
import { buildAuthHeaders } from '@/lib/settings/configurable';
import type { Settings } from '@/lib/settings/store';

/**
 * A LangGraph stream transport whose one-time hydration read (`getState`)
 * comes from the denormalized `thread.values` (`GET /threads/{id}`, ~110ms)
 * instead of the checkpoint (`GET /threads/{id}/state`, ~27s on the deployed
 * Oracle node — see the reopen-latency spec). Identical values, ~240x faster
 * reopen. ONLY the hydration read is redirected: live streaming, submit, and
 * resume still flow through the wrapped SSE adapter unchanged.
 *
 * The adapter is constructed unbound; the framework binds the thread via
 * `setThreadId`, so `getState` reads the CURRENT `adapter.threadId` each call
 * (correct for both reopen and post-submit fresh runs). A null threadId
 * (fresh run before submit) short-circuits — nothing to hydrate.
 *
 * Interrupted/busy threads: `thread.values` is a fine seed; the live event
 * subscription refines it, so interrupts still arrive over the stream.
 */
export function makeReopenTransport(client: Client, settings: Settings): AgentServerAdapter {
  const adapter = new HttpAgentServerAdapter({
    apiUrl: resolveBaseUrl(settings.apiUrl),
    defaultHeaders: buildAuthHeaders(settings),
    fetch: streamingFetch(),
  });

  adapter.getState = async () => {
    const threadId = adapter.threadId;
    if (!threadId) return null;
    const thread = await client.threads.get(threadId);
    return {
      values: thread.values,
      metadata: thread.metadata,
      next: [],
      tasks: [],
      checkpoint: null,
      parent_checkpoint: null,
    };
  };

  return adapter;
}
```

- [ ] **Step 2: Type-check the helper in isolation**

Run: `npx tsc --noEmit`
Expected: PASS. If `adapter.getState = …` errors on the generic `<StateType>` signature, cast the assignment: `adapter.getState = (async () => { … }) as typeof adapter.getState;` and re-run.

- [ ] **Step 3: Wire the transport into `useRunStream`**

In `src/features/agent-shared/use-run-stream.ts`, add the import and swap the `useStream` options. The `client` memo stays (the transport uses it for `threads.get`). Change the `useStream({...})` call from the agent-server branch (`client` + `fetch`) to the custom-adapter branch (`transport`):

```ts
// add near the other imports
import { makeReopenTransport } from './fast-hydration-transport';

// inside useRunStream, after the existing `const client = useMemo(...)`:
const transport = useMemo(
  () => makeReopenTransport(client, getSettings()),
  [client],
);

const stream = useStream<AgentState>({
  transport,
  assistantId: opts.assistantId || agent.id,
  threadId: threadId ?? null,
  messagesKey: 'messages',
  onThreadId: (id: string) => {
    setThreadId(id);
    router.setParams({ threadId: id });
    queryClient.invalidateQueries({ queryKey: ['threads'] });
  },
});
```

Remove the now-unused `fetch: streamingFetch()` line and its `streamingFetch` import **only if** `streamingFetch` is no longer referenced in the file (it is now used inside `fast-hydration-transport.ts` instead). Keep the `// Native fetch (critical)` comment's intent by moving it into the helper's construction (the helper already passes `fetch: streamingFetch()`).

- [ ] **Step 4: Type-check the wiring**

Run: `npx tsc --noEmit`
Expected: PASS. The custom-adapter branch forbids `client`/`fetch` on the `useStream` options object — confirm neither is passed there anymore (they moved into the transport). If `assistantId` typing complains under the custom-adapter branch, keep it — `useStream` reads `assistantId` at runtime in both branches (verified in `use-stream.js`).

- [ ] **Step 5: Build the web bundle**

Run: `npx expo export -p web --output-dir dist`
Expected: succeeds, `dist/` produced, no errors.

- [ ] **Step 6: Create the smoke script**

Create `scripts/smoke-reopen.mjs`. It serves `dist/` with an `/api` → deployed-backend proxy (CF headers + browser UA), reopens the known finished criteria thread, and asserts the reopen hit `GET /threads/{id}` (thread.values) and **not** `GET /threads/{id}/state` (checkpoint), plus a screenshot and a console-error check.

```js
// scripts/smoke-reopen.mjs — run: node scripts/smoke-reopen.mjs
// Env: CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (required).
// Requires system Chrome + puppeteer-core (install ad-hoc: `npm i -D puppeteer-core`).
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const API = 'https://muffin-api.rafiki.guru';
const TID = '019f85d6-2cdc-719e-a3f0-d8f01e5b3016';
const CID = process.env.CF_ACCESS_CLIENT_ID;
const CSEC = process.env.CF_ACCESS_CLIENT_SECRET;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const DIST = new URL('../dist', import.meta.url).pathname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

if (!CID || !CSEC) { console.error('set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET'); process.exit(2); }

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const body = [];
    req.on('data', (c) => body.push(c));
    req.on('end', () => {
      const target = API + req.url.replace(/^\/api/, '');
      const r = http.request(target, {
        method: req.method,
        headers: { ...req.headers, host: new URL(API).host, 'CF-Access-Client-Id': CID, 'CF-Access-Client-Secret': CSEC, 'User-Agent': UA },
      }, (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
      r.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
      if (body.length) r.write(Buffer.concat(body));
      r.end();
    });
    return;
  }
  let p = normalize(join(DIST, decodeURIComponent(req.url.split('?')[0])));
  if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  createReadStream(p).pipe(res);
});

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://localhost:${port}`;

const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const reqs = [];
const errors = [];
page.on('request', (r) => reqs.push(r.url()));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const t0 = Date.now();
await page.goto(`${base}/agents/criteria_analysis?threadId=${TID}`, { waitUntil: 'networkidle2', timeout: 60000 });
const elapsed = Date.now() - t0;
await page.screenshot({ path: 'smoke-reopen.png', fullPage: true });

const hitValues = reqs.some((u) => u.includes(`/threads/${TID}`) && !u.includes('/state'));
const hitCheckpoint = reqs.some((u) => u.includes(`/threads/${TID}/state`));
// Whitelist the known pre-existing React #418 hydration warning (see CLAUDE.md smoke notes).
const realErrors = errors.filter((e) => !/minified react error #418/i.test(e) && /reanimated|worklet/i.test(e));

await browser.close();
server.close();

console.log(`elapsed=${elapsed}ms  hitThreadValues=${hitValues}  hitCheckpoint=${hitCheckpoint}  reanimatedErrors=${realErrors.length}`);
if (!hitValues || hitCheckpoint || realErrors.length) { console.error('SMOKE FAIL', { hitValues, hitCheckpoint, realErrors }); process.exit(1); }
console.log('SMOKE PASS');
```

- [ ] **Step 7: Run the smoke**

Run: `npm i -D puppeteer-core && CF_ACCESS_CLIENT_ID=<id> CF_ACCESS_CLIENT_SECRET=<secret> node scripts/smoke-reopen.mjs`
Expected: `SMOKE PASS` with `hitThreadValues=true`, `hitCheckpoint=false`, `reanimatedErrors=0`, and `elapsed` in low single-digit seconds (dominated by bundle load, not the 27 s checkpoint read). Inspect `smoke-reopen.png` — the criteria run content (recap banner + criterion cards) is visible, not a hydration skeleton.

**If the smoke fails because submit/stream broke (fresh runs) or `setThreadId` isn't called on the custom adapter (getState reads a stale/empty threadId):** fall back to **Path A**. Revert Step 3, and instead keep the agent-server branch and seed `initialValues`, gating the mount on the fast fetch:

```ts
// use-run-stream.ts — Path A fallback
import { useQuery } from '@tanstack/react-query';
// ...
const seeded = useQuery({
  queryKey: ['thread-values', opts.threadId],
  queryFn: () => client.threads.get(opts.threadId as string),
  enabled: !!opts.threadId,
  staleTime: Infinity,
});
// Render nothing but the surface's own skeleton until the fast values land,
// then mount useStream with them as the seed. Because useStream cannot mount
// conditionally, pass `initialValues` and drive loading UI off `seeded.isPending`
// instead of `stream.isThreadLoading` in each surface's skeleton gate.
const stream = useStream<AgentState>({
  client,
  assistantId: opts.assistantId || agent.id,
  threadId: threadId ?? null,
  messagesKey: 'messages',
  fetch: streamingFetch(),
  initialValues: seeded.data?.values as AgentState | undefined,
  onThreadId: (id: string) => { setThreadId(id); router.setParams({ threadId: id }); queryClient.invalidateQueries({ queryKey: ['threads'] }); },
});
```
Path A note: the built-in adapter's slow `getState` still runs in the background, so expose `isThreadHydrating: !!opts.threadId && seeded.isPending` from `useRunStream` and switch the four surfaces' skeleton gates (`run-results.tsx`, `council-screen.tsx`, `chat-screen.tsx`, `agent-runner.tsx`) from `stream.isThreadLoading` to it. Re-run Steps 4–7.

- [ ] **Step 8: Commit**

```bash
git add src/features/agent-shared/fast-hydration-transport.ts \
        src/features/agent-shared/use-run-stream.ts \
        scripts/smoke-reopen.mjs package.json package-lock.json
git commit -m "perf(reopen): hydrate finished runs from thread.values, not getState

Reopen hydration read moves from GET /threads/{id}/state (checkpoint, ~27s on
the deployed node) to GET /threads/{id} (denormalized thread.values, ~110ms).
Same values, ~240x faster reopen; one change covers every run surface. Adds a
headless smoke asserting the reopen hits thread.values and not the checkpoint."
```

---

## Task 2: Docs, ROADMAP, backend-track note, and memory

**Files:**
- Modify: `CLAUDE.md` (the "Live vs history doctrine" note in the `renderers/`/stream section)
- Modify: `ROADMAP.md`
- Create: `docs/backend-notes/2026-07-23-getstate-latency.md`
- Create: a project memory file (see Step 4)

- [ ] **Step 1: Update `CLAUDE.md`**

Find the "Live vs history doctrine: events for live, state for history" paragraph (in the `use-run-stream.ts` bullet, which currently says a finished thread "makes only `GET /threads/{id}/state`"). Replace that sentence with:

```
On load a finished thread now hydrates its `values` from the denormalized
`thread.values` (`GET /threads/{id}`, ~110ms) via a custom stream transport
(`fast-hydration-transport.ts`) — NOT the checkpoint `getState`
(`GET /threads/{id}/state`), which is a flat ~27s on the deployed Oracle node
regardless of state size (measured; see docs/backend-notes/2026-07-23-getstate-latency.md).
Only the one-time hydration read is redirected; live streaming/submit/resume are
unchanged. Consequence: the M20 hydration ETA bar (`use-estimated-progress.ts` +
`HydrationCard`) now resolves in ~110ms for finished reopens, so it only ever
flashes — kept for the residual busy/live-hydration case.
```

- [ ] **Step 2: Update `ROADMAP.md`**

Add a completed entry for the Track-1 fix and an open item for Track-2:

```
- [x] Reopen latency: hydrate finished runs from `thread.values` not the checkpoint
  `getState` (~240x faster reopen; `fast-hydration-transport.ts`). [app]
- [ ] Backend: langgraph-postgres `getState`/`getHistory` (checkpointer) is a flat
  ~27s regardless of state size (getState 1 ckpt ≈ getHistory 8 ckpts). Not
  checkpoint bloat — points at checkpointer connection/pool/setup. Fixing it also
  speeds live runs + resume. [backend-patch] — see docs/backend-notes/2026-07-23-getstate-latency.md
```

- [ ] **Step 3: Write the Track-2 backend note (for the owner)**

Create `docs/backend-notes/2026-07-23-getstate-latency.md`:

```markdown
# getState latency — checkpointer read is a flat ~27s (Track 2)

Measured against the deployed API on a finished criteria_analysis thread
(019f85d6-2cdc-719e-a3f0-d8f01e5b3016), identical ~46KB of state values:

| Endpoint | Path | Time (x3) |
|---|---|---|
| GET /threads/{id}/state | checkpointer (langgraph-postgres) | 27.9 / 27.3 / 27.4 s |
| GET /threads/{id} | denormalized thread.values (JSONB) | 0.12 / 0.11 s |
| POST /threads/search | denormalized thread.values | 0.11 / 0.14 s |
| POST /threads/{id}/history (8 checkpoints) | checkpointer | 27.6 s |

Findings: cost is ~240x the thread.values path, independent of checkpoint count
(getState=1 ckpt ≈ getHistory=8 ckpts ≈ 27s) and of payload size (46KB). NOT
checkpoint bloat. Points at the langgraph-postgres checkpointer connection/pool/
setup path (cold/slow connection, tiny pool, per-call setup) — separate from the
fast threads-table SELECT that serves thread.values.

First diagnostics (deliver as a muffin-agent / muffin-deployment patch):
- langgraph-api checkpointer connection-pool config (size, min/max, lifetime) +
  DB connection latency from the node; whether a per-call setup()/migration runs.
- Instrument/time the checkpointer aget_tuple; compare a raw psql query.
- langgraph-postgres image version + known checkpointer perf issues; node CPU/IO
  under the ~14-service load.

The muffin-ui Track-1 fix (hydrate reopens from thread.values) sidesteps this for
the Calls-reopen path but does NOT help live runs / resume, which still call
getState — hence this remains worth root-causing.
```

- [ ] **Step 4: Save a project memory**

Create a memory file at `/Users/gururafiki/.claude/projects/-Users-gururafiki-Projects-Python-Muffin-muffin-agent-v2-muffin-umbrella/memory/muffin-reopen-getstate-latency.md`:

```markdown
---
name: muffin-reopen-getstate-latency
description: Deployed reopen slowness is the getState/checkpoint endpoint (~27s flat), not state size; thread.values returns the same data in ~110ms
metadata:
  type: reference
---

Measured on the deployed muffin API (finished criteria_analysis thread): `GET
/threads/{id}/state` (checkpointer) is a **flat ~27s** regardless of state size,
while `GET /threads/{id}` / `POST /threads/search` (denormalized `thread.values`)
return the SAME ~46KB in ~110ms (~240x). `getHistory` (8 ckpts) is also ~27s →
cost is per-checkpointer-request, not per-checkpoint or per-byte → NOT checkpoint
bloat; likely a checkpointer connection/pool/setup issue on the Oracle node.

muffin-ui Track-1 fix: `useRunStream` hydrates finished reopens from `thread.values`
via `fast-hydration-transport.ts` (custom `useStream` transport whose `getState`
reads `threads.get`), ~240x faster reopen. The M20 hydration ETA bar is now
near-vestigial for reopens. Track-2 (backend checkpointer perf) still open — it
also affects live runs + resume. See docs/backend-notes/2026-07-23-getstate-latency.md.
```

Then add a one-line pointer to `MEMORY.md`:
```
- [muffin reopen getState latency](muffin-reopen-getstate-latency.md) — reopen slowness is the checkpoint endpoint (~27s flat), not state size; thread.values is ~110ms; UI now hydrates from thread.values
```

- [ ] **Step 5: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: PASS (docs-only, but confirms nothing regressed).

```bash
git add CLAUDE.md ROADMAP.md docs/backend-notes/2026-07-23-getstate-latency.md
git commit -m "docs(reopen): record thread.values hydration + Track-2 getState-latency finding"
```

---

## Self-Review

**Spec coverage:**
- Track 1 client fix (`use-run-stream.ts`, hydrate from `thread.values`) → Task 1. ✓
- Path B preferred + Path A fallback, spike-gated → Task 1 Steps 1–7 (Path B) + the Step-7 fallback block (Path A). ✓
- Covers all reopen surfaces via the single `useRunStream` change → Task 1 Step 3. ✓
- Verification (tsc + export + headless smoke + screenshot, zero Reanimated) → Task 1 Steps 2,4,5,7. ✓
- ETA-bar reduced role → documented in Task 2 Step 1 (no code change needed; it just stops lingering). ✓
- Sub-agents panel still populates on reopen (lifecycle watcher independent of getState) → Task 1 Step 7 asserts content renders + `smoke-reopen.png` manual check. ✓
- Track 2 backend investigation → recorded (not implemented) in Task 2 Steps 2–3. ✓
- Memory of the finding → Task 2 Step 4. ✓

**Placeholder scan:** No TBD/TODO; every code/step is concrete. The `<id>`/`<secret>` in the smoke command are runtime secrets supplied via env, not plan placeholders.

**Type consistency:** `makeReopenTransport(client, settings)` defined in Task 1 Step 1 is consumed with the same signature in Step 3. `getState` return shape matches `AgentServerAdapter.getState`'s `{ values, next?, tasks?, metadata?, checkpoint?, parent_checkpoint? }`. `isThreadHydrating` (Path A only) is introduced and consumed within the same fallback block.

**Open risk carried into execution:** whether the framework calls `adapter.setThreadId` on the custom-adapter branch (Path B) — the Step-7 smoke is the go/no-go; Path A is the specified fallback.
