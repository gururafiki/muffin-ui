/**
 * The shared transcript renderer: a LangGraph conversation from its persisted
 * messages — used live (the messages grow as the run streams) and when
 * reopening a past thread. `Conversation` and the step-timeline components are
 * mutually recursive (a sub-agent group nests a full transcript), so the
 * cluster stays in one module; the pure fold logic lives in
 * `conversation-turns.ts`, the bubbles in `message-bubbles.tsx`.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Avatar, Badge, Card, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  JsonBlock,
  Markdown,
  messageText,
  parseTimeSeries,
  StructuredOutput,
  TimeSeriesChart,
  TodoList,
  isTodoList,
  type AnyMessage,
  type Todo,
} from '@/lib/agent/renderers';
import { toolStepMeta } from '@/lib/agent/steps';
import { palette } from '@/theme/colors';
import {
  buildTurns,
  coerceMessages,
  findRun,
  groupTimeline,
  isSignificant,
  tryParseJson,
  type ConversationMessage,
  type MessageActions,
  type Step,
  type SubagentRuns,
  type ToolStepT,
  type ViewMode,
} from './conversation-turns';
import { AnswerBlock, HumanBubble } from './message-bubbles';

export type {
  ConversationMessage,
  MessageActions,
  SubagentRun,
  SubagentRuns,
  ViewMode,
} from './conversation-turns';

/** Render a tool result: a chart when it's a time series, then pretty JSON if
 * it parses, otherwise markdown/text. */
function ToolResult({ message }: { message?: AnyMessage }) {
  if (!message) return <Text variant="muted" className="text-xs">No output captured.</Text>;
  const raw = messageText(message.content);
  if (!raw.trim()) return <Text variant="muted" className="text-xs">Empty result.</Text>;
  // Chart detection runs on the uncapped text — price-history payloads are
  // usually far larger than the JSON-preview cap below.
  const chart = parseTimeSeries(raw);
  const capped = raw.length > 8000 ? raw.slice(0, 8000) + '\n… (truncated)' : raw;
  const t = capped.trim();
  const json = tryParseJson(t);
  return (
    <View className="gap-2">
      {chart ? <TimeSeriesChart data={chart} /> : null}
      {json !== undefined ? <JsonBlock value={json} /> : <Markdown value={capped} />}
    </View>
  );
}

function RailNode({ icon, error, last }: { icon: IconName; error?: boolean; last?: boolean }) {
  return (
    <View className="w-6 items-center">
      {!last ? (
        <View
          style={{ position: 'absolute', top: 14, bottom: -10, width: 2 }}
          className="bg-frosting-100 dark:bg-night-border"
        />
      ) : null}
      <View
        className={cn(
          'z-10 h-6 w-6 items-center justify-center rounded-pill',
          error ? 'bg-bearish/15' : 'bg-frosting-100 dark:bg-night-surface-muted',
        )}>
        <Icon name={error ? 'close' : icon} size={13} color={error ? palette.bearish : palette.frosting[500]} />
      </View>
    </View>
  );
}

