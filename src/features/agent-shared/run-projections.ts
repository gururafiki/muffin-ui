import { useChannel, type Event } from '@langchain/react';
import { useMemo } from 'react';

import { stageOutput, type AgentDef, type StageDef, type StageDetail } from '@/lib/agent/registry';
import {
  parseArray,
  parseOr,
  zCriterionEvaluation,
  zCriterionEvent,
  zToolRun,
  type CriterionEvaluation,
  type ToolRun,
} from '@/lib/agent/schemas';
import type { AnyStream, RunStream } from '@/lib/agent/stream-types';
import { titleCase } from '@/lib/format';

type Dict = Record<string, unknown>;

/**
 * Fold the run's `custom`-channel events (backend `get_stream_writer()`) into
 * the per-criterion evaluations that have finished so far. The criteria graph
 * emits `{type: "criterion_evaluated", evaluation}` from each Send worker's
 * package node — the ONLY live per-criterion signal, because all parallel
 * workers commit in one parent superstep (root `values` only shows the full
 * scorecard at the barrier).
 */
export function useCriterionEvents(stream: AnyStream): {
  /** evaluation by criterion_name, in arrival order. */
  byName: Map<string, CriterionEvaluation>;
  /** evaluation by the worker's first namespace segment (`<node>:<task-id>`). */
  byNamespace: Map<string, CriterionEvaluation>;
} {
  const events = useChannel(stream, ['custom']);
  return useMemo(() => {
    const byName = new Map<string, CriterionEvaluation>();
    const byNamespace = new Map<string, CriterionEvaluation>();
    for (const ev of events as Event[]) {
      if (ev.method !== 'custom') continue;
      const payload: unknown = ev.params.data?.payload;
      if ((payload as { type?: unknown } | undefined)?.type !== 'criterion_evaluated') continue;
      const parsed = parseOr(zCriterionEvent, payload, 'criterion_evaluated event');
      if (!parsed) continue;
      const { evaluation } = parsed;
      if (evaluation.criterion_name) byName.set(evaluation.criterion_name, evaluation);
      const ns = ev.params.namespace?.[0];
      if (ns) byNamespace.set(ns, evaluation);
    }
    return { byName, byNamespace };
  }, [events]);
}

/**
 * The values view the run-view renderers read: root `values` (authoritative)
 * with `criterion_evaluations` unioned with live custom-event evaluations, so
 * criteria rows appear one-by-one mid-run and are superseded by the identical
 * checkpoint-backed list at the superstep barrier.
 */
export function mergeLiveEvaluations(
  values: Dict | undefined,
  byName: Map<string, CriterionEvaluation>,
): Dict {
  const v = values ?? {};
  if (byName.size === 0) return v;
  const root = Array.isArray(v.criterion_evaluations) ? (v.criterion_evaluations as Dict[]) : [];
  const seen = new Set(root.map((e) => e?.criterion_name).filter(Boolean));
  const extra = [...byName.values()].filter((e) => !seen.has(e.criterion_name));
  if (extra.length === 0 && root.length > 0) return v;
  return { ...v, criterion_evaluations: [...root, ...extra] };
}

export type SubgraphRow = {
  key: string;
  /** Human row label (registry stage label / criterion name / node name). */
  label: string;
  status: 'running' | 'complete' | 'error';
  namespace: readonly string[];
  nodeName: string;
  /** The finished worker's evaluation payload (criteria workers only). */
  evaluation?: CriterionEvaluation;
  /**
   * History fallback: the stage's persisted structured output (registry
   * `StageDef.output` → values). Completed threads have no replayable event
   * stream, so this is what the expanded row shows instead of the live
   * scoped transcript.
   */
  output?: unknown;
  /** History fallback: persisted `tool_runs` records attributed to this node. */
  toolRuns?: ToolRun[];
  /** Bespoke expanded-detail renderer id (registry `StageDef.detail`). */
  detail?: StageDetail;
};

/**
 * Rows for the sub-agents panel, straight from protocol-v2 subgraph discovery:
 * one row per compiled-agent node invocation (criteria stages, Send workers,
 * council personas, trading analysts) with a LIVE status — replaces the
 * checkpoint-history walk (`use-subagent-runs.ts`) entirely.
 */
export function useSubgraphRows(agent: AgentDef, stream: RunStream): SubgraphRow[] {
  const { byNamespace, byName } = useCriterionEvents(stream);
  const byNode = stream.subgraphsByNode;
  const values = stream.values;

  return useMemo(() => {
    const stages = agent.stages ?? [];
    // Stage for a discovered node: exact `node` match first, then the
    // `active` regex fallback (same resolution RunProgress uses).
    const stageFor = (node: string): StageDef | undefined =>
      stages.find((s) => s.node === node) ?? stages.find((s) => s.active?.test(node));
    const persistedRuns = parseArray(zToolRun, values?.tool_runs, 'values.tool_runs');

    // Evaluations by name — labels finished workers even after a refresh,
    // when custom events are gone but values carry the full scorecard.
    const evals = new Map<string, CriterionEvaluation>(byName);
    for (const e of parseArray(zCriterionEvaluation, values?.criterion_evaluations, 'values.criterion_evaluations')) {
      if (e.criterion_name) evals.set(e.criterion_name, e);
    }
    const unclaimed = [...evals.values()];

    const rows: SubgraphRow[] = [];
    for (const [node, snaps] of byNode) {
      const stage = stageFor(node);
      // History detail for the node's rows: its stage's persisted output +
      // the run-level tool records the backend attributed to this agent. The
      // council members' inner collect agents are named `<node>_data_collection`.
      const output = stage ? stageOutput(stage, values) : undefined;
      const toolRuns = persistedRuns.filter(
        (r) => r.agent === node || r.agent === `${node}_data_collection`,
      );
      snaps.forEach((snap, i) => {
        let label = stage?.node === node ? stage.label : titleCase(node);
        let evaluation: CriterionEvaluation | undefined;
        if (node === 'criterion_evaluation') {
          evaluation = byNamespace.get(snap.namespace[0] ?? '');
          if (evaluation) {
            const idx = unclaimed.indexOf(evaluation);
            if (idx >= 0) unclaimed.splice(idx, 1);
          } else if (snap.status === 'complete') {
            // Refresh case: events gone; hand out finished evaluations in order.
            evaluation = unclaimed.shift();
          }
          const name = evaluation?.criterion_name;
          label = name ? `Criterion — ${name}` : `Criterion ${i + 1} — evaluating…`;
        }
        rows.push({
          key: snap.id,
          label,
          status: snap.status,
          namespace: snap.namespace,
          nodeName: snap.nodeName,
          evaluation,
          output,
          toolRuns: toolRuns.length > 0 ? toolRuns : undefined,
          detail: stage?.detail,
        });
      });
    }
    // Historical threads: evaluations with no discovered worker (the event
    // buffer is gone and discovery seeding may be empty) still get a row —
    // the panel's per-criterion detail must not depend on live discovery.
    for (const evaluation of unclaimed) {
      const name = evaluation.criterion_name;
      rows.push({
        key: `eval:${name ?? rows.length}`,
        label: name ? `Criterion — ${name}` : 'Criterion',
        status: 'complete',
        namespace: [],
        nodeName: 'criterion_evaluation',
        evaluation,
      });
    }
    return rows;
  }, [agent.stages, byNode, byNamespace, byName, values]);
}
