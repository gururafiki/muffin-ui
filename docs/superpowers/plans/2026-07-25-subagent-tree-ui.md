# Recursive sub-agent tree UI (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render the captured `subagent_tree` channel as a recursive drill-down tree (any depth, live + history, uniform across agents), augmenting the existing panels; each node expands to trading-decision-level detail (transcript + output + tools) lazily fetched from the Store.

**Architecture:** Pure data layer (`collectSubagentTree` gathers the channel incl. criteria per-criterion homing; `buildForest` reconstructs the tree with synthetic ancestor nodes) → a lazy per-node Store fetch (`useSubagentDetail`) → a recursive UI that reuses the existing `SubagentActivity`/`SubAgentRunRow` row (each tree row is a `SubagentRun` whose `renderDetail` renders the node's detail + a nested `SubagentActivity` of its children) → mounted beneath the existing council/criteria/runner/calls panels, shown only when the tree is non-empty (old runs fall back to today's UI).

**Tech Stack:** Expo SDK 56 / React 19 / TS strict; `@langchain/langgraph-sdk` `client.store.getItem`; TanStack Query; zod `looseObject` schemas. No unit-test runner — verification is `npx tsc --noEmit` + `npx expo export -p web` + a headless drill-down smoke against a real thread, plus a standalone node script that exercises `buildForest` against the real captured tree.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-25-subagent-tree-ui-design.md`. **Depends on** the deployed muffin-agent `subagent_tree` channel + `("subagent_detail", thread_id)/node_id` Store payloads.
- **Data contract:** `TreeNode = { id, parent_id, name, kind: "subgraph"|"task", status, tool_summary:{count,tools,ok,failed,cached}, output_preview, has_detail }`. `id`/`parent_id` are `|`-joined `<node>:<uuid>` segments; `parent_id` `"__root__"` at depth 1. Criteria homes nodes inside `values.criterion_evaluations[i].subagent_tree` (gather both). Intermediate levels aren't keys — synthesize from id segments; tolerate dangling parents. `has_detail` is optimistic — tolerate a Store miss.
- **Real validation thread:** `019f98e1-b104-7742-a893-4b1a9a388366` (criteria AAPL, post-deploy) — use it for the `buildForest` fixture + the headless smoke.
- TS strict; `@/*` → `src/*`; React Compiler on (avoid redundant memoization). GPLv3; arm64. CI builds on push to main.
- **Augment, don't replace:** keep the existing council arena / criterion cards / runner headline; render the tree only when `collectSubagentTree(values).length > 0`, else keep today's `SubagentActivity`.

---

## File Structure

- **Modify** `src/lib/agent/schemas.ts` — add `zTreeNode` (`looseObject`) + `TreeNode` type.
- **Create** `src/lib/agent/subagent-tree.ts` — `collectSubagentTree(values): TreeNode[]` + `buildForest(nodes): TreeRow[]` (pure).
- **Create** `src/features/agent-shared/use-subagent-detail.ts` — `useSubagentDetail(threadId, nodeId, enabled)` (Store `getItem` via `useQuery`).
- **Create** `src/features/agent-shared/subagent-tree.tsx` — `SubagentTree({ rows, threadId })` + `NodeDetail`.
- **Modify** mount sites: `features/council/member-detail.tsx`, `lib/agent/renderers/criteria-result.tsx` (`CriterionDetails`), `features/agent-runner/agent-runner.tsx` (+ `run-results.tsx`), `app/calls/[threadId].tsx`.
- **Create** `scripts/buildforest-check.mjs` — feeds the real thread's captured tree to `buildForest` and asserts the forest.
- **Modify** `CLAUDE.md`, `ROADMAP.md`.

---

## Task 1: Data layer — schema, gather, and forest reconstruction

**Files:** Modify `src/lib/agent/schemas.ts`; Create `src/lib/agent/subagent-tree.ts`; Create `scripts/buildforest-check.mjs`.

**Interfaces produced:**
- `zTreeNode`, `TreeNode` (schemas.ts).
- `collectSubagentTree(values: Record<string, unknown> | undefined): TreeNode[]`
- `buildForest(nodes: TreeNode[]): TreeRow[]` where `TreeRow = { id: string; name: string; kind: string; status?: string; tool_summary?: ToolSummary; has_detail?: boolean; synthetic: boolean; children: TreeRow[] }`.

- [ ] **Step 1: Add `zTreeNode` to `schemas.ts`** (mirror `zToolRun`):

```ts
export const zTreeNode = z.looseObject({
  id: z.string(),
  parent_id: z.string().nullable().optional(),
  name: z.string().optional(),
  kind: z.string().optional(),
  status: z.string().optional(),
  tool_summary: z.looseObject({
    count: z.number().optional(), tools: z.array(z.string()).optional(),
    ok: z.number().optional(), failed: z.number().optional(), cached: z.number().optional(),
  }).optional(),
  output_preview: z.string().nullable().optional(),
  has_detail: z.boolean().optional(),
});
export type TreeNode = z.infer<typeof zTreeNode>;
```

- [ ] **Step 2: Implement `subagent-tree.ts`**

```ts
import { parseArray } from '@/lib/agent/schemas';
import { zTreeNode, type TreeNode } from '@/lib/agent/schemas';

const ROOT = '__root__';

export type TreeRow = {
  id: string;
  name: string;
  kind: string;
  status?: string;
  tool_summary?: TreeNode['tool_summary'];
  has_detail?: boolean;
  synthetic: boolean;
  children: TreeRow[];
};

/** Gather the tree channel: top-level `subagent_tree` + every criterion's homed
 *  `criterion_evaluations[i].subagent_tree` (the split `collectToolRuns` uses). */
