/**
 * Shared node model for the generic "Execution Tree" view (Level-0 plan +
 * drill-down). Pure data — no rendering here. Every run surface assembles an
 * `ExecNode[]` (via `buildExecTree`, `plan-steps.ts`) and hands it to the
 * (future) tree component; each node's expanded body renders the same four
 * facets (Result / Steps / Sub-agents / Tools) regardless of depth.
 */
import type { IconName } from '@/components/icons';
import type { ToolRun } from '@/lib/agent/renderers';

export type ExecStatus = 'done' | 'active' | 'pending' | 'error';

export type ExecNode = {
  id: string;
  label: string;
  icon?: IconName;
  status?: ExecStatus;
  /** `stage` = a Level-0 plan step (registry stage or deep-agent todo);
   * `agent` = a real captured `subagent_tree` node; `synthetic` = an
   * intermediate level `buildForest` synthesized because the backend never
   * writes it as its own node. */
  kind: 'stage' | 'agent' | 'synthetic';
  /** `subagent_tree` node id to resolve via `useSubagentDetail` for this
   * node's lazy heavy detail (messages/tool_runs/output). Undefined for
   * synthetic placeholders (no real node to fetch) and for stages with no
   * captured node of their own. */
  detailNodeId?: string;
  /** Eager structured output already present in streamed `values`
   * (`stageOutput(stage, values)` for a stage node, a criterion/persona
   * evaluation for an agent node, …) — shown before/without the lazy detail
   * fetch. */
  output?: unknown;
  /** Eager per-node tool-execution records already present in streamed
   * `values` (`collectToolRuns`), scoped to this node. */
  toolRuns?: ToolRun[];
  /** One-line summary (e.g. "3 tools · 1 failed") shown collapsed. */
  summary?: string;
  children: ExecNode[];
};
