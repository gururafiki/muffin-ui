import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import type { SubgraphDiscoverySnapshot } from '@langchain/langgraph-sdk/stream';

import { Icon } from '@/components/icons';
import { Card, Collapsible, ProgressBar, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AgentDef, StageDef } from '@/lib/agent/registry';
import { TodoList, isTodoList, type Todo } from '@/lib/agent/renderers';
import { describeStep } from '@/lib/agent/steps';
import { palette } from '@/theme/colors';

type StageStatus = 'done' | 'active' | 'pending';
type ByNode = ReadonlyMap<string, readonly SubgraphDiscoverySnapshot[]>;

interface StageRow {
  stage: StageDef;
  status: StageStatus;
  childrenRows: { key: string; label: string; done: boolean }[];
  /** Resolved expected-children total (registry `expected`, else discovery). */
  expected?: number;
}

/** Discovery snapshots belonging to a stage: exact `node`, else `active` regex. */
function stageSnaps(stage: StageDef, byNode: ByNode | undefined): readonly SubgraphDiscoverySnapshot[] {
  if (!byNode) return [];
  if (stage.node) return byNode.get(stage.node) ?? [];
  if (!stage.active) return [];
  const out: SubgraphDiscoverySnapshot[] = [];
  for (const [node, snaps] of byNode) if (stage.active.test(node)) out.push(...snaps);
  return out;
}

/**
 * Resolve each stage's done/active/pending. Primary source on the protocol-v2
 * stack is subgraph discovery (`byNode`: live per-node statuses); `done(values)`
 * stays authoritative for plain-function nodes that are never discovered.
 */
function resolveStages(
  stages: StageDef[],
  values: Record<string, unknown>,
  busy: boolean,
  byNode?: ByNode,
): StageRow[] {
  const rows: StageRow[] = stages.map((stage) => {
    const snaps = stageSnaps(stage, byNode);
    const running = busy && snaps.some((s) => s.status === 'running');
    const doneByState = stage.done(values);
    // All discovered invocations finished → outputs land at the superstep
    // barrier momentarily; show the stage as done rather than regressing.
    const doneBySnaps = snaps.length > 0 && snaps.every((s) => s.status !== 'running');
    const expectedRaw = typeof stage.expected === 'function' ? stage.expected(values) : stage.expected;
    return {
      stage,
      status: running ? 'active' : doneByState || doneBySnaps ? 'done' : 'pending',
      childrenRows: stage.children?.(values) ?? [],
      expected: expectedRaw ?? (snaps.length > 0 ? snaps.length : undefined),
    };
  });
  if (busy && !rows.some((r) => r.status === 'active')) {
    // No discovery signal yet (warm-up) — light up the first unfinished stage.
    const activeIdx = rows.findIndex((r) => r.status !== 'done');
    if (activeIdx >= 0) rows[activeIdx].status = 'active';
  }
  return rows;
}

function StageDot({ status }: { status: StageStatus }) {
  if (status === 'done') return <Icon name="check-circle" size={18} color={palette.leaf[500]} weight="fill" />;
  if (status === 'active') return <ActivityIndicator size="small" color={palette.butter[500]} />;
  return <View className="h-3.5 w-3.5 self-center rounded-pill border-2 border-frosting-200 dark:border-night-border" />;
}

/**
 * `mm:ss` elapsed since the run started streaming (observed client-side). Honest
 * and self-contained — for a fresh run started here it equals the true run time;
 * for a run reopened mid-flight it counts from when this client attached. Returns
 * `null` when not running. We show elapsed, NOT an estimated remaining — run
 * durations vary too much (5–15 min) to guess honestly.
 */
function useElapsedLabel(active: boolean): string | null {
  // `elapsed` only ever moves via the interval callback (an external clock),
  // never a synchronous read in render — so React-Compiler purity rules hold.
  // Same shape as `useEstimatedProgress`: this card mounts fresh per run (a new
  // run is a new screen instance), so `useState(0)` needs no manual reset.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const secs = Math.max(0, Math.floor(elapsed / 1000));
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

/** Soft pulsing dot for the "Now" line — the page always feels alive. */
function LivePulse() {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.35, { duration: 700 }), -1, true);
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={style} className="h-2.5 w-2.5 rounded-pill bg-butter-500" />;
}

