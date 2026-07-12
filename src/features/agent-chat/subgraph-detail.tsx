import { toMessageDict } from '@langchain/langgraph-sdk/ui';
import { useMessages, useToolCalls } from '@langchain/react';
import { View } from 'react-native';

import { Collapsible, Text } from '@/components/ui';
import {
  CriterionDetails,
  StructuredOutput,
  ToolRunList,
  type AnyMessage,
  type Criterion,
  type ToolRun,
} from '@/lib/agent/renderers';
import { Conversation } from './conversation';
import type { SubgraphRow } from './run-projections';

/** Map protocol-v2 assembled tool calls onto the `ToolRunList` row shape. */
function toToolRuns(
  calls: readonly { name: string; input?: unknown; output?: unknown; status: string; error?: string }[],
): ToolRun[] {
  return calls.map((c) => ({
    tool: c.name,
    status: c.status === 'error' ? 'error' : c.status === 'finished' ? 'ok' : 'running',
    args_preview: c.input === undefined ? undefined : JSON.stringify(c.input).slice(0, 300),
    output_preview: c.output == null ? undefined : (typeof c.output === 'string' ? c.output : JSON.stringify(c.output)).slice(0, 400),
    error: c.error,
  }));
}

/**
 * Expanded content of one discovered subgraph invocation (criteria worker /
 * stage agent / trading analyst).
 *
 * Live runs: the scoped transcript + tool calls streamed under the node's
 * namespace (scoped selectors read from the shared channel registry, so
 * mounting this lazily — on expand — opens no extra connections).
 *
 * Completed threads: the event stream is gone (transient buffer, never
 * replayable), so the scoped channels stay empty. The row falls back to what
 * checkpointed state DID keep: the criterion evaluation (workers), the stage's
 * structured output (registry `StageDef.output`), and the run-level `tool_runs`
 * records the backend attributed to this node.
 */
export function SubgraphDetail({ stream, row }: { stream: unknown; row: SubgraphRow }) {
  const scopedMessages = useMessages(stream as never, row.namespace);
  const toolCalls = useToolCalls(stream as never, row.namespace);

  const messages = scopedMessages.map((m) => toMessageDict(m)) as AnyMessage[];
  const liveRuns = toToolRuns(toolCalls as never);
  // Live tool calls win (they carry running/error states mid-run); persisted
  // records are the history substrate once the stream is gone.
  const runs = liveRuns.length > 0 ? liveRuns : (row.toolRuns ?? []);
  const output = row.evaluation == null && messages.length === 0 ? row.output : undefined;
  const hasBody = !!row.evaluation || output != null || messages.length > 0 || runs.length > 0;

  if (!hasBody) {
    return (
      <Text variant="muted" className="text-xs">
        {row.status === 'running' ? 'Working — details will appear as this specialist reports back.' : 'No detail was recorded for this step.'}
      </Text>
    );
  }

  return (
    <View className="gap-3">
      {row.evaluation ? <CriterionDetails c={row.evaluation as Criterion} /> : null}
      {output != null ? (
        <View className="gap-1">
          <Text variant="label">Result</Text>
          <StructuredOutput value={output} />
        </View>
      ) : null}
      {runs.length > 0 ? (
        <Collapsible title="Tool calls" icon="tools" meta={`${runs.length}`}>
          <ToolRunList runs={runs} />
        </Collapsible>
      ) : null}
      {messages.length > 0 ? <Conversation messages={messages} viewMode="verbose" /> : null}
    </View>
  );
}
