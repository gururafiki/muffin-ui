/**
 * One sub-agent tree node's expanded content — lazily fetched from the Store
 * (`useSubagentDetail`) the moment its `SubAgentRunRow` is expanded, so the
 * heavy transcript/tool-run payload never inflates `thread.values`. Reuses
 * the same renderers `SubgraphDetail` composes (`Conversation`,
 * `StructuredOutput`, `ToolRunsPanel`) — this is the sub-agent-tree
 * equivalent for nodes whose detail lives in the Store rather than a
 * discovered protocol-v2 subgraph.
 */
import { View } from 'react-native';

import { Skeleton, Text } from '@/components/ui';
import { StructuredOutput, ToolRunsPanel } from '@/lib/agent/renderers';
import { parseArray, zToolRun } from '@/lib/agent/schemas';
import { Conversation } from './conversation';
import { coerceMessages, type ConversationMessage } from './conversation-turns';
import { useSubagentDetail } from './use-subagent-detail';

export function NodeDetail({
  threadId,
  nodeId,
  hasDetail,
  synthetic,
}: {
  threadId?: string;
  nodeId: string;
  /** Optimistic backend hint that this node has Store detail — `false`
   * skips the fetch outright (nothing to wait on); `true`/absent still
   * tolerates a miss (the backend's store write is best-effort). */
  hasDetail?: boolean;
  /** A structural placeholder synthesized by `buildForest` for an ancestor
   * id prefix that was never itself captured — its children carry the real
   * detail, so this node has none of its own. */
  synthetic: boolean;
}) {
  const enabled = !synthetic && hasDetail !== false;
  const { data, isPending } = useSubagentDetail(threadId, nodeId, enabled);

  if (synthetic) return null;

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
