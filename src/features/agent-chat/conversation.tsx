import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Avatar, Badge, Button, Card, Field, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  JsonBlock,
  Markdown,
  messageKind,
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

export type ViewMode = 'summary' | 'verbose';

export type MessageActions = {
  busy: boolean;
  onCopy: (text: string) => void;
  onEdit: (message: AnyMessage, text: string) => void;
  onRegenerate: (message: AnyMessage) => void;
  branchInfo: (message: AnyMessage) => { index: number; total: number; prev?: string; next?: string } | undefined;
  onSetBranch: (branch: string) => void;
};

type ToolCall = { name?: string; args?: Record<string, unknown>; id?: string };
type Step =
  | { kind: 'think'; id: string; text: string }
  | { kind: 'tool'; id: string; call: ToolCall; result?: AnyMessage; error?: boolean };
type Turn = { human?: AnyMessage; steps: Step[]; answer?: AnyMessage };

/** One sub-agent run row: a captured transcript (backend `subagent_runs`
 * state channel) and/or a protocol-v2 discovered subgraph invocation. */
export type SubagentRun = {
  name?: string;
  description?: string;
  messages?: AnyMessage[];
  /** Full subgraph state (native sub-agents) — powers stage-oriented detail. */
  stateValues?: Record<string, unknown>;
  /** Live discovery status (protocol-v2 subgraph snapshots). */
  status?: 'running' | 'complete' | 'error';
  /** Caller-provided expanded content (scoped live transcript / evaluation). */
  renderDetail?: () => React.ReactNode;
};
export type SubagentRuns = Record<string, SubagentRun>;

/** Find the captured transcript for a `task` call, matched by its description. */
function findRun(runs: SubagentRuns | undefined, description?: string): SubagentRun | undefined {
  if (!runs || !description) return undefined;
  const target = description.trim();
  for (const r of Object.values(runs)) {
    const d = r.description?.trim();
    if (d && (d === target || target.startsWith(d) || d.startsWith(target))) return r;
  }
  return undefined;
}

/** Split a message list into turns, pairing tool calls with their results. */
function buildTurns(messages: AnyMessage[]): Turn[] {
  const toolById = new Map<string, AnyMessage>();
  for (const m of messages) {
    if (messageKind(m) === 'tool') {
      const id = (m as { tool_call_id?: string }).tool_call_id;
      if (id) toolById.set(id, m);
    }
  }

  const turns: Turn[] = [];
  let cur: Turn | null = null;
  const aiSeq: { turn: Turn; m: AnyMessage }[] = [];

  for (const m of messages) {
    const kind = messageKind(m);
    if (kind === 'human' || kind === 'user') {
      cur = { steps: [] };
      cur.human = m;
      turns.push(cur);
      continue;
    }
    if (kind === 'tool') continue;
    if (!cur) {
      cur = { steps: [] };
      turns.push(cur);
    }
    aiSeq.push({ turn: cur, m });
  }

  // Within each turn, the final content-only AI message is the answer; the rest
  // become "thinking" + tool steps.
  for (const t of turns) {
    const ais = aiSeq.filter((x) => x.turn === t).map((x) => x.m);
    ais.forEach((m, i) => {
      const text = messageText(m.content).trim();
      const calls = (m.tool_calls ?? []) as ToolCall[];
      const isLast = i === ais.length - 1;
      if (isLast && text && calls.length === 0) {
        t.answer = m;
        return;
      }
      if (text) t.steps.push({ kind: 'think', id: `${m.id ?? 't'}-think`, text });
      for (const c of calls) {
        const result = c.id ? toolById.get(c.id) : undefined;
        t.steps.push({
          kind: 'tool',
          id: c.id ?? `${m.id}-${c.name}`,
          call: c,
          result,
          error: (result as { status?: string } | undefined)?.status === 'error',
        });
      }
    });
  }
  return turns;
}

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

