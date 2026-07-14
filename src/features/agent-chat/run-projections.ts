import type { SubgraphDiscoverySnapshot } from '@langchain/langgraph-sdk/stream';
import { useChannel } from '@langchain/react';
import { useMemo } from 'react';

import { stageOutput, type AgentDef, type StageDef, type StageDetail } from '@/lib/agent/registry';
import type { ToolRun } from '@/lib/agent/renderers';

type Dict = Record<string, unknown>;

/** The shape `useRunStream` returns for `stream` — only what we read here. */
export type RunStreamLike = {
  values: Dict;
  isLoading: boolean;
  subgraphsByNode: ReadonlyMap<string, readonly SubgraphDiscoverySnapshot[]>;
};

/**
 * Fold the run's `custom`-channel events (backend `get_stream_writer()`) into
 * the per-criterion evaluations that have finished so far. The criteria graph
 * emits `{type: "criterion_evaluated", evaluation}` from each Send worker's
 * package node — the ONLY live per-criterion signal, because all parallel
 * workers commit in one parent superstep (root `values` only shows the full
 * scorecard at the barrier).
 */
export function useCriterionEvents(stream: unknown): {
  /** evaluation by criterion_name, in arrival order. */
  byName: Map<string, Dict>;
  /** evaluation by the worker's first namespace segment (`<node>:<task-id>`). */
  byNamespace: Map<string, Dict>;
} {
  const events = useChannel(stream as never, ['custom']);
  return useMemo(() => {
    const byName = new Map<string, Dict>();
    const byNamespace = new Map<string, Dict>();
    for (const ev of events as { params?: { namespace?: string[]; data?: { payload?: unknown } } }[]) {
      const payload = ev?.params?.data?.payload as { type?: string; evaluation?: Dict } | undefined;
      if (payload?.type !== 'criterion_evaluated' || !payload.evaluation) continue;
      const name = payload.evaluation.criterion_name;
      if (typeof name === 'string' && name) byName.set(name, payload.evaluation);
      const ns = ev.params?.namespace?.[0];
      if (ns) byNamespace.set(ns, payload.evaluation);
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
export function mergeLiveEvaluations(values: Dict | undefined, byName: Map<string, Dict>): Dict {
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
  evaluation?: Dict;
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

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Rows for the sub-agents panel, straight from protocol-v2 subgraph discovery:
 * one row per compiled-agent node invocation (criteria stages, Send workers,
 * council personas, trading analysts) with a LIVE status — replaces the
 * checkpoint-history walk (`use-subagent-runs.ts`) entirely.
 */
export function useSubgraphRows(agent: AgentDef, stream: RunStreamLike): SubgraphRow[] {
  const { byNamespace, byName } = useCriterionEvents(stream);
  const byNode = stream.subgraphsByNode;
  const values = stream.values;

  return useMemo(() => {
    const stages = agent.stages ?? [];
    // Stage for a discovered node: exact `node` match first, then the
    // `active` regex fallback (same resolution RunProgress uses).
    const stageFor = (node: string): StageDef | undefined =>
      stages.find((s) => s.node === node) ?? stages.find((s) => s.active?.test(node));
    const persistedRuns = Array.isArray(values?.tool_runs) ? (values.tool_runs as ToolRun[]) : [];

    // Evaluations by name — labels finished workers even after a refresh,
    // when custom events are gone but values carry the full scorecard.
    const evals = new Map<string, Dict>(byName);
    if (Array.isArray(values?.criterion_evaluations)) {
      for (const e of values.criterion_evaluations as Dict[]) {
        if (typeof e?.criterion_name === 'string') evals.set(e.criterion_name, e);
      }
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
        let evaluation: Dict | undefined;
        if (node === 'criterion_evaluation') {
          evaluation = byNamespace.get(snap.namespace[0] ?? '');
          if (evaluation) {
            const idx = unclaimed.indexOf(evaluation);
            if (idx >= 0) unclaimed.splice(idx, 1);
          } else if (snap.status === 'complete') {
            // Refresh case: events gone; hand out finished evaluations in order.
            evaluation = unclaimed.shift();
          }
          const name = typeof evaluation?.criterion_name === 'string' ? evaluation.criterion_name : undefined;
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
      const name = typeof evaluation.criterion_name === 'string' ? evaluation.criterion_name : undefined;
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