function StageChecklist({ rows }: { rows: StageRow[] }) {
  return (
    <View className="gap-1.5">
      {rows.map((r) => (
        <View key={r.stage.key}>
          <View className="flex-row items-center gap-2.5">
            <View className="w-5 items-center">
              <StageDot status={r.status} />
            </View>
            <Text
              variant="body"
              className={cn(
                'flex-1 text-sm',
                r.status === 'done' && 'text-ink-soft dark:text-night-text-muted',
                r.status === 'active' && 'font-heading',
              )}>
              {r.stage.label}
            </Text>
            {/* Bare total until children arrive (a `0/N` would mislead while
                parallel workers sit behind the superstep barrier), then k/N. */}
            {r.childrenRows.length > 0 ? (
              <Text variant="muted" className="text-xs">
                {r.childrenRows.filter((c) => c.done).length}
                {r.expected ? `/${r.expected}` : ''}
              </Text>
            ) : r.expected ? (
              <Text variant="muted" className="text-xs">{r.expected}</Text>
            ) : null}
          </View>
          {/* Children shown only while their stage is live — calm once finished. */}
          {r.status === 'active' && r.childrenRows.length > 0 ? (
            <View className="ml-7 mt-1 gap-1 border-l-2 border-frosting-100 pl-3 dark:border-night-border">
              {r.childrenRows.slice(-6).map((c) => (
                <View key={c.key} className="flex-row items-center gap-2">
                  <Icon name="check" size={12} color={palette.leaf[500]} weight="bold" />
                  <Text variant="muted" className="flex-1 text-xs" numberOfLines={1}>
                    {c.label}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * "Done / doing / next" for a run — the answer to "what is it doing right now?".
 *
 * Deep agents surface their own plan (`todos`); graph agents get a stage recipe
 * from the registry, resolved live against streamed state + node updates. While
 * running it's a pinned card with a pulsing "Now" line; when finished it folds
 * into a one-line summary you can reopen.
 */
export function RunProgress({
  agent,
  values,
  todos,
  busy,
  byNode,
}: {
  agent: AgentDef;
  values: Record<string, unknown> | undefined;
  todos?: Todo[];
  busy: boolean;
  /** Protocol-v2 subgraph discovery (`stream.subgraphsByNode`). */
  byNode?: ReadonlyMap<string, readonly SubgraphDiscoverySnapshot[]>;
}) {
  const v = values ?? {};
  const stageRows = agent.stages ? resolveStages(agent.stages, v, busy, byNode) : [];
  const hasTodos = isTodoList(todos);
  const doneCount = stageRows.filter((r) => r.status === 'done').length;
  // Determinate progress across the known checklist (stages, or a deep agent's
  // to-dos). Honest — it reflects completed units, not a guessed time estimate.
  const todoDone = hasTodos
    ? todos!.filter((t) => ['completed', 'done'].includes((t.status ?? '').toLowerCase())).length
    : 0;
  const progressTotal = hasTodos ? (todos?.length ?? 0) : stageRows.length;
  const progressDone = hasTodos ? todoDone : doneCount;
  const progress = progressTotal > 0 ? progressDone / progressTotal : 0;
  const elapsed = useElapsedLabel(busy);
  // The freshest running node across discovery — a live "Now:" label for deep
  // agents (no stage recipe) and a warm-up hint before a stage lights up.
  const liveNodeLabel = (() => {
    if (!byNode) return undefined;
    let latest: SubgraphDiscoverySnapshot | undefined;
    for (const snaps of byNode.values())
      for (const s of snaps)
        if (s.status === 'running' && (!latest || s.startedAt > latest.startedAt)) latest = s;
    return latest ? describeStep(latest.nodeName).label : undefined;
  })();

  if (!hasTodos && stageRows.length === 0) {
    // No recipe and no plan — while busy, still show a heartbeat.
    if (!busy) return null;
    return (
      <Card tone="muted" className="flex-row items-center gap-2.5">
        <LivePulse />
        <Text variant="muted" className="flex-1 text-sm">
          {liveNodeLabel ?? 'Working…'}
        </Text>
        {elapsed ? <Text variant="muted" className="text-xs">{elapsed}</Text> : null}
      </Card>
    );
  }

  const nowLabel = stageRows.find((r) => r.status === 'active')?.stage.label ?? liveNodeLabel;

  // Finished → fold away, one calm line.
  if (!busy) {
    if (!hasTodos && doneCount === 0) return null;
    return (
      <Collapsible
        title={hasTodos ? 'Plan' : `Run plan · ${doneCount}/${stageRows.length} stages`}
        icon="criteria">
        {hasTodos ? <TodoList todos={todos!} title="Plan" /> : <StageChecklist rows={stageRows} />}
      </Collapsible>
    );
  }

  return (
    <Card tone="muted" className="gap-3">
      <View className="flex-row items-center gap-2.5">
        <LivePulse />
        <Text variant="label" className="flex-1 normal-case">
          {nowLabel ? `Now: ${nowLabel}` : 'Warming up…'}
        </Text>
        <ActivityIndicator size="small" color={palette.frosting[400]} />
      </View>
      {progressTotal > 0 ? (
        <View className="gap-1">
          <ProgressBar
            value={progress}
            accessibilityLabel={`${progressDone} of ${progressTotal} ${hasTodos ? 'tasks' : 'stages'} complete`}
          />
          <View className="flex-row justify-between">
            <Text variant="muted" className="text-xs">
              {progressDone}/{progressTotal} {hasTodos ? 'tasks' : 'stages'}
            </Text>
            {elapsed ? <Text variant="muted" className="text-xs">{elapsed}</Text> : null}
          </View>
        </View>
      ) : null}
      {hasTodos ? <TodoList todos={todos!} title="Plan" /> : <StageChecklist rows={stageRows} />}
    </Card>
  );
}
