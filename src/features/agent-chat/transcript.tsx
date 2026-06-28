import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon, type IconName } from '@/components/icons';
import { Badge, Button, Card, Collapsible, Field, Text } from '@/components/ui';
import {
  isTodoList,
  JsonBlock,
  Markdown,
  messageKind,
  messageText,
  TodoList,
  type AnyMessage,
  type Todo,
} from '@/lib/agent/renderers';
import type { RunStep } from '@/lib/agent/steps';
import { palette } from '@/theme/colors';

export type ViewMode = 'summary' | 'verbose';

/** Group steps into a top-level list + per-namespace (sub-agent) buckets. */
function groupSteps(steps: RunStep[]) {
  const top: RunStep[] = [];
  const groups = new Map<string, RunStep[]>();
  for (const s of steps) {
    if (s.namespace.length === 0) top.push(s);
    else {
      const key = s.namespace[0];
      const arr = groups.get(key) ?? [];
      arr.push(s);
      groups.set(key, arr);
    }
  }
  return { top, groups };
}

function StepRow({ step }: { step: RunStep }) {
  return (
    <View className="flex-row items-center gap-2 py-0.5">
      <Icon name={step.icon} size={15} color={palette.frosting[400]} />
      <Text variant="muted" className="flex-1 text-sm">
        {step.label}
      </Text>
    </View>
  );
}

function subagentTitle(namespace: string): string {
  const name = namespace.split(':')[0].replace(/_/g, ' ');
  return `Sub-agent · ${name.replace(/\b\w/g, (c) => c.toUpperCase())}`;
}

/** Minimal, hierarchical run timeline. Collapsed by default; open while busy. */
export function StepsTrail({ steps, busy }: { steps: RunStep[]; busy: boolean }) {
  if (steps.length === 0) return null;
  const { top, groups } = groupSteps(steps);

  return (
    <Collapsible
      title="Steps"
      icon="sparkle"
      meta={`${steps.length}`}
      defaultOpen={busy}
      headerRight={busy ? <ActivityIndicator size="small" color={palette.frosting[400]} /> : undefined}>
      {top.map((s) => (
        <StepRow key={s.id} step={s} />
      ))}
      {[...groups.entries()].map(([ns, arr]) => (
        <Collapsible key={ns} title={subagentTitle(ns)} icon="agents" depth={1} meta={`${arr.length}`}>
          {arr.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </Collapsible>
      ))}
    </Collapsible>
  );
}

/** One tool call, paired with its result text if present. Used in verbose view. */
function ToolBlock({
  call,
  resultText,
}: {
  call: { name?: string; args?: unknown };
  resultText?: string;
}) {
  if (call.name?.includes('write_todos') && isTodoList((call.args as { todos?: unknown })?.todos)) {
    return <TodoList todos={(call.args as { todos: Todo[] }).todos} />;
  }
  return (
    <Collapsible title={`Tool · ${call.name ?? 'call'}`} icon="tools">
      <Text variant="label">arguments</Text>
      <JsonBlock value={call.args} />
      {resultText ? (
        <>
          <Text variant="label">result</Text>
          <Text variant="mono" className="text-xs">
            {resultText.slice(0, 2000)}
          </Text>
        </>
      ) : null}
    </Collapsible>
  );
}

export type BranchInfo = { index: number; total: number; prev?: string; next?: string };

export type MessageActions = {
  busy: boolean;
  onCopy: (text: string) => void;
  onEdit: (message: AnyMessage, text: string) => void;
  onRegenerate: (message: AnyMessage) => void;
  branchInfo: (message: AnyMessage) => BranchInfo | undefined;
  onSetBranch: (branch: string) => void;
};

function IconBtn({ icon, onPress, disabled }: { icon: IconName; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`h-7 w-7 items-center justify-center rounded-pill active:opacity-60 ${disabled ? 'opacity-40' : ''}`}>
      <Icon name={icon} size={15} color={palette.frosting[400]} />
    </Pressable>
  );
}

