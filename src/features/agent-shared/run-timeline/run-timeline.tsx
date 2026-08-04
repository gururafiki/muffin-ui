/**
 * The Timeline view: a run's whole shape, derived entirely from the LangGraph API.
 *
 * Three sources compose here, and none of them is a per-graph table:
 *
 * - `POST /threads/{id}/history` — the supersteps that ran, which nodes shared each one
 *   (that is the parallel/sequential distinction), how long each took, and what runs next.
 * - `GET /assistants/{id}/graph` — the compiled DAG, so steps that have NOT run yet are
 *   listed in order rather than appearing one at a time out of nowhere.
 * - `stream.subgraphs` / `stream.subagents` — live status and wall-clock while running.
 *
 * A graph registered next month renders correctly with no change here. The previous
 * version preferred a hand-written `AgentDef.stages` recipe per agent, so an
 * unregistered graph fell back to an unlabelled topology dump.
 */
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Skeleton, SpineRow, Text } from '@/components/ui';
import { palette } from '@/theme/colors';
import { pendingNodes, planFromGraph, useAssistantGraph } from '@/lib/agent/run-graph';
import { formatDuration, type Lane, type RunNode } from '@/lib/agent/run-node';
import { LaneList, NodeRow, useLiveOverlay, type TimelineCtx } from './run-card';
import { useRunTimeline } from './use-run-timeline';

const EMPTY_LANES: Lane[] = [];

/** The longest step in the run — the scale every duration bar is drawn against. */
function longest(lanes: Lane[]): number {
  let max = 0;
  for (const lane of lanes) {
    max = Math.max(max, lane.durationMs ?? 0);
    for (const node of lane.nodes) max = Math.max(max, node.durationMs ?? 0);
  }
  return max;
}

/**
 * The run's shape while history loads — **the real steps, from the graph**.
 *
 * `GET /assistants/{id}/graph` already tells us which nodes this graph declares, and the
 * loaded view already renders un-reached steps as `pending` rows. So the skeleton is those
 * same rows, through the same `SpineRow`/`NodeRow` components: right count, right labels,
 * right icons, and the same 26px gutter — which means history landing turns pending rows
 * into real ones instead of replacing a differently-shaped placeholder.
 *
 * It is generic by construction, not by discipline: everything comes from `planFromGraph`,
 * which humanises any node id and filters internal ones, so a graph written next month works
 * with no change here. Deriving this from `AgentDef.stages` instead would reintroduce exactly
 * the per-graph knowledge this view was built to avoid.
 *
 * The anonymous bars remain for the one case with nothing to derive from: the graph query
 * itself still in flight. That is brief and usually skipped entirely, since `useAssistantGraph`
 * is cached per `graphId`.
 *
 * KNOWN LIMIT: the graph gives node names and order, not superstep grouping — parallelism is
 * only knowable from history. So this lists steps flat, and some rows regroup into bracketed
 * fans when history arrives. Far less movement than three unlabelled bars, but not zero.
 */
function RunTimelineSkeleton({ pending, ctx }: { pending: RunNode[]; ctx: TimelineCtx }) {
  return (
    <View className="gap-2.5">
      <View className="flex-row items-center gap-2">
        <ActivityIndicator size="small" color={palette.frosting[400]} />
        <Text variant="muted" className="text-xs">
          Reading this run…
        </Text>
      </View>
      {pending.length > 0 ? (
        <View>
          {pending.map((node, i) => (
            <SpineRow key={node.id} status="pending" last={i === pending.length - 1}>
              <NodeRow node={node} ctx={ctx} />
            </SpineRow>
          ))}
        </View>
      ) : (
        [0, 1, 2].map((i) => (
          <View key={i} className="flex-row items-center gap-3">
            <Skeleton className="h-[18px] w-[18px] rounded-pill" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-3 w-12" />
          </View>
        ))
      )}
    </View>
  );
}

/**
 * Counts up to `value` over ~500ms, so the run summary lands with a little life instead
 * of snapping into place. Driven by an interval rather than a Reanimated shared value
 * because the number itself is rendered text, not a style.
 *
 * `progress` only ever moves from the interval callback — an external clock, never a
 * synchronous write in the effect body — which is the same shape as `useElapsedLabel`
 * (`run-progress.tsx`) and what keeps React-Compiler purity rules satisfied.
 */
