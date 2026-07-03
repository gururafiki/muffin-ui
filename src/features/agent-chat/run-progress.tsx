import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/components/icons';
import { Card, Collapsible, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { AgentDef, StageDef } from '@/lib/agent/registry';
import { TodoList, isTodoList, type Todo } from '@/lib/agent/renderers';
import { describeStep } from '@/lib/agent/steps';
import { palette } from '@/theme/colors';
import type { LiveNode } from './use-agent-stream';

type StageStatus = 'done' | 'active' | 'pending';

interface StageRow {
  stage: StageDef;
  status: StageStatus;
  childrenRows: { key: string; label: string; done: boolean }[];
}

/** Resolve each stage's done/active/pending from state + the live node. */
function resolveStages(stages: StageDef[], values: Record<string, unknown>, liveNode: LiveNode | undefined, busy: boolean): StageRow[] {
  const probe = liveNode ? [liveNode.node, ...liveNode.namespace].join(' ') : '';
  const rows: StageRow[] = stages.map((stage) => ({
    stage,
    status: stage.done(values) ? 'done' : 'pending',
    childrenRows: stage.children?.(values) ?? [],
  }));
  if (busy) {
    // Prefer the stage whose pattern matches what's streaming right now…
    let activeIdx = rows.findIndex((r) => r.status !== 'done' && r.stage.active?.test(probe));
    // …otherwise light up the first stage that isn't finished.
    if (activeIdx < 0) activeIdx = rows.findIndex((r) => r.status !== 'done');
    if (activeIdx >= 0) rows[activeIdx].status = 'active';
  }
  return rows;
}

function StageDot({ status }: { status: StageStatus }) {
  if (status === 'done') return <Icon name="check-circle" size={18} color={palette.leaf[500]} weight="fill" />;
  if (status === 'active') return <ActivityIndicator size="small" color={palette.butter[500]} />;
  return <View className="h-3.5 w-3.5 self-center rounded-pill border-2 border-frosting-200 dark:border-night-border" />;
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
                r.status === 'done' && 'text-[#9A8BB0] dark:text-night-text-muted',
                r.status === 'active' && 'font-heading',
              )}>
              {r.stage.label}
            </Text>
            {r.stage.expected || r.childrenRows.length > 0 ? (
              <Text variant="muted" className="text-xs">
                {r.childrenRows.filter((c) => c.done).length}
                {r.stage.expected ? `/${r.stage.expected}` : ''}
              </Text>
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
  liveNode,
  busy,
}: {
  agent: AgentDef;
  values: Record<string, unknown> | undefined;
  todos?: Todo[];
  liveNode?: LiveNode;
  busy: boolean;
}) {
  const v = values ?? {};
  const stageRows = agent.stages ? resolveStages(agent.stages, v, liveNode, busy) : [];
  const hasTodos = isTodoList(todos);
  const doneCount = stageRows.filter((r) => r.status === 'done').length;

  if (!hasTodos && stageRows.length === 0) {
    // No recipe and no plan — while busy, still show a heartbeat.
    if (!busy) return null;
    return (
      <Card tone="muted" className="flex-row items-center gap-2.5">
        <LivePulse />
        <Text variant="muted" className="flex-1 text-sm">
          {liveNode ? describeStep(liveNode.node).label : 'Working…'}
        </Text>
      </Card>
    );
  }

  const nowLabel =
    stageRows.find((r) => r.status === 'active')?.stage.label ??
    (liveNode ? describeStep(liveNode.node).label : undefined);

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
      {hasTodos ? <TodoList todos={todos!} title="Plan" /> : <StageChecklist rows={stageRows} />}
    </Card>
  );
}
