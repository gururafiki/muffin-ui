/**
 * One execution-tree node's expanded content, in the **Overview**'s idiom — fetched
 * the moment its row is expanded, straight from that node's LangGraph namespace.
 *
 * `namespace` is the single gate: `undefined` means there is nothing to fetch, because
 * the node is a plain function node in the graph rather than a compiled agent/subgraph.
 * That is a leaf by construction, not missing data.
 *
 * Reuses the same renderers `SubgraphDetail` composes (`Conversation`,
 * `StructuredOutput`, `ToolRunsPanel`).
 */
import { View } from 'react-native';

import { Skeleton, Text } from '@/components/ui';
import { StructuredOutput, ToolRunsPanel } from '@/lib/agent/renderers';
import { Conversation } from './conversation';
import { coerceMessages, type ConversationMessage } from './conversation-turns';
import { useRunTreeNode } from './use-run-tree';

export function NodeDetail({
  threadId,
  namespace,
  output,
  busy,
}: {
  threadId?: string;
  namespace?: string;
  /** Already-known structured output (a task's own channel writes) — rendered
   * immediately, without waiting for the namespace read. */
  output?: unknown;
  busy?: boolean;
}) {
  const { data, isPending } = useRunTreeNode(threadId, namespace, !!namespace, busy);

  if (!namespace && output == null) return null;

  if (isPending && namespace && output == null) {
    return (
      <View className="gap-1.5">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/5" />
      </View>
    );
  }

  const messages = coerceMessages((data?.messages ?? []) as ConversationMessage[]);
  const toolRuns = data?.toolRuns ?? [];
  const hasBody = messages.length > 0 || toolRuns.length > 0 || output != null;

  if (!hasBody) {
    return (
      <Text variant="muted" className="text-xs">
        This step recorded no transcript or tool calls.
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