function StepRow({ step, last, defaultOpen }: { step: Step; last: boolean; defaultOpen: boolean }) {
  const meta =
    step.kind === 'think'
      ? { label: 'Thinking', icon: 'thinking' as IconName, sublabel: undefined, isSubagent: false, isFinalOutput: false }
      : step.kind === 'nudge'
        ? { label: 'System: retry nudge', icon: 'warning' as IconName, sublabel: undefined, isSubagent: false, isFinalOutput: false }
        : toolStepMeta(step.call.name ?? 'tool', step.call.args ?? {});
  const [open, setOpen] = useState(defaultOpen || !!meta.isFinalOutput);
  const error = step.kind === 'tool' && step.error;

  return (
    <View className="flex-row gap-3">
      <RailNode icon={meta.icon} error={error} last={last} />
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-1 pb-3 active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Text
            variant={step.kind === 'nudge' ? 'muted' : 'body'}
            className={cn('flex-1 text-sm', meta.isSubagent && 'font-heading', error && 'text-bearish')}>
            {meta.label}
          </Text>
          {error ? <Badge label="failed" tone="bearish" /> : null}
          {meta.isSubagent ? <Badge label="sub-agent" tone="info" /> : null}
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
        </View>
        {meta.sublabel ? (
          <Text variant="muted" className="mt-0.5 text-xs" numberOfLines={open ? undefined : 1}>
            {meta.sublabel}
          </Text>
        ) : null}
        {open ? (
          <View className="mt-2 gap-2">
            {step.kind === 'think' || step.kind === 'nudge' ? (
              <Markdown value={step.text} />
            ) : meta.isFinalOutput ? (
              <StructuredOutput value={step.call.args} />
            ) : (
              <>
                {step.call.args && Object.keys(step.call.args).length > 0 && !meta.isSubagent ? (
                  <JsonBlock value={step.call.args} />
                ) : null}
                <ToolResult message={step.result} />
              </>
            )}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const RAIL = { position: 'absolute' as const, top: 14, bottom: -10, width: 2 };

function SubAgentGroup({
  name,
  calls,
  last,
  defaultOpen,
  subagentRuns,
}: {
  name: string;
  calls: ToolStepT[];
  last: boolean;
  defaultOpen: boolean;
  subagentRuns?: SubagentRuns;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const error = calls.some((c) => c.error);
  const brief = (c: ToolStepT) => toolStepMeta(c.call.name ?? 'tool', c.call.args ?? {}).sublabel;

  return (
    <View className="flex-row gap-3">
      <View className="w-6 items-center">
        {!last ? <View style={RAIL} className="bg-frosting-100 dark:bg-night-border" /> : null}
        <View className={cn('z-10 rounded-pill', error && 'border-2 border-bearish')}>
          <Avatar name={name} size={24} />
        </View>
      </View>
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-1 pb-3 active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Text variant="body" className="flex-1 text-sm font-heading">{name}</Text>
          {calls.length > 1 ? <Text variant="muted" className="text-xs">×{calls.length}</Text> : null}
          <Badge label="sub-agent" tone="info" />
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
        </View>
        {!open && brief(calls[0]) ? (
          <Text variant="muted" className="mt-0.5 text-xs" numberOfLines={1}>{brief(calls[0])}</Text>
        ) : null}
        {open ? (
          <View className="mt-2 gap-3">
            {calls.map((c, i) => {
              const run = findRun(subagentRuns, brief(c));
              return (
                <View key={c.id + i} className="gap-1 border-l-2 border-frosting-100 pl-3 dark:border-night-border">
                  {calls.length > 1 ? <Text variant="label">Task {i + 1}</Text> : null}
                  {brief(c) ? <Text variant="muted" className="text-xs">{brief(c)}</Text> : null}
                  {/* Prefer the captured internal transcript (nested timeline); fall
                      back to the tool result (final report) when not captured. */}
                  {run?.messages?.length ? (
                    <Conversation messages={run.messages} viewMode="verbose" subagentRuns={subagentRuns} />
                  ) : (
                    <ToolResult message={c.result} />
                  )}
                </View>
              );
            })}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function StepTimeline({
  steps,
  viewMode,
  subagentRuns,
}: {
  steps: Step[];
  viewMode: ViewMode;
  subagentRuns?: SubagentRuns;
}) {
  const shown = viewMode === 'verbose' ? steps : steps.filter(isSignificant);
  if (shown.length === 0) return null;
  const { nodes, subCount } = groupTimeline(shown);
  return (
    <Card tone="muted" className="gap-0">
      <View className="mb-1 flex-row items-center gap-2">
        <Icon name="sparkle" size={14} color={palette.frosting[500]} />
        <Text variant="label">
          {steps.length} steps{subCount > 0 ? ` · ${subCount} sub-agents` : ''}
        </Text>
      </View>
      {/* Steps stay collapsed one-liners you tap to expand — summary shows only
          the high-signal ones, verbose shows every step (still collapsed). */}
      {nodes.map((n, i) =>
        n.kind === 'sub' ? (
          <SubAgentGroup
            key={'s' + i}
            name={n.name}
            calls={n.calls}
            last={i === nodes.length - 1}
            defaultOpen={false}
            subagentRuns={subagentRuns}
          />
        ) : (
          <StepRow key={'l' + i} step={n.step} last={i === nodes.length - 1} defaultOpen={false} />
        ),
      )}
    </Card>
  );
}

/**
 * Render a LangGraph conversation from its persisted messages — used live (the
 * messages grow as the run streams) and when reopening a past thread. Each
 * assistant turn becomes a minimal, expandable step timeline (sub-agents shown
 * as emphasised rows) followed by the markdown answer.
 */
export function Conversation({
  messages,
  todos,
  viewMode,
  busy,
  actions,
  subagentRuns,
}: {
  /** Persisted dicts or live `stream.messages` instances — both render. */
  messages: readonly ConversationMessage[];
  todos?: Todo[];
  viewMode: ViewMode;
  busy?: boolean;
  actions?: MessageActions;
  /** Captured sub-agent transcripts, keyed by run id (deep agents). */
  subagentRuns?: SubagentRuns;
}) {
  // Recomputed only when the message list changes — NOT on unrelated
  // re-renders (during token streaming the list identity changes anyway).
  const turns = useMemo(() => buildTurns(coerceMessages(messages)), [messages]);

  return (
    <View className="gap-3">
      {isTodoList(todos) ? <TodoList todos={todos} title="Plan" /> : null}
      {turns.map((turn, ti) => (
        <View key={ti} className="gap-3">
          {turn.human ? <HumanBubble message={turn.human} actions={actions} /> : null}
          <StepTimeline key={viewMode} steps={turn.steps} viewMode={viewMode} subagentRuns={subagentRuns} />
          {turn.answer ? <AnswerBlock message={turn.answer} actions={actions} /> : null}
          {busy && ti === turns.length - 1 ? (
            <View className="flex-row items-center gap-2 px-1">
              <ActivityIndicator size="small" color={palette.frosting[400]} />
              <Text variant="muted" className="text-sm">Working…</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}