function tryParseJson(t: string): unknown {
  if (!(t.startsWith('{') || t.startsWith('[')) || t.length >= 8000) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
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
  const [open, setOpen] = useState(defaultOpen);

  const meta =
    step.kind === 'think'
      ? { label: 'Thinking', icon: 'thinking' as IconName, sublabel: undefined, isSubagent: false }
      : toolStepMeta(step.call.name ?? 'tool', step.call.args ?? {});
  const error = step.kind === 'tool' && step.error;

  return (
    <View className="flex-row gap-3">
      <RailNode icon={meta.icon} error={error} last={last} />
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-1 pb-3 active:opacity-70">
        <View className="flex-row items-center gap-2">
          <Text variant="body" className={cn('flex-1 text-sm', meta.isSubagent && 'font-heading')}>
            {meta.label}
          </Text>
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
            {step.kind === 'think' ? (
              <Markdown value={step.text} />
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

type ToolStepT = Extract<Step, { kind: 'tool' }>;
type TimelineNode =
  | { kind: 'leaf'; step: Step }
  | { kind: 'sub'; name: string; calls: ToolStepT[] };

/** Group a flat step list into an orchestrator tree: parent steps stay as
 * leaves, while sub-agent (`task`) calls collapse under one node per agent. */
function groupTimeline(steps: Step[]): { nodes: TimelineNode[]; subCount: number } {
  const nodes: TimelineNode[] = [];
  const subByName = new Map<string, Extract<TimelineNode, { kind: 'sub' }>>();
  for (const step of steps) {
    if (step.kind === 'tool') {
      const meta = toolStepMeta(step.call.name ?? 'tool', step.call.args ?? {});
      if (meta.isSubagent) {
        let node = subByName.get(meta.label);
        if (!node) {
          node = { kind: 'sub', name: meta.label, calls: [] };
          subByName.set(meta.label, node);
          nodes.push(node);
        }
        node.calls.push(step);
        continue;
      }
    }
    nodes.push({ kind: 'leaf', step });
  }
  return { nodes, subCount: subByName.size };
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

/** In summary view, keep only high-signal steps (sub-agents + to-do updates);
 * hide the orchestrator's plumbing (caching, file reads, schema, thinking). */
function isSignificant(step: Step): boolean {
  if (step.kind === 'think') return false;
  const name = (step.call.name ?? '').toLowerCase();
  return toolStepMeta(name, step.call.args ?? {}).isSubagent || /write_todos|todo/.test(name);
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

function BranchControls({ message, actions }: { message: AnyMessage; actions: MessageActions }) {
  const b = actions.branchInfo(message);
  if (!b || b.total <= 1) return null;
  return (
    <View className="flex-row items-center">
      <Pressable disabled={!b.prev} onPress={() => b.prev && actions.onSetBranch(b.prev)} className="p-1 active:opacity-60">
        <Icon name="arrow-left" size={14} color={b.prev ? palette.frosting[400] : palette.frosting[200]} />
      </Pressable>
      <Text variant="muted" className="text-xs">{b.index + 1}/{b.total}</Text>
      <Pressable disabled={!b.next} onPress={() => b.next && actions.onSetBranch(b.next)} className="p-1 active:opacity-60">
        <Icon name="arrow-right" size={14} color={b.next ? palette.frosting[400] : palette.frosting[200]} />
      </Pressable>
    </View>
  );
}

function ActionBtn({ icon, onPress, disabled }: { icon: IconName; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className={cn('h-7 w-7 items-center justify-center active:opacity-60', disabled && 'opacity-40')}>
      <Icon name={icon} size={15} color={palette.frosting[400]} />
    </Pressable>
  );
}

function HumanBubble({ message, actions }: { message: AnyMessage; actions?: MessageActions }) {
  const body = messageText(message.content);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);

  if (editing && actions) {
    return (
      <Card tone="outline" className="gap-2">
        <Field value={text} onChangeText={setText} multiline autoFocus />
        <View className="flex-row gap-2">
          <Button title="Save & resend" size="sm" disabled={actions.busy || !text.trim()} onPress={() => { setEditing(false); actions.onEdit(message, text.trim()); }} />
          <Button title="Cancel" size="sm" variant="ghost" onPress={() => setEditing(false)} />
        </View>
      </Card>
    );
  }

  return (
    <Card tone="outline" className="gap-1 self-end" style={{ maxWidth: '90%' }}>
      <Text variant="body">{body}</Text>
      {actions ? (
        <View className="flex-row items-center justify-end gap-0.5 pt-1">
          <BranchControls message={message} actions={actions} />
          <ActionBtn icon="copy" onPress={() => actions.onCopy(body)} />
          <ActionBtn icon="edit" disabled={actions.busy} onPress={() => { setText(body); setEditing(true); }} />
        </View>
      ) : null}
    </Card>
  );
}

function AnswerBlock({ message, actions }: { message: AnyMessage; actions?: MessageActions }) {
  const body = messageText(message.content);
  return (
    <Card tone="raised" className="gap-2">
      <Markdown value={body} />
      {actions ? (
        <View className="flex-row items-center justify-end gap-0.5 pt-1">
          <BranchControls message={message} actions={actions} />
          <ActionBtn icon="copy" onPress={() => actions.onCopy(body)} />
          <ActionBtn icon="regenerate" disabled={actions.busy} onPress={() => actions.onRegenerate(message)} />
        </View>
      ) : null}
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
  messages: AnyMessage[];
  todos?: Todo[];
  viewMode: ViewMode;
  busy?: boolean;
  actions?: MessageActions;
  /** Captured sub-agent transcripts, keyed by run id (deep agents). */
  subagentRuns?: SubagentRuns;
}) {
  const turns = buildTurns(messages);

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

const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The sub-agent's headline — its last substantive line — for a collapsed preview. */
function runPreview(run: SubagentRun): string | undefined {
  const msgs = run.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = messageText(msgs[i].content).trim();
    if (t) return t.replace(/[#*`>|]/g, '').replace(/\s+/g, ' ');
  }
  return run.description;
}

/**
 * "Sub-agents" — a soft, progressive panel of the specialists a run delegated to
 * (native sub-agents: trading analysts, council personas; or captured deep-agent
 * sub-agents). Each is an avatar row with a one-line preview; tapping reveals its
 * own nested timeline. Nothing is expanded until you ask for it.
 */
export function SubagentActivity({ runs }: { runs?: SubagentRun[] }) {
  const list = (runs ?? []).filter(
    (r) =>
      (r.messages?.length ?? 0) > 0 ||
      Object.keys(r.stateValues ?? {}).length > 0 ||
      r.renderDetail != null ||
      r.status != null,
  );
  if (list.length === 0) return null;

  return (
    <Card tone="sticker" className="gap-1">
      <View className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-crumb bg-frosting-100 dark:bg-night-surface-muted">
          <Icon name="agents" size={16} color={palette.frosting[600]} />
        </View>
        <View className="flex-1">
          <Text variant="heading" className="text-base">Sub-agents</Text>
          <Text variant="muted" className="text-xs">
            {list.length} specialist{list.length > 1 ? 's' : ''} · tap to see how each one worked
          </Text>
        </View>
      </View>
      <View className="mt-1">
        {list.map((r, i) => (
          <SubAgentRunRow key={(r.name ?? '') + i} run={r} last={i === list.length - 1} />
        ))}
      </View>
    </Card>
  );
}

const DATA_KEY_RE = /(_series|_history|_latest|_1y)$|^(market_cap|insider_trades|company_news|metrics_history|prices_1y)$/;

/**
 * Stage-oriented digest of a native sub-agent's state: which data it collected
 * (chips with point counts) and the evidence it computed. Gives persona /
 * specialist detail real depth even when only the final message survived.
 */
export function SubagentStateDigest({ values }: { values?: Record<string, unknown> }) {
  if (!values) return null;
  const dataKeys = Object.entries(values).filter(([k, v]) => DATA_KEY_RE.test(k) && v != null);
  const evidence = values.evidence;
  const hasEvidence = evidence != null && (!Array.isArray(evidence) || evidence.length > 0);
  if (dataKeys.length === 0 && !hasEvidence) return null;

  return (
    <View className="gap-2">
      {dataKeys.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Data collected</Text>
          <View className="flex-row flex-wrap gap-1.5">
            {dataKeys.map(([k, v]) => {
              const label = titleCase(k.replace(DATA_KEY_RE, '').replace(/_/g, ' ').trim() || k);
              const count = Array.isArray(v) ? ` · ${v.length}` : '';
              return <Badge key={k} label={`${label}${count}`} tone="info" />;
            })}
          </View>
        </View>
      ) : null}
      {hasEvidence ? (
        <View className="gap-1">
          <Text variant="label">Evidence</Text>
          <StructuredOutput value={evidence} />
        </View>
      ) : null}
    </View>
  );
}

function SubAgentRunRow({ run, last }: { run: SubagentRun; last: boolean }) {
  const [open, setOpen] = useState(false);
  const label = titleCase(run.name || 'sub-agent');
  const preview = runPreview(run);
  const steps = run.messages?.length ?? 0;
  // Never open into an empty container: without detail the row is inert.
  const expandable =
    run.renderDetail != null || (run.messages?.length ?? 0) > 0 || Object.keys(run.stateValues ?? {}).length > 0 || !!run.description;

  return (
    <View className="flex-row gap-3">
      <View className="w-8 items-center">
        {!last ? <View style={{ ...RAIL, top: 18 }} className="bg-frosting-100 dark:bg-night-border" /> : null}
        <View className="z-10 rounded-pill">
          <Avatar name={label} size={32} />
        </View>
      </View>
      <Pressable
        onPress={expandable ? () => setOpen((o) => !o) : undefined}
        className="flex-1 border-b border-frosting-100 py-2 active:opacity-70 dark:border-night-border">
        <View className="flex-row items-center gap-2">
          <Text variant="body" className="flex-1 text-sm font-heading">{label}</Text>
          {run.status === 'running' ? <ActivityIndicator size="small" color={palette.butter[500]} /> : null}
          {run.status === 'error' ? <Badge label="error" tone="bearish" /> : null}
          {steps > 1 ? <Text variant="muted" className="text-xs">{steps} steps</Text> : null}
          {expandable ? (
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
          ) : null}
        </View>
        {!open && preview ? (
          <Text variant="muted" className="mt-0.5 text-xs" numberOfLines={2}>{preview}</Text>
        ) : null}
        {open ? (
          <View className="mt-2 gap-3 rounded-crumb bg-white/50 p-2 dark:bg-night-bg/40">
            {run.description ? (
              <View className="gap-1">
                <Text variant="label">Brief</Text>
                <Text variant="muted" className="text-xs">{run.description}</Text>
              </View>
            ) : null}
            {run.renderDetail?.()}
            <SubagentStateDigest values={run.stateValues} />
            {run.messages?.length ? <Conversation messages={run.messages} viewMode="verbose" /> : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
