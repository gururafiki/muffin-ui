/**
 * One execution-tree node's expanded content — lazily fetched the moment its row is
 * expanded, so the heavy transcript/tool-run payload never inflates `thread.values`.
 * Reuses the same renderers `SubgraphDetail` composes (`Conversation`,
 * `StructuredOutput`, `ToolRunsPanel`).
 *
 * `detailNodeId` is the single gate: `undefined` means there is nothing to fetch —
 * either a synthetic placeholder (its children carry the real detail) or a node the
 * backend flagged as detail-less. The caller no longer has to pass `synthetic` and
 * `hasDetail` separately; `ExecNode.detailNodeId` already encodes both.
 */
import { View } from 'react-native';

import { Skeleton, Text } from '@/components/ui';
import { StructuredOutput, ToolRunsPanel } from '@/lib/agent/renderers';
import { parseArray, zToolRun } from '@/lib/agent/schemas';
import { Conversation } from './conversation';
import { coerceMessages, type ConversationMessage } from './conversation-turns';
import { useSubagentDetail } from './use-subagent-detail';

export function NodeDetail({ threadId, detailNodeId }: { threadId?: string; detailNodeId?: string }) {
  const enabled = !!detailNodeId;
  const { data, isPending } = useSubagentDetail(threadId, detailNodeId ?? '', enabled);

  if (!enabled) return null;

  if (isPending) {
    return (
      <View className="gap-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/5" />
      </View>
    );
  }

  const messages = coerceMessages((data?.messages ?? []) as ConversationMessage[]);
  const toolRuns = parseArray(zToolRun, data?.tool_runs, 'tool_runs');
  const output = data?.output;
  const hasBody = messages.length > 0 || toolRuns.length > 0 || output != null;

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
          <StructuredOutput value={output} />
        </View>
      ) : null}
      {messages.length > 0 ? <Conversation messages={messages} viewMode="verbose" /> : null}
      <ToolRunsPanel title="Tool calls" runs={toolRuns} mode="flat" />
    </View>
  );
}
