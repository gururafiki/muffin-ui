/**
 * Pure assembly of the Level-0 `ExecNode[]` plan for the Execution Tree view —
 * "plan-first hybrid": prefer the agent's registered execution recipe
 * (`AgentDef.stages`) or a deep agent's `todos` plan, joined to the REAL
 * captured topology (`subagent_tree` -> `buildForest`) so each plan step can
 * drill into what actually ran under it. Agents with neither (todo-less,
 * stage-less) fall back to the raw topology.
 *
 * No rendering here — this only builds the `ExecNode` tree; see
 * `execution-tree.tsx` (a later task) for the component that walks it.
 */
import type { AgentDef, StageDef } from '@/lib/agent/registry';
import { stageOutput } from '@/lib/agent/registry';
import { collectToolRuns, isTodoList } from '@/lib/agent/renderers';
import { buildForest, collectSubagentTree, type TreeRow } from '@/lib/agent/subagent-tree';
import { titleCase } from '@/lib/format';
import { resolveStages, type ByNode } from '../run-progress';
import type { ExecNode } from './types';

/**
 * Map one `buildForest` row (a real captured `subagent_tree` node, or a
 * synthesized intermediate level) to an `ExecNode`, recursing into children.
 * `detailNodeId` is only set for real nodes — a synthetic placeholder has no
 * captured detail of its own (its real children carry it).
 */
export function treeRowToExecNode(row: TreeRow): ExecNode {
  const ts = row.tool_summary;
  const summary =
    ts && (ts.count ?? 0) > 0
      ? `${ts.count} tool${ts.count === 1 ? '' : 's'}${ts.failed ? ` · ${ts.failed} failed` : ''}`
      : undefined;
  return {
    id: row.id,
    label: titleCase(row.name),
    status: row.status === 'error' ? 'error' : 'done',
    kind: row.synthetic ? 'synthetic' : 'agent',
    detailNodeId: row.synthetic ? undefined : row.id,
    summary,
    children: row.children.map(treeRowToExecNode),
  };
}

/** Forest roots belonging to a stage: exact `node` match wins, else `active`
 * regex — same precedence as `stageSnaps` (`run-progress.tsx`) so a step's
 * plan status and its drilldown children agree on which real nodes are
 * "its own". Grouped by leading segment name (NOT a 1:1 map) because a
 * Send-fan-out stage (e.g. criteria "Evaluate") has many top-level roots
 * that all share the same leading name (`criterion_evaluation:<uuid1>`,
 * `criterion_evaluation:<uuid2>`, …). */
function childrenForStage(stage: StageDef, rootsByName: ReadonlyMap<string, TreeRow[]>): TreeRow[] {
  if (stage.node) return rootsByName.get(stage.node) ?? [];
  if (!stage.active) return [];
  const out: TreeRow[] = [];
  for (const [name, roots] of rootsByName) if (stage.active.test(name)) out.push(...roots);
  return out;
}

/**
 * Assemble the Level-0 execution-tree plan for one run:
 * 1. Graph agents (`AgentDef.stages`) — one `ExecNode` per registry stage,
 *    joined to its real topology children.
 * 2. Deep agents (no `stages`, but a `todos` plan) — one `ExecNode` per todo,
 *    with the forest roots appended as top-level agent nodes (deep-agent task
 *    sub-agents have no stage to nest under).
 * 3. Fallback (neither) — the raw topology forest, unchanged.
 */
export function buildExecTree(
  agent: AgentDef,
  values: Record<string, unknown>,
  busy: boolean,
  byNode?: ByNode,
): ExecNode[] {
  const forest = buildForest(collectSubagentTree(values));
  const rootsByName = new Map<string, TreeRow[]>();
  for (const root of forest) {
    const name = root.id.split(':')[0];
    const bucket = rootsByName.get(name);
    if (bucket) bucket.push(root);
    else rootsByName.set(name, [root]);
  }

  if (agent.stages?.length) {
    const toolRunsAll = collectToolRuns(values);
    return resolveStages(agent.stages, values, busy, byNode).map((row): ExecNode => {
      const { stage } = row;
      const toolRuns = stage.node
        ? toolRunsAll.filter((r) => r.agent === stage.node || r.agent === `${stage.node}_data_collection`)
        : [];
      return {
        id: `stage:${stage.key}`,
        label: stage.label,
        icon: stage.icon,
        kind: 'stage',
        status: row.status,
        output: stageOutput(stage, values),
        toolRuns: toolRuns.length > 0 ? toolRuns : undefined,
        children: childrenForStage(stage, rootsByName).map(treeRowToExecNode),
      };
    });
  }

  const todos = (values as { todos?: unknown }).todos;
  if (isTodoList(todos)) {
    const todoNodes: ExecNode[] = todos.map((todo, i) => ({
      id: `todo:${i}`,
      label: todo.content ?? todo.activeForm ?? `Step ${i + 1}`,
      kind: 'stage',
      status: todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'active' : 'pending',
      children: [],
    }));
    return [...todoNodes, ...forest.map(treeRowToExecNode)];
  }

  return forest.map(treeRowToExecNode);
}
