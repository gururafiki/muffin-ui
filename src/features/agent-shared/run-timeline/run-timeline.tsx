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
import { useMemo } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Skeleton, SpineRow, Text } from '@/components/ui';
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

function RunTimelineSkeleton() {
  return (
    <View className="gap-2.5">
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-row items-center gap-3">
          <Skeleton className="h-[18px] w-[18px] rounded-pill" />
          <Skeleton className="h-3.5 flex-1" />
          <Skeleton className="h-3 w-12" />
        </View>
      ))}
    </View>
  );
}

/** One line of honest run-level accounting above the spine. */
function TimelineSummary({ lanes, pending, busy }: { lanes: Lane[]; pending: RunNode[]; busy: boolean }) {
  const nodes = lanes.flatMap((l) => l.nodes);
  const failed = nodes.filter((n) => n.status === 'error').length;
  const fans = lanes.filter((l) => l.parallel).length;
  const total = lanes.reduce((sum, l) => sum + (l.durationMs ?? 0), 0);

  const parts = [
    `${nodes.length} step${nodes.length === 1 ? '' : 's'}`,
    fans > 0 ? `${fans} parallel` : undefined,
    pending.length > 0 && busy ? `${pending.length} to go` : undefined,
    failed > 0 ? `${failed} failed` : undefined,
    total > 0 ? formatDuration(total) : undefined,
  ].filter(Boolean);

  return (
    <Text variant="muted" className="text-xs">
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

  if (isPending && lanes.length === 0) return <RunTimelineSkeleton />;

  if (lanes.length === 0 && pending.length === 0) {
    return (
      <Text variant="muted" className="text-sm">
        No execution recorded for this run.
      </Text>
    );
  }

  const body = (
    <View className="gap-2">
      <TimelineSummary lanes={lanes} pending={pending} busy={busy} />
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
