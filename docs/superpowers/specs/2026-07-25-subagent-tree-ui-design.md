# Recursive sub-agent tree — Phase 2 (muffin-ui) design

**Date:** 2026-07-25
**Status:** Design — awaiting review
**Depends on:** muffin-agent Phase 1 (merged, PR #121, deployed) — the `subagent_tree` state channel +
the `("subagent_detail", thread_id)/node_id` Store payloads.

## Goal

Render the captured execution topology as a **recursive drill-down tree**, uniform across agents and
identical live and on reopened runs: click a node → its children → … to any depth (council persona →
its `collect_data` → the data-collection subagents it called → their tools; criterion → its executed
subagents; trading analyst → its subagents). Each expanded node shows **trading-decision-level detail**
(the existing `SubgraphDetail`: Steps transcript + structured output + tool-runs), fetched lazily.

**Mount strategy = augment** (approved): keep the bespoke top-level UX (council arena, criterion
cards, the runner's headline) and attach the recursive subtree *beneath a node's existing detail* —
the current screens keep their identity; the tree adds depth.

## What Phase 1 gives us (the data contract)

- `values.subagent_tree`: `{ node_id: TreeNode }`, `TreeNode = { id, parent_id, name, kind, status,
  tool_summary: {count, tools, ok, failed, cached}, output_preview, has_detail }`. `id`/`parent_id`
  are `checkpoint_ns`-derived (`|`-joined `<node>:<uuid>` segments; the middleware segment stripped).
  `parent_id` is `"__root__"` at depth 1.
- **Criteria homing:** for `criteria_analysis`, each criterion's nodes live inside
  `values.criterion_evaluations[i].subagent_tree` (the `package` node re-homes them, exactly like
  `tool_runs`). So the consumer gathers the **top-level channel PLUS each criterion entry** — the same
  split `collectToolRuns` already does.
- **Intermediate levels aren't keys.** Only capturing agents emit a node; structural levels (the
  persona subgraph `mohnish_pabrai:<uuid>`, the criterion worker) appear only as `parent_id`
  prefixes. The consumer must **synthesize ancestor nodes from the id segments** and tolerate a
  `parent_id` that isn't itself a key.
- **Detail** per node is in the Store: `client.store.getItem(["subagent_detail", threadId], nodeId)`
  → `{ messages, tool_runs, output }`. `has_detail` is optimistic (sync path / failed offload may
  have written nothing) — tolerate a miss.

## Design

### 1. Data layer — `src/lib/agent/subagent-tree.ts`

- **Schema** (`schemas.ts`): `zTreeNode` (`looseObject`) + `TreeNode` type, mirroring the backend
  shape (keep in sync, like `zToolRun`).
- **`collectSubagentTree(values): TreeNode[]`** — gather `values.subagent_tree` (dict → list) +
  every `values.criterion_evaluations[i].subagent_tree`, parsed via `parseArray`/`parseOr`
  (skip malformed, one dev warning). Mirrors `collectToolRuns`.
- **`buildForest(nodes): TreeRow[]`** — pure function: index by `id`; for each node split its `id`
  into `<name>:<uuid>` segment prefixes and synthesize any missing ancestor as a structural
  `TreeRow` (`{ id, name: segmentName, kind: "subgraph", synthetic: true }`); wire `parent → children`
  by `parent_id`/prefix; return the roots (`parent_id === "__root__"` or parent absent). Each
  `TreeRow = { id, name, kind, status?, tool_summary?, has_detail?, synthetic, children: TreeRow[] }`.
  Display name: the captured `name` for real nodes, the segment node-name for synthetic ancestors.

### 2. Lazy detail fetch — extend the tool-cache module or a sibling `subagent-detail.ts`

`useSubagentDetail(threadId, nodeId, enabled)` — `useQuery(['subagent-detail', threadId, nodeId], () =>
client.store.getItem(["subagent_detail", threadId], nodeId), { enabled })`. Fetched only when a node
is expanded (`enabled` = expanded). Returns `{ messages, tool_runs, output } | null`.

### 3. Recursive UI — `src/features/agent-shared/subagent-tree.tsx`

- **`SubagentTree({ rows, threadId, depth })`** — renders each `TreeRow` as a `SubAgentRunRow`-style
  row (avatar + name + status pill + a one-line "N tools · M failed" from `tool_summary`); tap toggles
  expand. Expanded body =
  1. the node's **detail** (`useSubagentDetail` → render with the existing detail renderers: the
     `Conversation`/Steps transcript from `messages`, `StructuredOutput` from `output`, `ToolRunsPanel`
     from `tool_runs`) — i.e. reuse the `SubgraphDetail` body, refactored to accept a plain
     `{messages, tool_runs, output}` source instead of only a live scoped stream; a small loading
     skeleton while the Store fetch is in flight; a graceful "no detail recorded" on a miss;
  2. a nested **`<SubagentTree rows={row.children} depth={depth+1} />`**.
  Synthetic ancestor rows have no detail — they render just their label + children.
