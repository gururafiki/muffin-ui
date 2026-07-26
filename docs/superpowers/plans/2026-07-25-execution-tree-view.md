# Execution Tree view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A generic, per-agent-toggleable "Execution tree" view: the run's plan as a rail timeline at the root, each node drillable to any depth into its Result / Steps / Sub-agents / Tool-calls, with pluggable custom components per output-type and per tool-name. Augments (never replaces) today's Overview.

**Design spec:** the approved plan at `/Users/gururafiki/.claude/plans/during-development-and-planning-sleepy-neumann.md` (read it — has the full "what/how to display", decisions, and the file map). Branch `execution-tree-view`.

## Global Constraints
- Expo SDK 56 / React 19 / **TS strict**; **React Compiler on** (no redundant memo; never put a freshly-built object/array into a hook dep — see the reopen-fix regression). **No unit-test runner** — verify via `npx tsc --noEmit` + `npx expo export -p web` + a headless drill-down smoke.
- **Augment + fallback:** default view is today's Overview; the tree is opt-in per agent. Old runs (no `subagent_tree`) must still work.
- **Reuse, don't reinvent:** compose `RunProgress`/`resolveStages`, `buildForest`/`SubagentTree`/`NodeDetail`/`useSubagentDetail`, `Conversation`/`StepTimeline`, `collectToolRuns`/`ToolRunsPanel`/`useToolCache`, `TimeSeriesChart`/`parseTimeSeries`, `StructuredOutput`/`CriterionDetails`/`Verdict`/`ReportSection`/`DebateView`, `Collapsible`/`Card`. Registries stay UI-side (registry `AgentDef` stays JSX-free), mirroring `RESULT_RENDERERS` (`run-results.tsx:32`).
- **Real validation thread:** `019f98e1-b104-7742-a893-4b1a9a388366` (criteria/AAPL; 4 stages + 11 `criterion_evaluation:<uuid>|evaluate:<uuid>` nodes; 15 `subagent_detail` Store items). CF headers: `CF_ACCESS_CLIENT_ID=f787c468f3a8ec39c06654e7dd12c6bb.access`, `CF_ACCESS_CLIENT_SECRET=e2813bb1bc9b01b048f2d73bf4cc7040eaa078a4b4b1fdcf8b5af890e339b352`.

## Shared node model (used by Tasks 1/3/4)
```ts
// src/features/agent-shared/execution-tree/types.ts
import type { IconName } from '@/components/icons';
import type { ToolRun } from '@/lib/agent/renderers';
export type ExecStatus = 'done' | 'active' | 'pending' | 'error';
export type ExecNode = {
  id: string;                 // subagent_tree node id, or a stage/todo key
  label: string;
  icon?: IconName;
  status?: ExecStatus;
  kind: 'stage' | 'agent' | 'synthetic';
  detailNodeId?: string;      // subagent_tree id → useSubagentDetail (undefined for synthetic/stage w/o capture)
  output?: unknown;           // eager structured output (stageOutput / evaluation); else pulled from detail
  toolRuns?: ToolRun[];       // eager per-node tool records (collectToolRuns filtered)
  summary?: string;           // one-line collapsed preview
  children: ExecNode[];
};
```

---

## Task 1: `plan-steps.ts` — assemble the ExecNode tree (root plan + join to topology)

**Files:** Create `src/features/agent-shared/execution-tree/types.ts` (above) + `src/features/agent-shared/execution-tree/plan-steps.ts`. Modify `src/features/agent-shared/run-progress.tsx` to **export** `resolveStages` + `stageSnaps` (currently module-private) so plan-steps can reuse them (or copy the tiny `stageSnaps`/`resolveStages` logic if exporting is awkward — prefer exporting).

