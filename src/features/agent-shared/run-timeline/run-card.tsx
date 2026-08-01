/**
 * The recursive heart of the run timeline.
 *
 * One node expands into the four facets a reader asks for — **Input · Plan · Timeline ·
 * Output** — and anything inside that Timeline which is itself an agent or subgraph
 * expands the same way. That is what "render each node as a graph itself" means here:
 * there is one card component, and it contains itself.
 *
 * ## Two kinds of node, because there are two kinds of node
 *
 * - **A pipeline/graph node** (the criteria root, a council persona, a conference
 *   subgraph) has no `messages` channel at all — muffin-agent's graph-authoring rule
 *   keeps parent pipeline state off `AgentState` — so its timeline IS its child
 *   supersteps, rendered as a nested spine.
 * - **An agent node** (a deep agent, a ReAct specialist) has a transcript, and its
 *   children are `task` delegations that ALSO appear in that transcript as tool calls.
 *   Rendering both would say everything twice, so the transcript is the timeline and
 *   each delegation step becomes the drill-down into that sub-agent's own card, joined
 *   exactly by `task` tool-call id.
 *
 * `LaneList`, `NodeRow` and `RunCardBody` are mutually recursive, so they live in one
 * module with hoisted `function` declarations to avoid a cross-file require cycle —
 * the same reason `conversation.tsx` keeps its Conversation/StepTimeline pair together.
 *
 * **Everything below the root is fetched on expand.** A card that owns a namespace reads
 * it when it opens (`useRunTimeline`), so a 27-namespace criteria run only ever pays for
 * the branches someone actually opened.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import {
  Badge,
  Card,
  DurationBar,
  ParallelFan,
  Skeleton,
  SpineRow,
  StatusDot,
  Text,
  statusLabel,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { renderNodeOutput, TodoList, ToolRunsPanel, isTodoList, type Todo } from '@/lib/agent/renderers';
import { formatDuration, laneStatus, type Lane, type RunNode } from '@/lib/agent/run-node';
import { palette } from '@/theme/colors';
import { Conversation } from '../conversation';
import { coerceMessages, type ConversationMessage } from '../conversation-turns';
import { useLiveOverlay, type LiveOverlay } from './use-live-overlay';
import { useRunTimeline, type RunTimelineDetail } from './use-run-timeline';

/** Shared context every level of the recursion needs. Passed explicitly (not through
 * React context) so the pure-ish components stay easy to reason about and to test. */
export type TimelineCtx = {
  threadId?: string;
  busy: boolean;
  /** Longest step in the run, so duration bars are comparable across the whole page. */
  maxMs: number;
  live: LiveOverlay;
  /** Guards against a pathological graph recursing without end. */
  depth: number;
};

const MAX_DEPTH = 8;

/** Live status/timing win over the checkpoint reading; history is the fallback. */
function resolve(node: RunNode, ctx: TimelineCtx): RunNode {
  const status = ctx.live.statusFor(node);
  const durationMs = ctx.live.durationFor(node);
  if (!status && durationMs == null) return node;
  return { ...node, status: status ?? node.status, durationMs: durationMs ?? node.durationMs };
}

// ── Lanes ────────────────────────────────────────────────────────────────────

/**
 * A run's supersteps as a vertical spine: sequential steps on the rail, parallel
 * supersteps bracketed into a fan.
 */
export function LaneList({ lanes, ctx, trailing }: { lanes: Lane[]; ctx: TimelineCtx; trailing?: boolean }) {
  return (
    <View>
      {lanes.map((lane, i) => {
        const last = !trailing && i === lanes.length - 1;
        // Members of a finished fan all inherit the lane's single wall-clock, so
        // repeating it on all ten rows says nothing the header has not already said.
        // Live members DO get individual timing from discovery, and keep it.
        const sharedDuration = lane.nodes.every((n) => resolve(n, ctx).durationMs === lane.durationMs);
        return lane.parallel ? (
          <ParallelFan key={lane.step} last={last} header={<FanHeader lane={lane} ctx={ctx} />}>
            {lane.nodes.map((n) => (
              <NodeRow key={n.id} node={n} ctx={ctx} bare hideDuration={sharedDuration} />
            ))}
          </ParallelFan>
        ) : (
          <SpineRow key={lane.step} status={resolve(lane.nodes[0], ctx).status} last={last}>
            <NodeRow node={lane.nodes[0]} ctx={ctx} />
          </SpineRow>
        );
      })}
    </View>
  );
}