function useCountUp(value: number, enabled: boolean): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / 500);
      setProgress(p);
      if (p >= 1) clearInterval(id);
    }, 40);
    return () => clearInterval(id);
  }, [enabled]);
  return enabled ? Math.round(value * progress) : value;
}

/** One line of honest run-level accounting above the spine. */
function TimelineSummary({
  lanes,
  pending,
  busy,
  animate,
}: {
  lanes: Lane[];
  pending: RunNode[];
  busy: boolean;
  animate: boolean;
}) {
  const nodes = lanes.flatMap((l) => l.nodes);
  const failed = nodes.filter((n) => n.status === 'error').length;
  const fans = lanes.filter((l) => l.parallel).length;
  const total = lanes.reduce((sum, l) => sum + (l.durationMs ?? 0), 0);
  const steps = useCountUp(nodes.length, animate);

  const parts = [
    `${steps} step${steps === 1 ? '' : 's'}`,
    fans > 0 ? `${fans} parallel` : undefined,
    pending.length > 0 && busy ? `${pending.length} to go` : undefined,
    failed > 0 ? `${failed} failed` : undefined,
    total > 0 ? formatDuration(total) : undefined,
  ].filter(Boolean);

  return (
    <Text variant="muted" className="text-xs tabular-nums">
      {parts.join(' · ')}
    </Text>
  );
}

export function RunTimeline({
  graphId,
  threadId,
  busy,
}: {
  /** The LangGraph graph/assistant id — `metadata.graph_id`, or a registry agent id. */
  graphId?: string;
  threadId?: string;
  busy: boolean;
}) {
  const { data: detail, isPending } = useRunTimeline(threadId, undefined, true, busy);
  const { data: graph } = useAssistantGraph(graphId);
  const live = useLiveOverlay(busy);

  // `?? EMPTY_LANES` rather than `?? []`: a fresh array literal each render would
  // invalidate the memo below on every render.
  const lanes = detail?.lanes ?? EMPTY_LANES;

  // Steps the graph declares that this run has not reached. Whatever `next` names is
  // starting now, so it is shown as active rather than merely pending.
  const pending = useMemo(() => {
    const executed = new Set(lanes.flatMap((l) => l.nodes.map((n) => n.name)));
    return pendingNodes(planFromGraph(graph ?? undefined), executed, new Set(detail?.pending ?? []));
  }, [graph, lanes, detail?.pending]);

  const reduced = useReducedMotion();
  const ctx: TimelineCtx = { threadId, busy, maxMs: longest(lanes), live, depth: 0 };

  // With no lanes yet, `pending` IS the whole graph — so the skeleton is the run's real
  // shape rather than three anonymous bars.
  if (isPending && lanes.length === 0) return <RunTimelineSkeleton pending={pending} ctx={ctx} />;

  if (lanes.length === 0 && pending.length === 0) {
    return (
      <Text variant="muted" className="text-sm">
        No execution recorded for this run.
      </Text>
    );
  }

  const body = (
    <View className="gap-2">
      {/* Count-up only on a settled run: while busy the step count genuinely grows, and
          re-animating from zero on every new lane would read as a glitch. */}
      <TimelineSummary lanes={lanes} pending={pending} busy={busy} animate={!reduced && !busy} />
      <View>
        <LaneList lanes={lanes} ctx={ctx} trailing={pending.length > 0} />
        {/* The road ahead. Only ever shown while a run is live — on a finished thread a
            node that never ran was a branch not taken, not work still to come, and
            listing it would misreport what happened. */}
        {busy
          ? pending.map((node, i) => (
              <SpineRow key={node.id} status={node.status} last={i === pending.length - 1}>
                <NodeRow node={node} ctx={ctx} />
              </SpineRow>
            ))
          : null}
      </View>
    </View>
  );

  return reduced ? body : <Animated.View entering={FadeInDown.duration(280)}>{body}</Animated.View>;
}