**Interfaces produced:**
- `treeRowToExecNode(row: TreeRow): ExecNode` — map a `buildForest` row → ExecNode (`kind: row.synthetic ? 'synthetic' : 'agent'`, `detailNodeId: row.synthetic ? undefined : row.id`, `label` = a readable name (fix the "Criterion Evaluation ×2" dup: for a synthetic parent whose only child repeats the name, prefer the segment; keep it simple), children recursed).
- `buildExecTree(agent, values, busy, byNode): ExecNode[]` — the Level-0 assembly:
  1. `forest = buildForest(collectSubagentTree(values))`; index roots by leading segment name (`id.split(':',1)[0]`).
  2. **If `agent.stages`:** `resolveStages(stages, values, busy, byNode)` → one `ExecNode{kind:'stage'}` per stage: `label`=stage.label, `icon`=stage.icon, `status`=row.status, `output`=`stageOutput(stage, values)` (helpers.ts), `toolRuns`=`collectToolRuns(values)` filtered to the stage's node name(s), `children`= the forest roots whose leading-segment matches `stage.node` (exact) or `stage.active` (regex) mapped via `treeRowToExecNode`. Stages with no matching forest root still show (output/status only).
  3. **Else if `isTodoList(values.todos)`:** one `ExecNode{kind:'stage'}` per todo (label=todo content, status from todo state), plus the forest roots appended as agent nodes (deep-agent task subagents).
  4. **Else (fallback):** `forest.map(treeRowToExecNode)`.

- [ ] **Step 1:** create `types.ts`; export `resolveStages`/`stageSnaps` from `run-progress.tsx` (add `export`).
- [ ] **Step 2:** implement `plan-steps.ts` per above; `npx tsc --noEmit`.
- [ ] **Step 3:** extend `scripts/buildforest-check.mjs` (or a new `scripts/exectree-check.mjs`) to fetch the real thread's `values` and run a JS port of `buildExecTree` for the criteria agent stages, asserting: 6 stage nodes in order (Classify…Synthesise), the "Evaluate" stage has 11 children, every `evaluate` node id present. Run with CF env. (JS port kept in sync, like buildforest-check.)
- [ ] **Step 4:** commit.

---

## Task 2: pluggable renderer registries

**Files:** Create `src/lib/agent/renderers/output-registry.tsx` + `src/lib/agent/renderers/tool-registry.tsx`; export both from `src/lib/agent/renderers/index.ts`. **Watch the require cycle** (the barrel imports these; these must NOT import back through the barrel for components that re-enter it — import leaf components directly, mirroring how `node-detail.tsx` avoided it).