/** "10 in parallel · 4m 17s" — the one line that makes a fan legible at a glance. */
function FanHeader({ lane, ctx }: { lane: Lane; ctx: TimelineCtx }) {
  const status = laneStatus(lane);
  const done = lane.nodes.filter((n) => resolve(n, ctx).status === 'done').length;
  const failed = lane.nodes.filter((n) => resolve(n, ctx).status === 'error').length;
  const duration = formatDuration(lane.durationMs);
  return (
    <View className="flex-row items-center gap-2 pt-0.5">
      <Text variant="label" className="normal-case">
        {lane.nodes.length} in parallel
      </Text>
      {status === 'active' ? (
        <Text variant="muted" className="text-xs">
          {done}/{lane.nodes.length} done
        </Text>
      ) : null}
      {failed > 0 ? <Badge label={`${failed} failed`} tone="bearish" /> : null}
      <View className="flex-1" />
      {duration && lane.durationMs ? (
        <DurationBar ms={lane.durationMs} maxMs={ctx.maxMs} label={duration} />
      ) : null}
    </View>
  );
}

// ── One node ─────────────────────────────────────────────────────────────────

/**
 * One node's row: a tappable header that expands into its full card.
 *
 * `bare` drops the leading status dot for members of a parallel fan, whose bracket
 * already carries the grouping — the dot moves inline with the label instead, so the fan
 * reads as a set rather than as a second spine.
 */
export function NodeRow({
  node: raw,
  ctx,
  bare,
  hideDuration,
}: {
  node: RunNode;
  ctx: TimelineCtx;
  bare?: boolean;
  hideDuration?: boolean;
}) {
  const node = resolve(raw, ctx);
  const [open, setOpen] = useState(false);
  // Nothing to open: a step that has not started has no record to show, and saying so
  // by not offering a chevron beats an empty panel that reads as a bug.
  const expandable = node.status !== 'pending' && ctx.depth < MAX_DEPTH;
  const duration = formatDuration(node.durationMs);

  return (
    <View className={cn('rounded-crumb', node.status === 'error' && 'bg-bearish/5')}>
      <Pressable
        disabled={!expandable}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityState={expandable ? { expanded: open } : undefined}
        accessibilityLabel={`${node.label}, ${statusLabel(node.status)}${duration ? `, ${duration}` : ''}`}
        className={cn('flex-row items-center gap-2 py-1.5', expandable && 'active:opacity-70')}>
        {bare ? <StatusDot status={node.status} size={15} /> : null}
        {node.icon ? <Icon name={node.icon} size={15} color={palette.frosting[500]} /> : null}
        <Text
          variant="body"
          numberOfLines={2}
          className={cn(
            'min-w-0 flex-1 text-sm',
            node.status === 'active' && 'font-heading',
            node.status === 'pending' && 'text-ink-soft dark:text-night-text-muted',
            node.status === 'error' && 'text-bearish',
          )}>
          {node.label}
        </Text>
        {node.status === 'active' ? <Badge label="running" tone="info" /> : null}
        {node.status === 'error' ? <Badge label="failed" tone="bearish" /> : null}
        {duration && node.durationMs && !hideDuration ? (
          <DurationBar ms={node.durationMs} maxMs={ctx.maxMs} label={duration} />
        ) : null}
        {expandable ? (
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
        ) : null}
      </Pressable>
      {open ? (
        <View className="pb-2 pl-1 pr-1">
          <RunCardBody node={node} ctx={{ ...ctx, depth: ctx.depth + 1 }} />
        </View>
      ) : null}
    </View>
  );
}

/** A titled facet of a card. Consistent labelling is what makes the four sections
 * scannable once you have seen them once. */
function Facet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1">
      <Text variant="label">{label}</Text>
      {children}
    </View>
  );
}

/** Skeleton shaped like the card that will replace it, so nothing jumps on arrival. */
function CardSkeleton() {
  return (
    <View className="gap-2">
      <Skeleton className="h-3 w-14" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-4/5" />
      <Skeleton className="h-3 w-14" />
      <Skeleton className="h-3.5 w-3/5" />
    </View>
  );
}

/**
 * One node's four facets. This is the component that recurses.
 */
export function RunCardBody({ node, ctx }: { node: RunNode; ctx: TimelineCtx }) {
  const { data, isPending } = useRunTimeline(ctx.threadId, node.namespace, !!node.namespace, ctx.busy);

  const detail: RunTimelineDetail | undefined = data;
  const input = node.input ?? detail?.input;
  const plan = detail?.plan ?? [];
  const latestPlan = plan.at(-1)?.todos;
  const output = node.output;
  const hasNamespace = !!node.namespace;

  if (isPending && hasNamespace && input == null && output == null) return <CardSkeleton />;

  const hasTimeline = (detail?.messages.length ?? 0) > 0 || (detail?.lanes.length ?? 0) > 0;
  const hasBody = input != null || latestPlan != null || hasTimeline || output != null;

  if (!hasBody) {
    return (
      <Text variant="muted" className="text-xs">
        {hasNamespace
          ? 'This step recorded no transcript, tool calls or sub-steps.'
          : // A leaf by construction — a plain function node in the graph, not a
            // missing branch. Saying so beats an empty panel that reads as a bug.
            'This step is a single call with no sub-steps of its own.'}
      </Text>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(180)}>
      <Card tone="muted" className="gap-3">
        {input ? (
          <Facet label="Input">
            <InputBlock text={input} />
          </Facet>
        ) : null}

        {isTodoList(latestPlan) ? (
          <Facet label="Plan">
            <TodoList todos={latestPlan as Todo[]} title={planTitle(latestPlan as Todo[])} />
          </Facet>
        ) : null}

        {hasTimeline && detail ? (
          <Facet label="Timeline">
            {/* When Input came from the transcript's own opening human message, the
                transcript must not repeat it — otherwise a 2,000-character system brief
                renders twice, back to back, before any of the actual work. */}
            <NodeTimeline node={node} detail={detail} ctx={ctx} skipLeadingHuman={input === detail.input} />
          </Facet>
        ) : null}

        {output != null ? (
          <Facet label="Output">{renderNodeOutput(node.outputChannel, output)}</Facet>
        ) : null}
      </Card>
    </Animated.View>
  );
}