export function collectSubagentTree(values: Record<string, unknown> | undefined): TreeNode[] {
  if (!values) return [];
  const dicts: unknown[] = [];
  const top = values.subagent_tree;
  if (top && typeof top === 'object') dicts.push(...Object.values(top));
  const evals = values.criterion_evaluations;
  if (Array.isArray(evals)) {
    for (const c of evals) {
      const t = (c as { subagent_tree?: unknown })?.subagent_tree;
      if (t && typeof t === 'object') dicts.push(...Object.values(t));
    }
  }
  return parseArray(zTreeNode, dicts, 'subagent_tree');
}

/** The `<name>` of a `<name>:<uuid>` ns segment. */
function segName(segment: string): string {
  return segment.split(':', 1)[0] || segment;
}

/** Reconstruct the forest, synthesizing intermediate ancestor nodes that never
 *  captured (they appear only as id prefixes) and tolerating dangling parents. */
export function buildForest(nodes: TreeNode[]): TreeRow[] {
  const rows = new Map<string, TreeRow>();
  const ensure = (id: string, synthetic: boolean): TreeRow => {
    let r = rows.get(id);
    if (!r) {
      const segs = id.split('|');
      r = { id, name: segName(segs[segs.length - 1]), kind: 'subgraph', synthetic, children: [] };
      rows.set(id, r);
    }
    return r;
  };
  // Real nodes first (so their fields win over a synthetic placeholder).
  for (const n of nodes) {
    const r = ensure(n.id, false);
    r.synthetic = false;
    if (n.name) r.name = n.name;
    if (n.kind) r.kind = n.kind;
    r.status = n.status;
    r.tool_summary = n.tool_summary;
    r.has_detail = n.has_detail;
  }
  // Synthesize every ancestor prefix.
  for (const id of [...rows.keys()]) {
    const segs = id.split('|');
    for (let i = 1; i < segs.length; i++) ensure(segs.slice(0, i).join('|'), true);
  }
  // Wire parent -> children by the id-minus-last-segment (NOT parent_id, which
  // may point at a stripped/rehomed ancestor); roots = single-segment ids.
  const roots: TreeRow[] = [];
  for (const r of rows.values()) {
    const segs = r.id.split('|');
    if (segs.length <= 1) { roots.push(r); continue; }
    const parentId = segs.slice(0, -1).join('|');
    (rows.get(parentId) ?? ensure(parentId, true)).children.push(r);
  }
  return roots;
}
```

- [ ] **Step 3: `tsc` + the forest check against real data**

`npx tsc --noEmit` must pass. Then create `scripts/buildforest-check.mjs`: fetch `values` for thread `019f98e1-b104-7742-a893-4b1a9a388366` through a CF-header proxy (reuse the `serve.mjs`/curl pattern from `scripts/smoke-reopen.mjs`), run the compiled `collectSubagentTree`+`buildForest` (import from `dist` after an `expo export`, OR inline a JS port), and assert: (a) non-empty forest; (b) at least one row has children (nesting); (c) every real node id from the channel appears in the flattened forest (no dropped nodes); (d) no `children` cycle. Print the forest.
Run: `CF_ACCESS_CLIENT_ID=… CF_ACCESS_CLIENT_SECRET=… node scripts/buildforest-check.mjs` → all asserts pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/agent/schemas.ts src/lib/agent/subagent-tree.ts scripts/buildforest-check.mjs
git commit -m "feat(subagent-tree): schema + collect + forest reconstruction from captured channel"
```