- Reuses `SubagentActivity`'s card/row look so it feels native.

### 4. Mount points (augment)

- **Council** (`member-detail.tsx`): under the persona's existing verdict/evidence/"Data collected",
  add `<SubagentTree rows={subtreeFor(personaNodeId)} threadId />` — the persona's `collect_data` →
  collectors → tools. `personaNodeId` is the reconstructed `<persona>:<uuid>` root for that member.
- **Criteria** (`criteria-result.tsx` `CriterionDetails`): under the criterion's existing detail, add
  its subtree from `criterion_evaluations[i].subagent_tree`.
- **Generic runner** (`agent-runner.tsx` / `run-results.tsx`) + **calls detail**
  (`app/calls/[threadId].tsx`): replace the flat `SubagentActivity` rows with the top-level
  `SubagentTree` (roots of the whole run). Trading/research/stock_evaluation get the tree here.
- **`SubgraphDetail`** stays for live scoped transcripts where it already works; the tree is the
  history/topology view. Where both could show, prefer the tree (single source).

### 5. Live vs history

Both read `values.subagent_tree` (captured), so they're identical — no dependence on live-discovery
depth. Live: the channel fills in at superstep barriers (the tree grows as nodes complete). History:
the whole tree is present on reopen from `thread.values` (fast). Detail is always lazy from the Store.

## Key considerations & risks

- **Backend must actually populate the channel on the Platform.** Phase-1's one deferred risk
  (`checkpoint_ns` reaching the middleware on LangGraph Platform). **Verification gate:** before
  building the UI against it, confirm one post-deploy run's `values.subagent_tree` has `"|"`-nested
  ids (anon read). If it collapses to a single `__root__`, escalate to backend before investing in UI.
- **Old runs** have no `subagent_tree` → the tree is empty → fall back to today's panels
  (`SubagentActivity` from `subagent_runs`/`subgraphsByNode`). Keep the existing components as the
  fallback; render the tree only when `collectSubagentTree(values)` is non-empty.
- **Dangling parents / synthetic nodes** — `buildForest` must never drop a node whose `parent_id`
  isn't a key; it synthesizes the ancestor instead.
- **Detail-fetch auth** — `client.store.getItem` goes through the same authed client as the existing
  tool-cache `searchItems`; anon reads are open.
- **State size** — the tree channel is light (Phase 1 kept transcripts out of it); confirm the runner
  doesn't re-slow. No new heavy state on the client.

## Verification

`npx tsc --noEmit` + `npx expo export -p web` + a headless drill-down smoke against a **real
post-deploy thread** (reopen a council or criteria run: expand a persona → see its `collect_data`
child → expand → see whether it made tool calls; expand a criterion → its collectors), zero Reanimated
errors, screenshot. This smoke doubles as the Phase-1 `checkpoint_ns`-on-Platform validation.

## Docs

`muffin-ui/CLAUDE.md` (the renderers/subagents-panel section — the recursive `SubagentTree`, the
`collectSubagentTree` gather incl. criteria homing, the lazy `subagent_detail` Store fetch, tree
reconstruction from id segments) + ROADMAP; update the `muffin-ui-subagents-panel-discovery` memory
(panel now reflects real captured topology at any depth).

## Open questions

- **Display name polish:** captured `collect_data` node label is `<persona>_data_collection` (its
  `self._name`); the ns segment is `collect_data`. Which reads better per level is a build-time polish
  call (proposal: segment name for structural clarity, with the agent label as secondary text).
- **De-dup vs `SubgraphDetail`:** trading analysts currently show via `SubgraphDetail`'s live scoped
  transcript; on history they'd also appear in the tree. Decide during build whether the tree fully
  replaces the runner's flat panel or coexists for live.
