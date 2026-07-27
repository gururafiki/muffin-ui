/**
 * Assembles the Level-0 `ExecNode[]` plan for the Execution Tree — "plan-first
 * hybrid": prefer the agent's registered recipe (`AgentDef.stages`) or a deep agent's
 * `todos` plan, joined to the REAL captured topology (`buildTopology`) so each plan
 * step drills into what actually ran under it. Agents with neither fall back to the
 * raw topology.
 *
 * The node model itself lives in `@/lib/agent/exec-tree` (pure, React-free, directly
 * exercised by `scripts/exectree-check.ts`); this file only does the registry join.
 */
import { stageOutput } from '@/lib/agent/registry';
import type { AgentDef, StageDef } from '@/lib/agent/registry';
import {
  buildTopology,
  childrenForStage,
  collectTopology,
  rootsByName,
  toolRunsForStage,
  type ExecNode,
} from '@/lib/agent/exec-tree';
import { collectToolRuns, isTodoList } from '@/lib/agent/renderers';
import { parseOr, zCriterionEvaluation } from '@/lib/agent/schemas';
import { resolveStages, type ByNode } from '../run-progress';

/**
 * Children of the criteria "Evaluate each criterion" fan-out: one node per
 * `criterion_evaluations[i]`, NAMED by its criterion (the raw topology gives N
 * indistinguishable "Criterion evaluation" rows), with the evaluation as eager
 * output so the card renders without a detail fetch.
 */
function criterionChildren(values: Record<string, unknown>): ExecNode[] | undefined {
  const raw = values.criterion_evaluations;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((entry, i): ExecNode => {
    const c = parseOr(zCriterionEvaluation, entry, 'exec.criterion');
    // Each entry re-homes its own topology under itself.
    const worker = buildTopology(collectTopology({ criterion_evaluations: [entry] }))[0];
    return {
      id: `criterion:${i}`,
      label: c?.criterion_name ?? `Criterion ${i + 1}`,
      kind: 'agent',
      status: 'done',
      output: c ?? entry,
      outputKind: 'criterion',
      detailNodeId: worker?.kind === 'agent' ? worker.id : undefined,
      toolRuns: c?.tool_runs,
      summary: c?.signal ? String(c.signal) : undefined,
      children: worker?.children ?? [],
    };
  });
}

export function buildExecTree(
  agent: AgentDef,
  values: Record<string, unknown>,
  busy: boolean,
  byNode?: ByNode,
): ExecNode[] {
  const forest = buildTopology(collectTopology(values));
  const byName = rootsByName(forest);

  if (agent.stages?.length) {
    const allRuns = collectToolRuns(values);
    return resolveStages(agent.stages, values, busy, byNode).map((row): ExecNode => {
      const stage: StageDef = row.stage;
      const children =
        (stage.node === 'criterion_evaluation' ? criterionChildren(values) : undefined) ??
        childrenForStage(stage, byName);
      // Tool runs use the same node-then-active precedence as children and status.
      const toolRuns = toolRunsForStage(stage, allRuns);
      return {
        id: `stage:${stage.key}`,
        label: stage.label,
        icon: stage.icon,
        kind: 'stage',
        status: row.status,
        output: stageOutput(stage, values),
        outputKind: stage.outputKind,
        toolRuns: toolRuns.length > 0 ? toolRuns : undefined,
        children,
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
    return [...todoNodes, ...forest];
  }

  return forest;
}