---

## Task 2: Lazy per-node detail fetch from the Store

**Files:** Create `src/features/agent-shared/use-subagent-detail.ts`.

**Interfaces:** `useSubagentDetail(threadId: string | undefined, nodeId: string, enabled: boolean): { data?: {messages?: unknown[]; tool_runs?: unknown[]; output?: unknown}; isPending: boolean }`.

- [ ] **Step 1: Implement** (mirror `tool-cache.tsx`'s `useQuery` + `makeClient`)

```ts
import { useQuery } from '@tanstack/react-query';
import { makeClient } from '@/lib/agent/client';
import { getSettings } from '@/lib/settings/store';

export function useSubagentDetail(threadId: string | undefined, nodeId: string, enabled: boolean) {
  const q = useQuery({
    queryKey: ['subagent-detail', threadId, nodeId],
    enabled: enabled && !!threadId,
    staleTime: Infinity,
    queryFn: async () => {
      const client = makeClient(getSettings());
      const item = await client.store.getItem(['subagent_detail', threadId as string], nodeId);
      return (item?.value ?? null) as { messages?: unknown[]; tool_runs?: unknown[]; output?: unknown } | null;
    },
  });
  return { data: q.data ?? undefined, isPending: q.isPending && enabled };
}
```

- [ ] **Step 2: `tsc` + commit**

```bash
npx tsc --noEmit
git add src/features/agent-shared/use-subagent-detail.ts
git commit -m "feat(subagent-tree): lazy per-node detail fetch from the Store"
```

---

## Task 3: Recursive `SubagentTree` + `NodeDetail`

**Files:** Create `src/features/agent-shared/subagent-tree.tsx`.

**Interfaces:** `SubagentTree({ rows, threadId }: { rows: TreeRow[]; threadId?: string })`.

- [ ] **Step 1: Implement** — reuse the existing `SubagentActivity` row look by mapping each `TreeRow` to a `SubagentRun` whose `renderDetail` renders `NodeDetail` (lazy Store fetch → transcript/output/tools) **plus** a nested `SubagentActivity` of the row's children.

```tsx
import { View } from 'react-native';
import { SubagentActivity } from './subagent-activity';
import { NodeDetail } from './node-detail'; // or inline below
import type { SubagentRun } from './conversation-turns';
import type { TreeRow } from '@/lib/agent/subagent-tree';

function toRuns(rows: TreeRow[], threadId?: string): SubagentRun[] {
  return rows.map((row) => ({
    name: row.name,
    status: row.status === 'error' ? 'error' : 'complete',
    // one-line preview via existing runPreview shape; SubagentActivity shows it
    stateValues: row.tool_summary ? { tools: row.tool_summary.count } : undefined,
    renderDetail: () => (
      <View className="gap-3">
        <NodeDetail threadId={threadId} nodeId={row.id} hasDetail={row.has_detail} synthetic={row.synthetic} />
        {row.children.length > 0 ? <SubagentActivity runs={toRuns(row.children, threadId)} /> : null}
      </View>
    ),
  }));
}

export function SubagentTree({ rows, threadId }: { rows: TreeRow[]; threadId?: string }) {
  if (rows.length === 0) return null;
  return <SubagentActivity runs={toRuns(rows, threadId)} />;
}
```

`NodeDetail` (same file or `node-detail.tsx`): calls `useSubagentDetail(threadId, nodeId, enabled=true)` (mounted only when the row is expanded, so the fetch is lazy), renders a skeleton while pending, then — reusing the existing renderers — `Conversation`/Steps from `messages` (via `coerceMessages`), `StructuredOutput` from `output`, `ToolRunsPanel mode="flat"` from `tool_runs`; on a null result (synthetic node or Store miss) render nothing (synthetic) or a muted "No detail recorded". Extract the shared body from `SubgraphDetail` if it eases reuse, but do not change `SubgraphDetail`'s live behavior.

- [ ] **Step 2: `tsc` + a quick `expo export`** (compile check of the RN tree), commit.

```bash
npx tsc --noEmit && npx expo export -p web --output-dir dist >/dev/null
git add src/features/agent-shared/subagent-tree.tsx src/features/agent-shared/node-detail.tsx
git commit -m "feat(subagent-tree): recursive SubagentTree + lazy NodeDetail"
```

---

## Task 4: Mount the tree (augment) across surfaces

**Files:** `features/council/member-detail.tsx`, `lib/agent/renderers/criteria-result.tsx`, `features/agent-runner/agent-runner.tsx` (+ `run-results.tsx`), `app/calls/[threadId].tsx`.

- [ ] **Step 1: Runner + calls (top-level tree)** — where `SubagentActivity`/`subagentRuns` renders today, additionally compute `const tree = buildForest(collectSubagentTree(values))` and, when `tree.length > 0`, render `<SubagentTree rows={tree} threadId={threadId} />` INSTEAD of the flat panel (keep the flat `SubagentActivity` as the fallback when the tree is empty — old runs).

- [ ] **Step 2: Council member-detail** — compute the whole run's forest once (in `council-screen.tsx`, pass down), and in `MemberDetail` render the selected persona's subtree: find the root row whose `name`/id segment matches the persona slug (`<persona>:<uuid>`), render `<SubagentTree rows={[thatRow]} threadId />` under the existing evidence/"Data collected". If no matching row (old run), render nothing (existing UI unchanged).

- [ ] **Step 3: Criteria `CriterionDetails`** — the criterion's nodes are in `criterion_evaluations[i].subagent_tree`; build that criterion's forest (`buildForest(collectSubagentTree({ subagent_tree: c.subagent_tree }))`) and render `<SubagentTree>` under the existing criterion detail.

- [ ] **Step 4: `tsc` + `expo export` + commit**

```bash
npx tsc --noEmit && npx expo export -p web --output-dir dist >/dev/null
git add -A && git commit -m "feat(subagent-tree): mount recursive tree (augment) on council/criteria/runner/calls"
```

---

## Task 5: Verify end-to-end (headless drill-down smoke) + docs

- [ ] **Step 1: Headless smoke against the real thread**

Adapt `scripts/smoke-reopen.mjs` into `scripts/smoke-subagent-tree.mjs`: dist + `/api` proxy (CF headers), navigate to the criteria run `/agents/criteria_analysis?threadId=019f98e1-b104-7742-a893-4b1a9a388366`, wait for content, then drive the drill-down (find a criterion, expand it, assert a child sub-agent row appears; expand that, assert its detail/loading appears — via `page.getByText`/DOM query), screenshot, assert zero Reanimated/worklet errors (whitelist React #418). Also verify no console errors from the Store fetch.
Run it (CF creds via env). Expected: PASS + a screenshot showing the nested tree.

- [ ] **Step 2: Docs + memory**

Update `CLAUDE.md` (renderers/subagents-panel section: `SubagentTree` + `collectSubagentTree` incl. criteria homing + `useSubagentDetail` Store fetch + `buildForest` reconstruction + the augment mount rule) and `ROADMAP.md`. Update the `muffin-ui-subagents-panel-discovery` memory (panel now reflects real captured topology at any depth).

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test+docs(subagent-tree): headless drill-down smoke + docs"
```

---

## Self-Review

**Spec coverage:** data layer incl. criteria homing + synthetic ancestors (Task 1) ✓; lazy Store detail (Task 2) ✓; recursive UI reusing SubagentActivity, SubgraphDetail-level detail (Task 3) ✓; augment mounts across all surfaces (Task 4) ✓; fallback to today's UI when tree empty (Task 4 Steps 1–3) ✓; verification against a real thread (Task 5) ✓; docs+memory (Task 5) ✓.

**Placeholder scan:** concrete code for the novel pieces; the mount edits are described against named files/components (the exact insertion point is read-then-edit, not a placeholder). `buildForest` uses id-segment parentage (not `parent_id`) deliberately — the id encodes the true tree, `parent_id` may point at a rehomed/stripped ancestor.

**Type consistency:** `TreeNode`/`TreeRow`/`collectSubagentTree`/`buildForest`/`useSubagentDetail`/`SubagentTree` signatures are consistent across tasks; `SubagentRun` reuse matches `conversation-turns.ts`.

**Open risk:** the exact real names/ids land from validation thread `019f98e1-…`; if `buildForest`'s id-segment assumption is off (e.g. criteria homing stores a re-keyed id), Task 1 Step 3's forest check catches it before any UI is built.
