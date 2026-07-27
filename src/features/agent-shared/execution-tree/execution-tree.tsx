/**
 * The recursive drill-down component for the Execution Tree view: a vertical
 * rail of Level-0 plan steps (`buildExecTree`, `plan-steps.ts`), each row
 * expandable to a shared 4-facet body (Result / Steps / Sub-agents /
 * Tool-calls) that recurses into child `TreeNodeRow`s to any depth. Enriches
 * `NodeDetail` (`node-detail.tsx`) with the output-shape registry
 * (`renderNodeOutput`) and the Sub-agents facet's recursion.
 *
 * `NodeFacets` and `TreeNodeRow` are mutually recursive (a node's Sub-agents
 * facet renders child rows; a row's expanded body IS `NodeFacets`) — kept in
 * one file with `function` declarations (hoisted) to avoid a cross-file
 * require cycle, exactly like `conversation.tsx`'s Conversation/StepTimeline
 * pair.
 */
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { Icon } from '@/components/icons';
import { Skeleton, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import { palette } from '@/theme/colors';
import { renderNodeOutput, ToolRunsPanel, type ToolRun } from '@/lib/agent/renderers';
import { parseArray, zToolRun } from '@/lib/agent/schemas';
import type { AgentDef } from '@/lib/agent/registry';
import { Conversation } from '../conversation';
import { coerceMessages, type ConversationMessage } from '../conversation-turns';
import { type ByNode } from '../run-progress';
import { useSubagentDetail } from '../use-subagent-detail';
import type { ExecNode, ExecStatus } from '@/lib/agent/exec-tree';
import { buildExecTree } from './plan-steps';

/** Drop tool runs that appear in both the eager per-node list and the lazily
 * fetched Store detail (same call homed to two places). Keyed on `args_hash`
 * when present; records without one (rare — errors, `task` delegations) always
 * pass through, since they have no stable identity to collapse on. */
function dedupeToolRuns(runs: ToolRun[]): ToolRun[] {
  const seen = new Set<string>();
  return runs.filter((r) => {
    if (!r.args_hash) return true;
    const key = `${r.tool ?? ''}:${r.args_hash}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Leading status dot for one rail row — mirrors `StageDot` (`run-progress.tsx`)
 * but covers all four `ExecStatus` values (adds `error`). */
function ExecStatusDot({ status }: { status?: ExecStatus }) {
  if (status === 'done') return <Icon name="check-circle" size={18} color={palette.leaf[500]} weight="fill" />;
  if (status === 'active') return <ActivityIndicator size="small" color={palette.butter[500]} />;
  if (status === 'error') return <Icon name="warning" size={18} color={palette.bearish} weight="fill" />;
  return <View className="h-3.5 w-3.5 self-center rounded-pill border-2 border-frosting-200 dark:border-night-border" />;
}

/**
 * The shared 4-facet expanded body for one `ExecNode`, at any depth. Lazily
 * fetches Store detail only for real captured agent nodes (`detailNodeId`);
 * eager `node.output`/`node.toolRuns` (already in streamed `values`) render
 * immediately, the Store fetch only fills in what wasn't eager.
 */
function NodeFacets({ node, threadId }: { node: ExecNode; threadId?: string }) {
  const enabled = !!node.detailNodeId;
  const { data: detail, isPending } = useSubagentDetail(threadId, node.detailNodeId ?? '', enabled);

  const output = node.output ?? detail?.output;
  const messages = coerceMessages((detail?.messages ?? []) as ConversationMessage[]);
  // Merge eager per-node tool runs (e.g. a criterion's homed `tool_runs`) with
  // the node's lazily-fetched Store detail, de-duping: a criterion node carries
  // BOTH its homed copy AND a `detailNodeId` pointing at the same worker, so the
  // two sources overlap. Key on `args_hash` (the backend's stable per-call id).
  const toolRuns = dedupeToolRuns([
    ...(node.toolRuns ?? []),
    ...parseArray(zToolRun, detail?.tool_runs, 'exec.tool_runs'),
  ]);

  const hasEagerContent = node.output != null || !!node.toolRuns?.length || node.children.length > 0;
  if (isPending && !hasEagerContent) {
    return (
      <View className="gap-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/5" />
      </View>
    );
  }

  const hasBody = output != null || messages.length > 0 || node.children.length > 0 || toolRuns.length > 0;
  if (!hasBody) {
    return (
      <Text variant="muted" className="text-xs">
        No detail was recorded for this step.
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
      {node.children.length > 0 ? (
        <View className="gap-1">
          {node.children.map((c) => (
            <TreeNodeRow key={c.id} node={c} threadId={threadId} depth={1} />
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
 */
function TreeNodeRow({
  node,
  threadId,
  depth = 0,
}: {
  node: ExecNode;
  threadId?: string;
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
          <NodeFacets node={node} threadId={threadId} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The Execution Tree view: the Level-0 plan (`buildExecTree`) rendered as a
 * rail of expandable `TreeNodeRow`s, each recursing into its real captured
 * sub-agent topology on expand.
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
  const nodes = buildExecTree(agent, values, busy, byNode);
  if (nodes.length === 0) {
    return <Text variant="muted" className="text-sm">No execution recorded for this run.</Text>;
  }
  return (
    <View className="gap-1">
      {nodes.map((n) => (
        <TreeNodeRow key={n.id} node={n} threadId={threadId} depth={0} />
      ))}
    </View>
  );
}
