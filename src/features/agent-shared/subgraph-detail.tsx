import { toMessageDict } from '@langchain/langgraph-sdk/ui';
import { useMessages, useToolCalls } from '@langchain/react';
import { View } from 'react-native';

import { Skeleton, Text } from '@/components/ui';
import {
  DebateTurns,
  bullBearTurns,
  debatersForTurns,
  namedMessageTurns,
} from '@/features/multi-agent/debate';
import {
  CriterionDetails,
  StructuredOutput,
  ToolRunsPanel,
  type AnyMessage,
  type ToolRun,
} from '@/lib/agent/renderers';
import { useRunStreamContext } from '@/lib/agent/stream-context';
import { Conversation } from './conversation';
import type { SubgraphRow } from './run-projections';

/**
 * Shape a stage's `detail: 'debate'` output into debate turn bubbles. This is
 * always reached from an already-expanded `SubAgentRunRow`, so it renders the
 * bare `DebateTurns` — not a second nested collapsible.
 */
function DebateDetail({ output }: { output: unknown }) {
  const turns = Array.isArray(output)
    ? namedMessageTurns(output)
    : bullBearTurns(
        (output as { bull?: unknown } | null)?.bull,
        (output as { bear?: unknown } | null)?.bear,
      );
  return <DebateTurns debaters={debatersForTurns(turns)} turns={turns} />;
}

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

/** Placeholder for a row whose detail hasn't landed yet — pulses while the
 * run is still busy, so an in-progress row doesn't look identical to one
 * that genuinely recorded nothing. */
function SubgraphDetailSkeleton() {
  return (
    <View className="gap-1.5">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-1/2" />
    </View>
  );
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
export function SubgraphDetail({ row }: { row: SubgraphRow }) {
  const stream = useRunStreamContext();
  const scopedMessages = useMessages(stream, row.namespace);
  const toolCalls = useToolCalls(stream, row.namespace);

  const messages = scopedMessages.map((m) => toMessageDict(m)) as AnyMessage[];
  const liveRuns = toToolRuns(toolCalls);
  // Live tool calls win (they carry running/error states mid-run); persisted
  // records are the history substrate once the stream is gone.
  const runs = liveRuns.length > 0 ? liveRuns : (row.toolRuns ?? []);
  const output = row.evaluation == null && messages.length === 0 ? row.output : undefined;
  const hasBody = !!row.evaluation || output != null || messages.length > 0 || runs.length > 0;

  if (!hasBody) {
    if (row.status !== 'error' && stream.isLoading) {
      return <SubgraphDetailSkeleton />;
    }
    return (
      <Text variant="muted" className="text-xs">
        {row.status === 'running' ? 'Working — details will appear as this specialist reports back.' : 'No detail was recorded for this step.'}
      </Text>
    );
  }

  return (
    <View className="gap-3">
      {row.evaluation ? <CriterionDetails c={row.evaluation} /> : null}
      {output != null ? (
        row.detail === 'debate' ? (
          <View className="gap-1">
            <Text variant="label">Debate</Text>
            <DebateDetail output={output} />
          </View>
        ) : (
          <View className="gap-1">
            <Text variant="label">Result</Text>
            <StructuredOutput value={output} />
          </View>
        )
      ) : null}
      <ToolRunsPanel title="Tool calls" runs={runs} mode="flat" />
      {messages.length > 0 ? <Conversation messages={messages} viewMode="verbose" /> : null}
    </View>
  );
}