**Interfaces:**
- `renderNodeOutput(node: {name?: string}, value: unknown, threadId?: string): ReactNode` — string map by node name → component: `criterion_evaluation`/`*_data_collection` w/ a criterion shape → `CriterionDetails`; persona verdict shape → `Verdict`+evidence; trading analyst → `ReportSection`; a `bull`/`bear` debate shape → `DebateView`; **default** → `StructuredOutput`. Use shape guards where a name is ambiguous. Model the map on `RESULT_RENDERERS`.
- `renderToolOutput(toolName: string, payload: unknown): ReactNode` — string map by tool name: `/equity_price|ohlcv|_historical|get_indicators/i` → `TimeSeriesChart` (via `parseTimeSeries(payload)`); **default** → `parseTimeSeries(payload) ? <TimeSeriesChart> : <JsonBlock>/<Markdown>` (today's `tool-runs.tsx:117-123` heuristic). Keep it a thin, additive layer over the existing chart/json/markdown logic.

- [ ] Implement both; `tsc`; commit. (No standalone test — exercised by Task 7 smoke.)

---

## Task 3: `NodeFacets` — the recursive 4-facet body

**Files:** Create `src/features/agent-shared/execution-tree/node-facets.tsx`.

`NodeFacets({ node, threadId }: { node: ExecNode; threadId?: string })`:
- If `node.detailNodeId`: `const { data, isPending } = useSubagentDetail(threadId, node.detailNodeId, true)` (mounted only when expanded → already lazy). Skeleton while pending.
- Render, each as a titled `Collapsible`/section, omitting empties:
  1. **Result:** `renderNodeOutput(node, node.output ?? data?.output, threadId)`.
  2. **Steps:** `data?.messages?.length ? <Conversation messages={coerceMessages(data.messages)} viewMode="verbose" /> : null`.
  3. **Sub-agents:** `node.children.length ? node.children.map(c => <TreeNodeRow key={c.id} node={c} threadId={threadId} />) : null` — **recursion** (TreeNodeRow imported from execution-tree.tsx; or hoist `TreeNodeRow` here to avoid a cycle — decide during build, keep both in the execution-tree folder).
  4. **Tools:** merge `node.toolRuns` + `parseArray(zToolRun, data?.tool_runs)`; for each, render `renderToolOutput(run.tool, <joined cached payload via useToolCache()>)` inside a `ToolRunRow`-style row — OR simplest v1: reuse `<ToolRunsPanel runs={mergedRuns} mode="flat" />` (which already does the chart/json join) and layer the tool-registry only where it differs. Prefer reusing `ToolRunsPanel` for v1 to avoid duplicating the cache-join; note the tool-registry as the override seam.
- `tsc` + `expo export`; commit.

---

## Task 4: `ExecutionTree` + `TreeNodeRow`

**Files:** Create `src/features/agent-shared/execution-tree/execution-tree.tsx`.
- `TreeNodeRow({ node, threadId })`: a rail-node row (reuse the `SubAgentRunRow` look/`Collapsible` `depth` — a `<Collapsible>` with `icon={node.icon}`, header = label + status dot + `node.summary`, body = `<NodeFacets node threadId />`). Status dot: reuse `RunProgress`'s `StageDot` semantics (done ✓ / active spinner / pending).
- `ExecutionTree({ agent, values, busy, byNode, threadId })`: `const nodes = useMemo(() => buildExecTree(agent, values, busy, byNode), [agent, values, busy, byNode])`; render a vertical rail of `TreeNodeRow`s. Empty → a muted "No execution recorded for this run." (so old runs fall back cleanly at the mount site).
- `tsc` + `expo export`; commit.

---

## Task 5: toggle + persistence

**Files:** Create `src/components/ui/segmented.tsx` (promote `Segmented<T>` from `app/(tabs)/index.tsx:21-56`; export from `components/ui/index.ts`); `src/features/agent-shared/agent-view-store.ts` (zustand-persist `Record<string,'overview'|'tree'>` modeled on `features/markets/map-view-store.ts` — `name:'muffin-agent-view'`, `version:1`, `migrate`, `persistStorage()`; selector `useAgentView(agentId)` + `setAgentView(agentId, v)`); `src/features/agent-shared/run-view-toggle.tsx` (`RunViewToggle({ agentId })` → `<Segmented options={[{value:'overview',label:'Overview'},{value:'tree',label:'Execution tree'}]} value onChange>`).
- `tsc`; commit.

---

## Task 6: mount on all surfaces (augment + fallback)

**Files:** `agent-runner/agent-runner.tsx`, `council/council-screen.tsx`, `agent-chat/chat-screen.tsx`, `app/calls/[threadId].tsx`. Pattern per surface: read `useAgentView(agent.id)`; render `<RunViewToggle agentId={agent.id} />` under `RunRecap` (chat: beside the Summary/Verbose chips); when `view==='tree'` render `<ExecutionTree agent values={view} busy byNode={stream.subgraphsByNode} threadId />` in place of the Overview body; else the existing body unchanged. Calls detail uses `thread.values` + no `byNode` (pass `undefined`; discovery-less is fine — topology comes from `subagent_tree`).
- `tsc` + `expo export`; commit.

---

## Task 7: verify + docs
- [ ] `npx tsc --noEmit` + `npx expo export -p web`.
- [ ] Headless smoke (`scripts/smoke-exectree.mjs`, adapt `smoke-subagent-tree.mjs` + the live-proxy): open the real thread, flip the toggle to "Execution tree", assert Level-0 shows the ordered stages, expand "Evaluate" → 11 children, expand one → Result (criterion card) + Steps + Tools render; assert the toggle persists across reload; zero Reanimated errors; screenshot. (Controller may drive the interactive part via Playwright MCP.)
- [ ] Docs: `muffin-ui/CLAUDE.md` (Execution-tree view + the two registries + the toggle store), `ROADMAP.md`, update the `muffin-ui-subagents-panel-discovery` memory.
- [ ] commit.

## Self-Review
Spec coverage: root plan timeline (T1/T4) · recursive 4-facet drill-down (T3) · pluggable output+tool registries (T2) · toggle+persist (T5) · all surfaces augment+fallback (T6) · verify+docs (T7). Placeholder scan: the `ExecNode` model + registry signatures + assembly are concrete; the ToolRunsPanel-vs-custom-tool-row choice in T3 is a stated build-time simplification (reuse ToolRunsPanel for v1). Require-cycle risk (registries/NodeFacets ↔ renderers barrel) is flagged in T2/T3 — import leaf components directly.
