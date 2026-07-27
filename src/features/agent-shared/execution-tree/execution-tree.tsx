/**
 * The recursive drill-down for the Execution Tree view: a vertical rail of Level-0
 * plan steps (`buildExecTree`, `plan-steps.ts`), each row expandable into a shared
 * body (Result / Steps / children / Tool calls) that recurses to any depth.
 *
 * **Everything below the root is fetched on expand.** A row that owns a LangGraph
 * `namespace` reads that namespace's checkpoints when it opens (`useRunTreeNode`) —
 * its transcript, the tool calls inside that transcript, and the tasks that ran under
 * it, which become the next level of rows. Collapsed rows cost nothing, so a 27-node
 * criteria run only ever pays for the branches the reader actually opens.
 *
 * `NodeFacets` and `TreeNodeRow` are mutually recursive (a node's body renders child
 * rows; a row's expanded body IS `NodeFacets`) — kept in one file with hoisted
 * `function` declarations to avoid a cross-file require cycle, exactly like
 * `conversation.tsx`'s Conversation/StepTimeline pair.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Skeleton, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { renderNodeOutput, ToolRunsPanel } from '@/lib/agent/renderers';
import type { AgentDef } from '@/lib/agent/registry';
import { Conversation } from '../conversation';
import { coerceMessages, type ConversationMessage } from '../conversation-turns';
import { type ByNode } from '../run-progress';
import { useRunTreeNode, useRunTreeRoot } from '../use-run-tree';
import type { ExecNode, ExecStatus } from '@/lib/agent/exec-tree';
import { buildExecTree } from './plan-steps';

/** Leading status dot for one rail row — mirrors `StageDot` (`run-progress.tsx`)
 * but covers all four `ExecStatus` values (adds `error`). */
function ExecStatusDot({ status }: { status?: ExecStatus }) {
  if (status === 'done') return <Icon name="check-circle" size={18} color={palette.leaf[500]} weight="fill" />;
  if (status === 'active') return <ActivityIndicator size="small" color={palette.butter[500]} />;
  if (status === 'error') return <Icon name="warning" size={18} color={palette.bearish} weight="fill" />;
  return <View className="h-3.5 w-3.5 self-center rounded-pill border-2 border-frosting-200 dark:border-night-border" />;
}

/**
 * One `ExecNode`'s expanded body, at any depth.
 *
 * Two sources compose here. Whatever the node already carries — a stage's output from
 * streamed `values`, a task's own channel writes — renders immediately. Its namespace
 * detail (transcript, tool calls, children) is fetched now that the row is open, and
 * fills in beneath. A stage row with no namespace of its own still lists its children,
 * which each fetch their own.
 */
function NodeFacets({ node, threadId, busy }: { node: ExecNode; threadId?: string; busy?: boolean }) {
  const { data: detail, isPending } = useRunTreeNode(threadId, node.namespace, !!node.namespace, busy);

  const children = detail?.children.length ? detail.children : node.children;
  const messages = coerceMessages((detail?.messages ?? []) as ConversationMessage[]);
  const toolRuns = detail?.toolRuns ?? node.toolRuns ?? [];
  const output = node.output;

  const hasEagerContent = output != null || node.children.length > 0;
  if (isPending && node.namespace && !hasEagerContent) {
    return (
      <View className="gap-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/5" />
      </View>
    );
  }

  const hasBody = output != null || messages.length > 0 || children.length > 0 || toolRuns.length > 0;
  if (!hasBody) {
    return (
      <Text variant="muted" className="text-xs">
        {node.namespace
          ? 'This step recorded no transcript, tool calls or sub-steps.'
          : // A leaf by construction: a plain function node in the graph, not a
            // missing branch. Saying so beats an empty panel that reads as a bug.
            'This step is a single call with no sub-steps of its own.'}
      </Text>
    );
  }

  return (
    <View className="gap-3">
      {output != null ? (
        <View className="gap-1">
          <Text variant="label">Result</Text>
          {renderNodeOutput({ name: node.label, outputKind: node.outputKind }, output, threadId)}
        </View>
      ) : null}
      {messages.length > 0 ? <Conversation messages={messages} viewMode="verbose" /> : null}
      {children.length > 0 ? (
        <View className="gap-1">
          {children.map((c) => (
            <TreeNodeRow key={c.id} node={c} threadId={threadId} busy={busy} depth={1} />
          ))}
        </View>
      ) : null}
      {toolRuns.length > 0 ? <ToolRunsPanel title="Tool calls" mode="flat" runs={toolRuns} /> : null}
    </View>
  );
}

/**
 * One rail row: a leading status dot + label, tap to expand into `NodeFacets`.
 * Bespoke (not the generic `Collapsible`) because it needs to host the status
 * dot + optional icon ahead of the label — modeled on `ToolRunRow`
 * (`tool-runs.tsx`) + `StageChecklist` (`run-progress.tsx`).
 *
 * `NodeFacets` is mounted only while open, which is what keeps the fetch lazy.
 */
function TreeNodeRow({
  node,
  threadId,
  busy,
  depth = 0,
}: {
  node: ExecNode;
  threadId?: string;
  busy?: boolean;
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className={cn('rounded-crumb', depth > 0 && 'border-l-2 border-frosting-100 pl-2 dark:border-night-border')}>
      <Pressable onPress={() => setOpen((o) => !o)} className="flex-row items-center gap-2 py-1.5 active:opacity-70">
        <View className="w-5 items-center">
          <ExecStatusDot status={node.status} />
        </View>
        {node.icon ? <Icon name={node.icon} size={16} color={palette.frosting[500]} /> : null}
        <Text variant="body" className={cn('flex-1 text-sm', node.status === 'active' && 'font-heading')}>
          {node.label}
        </Text>
        {node.summary ? <Text variant="muted" className="text-xs">{node.summary}</Text> : null}
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} color={palette.frosting[400]} weight="bold" />
      </Pressable>
      {open ? (
        <View className="pb-2 pl-6">
          <NodeFacets node={node} threadId={threadId} busy={busy} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The Execution Tree view: the Level-0 plan rendered as a rail of expandable rows,
 * each recursing into what really ran under it.
 *
 * The root topology is read once per thread; everything deeper waits for a tap.
 */
export function ExecutionTree({
  agent,
  values,
  busy,
  byNode,
  threadId,
}: {
  agent: AgentDef;
  values: Record<string, unknown>;
  busy: boolean;
  byNode?: ByNode;
  threadId?: string;
}) {
  const { data: topology, isPending } = useRunTreeRoot(threadId, busy);
  const nodes = buildExecTree(agent, values, busy, topology ?? [], byNode);

  if (isPending && nodes.length === 0) {
    return (
      <View className="gap-1.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-3/5" />
      </View>
    );
  }

  if (nodes.length === 0) {
    return (
      <Text variant="muted" className="text-sm">
        No execution recorded for this run.
      </Text>
    );
  }

  return (
    <View className="gap-1">
      {nodes.map((n) => (
        <TreeNodeRow key={n.id} node={n} threadId={threadId} busy={busy} depth={0} />
      ))}
    </View>
  );
}