function planTitle(todos: Todo[]): string {
  const done = todos.filter((t) => /completed|done/i.test(t.status ?? '')).length;
  return done === todos.length ? 'Plan · all done' : `Plan · step ${Math.min(done + 1, todos.length)} of ${todos.length}`;
}

/** The prompt a node was handed. Models routinely emit markdown here, so it is rendered
 * as markdown rather than as a flat string — and capped, because a deep agent's brief
 * can run to thousands of characters that nobody wants above the actual work. */
function InputBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320;
  return (
    <Pressable disabled={!long} onPress={() => setOpen((o) => !o)}>
      <Text variant="muted" className="text-xs" numberOfLines={open || !long ? undefined : 4}>
        {text}
      </Text>
      {long ? (
        <Text variant="muted" className="mt-0.5 text-[11px] text-frosting-500">
          {open ? 'Show less' : 'Show full prompt'}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * What a node actually did, in order.
 *
 * See the module header for why a transcript and a set of child lanes are treated as
 * alternatives rather than stacked: for an agent they are two views of the same events.
 */
function NodeTimeline({
  node,
  detail,
  ctx,
  skipLeadingHuman,
}: {
  node: RunNode;
  detail: RunTimelineDetail;
  ctx: TimelineCtx;
  skipLeadingHuman?: boolean;
}) {
  const all = coerceMessages(detail.messages as ConversationMessage[]);
  const leadingHuman = all.findIndex((m) => m.type === 'human' || m.role === 'user');
  const messages = skipLeadingHuman && leadingHuman === 0 ? all.slice(1) : all;
  const childNodes = detail.lanes.flatMap((l) => l.nodes);
  // While live, discovery sees sub-agents whose checkpoints have not landed yet.
  const liveChildren = ctx.live
    .subagentsUnder(node.namespace)
    .filter((live) => !childNodes.some((c) => c.toolCallId === live.toolCallId));

  if (messages.length > 0) {
    // Agent mode. Each `task` step expands into that sub-agent's own card, joined by
    // tool-call id — so the delegation and the sub-agent are ONE row, not two.
    const byCallId = new Map(
      [...childNodes, ...liveChildren].filter((c) => c.toolCallId).map((c) => [c.toolCallId as string, c]),
    );
    const orphans = [...childNodes, ...liveChildren].filter((c) => !c.toolCallId);
    return (
      <View className="gap-2">
        <Conversation
          messages={messages}
          viewMode="verbose"
          busy={node.status === 'active'}
          renderSubagent={(callId) => {
            const child = byCallId.get(callId);
            return child ? <RunCardBody node={child} ctx={{ ...ctx, depth: ctx.depth + 1 }} /> : undefined;
          }}
        />
        {/* Children the transcript did not account for — a sub-agent whose `task` call
            was summarised out of the message history, say. Better shown than dropped. */}
        {orphans.length > 0 ? (
          <View>
            {orphans.map((c, i) => (
              <SpineRow key={c.id} status={c.status} last={i === orphans.length - 1}>
                <NodeRow node={c} ctx={ctx} />
              </SpineRow>
            ))}
          </View>
        ) : null}
        {detail.toolRuns.length > 0 ? (
          <ToolRunsPanel title="Tool calls" runs={detail.toolRuns} />
        ) : null}
      </View>
    );
  }

  // Graph mode: the node's timeline IS its child supersteps.
  return (
    <View className="gap-2">
      <LaneList lanes={detail.lanes} ctx={ctx} />
      {liveChildren.length > 0 ? (
        <View>
          {liveChildren.map((c, i) => (
            <SpineRow key={c.id} status={c.status} last={i === liveChildren.length - 1}>
              <NodeRow node={c} ctx={ctx} />
            </SpineRow>
          ))}
        </View>
      ) : null}
      {detail.toolRuns.length > 0 ? <ToolRunsPanel title="Tool calls" runs={detail.toolRuns} /> : null}
    </View>
  );
}

export { useLiveOverlay };