function MessageView({
  message,
  viewMode,
  toolResults,
  actions,
}: {
  message: AnyMessage;
  viewMode: ViewMode;
  toolResults: Map<string, string>;
  actions: MessageActions;
}) {
  const kind = messageKind(message);
  const body = messageText(message.content);
  const isHuman = kind === 'human' || kind === 'user';
  const toolCalls = message.tool_calls ?? [];
  const branch = actions.branchInfo(message);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(body);

  return (
    <Card tone={isHuman ? 'outline' : 'raised'} className="gap-2">
      <Badge label={isHuman ? 'you' : message.name ?? 'agent'} tone="info" />

      {editing ? (
        <View className="gap-2">
          <Field value={editText} onChangeText={setEditText} multiline autoFocus />
          <View className="flex-row gap-2">
            <Button
              title="Save & resend"
              size="sm"
              disabled={actions.busy || !editText.trim()}
              onPress={() => {
                setEditing(false);
                actions.onEdit(message, editText.trim());
              }}
            />
            <Button title="Cancel" size="sm" variant="ghost" onPress={() => setEditing(false)} />
          </View>
        </View>
      ) : body ? (
        isHuman ? <Text variant="body">{body}</Text> : <Markdown value={body} />
      ) : null}

      {viewMode === 'verbose' && toolCalls.length > 0 ? (
        <View className="gap-2">
          {toolCalls.map((tc, i) => (
            <ToolBlock key={tc.id ?? i} call={tc} resultText={tc.id ? toolResults.get(tc.id) : undefined} />
          ))}
        </View>
      ) : null}

      {!editing ? (
        <View className="flex-row items-center gap-1 pt-1">
          {branch && branch.total > 1 ? (
            <View className="flex-row items-center">
              <IconBtn
                icon="arrow-left"
                onPress={() => branch.prev && actions.onSetBranch(branch.prev)}
                disabled={!branch.prev}
              />
              <Text variant="muted" className="text-xs">
                {branch.index + 1}/{branch.total}
              </Text>
              <IconBtn
                icon="arrow-right"
                onPress={() => branch.next && actions.onSetBranch(branch.next)}
                disabled={!branch.next}
              />
            </View>
          ) : null}
          <View className="flex-1" />
          {body ? <IconBtn icon="copy" onPress={() => actions.onCopy(body)} /> : null}
          {isHuman ? (
            <IconBtn
              icon="edit"
              disabled={actions.busy}
              onPress={() => {
                setEditText(body);
                setEditing(true);
              }}
            />
          ) : (
            <IconBtn icon="regenerate" disabled={actions.busy} onPress={() => actions.onRegenerate(message)} />
          )}
        </View>
      ) : null}
    </Card>
  );
}

export function Transcript({
  messages,
  steps,
  todos,
  viewMode,
  busy,
  actions,
}: {
  messages: AnyMessage[];
  steps: RunStep[];
  todos?: Todo[];
  viewMode: ViewMode;
  busy: boolean;
  actions: MessageActions;
}) {
  // Map tool_call_id → result text so verbose tool blocks can show their output.
  const toolResults = new Map<string, string>();
  for (const m of messages) {
    if (messageKind(m) === 'tool') {
      const id = (m as { tool_call_id?: string }).tool_call_id;
      if (id) toolResults.set(id, messageText(m.content));
    }
  }

  const visible = messages.filter((m) => {
    const kind = messageKind(m);
    if (kind === 'tool') return false; // tool output surfaced via verbose tool blocks + steps
    if (kind === 'human' || kind === 'user') return true;
    // AI: in summary, only show messages that carry an answer (hide pure tool-call turns).
    if (viewMode === 'summary') return messageText(m.content).trim().length > 0;
    return true;
  });

  return (
    <View className="gap-2">
      {todos && todos.length > 0 ? <TodoList todos={todos} /> : null}
      <StepsTrail steps={steps} busy={busy} />
      {visible.map((m, i) => (
        <MessageView key={m.id ?? i} message={m} viewMode={viewMode} toolResults={toolResults} actions={actions} />
      ))}
    </View>
  );
}
