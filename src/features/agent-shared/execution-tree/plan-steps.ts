/**
 * Assembles the Level-0 `ExecNode[]` plan for the Execution Tree — "plan-first
 * hybrid": prefer the agent's registered recipe (`AgentDef.stages`) or a deep agent's
 * `todos` plan, joined to the REAL topology so each plan step drills into what actually
 * ran under it. Agents with neither render the topology directly.
 *
 * `topology` is the run's root namespace read from LangGraph's checkpoints
 * (`useRunTreeRoot`) — it is passed in rather than derived here so this stays a pure
 * function, directly exercised by `scripts/exectree-check.ts`.
 *
 * The node model itself lives in `@/lib/agent/exec-tree`.
 */
import { stageOutput } from '@/lib/agent/registry';
import type { AgentDef, StageDef } from '@/lib/agent/registry';
import { childrenForStage, type ExecNode } from '@/lib/agent/exec-tree';
import { isTodoList } from '@/lib/agent/renderers';
import { taskWrite } from '@/lib/agent/run-history';
import { parseOr, zCriterionEvaluation } from '@/lib/agent/schemas';
import { resolveStages, type ByNode } from '../run-progress';

/**
 * Name the criteria fan-out's workers.
 *
 * The raw topology gives N indistinguishable `criterion_evaluation` rows — every
 * worker is the same graph node. Each task's `result` carries the channel it wrote,
 * so the criterion's own name is available from the ROOT history, without fetching
 * each worker's namespace.
 *
 * Deliberately not paired by index against `values.criterion_evaluations`: these are
 * parallel `Send` workers, so completion order is not task order and the labels would
 * silently drift onto the wrong rows.
 */
function nameCriterionWorkers(nodes: ExecNode[]): ExecNode[] {
  return nodes.map((node, i) => {
    if (node.name !== 'criterion_evaluation') return node;
    const written = taskWrite(node.output, 'criterion_evaluations');
    const evaluation = parseOr(zCriterionEvaluation, written, 'exec.criterion');
    return {
      ...node,
      label: evaluation?.criterion_name ?? `Criterion ${i + 1}`,
      output: evaluation ?? node.output,
      outputKind: 'criterion' as const,
      summary: evaluation?.signal ? String(evaluation.signal) : node.summary,
    };
  });
}

export function buildExecTree(
  agent: AgentDef,
  values: Record<string, unknown>,
  busy: boolean,
  topology: ExecNode[],
  byNode?: ByNode,
): ExecNode[] {
  if (agent.stages?.length) {
    return resolveStages(agent.stages, values, busy, byNode).map((row): ExecNode => {
      const stage: StageDef = row.stage;
      return {
        id: `stage:${stage.key}`,
        label: stage.label,
        icon: stage.icon,
        kind: 'stage',
        status: row.status,
        output: stageOutput(stage, values),
        outputKind: stage.outputKind,
        children: nameCriterionWorkers(childrenForStage(stage, topology)),
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
    return [...todoNodes, ...topology];
  }

  return nameCriterionWorkers(topology);
}
